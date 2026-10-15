// Rondel on Cloudflare: Workers serve the built app; each meeting room is a Durable Object
// that runs the same Room logic as the Node server, storing encrypted entries in its SQLite.
import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_RETENTION_DAYS, Room, ROOM_ID, type Conn, type RoomStore } from '../core/room';
import { PROTOCOL_VERSION, type Entry } from '../core/protocol';

interface Env {
  ROOMS: DurableObjectNamespace<RoomObject>;
  ASSETS: Fetcher;
  /** Days a meeting is kept after its last change (wrangler.jsonc "vars"); "0" keeps it until deleted. */
  RETENTION_DAYS?: string;
  /** Connections per address per minute (wrangler.jsonc "ratelimits"). Absent in local dev. */
  CONNECT_LIMIT?: RateLimit;
}

class DurableStore implements RoomStore {
  constructor(private sql: SqlStorage, private kv: DurableObjectStorage, private wrote: () => void) {
    sql.exec('CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, data TEXT NOT NULL)');
  }
  async getAuthHash() {
    return (await this.kv.get<string>('auth')) ?? null;
  }
  async setAuthHash(hash: string) {
    await this.kv.put('auth', hash);
  }
  async entriesSince(since: number) {
    return this.sql.exec<{ seq: number; data: string }>('SELECT seq, data FROM entries WHERE seq > ? ORDER BY seq', since).toArray() as Entry[];
  }
  async append(data: string) {
    const { next } = this.sql.exec<{ next: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM entries').one();
    this.sql.exec('INSERT INTO entries (seq, data) VALUES (?, ?)', next, data);
    await this.touch();
    return next;
  }
  async compact(upTo: number, data: string) {
    this.kv.transactionSync(() => {
      this.sql.exec('DELETE FROM entries WHERE seq <= ?', upTo);
      this.sql.exec('INSERT INTO entries (seq, data) VALUES (?, ?)', upTo, data);
    });
    await this.touch();
  }
  private async touch() {
    await this.kv.put('lastWrite', Date.now());
    this.wrote();
  }
  async lastWrite() {
    const { n } = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM entries').one();
    return n ? ((await this.kv.get<number>('lastWrite')) ?? null) : null;
  }
  async clear(tombstone: boolean) {
    // Everything goes, including the auth hash; a tombstone is the only thing left behind.
    await this.kv.deleteAlarm();
    await this.kv.deleteAll(); // also drops the SQL tables
    this.sql.exec('CREATE TABLE IF NOT EXISTS entries (seq INTEGER PRIMARY KEY, data TEXT NOT NULL)');
    if (tombstone) await this.kv.put('gone', true);
  }
  async isGone() {
    return (await this.kv.get<boolean>('gone')) === true;
  }
  async stats() {
    return this.sql.exec<{ count: number; bytes: number }>('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)), 0) AS bytes FROM entries').one();
  }
}

/**
 * One meeting room. Connections use the hibernation API: between messages the object can be evicted
 * from memory, so a tab left open overnight costs nothing. On waking, the constructor hands the open
 * sockets back to a fresh Room, with whether each had already authenticated.
 */
export class RoomObject extends DurableObject<Env> {
  private room: Room;
  private conns = new Map<WebSocket, Conn>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const days = env.RETENTION_DAYS === undefined ? DEFAULT_RETENTION_DAYS : Number(env.RETENTION_DAYS);
    this.room = new Room(new DurableStore(ctx.storage.sql, ctx.storage, () => void this.schedule()), days);
    // Heartbeats are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    for (const ws of ctx.getWebSockets()) this.room.open(this.conn(ws), !!ws.deserializeAttachment()?.authed);
  }

  /** Keep one alarm at the room's expiry time; moved forward at most once a day to save writes. */
  private async schedule() {
    const at = await this.room.expiresAt();
    if (at === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current < at - 86_400_000) await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    const next = await this.room.expire();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  private conn(ws: WebSocket) {
    let c = this.conns.get(ws);
    if (!c) {
      c = {
        send: (t) => ws.send(t),
        close: (code, reason) => ws.close(code, reason),
        authed: () => ws.serializeAttachment({ authed: true }),
      };
      this.conns.set(ws, c);
    }
    return c;
  }

  async fetch(_req: Request) {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.room.open(this.conn(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data === 'string') await this.room.message(this.conn(ws), data);
  }

  async webSocketClose(ws: WebSocket) {
    this.room.close(this.conn(ws));
    this.conns.delete(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}

export default {
  async fetch(req: Request, env: Env) {
    const url = new URL(req.url);
    if (url.pathname.endsWith('/api/health')) {
      return Response.json({ rondel: true, protocol: PROTOCOL_VERSION }, { headers: { 'cache-control': 'no-store' } });
    }
    const m = /\/api\/rooms\/([^/?]+)$/.exec(url.pathname);
    if (m) {
      if (!ROOM_ID.test(m[1])) return new Response('Bad room', { status: 400 });
      if (req.headers.get('upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      // Generous, since a whole office can share one address; it stops scripts, not meetings.
      const ip = req.headers.get('cf-connecting-ip') ?? '';
      if (env.CONNECT_LIMIT && !(await env.CONNECT_LIMIT.limit({ key: ip })).success) {
        return new Response('Too many connections from this network, try again in a minute', { status: 429 });
      }
      return env.ROOMS.get(env.ROOMS.idFromName(m[1])).fetch(req);
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
