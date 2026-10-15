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
}

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

  constructor(private store: RoomStore) {}

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
      if (typeof msg.auth !== 'string' || msg.auth.length < 16) return this.fail(conn, 'bad-request', 'Missing auth');
      const hash = await sha256(msg.auth);
      const known = await this.store.getAuthHash();
      if (known === null) await this.store.setAuthHash(hash);
      else if (known !== hash) return this.fail(conn, 'forbidden', 'This link does not match the meeting');
      state.authed = true;
      conn.authed?.();
      const since = Number.isFinite(msg.since) ? msg.since : 0;
      const { count } = await this.store.stats();
      this.send(conn, { t: 'welcome', entries: await this.store.entriesSince(since), others: this.authedCount() - 1, entryCount: count });
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
