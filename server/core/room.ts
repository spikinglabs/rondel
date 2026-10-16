import { LIMITS, PROTOCOL_VERSION, type ClientMessage, type Entry, type ErrorCode, type ServerMessage } from './protocol';

/** Where a room keeps its data. Each platform adapter provides one (SQLite file, Durable Object storage, …). */
export interface RoomStore {
  /** SHA-256 of the room's auth token, set by the first client that connects. */
  getAuthHash(): Promise<string | null>;
  setAuthHash(hash: string): Promise<void>;
  /** Entries with seq > since, in seq order. */
  entriesSince(since: number): Promise<Entry[]>;
  /** Store a new entry and return its seq (strictly increasing). */
  append(data: string): Promise<number>;
  /** Delete entries with seq <= upTo and store `data` as the entry with seq = upTo. */
  compact(upTo: number, data: string): Promise<void>;
  stats(): Promise<{ count: number; bytes: number }>;
  /** When an entry was last stored or compacted (ms since 1970), or null for an empty room. */
  lastWrite(): Promise<number | null>;
  /**
   * Delete every entry and the auth hash. With `tombstone`, remember that the room was deleted on purpose,
   * so browsers that still hold a copy can't upload it again; without, the room id is simply free again.
   */
  clear(tombstone: boolean): Promise<void>;
  /** True after clear(true). */
  isGone(): Promise<boolean>;
}

/** How long the server keeps a meeting after its last change, unless the adapter says otherwise. */
export const DEFAULT_RETENTION_DAYS = 90;
const DAY = 86_400_000;

/** One open connection, as the adapter sees it. */
export interface Conn {
  send(text: string): void;
  close(code?: number, reason?: string): void;
  /** Called once the connection has proved it holds the link, so an adapter that sleeps between
   *  messages (Cloudflare hibernation) can remember it and pass `authed` back to `open` on waking. */
  authed?(): void;
}

/**
 * The whole server-side logic of a meeting room, independent of where it runs. An adapter creates one
 * Room per room id, passes it connections and their text frames, and supplies a RoomStore.
 */
export class Room {
  private conns = new Map<Conn, { authed: boolean }>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private store: RoomStore, private retentionDays = DEFAULT_RETENTION_DAYS) {}

  /** When the room expires if nothing changes before then (ms), or null when it holds nothing. */
  async expiresAt() {
    const last = await this.store.lastWrite();
    return last === null || this.retentionDays <= 0 ? null : last + this.retentionDays * DAY;
  }

  /**
   * Called by the adapter's timer: deletes the room if it has passed its retention time and nobody is
   * connected. Returns when to check again (ms), or null when there is nothing left to expire.
   */
  async expire(now = Date.now()): Promise<number | null> {
    const at = await this.expiresAt();
    if (at === null) return null;
    if (this.conns.size > 0) return Math.max(at, now + DAY);
    if (at > now) return at;
    await this.store.clear(false);
    return null;
  }

  get size() {
    return this.conns.size;
  }

  /** A new connection, or (with `authed`) one an adapter is handing back after the room was asleep. */
  open(conn: Conn, authed = false) {
    if (authed) {
      this.conns.set(conn, { authed: true });
      return;
    }
    if (this.conns.size >= LIMITS.maxConnections) {
      this.fail(conn, 'room-full', 'This meeting has too many open connections');
      return;
    }
    this.conns.set(conn, { authed: false });
  }

  close(conn: Conn) {
    const state = this.conns.get(conn);
    this.conns.delete(conn);
    if (state?.authed) this.broadcast(conn, { t: 'peers', others: 0, joined: false }, true);
  }

  /** Handle one text frame. Frames are processed one at a time so seqs and acks stay in order. */
  message(conn: Conn, text: string) {
    this.queue = this.queue.then(() => this.handle(conn, text)).catch(() => this.fail(conn, 'bad-request', 'Could not process message'));
    return this.queue;
  }

  private async handle(conn: Conn, text: string) {
    const state = this.conns.get(conn);
    if (!state) return;
    if (text.length > LIMITS.maxFrame) return this.fail(conn, 'too-large', 'Message too large');
    let msg: ClientMessage;
    try {
      msg = JSON.parse(text);
    } catch {
      return this.fail(conn, 'bad-request', 'Not JSON');
    }

    if (!state.authed) {
      if (msg.t !== 'hello') return this.fail(conn, 'bad-request', 'Say hello first');
      if (msg.v !== PROTOCOL_VERSION) return this.fail(conn, 'version', 'Please reload the page to get the latest version');
      if (await this.store.isGone()) return this.fail(conn, 'gone', 'This meeting was deleted from the server');
      if (typeof msg.auth !== 'string' || msg.auth.length < 16) return this.fail(conn, 'bad-request', 'Missing auth');
      const hash = await sha256(msg.auth);
      const known = await this.store.getAuthHash();
      if (known === null) await this.store.setAuthHash(hash);
      else if (known !== hash) return this.fail(conn, 'forbidden', 'This link does not match the meeting');
      state.authed = true;
      conn.authed?.();
      const since = Number.isFinite(msg.since) ? msg.since : 0;
      const { count } = await this.store.stats();
      const expires = await this.expiresAt();
      this.send(conn, {
        t: 'welcome', entries: await this.store.entriesSince(since), others: this.authedCount() - 1, entryCount: count,
        expiresAt: expires === null ? null : new Date(expires).toISOString(), retentionDays: this.retentionDays,
      });
      this.broadcast(conn, { t: 'peers', others: 0, joined: true }, true);
      return;
    }

    switch (msg.t) {
      case 'ping':
        return this.send(conn, { t: 'pong' });
      case 'upd': {
        if (typeof msg.data !== 'string') return this.fail(conn, 'bad-request', 'Bad update');
        const { bytes } = await this.store.stats();
        if (bytes + msg.data.length > LIMITS.maxRoomBytes) return this.fail(conn, 'too-large', 'This meeting is full');
        const seq = await this.store.append(msg.data);
        this.send(conn, { t: 'ack', id: msg.id, seq });
        this.broadcast(conn, { t: 'upd', seq, data: msg.data });
        return;
      }
      case 'aw':
        if (typeof msg.data === 'string') this.broadcast(conn, { t: 'aw', data: msg.data });
        return;
      case 'compact':
        if (typeof msg.data !== 'string' || !Number.isInteger(msg.upTo) || msg.upTo < 1) return this.fail(conn, 'bad-request', 'Bad snapshot');
        await this.store.compact(msg.upTo, msg.data);
        return;
      case 'delete': {
        await this.store.clear(true);
        for (const c of [...this.conns.keys()]) {
          this.send(c, { t: 'deleted' });
          this.conns.delete(c);
          try {
            c.close(4000, 'gone');
          } catch {
            /* already closed */
          }
        }
        return;
      }
      default:
        return this.fail(conn, 'bad-request', 'Unknown message');
    }
  }

  private authedCount() {
    let n = 0;
    for (const s of this.conns.values()) if (s.authed) n++;
    return n;
  }

  private send(conn: Conn, msg: ServerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      this.conns.delete(conn);
    }
  }

  /** Send to every other authenticated connection. `peers` messages get each receiver's own count. */
  private broadcast(from: Conn, msg: ServerMessage, isPeers = false) {
    const others = this.authedCount() - 1;
    for (const [c, s] of this.conns) {
      if (c === from || !s.authed) continue;
      this.send(c, isPeers ? { ...(msg as any), others } : msg);
    }
  }

  private fail(conn: Conn, code: ErrorCode, message: string) {
    this.send(conn, { t: 'error', code, message });
    this.conns.delete(conn);
    try {
      conn.close(4000, code);
    } catch {
      /* already closed */
    }
  }
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Room ids are random base64url strings from the meeting link. */
export const ROOM_ID = /^[A-Za-z0-9_-]{8,64}$/;
