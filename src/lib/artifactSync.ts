import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { deriveKeys, open, seal, type RoomKeys } from './crypto';
import type { Sync, SyncStatus } from './sync';

// The small slice of the claude.ai artifact runtime ("db" and "room" capabilities) this adapter uses.
interface DbError { code: string; message: string }
interface DocSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
interface QuerySnap {
  docChanges(): { type: 'added' | 'modified' | 'removed'; doc: DocSnap }[];
  metadata: { fromCache: boolean; hasPendingWrites: boolean };
}
interface DocRef {
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  acquire(o: { holder: string; ttlMs?: number }): Promise<{ acquired: boolean }>;
}
interface CollRef {
  doc(id?: string): DocRef;
  onSnapshot(next: (s: QuerySnap) => void, error?: (e: DbError) => void): () => void;
}
export interface ArtifactDb { collection(path: string): CollRef; doc(path: string): DocRef }
interface RoomPeer { presence: Readonly<Record<string, unknown>> }
interface NamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  onPeers(fn: (c: { joined: readonly RoomPeer[]; updated: readonly RoomPeer[]; left: readonly RoomPeer[] }) => void): () => void;
  leave(): Promise<void>;
}
export interface ArtifactRoom { join(name: string): Promise<NamedRoom> }
export interface ArtifactCaps { db: ArtifactDb; room: ArtifactRoom | null }

/** Compact the stored log once it holds this many entries. */
const COMPACT_AFTER = 150;
/** Local edits within this window go out as one stored entry. */
const BATCH_MS = 400;
/** Stored documents are capped at 256 KiB; stay well clear of it. */
const MAX_ENTRY = 200_000;

const hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Syncs through the shared storage of a claude.ai artifact, for previews hosted there. Same model
 * as ServerSync: every edit is an encrypted entry in a per-meeting collection, with presence sent
 * through the artifact's live room. The store only ever holds opaque, encrypted blobs.
 */
export class ArtifactSync implements Sync {
  readonly mode = 'server' as const;
  readonly awareness: awarenessProtocol.Awareness;
  error: string | null = null;
  loaded = false;

  private keys: Promise<RoomKeys>;
  private coll: CollRef;
  /** What the store is known to hold, so we can work out what it is missing. */
  private mirror = new Y.Doc();
  private entries = new Set<string>();
  private definitive = false;
  private stale = false;
  private readOnly = false;
  private destroyed = false;
  private unsub: () => void = () => {};
  private queue: Uint8Array[] = [];
  private flushTimer = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private incoming: Promise<unknown> = Promise.resolve();
  private compacting = false;
  private named: NamedRoom | null = null;
  private offPeers: () => void = () => {};
  private presenceTimer = 0;
  private tick: number;
  private listeners = new Set<() => void>();

  constructor(private doc: Y.Doc, private roomId: string, key: string, private caps: ArtifactCaps) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    this.keys = deriveKeys(key, roomId);
    this.coll = caps.db.collection(`rooms/${roomId}/u`);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    // Renew presence so others don't time us out.
    this.tick = window.setInterval(() => this.awareness.setLocalState(this.awareness.getLocalState()), 10_000);
    window.addEventListener('beforeunload', this.destroy);
    this.subscribe();
    this.joinRoom();
  }

  get status(): SyncStatus {
    if (!this.definitive) return this.error ? 'offline' : 'searching';
    return this.stale ? 'offline' : 'connected';
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private subscribe() {
    if (this.destroyed) return;
    this.unsub = this.coll.onSnapshot(
      (snap) => {
        const changes = snap.docChanges();
        const fromCache = snap.metadata.fromCache;
        this.incoming = this.incoming.then(() => this.receive(changes, fromCache)).catch((err) => {
          this.error = `Could not read meeting data: ${err?.message ?? err}`;
          this.emit();
        });
      },
      (e) => {
        if (e.code === 'revoked' || e.code === 'not_granted') {
          this.error = 'This preview no longer has access to its storage.';
          this.emit();
          return;
        }
        this.stale = true;
        this.emit();
        window.setTimeout(() => this.subscribe(), 3000);
      },
    );
  }

  private async receive(changes: ReturnType<QuerySnap['docChanges']>, fromCache: boolean) {
    const { key } = await this.keys;
    for (const c of changes) {
      if (c.type === 'removed') {
        this.entries.delete(c.doc.id);
        continue;
      }
      if (this.entries.has(c.doc.id) && c.type === 'added') continue;
      this.entries.add(c.doc.id);
      const d = c.doc.data()?.d;
      if (typeof d !== 'string') continue;
      let u: Uint8Array;
      try {
        u = await open(key, d);
      } catch {
        continue; // not ours, or damaged
      }
      Y.applyUpdate(this.mirror, u);
      Y.applyUpdate(this.doc, u, this);
    }
    this.stale = fromCache && this.definitive;
    if (!fromCache && !this.definitive) {
      this.definitive = this.loaded = true;
      // Anything we have that the store doesn't (a new meeting, edits made before loading, an opened file).
      if (!Y.equalSnapshots(Y.snapshot(this.mirror), Y.snapshot(this.doc))) {
        this.enqueue(Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.mirror)));
      }
    }
    if (this.definitive && this.entries.size > COMPACT_AFTER) this.compact();
    this.emit();
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Before the first full load, the catch-up diff above covers local edits.
    if (origin !== this && this.definitive) this.enqueue(update);
  };

  private enqueue(u: Uint8Array) {
    if (this.readOnly) return;
    this.queue.push(u);
    clearTimeout(this.flushTimer);
    this.flushTimer = window.setTimeout(this.flush, BATCH_MS);
  }

  private flush = () => {
    if (!this.queue.length) return;
    const u = Y.mergeUpdates(this.queue);
    this.queue = [];
    this.writes = this.writes.then(() => this.write(u));
  };

  private async write(u: Uint8Array, attempt = 0): Promise<void> {
    const data = await seal((await this.keys).key, u);
    if (data.length > MAX_ENTRY) {
      this.error = 'That change is too large to store in this preview.';
      this.emit();
      return;
    }
    try {
      await this.coll.doc().set({ d: data, t: Date.now() });
    } catch (e: any) {
      const code = e?.code;
      if (code === 'invalid_argument' || code === 'not_granted') {
        this.readOnly = true;
        this.error = 'You can view this meeting but not change it. Ask the owner of the preview for Contributor access.';
      } else if (code === 'quota_exceeded') {
        this.error = 'The preview storage is full.';
      } else if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 500 + Math.random() * 1000 * (attempt + 1)));
        return this.write(u, attempt + 1);
      } else {
        this.error = `Could not save: ${e?.message ?? e}`;
      }
      this.emit();
    }
  }

  /** Replace many small entries with one snapshot. Only one browser does it at a time. */
  private compact() {
    if (this.compacting || this.readOnly) return;
    this.compacting = true;
    this.writes = this.writes
      .then(async () => {
        const lock = await this.caps.db.doc(`rooms/${this.roomId}/meta/compact`).acquire({ holder: String(this.doc.clientID), ttlMs: 60_000 });
        if (!lock.acquired) return;
        const covered = [...this.entries];
        const data = await seal((await this.keys).key, Y.encodeStateAsUpdate(this.mirror));
        if (data.length > MAX_ENTRY) return;
        await this.coll.doc().set({ d: data, t: Date.now(), snapshot: true });
        for (const id of covered) {
          if (this.destroyed) return;
          await this.coll.doc(id).delete();
        }
      })
      .catch(() => {})
      .finally(() => window.setTimeout(() => (this.compacting = false), 60_000));
  }

  // ------------------------------------------------------------ presence, through the live room

  private async joinRoom() {
    if (!this.caps.room) return;
    try {
      const name = `rondel-${(await hex(this.roomId)).slice(0, 40)}`;
      const named = await this.caps.room.join(name);
      if (this.destroyed) return void named.leave();
      this.named = named;
      this.offPeers = named.onPeers(({ joined, updated, left }) => {
        for (const p of [...joined, ...updated]) this.applyPresence(p.presence);
        const gone = left.map((p) => p.presence.c).filter((c): c is number => typeof c === 'number' && c !== this.doc.clientID);
        if (gone.length) awarenessProtocol.removeAwarenessStates(this.awareness, gone, this);
      });
      this.sendPresence();
    } catch {
      // Presence is a nicety; the meeting still syncs without it.
    }
  }

  private async applyPresence(p: Readonly<Record<string, unknown>>) {
    if (typeof p.aw !== 'string' || p.c === this.doc.clientID) return;
    try {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, await open((await this.keys).key, p.aw), this);
    } catch {
      // ignore presence we can't read
    }
  }

  private onAwarenessUpdate = (_: unknown, origin: unknown) => {
    if (origin === this) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = window.setTimeout(() => this.sendPresence(), 100);
  };

  private async sendPresence() {
    if (!this.named || this.destroyed) return;
    const u = awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
    const aw = await seal((await this.keys).key, u);
    this.named?.presence({ aw, c: this.doc.clientID }).catch(() => {});
  }

  destroy = () => {
    if (this.destroyed) return;
    this.flush();
    this.destroyed = true;
    clearInterval(this.tick);
    clearTimeout(this.flushTimer);
    clearTimeout(this.presenceTimer);
    window.removeEventListener('beforeunload', this.destroy);
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.unsub();
    this.offPeers();
    this.named?.leave().catch(() => {});
    this.mirror.destroy();
    this.listeners.clear();
  };
}
