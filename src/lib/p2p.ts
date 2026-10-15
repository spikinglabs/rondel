import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { joinRoom as joinNostr } from '@trystero-p2p/nostr';
import { joinRoom as joinTorrent } from '@trystero-p2p/torrent';
import type { Sync, SyncStatus } from './sync';

/**
 * Keeps a Y.Doc and its awareness (presence) in sync with everyone else who has the same
 * room id and key open. Browsers find each other through public relays, which only ever see
 * a hash of the room id and handshakes encrypted with the key; meeting content travels over
 * direct, encrypted WebRTC connections between the browsers.
 */
export class PeerSync implements Sync {
  readonly mode = 'p2p' as const;
  loaded = false;
  readonly awareness: awarenessProtocol.Awareness;
  private room: ReturnType<typeof joinNostr>;
  private sendUpdate: (d: Uint8Array, opts?: { target?: string }) => Promise<unknown>;
  private sendSV: (d: Uint8Array, opts?: { target?: string }) => Promise<unknown>;
  private sendAwareness: (d: Uint8Array, opts?: { target?: string }) => Promise<unknown>;
  private peers = new Set<string>();
  private listeners = new Set<() => void>();
  private startedAt = Date.now();
  private tick: number;
  error: string | null = null;

  constructor(private doc: Y.Doc, roomId: string, key: string) {
    this.awareness = new awarenessProtocol.Awareness(doc);
    const cfg = window.RONDEL_CONFIG ?? {};
    const config: Parameters<typeof joinNostr>[0] = {
      appId: 'rondel-meetings',
      password: key,
      ...(cfg.relayUrls?.length ? { relayConfig: { urls: cfg.relayUrls, warnOnRelayFailure: false } } : { relayConfig: { warnOnRelayFailure: false } }),
      ...(cfg.turn?.length ? { turnConfig: cfg.turn } : {}),
    };
    const join = cfg.strategy === 'torrent' ? joinTorrent : joinNostr;
    this.room = join(config, roomId, {
      onJoinError: (d) => {
        this.error = String((d as any)?.error ?? 'Could not connect to a participant');
        this.emit();
      },
    }) as ReturnType<typeof joinNostr>;

    const update = this.room.makeAction('u');
    const sv = this.room.makeAction('sv');
    const aw = this.room.makeAction('aw');
    this.sendUpdate = (d, o) => update.send(d, o);
    this.sendSV = (d, o) => sv.send(d, o);
    this.sendAwareness = (d, o) => aw.send(d, o);

    update.onMessage = (data: any) => {
      Y.applyUpdate(doc, toBytes(data), this);
      if (!this.loaded) {
        this.loaded = true;
        this.emit();
      }
    };
    // A peer told us what it has: answer with everything it is missing.
    sv.onMessage = (data: any, { peerId }: any) => {
      this.sendUpdate(Y.encodeStateAsUpdate(doc, toBytes(data)), { target: peerId });
    };
    aw.onMessage = (data: any) => awarenessProtocol.applyAwarenessUpdate(this.awareness, toBytes(data), this);

    this.room.onPeerJoin = (peerId: string) => {
      this.peers.add(peerId);
      this.sendSV(Y.encodeStateVector(doc), { target: peerId });
      this.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, [...this.awareness.getStates().keys()]), { target: peerId });
      this.emit();
    };
    this.room.onPeerLeave = (peerId: string) => {
      this.peers.delete(peerId);
      // Drop presence of clients we can no longer reach.
      const stale = [...this.awareness.getStates().keys()].filter((c) => c !== doc.clientID && !this.reachable(c));
      if (stale.length) awarenessProtocol.removeAwarenessStates(this.awareness, stale, this);
      this.emit();
    };

    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    // Awareness entries expire unless renewed; renew ours, and refresh status text.
    this.tick = window.setInterval(() => {
      this.awareness.setLocalState(this.awareness.getLocalState());
      this.emit();
    }, 10_000);
    window.addEventListener('beforeunload', this.destroy);
  }

  private reachable(_clientId: number) {
    // Awareness doesn't map client ids to peers; with nobody left, everyone else is stale.
    return this.peers.size > 0;
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin !== this && this.peers.size) this.sendUpdate(update);
  };

  private onAwarenessUpdate = ({ added, updated, removed }: any, origin: unknown) => {
    if (origin === this || !this.peers.size) return;
    const changed = [...added, ...updated, ...removed];
    this.sendAwareness(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
  };

  get peerCount() {
    return this.peers.size;
  }

  get status(): SyncStatus {
    if (this.peers.size) return 'connected';
    return Date.now() - this.startedAt < 15_000 ? 'searching' : 'alone';
  }

  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  destroy = () => {
    clearInterval(this.tick);
    window.removeEventListener('beforeunload', this.destroy);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.room.leave();
    this.listeners.clear();
  };
}

function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  throw new Error('Unexpected payload');
}
