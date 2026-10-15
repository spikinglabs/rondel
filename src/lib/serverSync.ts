import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { deriveKeys, open, seal, type RoomKeys } from './crypto';
import { serverBase, type Sync, type SyncStatus } from './sync';
import type { ClientMessage, ServerMessage } from '../../server/core/protocol';
import { PROTOCOL_VERSION } from '../../server/core/protocol';

/** Compact the stored log once it holds this many entries. */
const COMPACT_AFTER = 150;

/**
 * Syncs through a Rondel room server, which stores the meeting so people can contribute at
 * different times (preparation) and join when nobody else is online. Everything sent is
 * encrypted with a key derived from the meeting link; the server only sees opaque blobs.
 */
export class ServerSync implements Sync {
  readonly mode = 'server' as const;
  readonly awareness: awarenessProtocol.Awareness;
  error: string | null = null;
  loaded = false;

  private ws: WebSocket | null = null;
  private keys: Promise<RoomKeys>;
  /** What the server is known to hold, so we can work out what it is missing after being offline. */
  private mirror = new Y.Doc();
  private lastSeq = 0;
  private pending = new Map<number, Uint8Array>();
  private nextId = 1;
  private open = false;
  private everOpen = false;
  private fatal = false;
  private destroyed = false;
  private attempts = 0;
  private retryTimer = 0;
  private lastHeard = 0;
  private tick: number;
  private listeners = new Set<() => void>();
  /** Keeps outgoing frames in order despite asynchronous encryption. */
  private out: Promise<unknown> = Promise.resolve();
  /** Incoming frames are handled one at a time, in order. */
  private in: Promise<unknown> = Promise.resolve();

  constructor(private doc: Y.Doc, private roomId: string, key: string) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.keys = deriveKeys(key, roomId);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.tick = window.setInterval(() => {
      this.awareness.setLocalState(this.awareness.getLocalState());
      // Heartbeat: a connection that has gone quiet is treated as lost, so we reconnect and resync.
      if (this.open && Date.now() - this.lastHeard > 25_000) this.ws?.close();
      else if (this.open) this.raw({ t: 'ping' });
      this.emit();
    }, 10_000);
    window.addEventListener('beforeunload', this.destroy);
    window.addEventListener('online', this.reconnectNow);
    window.addEventListener('offline', this.dropConnection);
    this.connect();
  }

  get status(): SyncStatus {
    if (this.open) return 'connected';
    // Two failed attempts in a row without ever connecting: say so rather than "connecting" forever.
    return this.everOpen || this.fatal || this.attempts >= 2 ? 'offline' : 'searching';
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private connect() {
    if (this.destroyed || this.fatal) return;
    const url = new URL(`api/rooms/${this.roomId}`, serverBase());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = async () => {
      const { auth } = await this.keys;
      this.raw({ t: 'hello', v: PROTOCOL_VERSION, auth, since: this.lastSeq });
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      this.lastHeard = Date.now();
      const msg = JSON.parse(e.data) as ServerMessage;
      this.in = this.in.then(() => this.handle(msg)).catch((err) => {
        this.error = `Could not read meeting data: ${err?.message ?? err}`;
        this.emit();
      });
    };
    ws.onclose = () => this.closed(ws);
  }

  private dropConnection = () => {
    const ws = this.ws;
    if (!ws) return;
    ws.close();
    this.closed(ws); // don't wait for the close handshake on a dead network
  };

  private closed(ws: WebSocket) {
    if (this.ws !== ws) return;
    this.ws = null;
    this.open = false;
    this.pending.clear();
    this.emit();
    if (!this.destroyed && !this.fatal) {
      const delay = Math.min(30_000, 1000 * 2 ** this.attempts++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    }
  }

  private reconnectNow = () => {
    if (this.ws || this.destroyed) return;
    clearTimeout(this.retryTimer);
    this.attempts = 0;
    this.connect();
  };

  private async handle(msg: ServerMessage) {
    const { key } = await this.keys;
    switch (msg.t) {
      case 'welcome': {
        for (const e of msg.entries) {
          const u = await open(key, e.data);
          Y.applyUpdate(this.mirror, u);
          Y.applyUpdate(this.doc, u, this);
          this.lastSeq = Math.max(this.lastSeq, e.seq);
        }
        this.open = this.everOpen = this.loaded = true;
        this.attempts = 0;
        this.error = null;
        // Anything we have that the server doesn't (offline edits, a new meeting, an opened file).
        if (!Y.equalSnapshots(Y.snapshot(this.mirror), Y.snapshot(this.doc))) {
          this.sendUpdate(Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.mirror)));
        }
        this.sendAwareness([...this.awareness.getStates().keys()]);
        if (msg.entryCount > COMPACT_AFTER) this.compact();
        this.emit();
        return;
      }
      case 'upd': {
        const u = await open(key, msg.data);
        Y.applyUpdate(this.mirror, u);
        Y.applyUpdate(this.doc, u, this);
        this.lastSeq = Math.max(this.lastSeq, msg.seq);
        return;
      }
      case 'ack': {
        const u = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (u) Y.applyUpdate(this.mirror, u);
        this.lastSeq = Math.max(this.lastSeq, msg.seq);
        return;
      }
      case 'aw':
        awarenessProtocol.applyAwarenessUpdate(this.awareness, await open(key, msg.data), this);
        return;
      case 'peers':
        // Someone new: tell them who we are.
        if (msg.joined) this.sendAwareness([this.doc.clientID]);
        this.emit();
        return;
      case 'pong':
        return;
      case 'error':
        this.error = msg.message;
        if (msg.code === 'forbidden' || msg.code === 'version') this.fatal = true;
        this.emit();
        return;
    }
  }

  private raw(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private sendUpdate(u: Uint8Array) {
    const id = this.nextId++;
    this.pending.set(id, u);
    this.out = this.out.then(async () => this.raw({ t: 'upd', id, data: await seal((await this.keys).key, u) }));
  }

  private sendAwareness(clients: number[]) {
    const u = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clients);
    this.out = this.out.then(async () => this.raw({ t: 'aw', data: await seal((await this.keys).key, u) }));
  }

  private compact() {
    const upTo = this.lastSeq;
    const snapshot = Y.encodeStateAsUpdate(this.mirror);
    this.out = this.out.then(async () => this.raw({ t: 'compact', upTo, data: await seal((await this.keys).key, snapshot) }));
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // While offline, nothing is lost: the next welcome sends whatever the server is missing.
    if (origin !== this && this.open) this.sendUpdate(update);
  };

  private onAwarenessUpdate = ({ added, updated, removed }: any, origin: unknown) => {
    if (origin === this || !this.open) return;
    this.sendAwareness([...added, ...updated, ...removed]);
  };

  destroy = () => {
    if (this.destroyed) return;
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    this.destroyed = true;
    clearInterval(this.tick);
    clearTimeout(this.retryTimer);
    window.removeEventListener('beforeunload', this.destroy);
    window.removeEventListener('online', this.reconnectNow);
    window.removeEventListener('offline', this.dropConnection);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    // Let the presence removal go out before closing.
    this.out.finally(() => this.ws?.close());
    this.mirror.destroy();
    this.listeners.clear();
  };
}
