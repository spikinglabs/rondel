// The sync protocol between browsers and a Rondel room server. JSON text frames.
// Meeting content is end-to-end encrypted in the browser with the key from the meeting link;
// the server only stores and relays opaque base64 blobs and cannot read them.

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  /** First message on a connection. `auth` proves knowledge of the link key; `since` = last seq this client has. */
  | { t: 'hello'; v: number; auth: string; since: number }
  /** An encrypted document update to store and pass on. `id` is echoed in the ack. */
  | { t: 'upd'; id: number; data: string }
  /** Encrypted presence, passed on to the others in the room and never stored. */
  | { t: 'aw'; data: string }
  /** An encrypted snapshot that replaces every stored entry up to and including `upTo`. */
  | { t: 'compact'; upTo: number; data: string }
  /** Heartbeat, so clients notice a dead connection quickly. */
  | { t: 'ping' };

export type ServerMessage =
  /** Stored entries newer than the client's `since`, in order, plus how many others are connected. */
  | { t: 'welcome'; entries: Entry[]; others: number; entryCount: number }
  | { t: 'upd'; seq: number; data: string }
  | { t: 'ack'; id: number; seq: number }
  | { t: 'aw'; data: string }
  /** Someone joined or left; clients re-announce their presence on join. */
  | { t: 'peers'; others: number; joined: boolean }
  | { t: 'pong' }
  | { t: 'error'; code: ErrorCode; message: string };

export type ErrorCode = 'bad-request' | 'forbidden' | 'too-large' | 'room-full' | 'version';

export interface Entry {
  seq: number;
  data: string;
}

export const LIMITS = {
  /** Largest single frame a client may send, in characters of JSON. */
  maxFrame: 2_000_000,
  /** Stored bytes per room before new updates are refused; clients compact well before this. */
  maxRoomBytes: 25_000_000,
  /** Open connections per room. */
  maxConnections: 100,
};
