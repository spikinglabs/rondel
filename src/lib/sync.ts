import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import type { ArtifactCaps } from './artifactSync';

export interface RondelConfig {
  /** "auto" (default): use a Rondel server at the same address if there is one, else peer-to-peer. */
  sync?: 'auto' | 'server' | 'p2p' | 'artifact';
  /** Where the Rondel server is, if not at the same address as the app. */
  serverUrl?: string | null;
  /** Extra meeting templates for everyone using this installation: paths or URLs of YAML files. */
  templates?: string[];
  /** Address to put in invite links, if not the page's own (for example a claude.ai artifact link). */
  shareUrl?: string | null;
  /** Marks the installation as a lab test: a "Lab" tag in the header and a note on the data page. A text replaces "Lab". */
  lab?: boolean | string;
  /** Where "Send feedback" goes: an email address or a web address (a form). Hidden when empty. */
  feedback?: string | null;
  // Peer-to-peer settings
  strategy?: 'nostr' | 'torrent';
  relayUrls?: string[] | null;
  turn?: RTCIceServer[];
}

declare global {
  interface Window {
    RONDEL_CONFIG?: RondelConfig;
  }
}

/**
 * connected: talking to the server, or to at least one other browser.
 * searching: still connecting. alone: peer-to-peer and nobody else is here. offline: lost the server.
 */
export type SyncStatus = 'searching' | 'connected' | 'alone' | 'offline';

/** Keeps a meeting document and everyone's presence in step, however it's done. */
export interface Sync {
  /** "server": stored somewhere shared (a Rondel server or an artifact's storage). */
  readonly mode: 'server' | 'p2p';
  readonly awareness: Awareness;
  readonly status: SyncStatus;
  /** True once the meeting's stored or shared state has been received at least once. */
  readonly loaded: boolean;
  readonly error: string | null;
  onChange(fn: () => void): () => void;
  destroy(): void;
}

const config = () => window.RONDEL_CONFIG ?? {};

export function serverBase() {
  const cfg = config();
  const base = new URL(cfg.serverUrl || './', location.href);
  base.hash = '';
  base.search = '';
  return base;
}

export type SyncMode = 'server' | 'p2p' | 'artifact';

let caps: Promise<ArtifactCaps | null> | null = null;

/** Inside a claude.ai artifact preview, its shared storage and live room, if this view has them. */
function artifactCaps(): Promise<ArtifactCaps | null> {
  caps ??= (async () => {
    const claude = (window as any).claude;
    if (typeof claude?.use !== 'function') return null;
    try {
      const db = await claude.use('db');
      if (!db) return null;
      const room = await claude.use('room').catch(() => null);
      return { db, room };
    } catch {
      return null;
    }
  })();
  return caps;
}

let detected: Promise<SyncMode> | null = null;

/** Which way to sync, decided once per page load. */
export function syncMode(): Promise<SyncMode> {
  const want = config().sync ?? 'auto';
  if (want !== 'auto') return Promise.resolve(want);
  if (location.protocol === 'file:') return Promise.resolve('p2p');
  detected ??= (async () => {
    if (await artifactCaps()) return 'artifact';
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(new URL('api/health', serverBase()), { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const body = res.ok ? await res.json() : null;
      return body?.rondel ? 'server' : 'p2p';
    } catch {
      return 'p2p';
    }
  })();
  return detected;
}

export async function createSync(doc: Y.Doc, roomId: string, key: string): Promise<Sync> {
  const mode = await syncMode();
  if (mode === 'artifact') {
    const found = await artifactCaps();
    if (found) {
      const { ArtifactSync } = await import('./artifactSync');
      return new ArtifactSync(doc, roomId, key, found);
    }
  }
  if (mode === 'server') {
    const { ServerSync } = await import('./serverSync');
    return new ServerSync(doc, roomId, key);
  }
  const { PeerSync } = await import('./p2p');
  return new PeerSync(doc, roomId, key);
}
