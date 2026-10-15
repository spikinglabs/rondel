import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { initMeeting, maps, readMeta, readView, type NewMeetingInput, type View } from './model';
import { openDoc, rememberPeople, trackIndex, type Identity } from './store';
import { createSync, type Sync, type SyncStatus } from './sync';
import { meetingOps, type Ops } from './ops';
import { whenLoaded } from './series';

/** Work to apply once a meeting's local storage has loaded: a brand-new meeting, or a reopened file. */
const pending = new Map<string, { init?: NewMeetingInput; update?: Uint8Array; afterLoad?: boolean }>();
export function queueNewMeeting(roomId: string, init: NewMeetingInput) {
  pending.set(roomId, { init });
}
/** A series meeting someone else may be starting at the same time: create it only if the shared copy is still empty. */
export function queueSeriesMeeting(roomId: string, init: NewMeetingInput) {
  pending.set(roomId, { init, afterLoad: true });
}
export function queueImport(roomId: string, update: Uint8Array) {
  pending.set(roomId, { update });
}

export interface Peer {
  clientId: number;
  id: string;
  name: string;
  readyEpoch: number;
  drafts: Record<string, number>;
  /** The column someone is writing a card in; the text only on an open board. */
  typing: { columnId: string; text: string | null } | null;
  self: boolean;
}

export type MeetingState =
  | { status: 'loading' }
  | { status: 'waiting'; sync: Sync } // joined by link, nobody has shared the meeting yet
  | { status: 'ready'; doc: Y.Doc; view: View; ops: Ops; sync: Sync; peers: Peer[]; syncStatus: SyncStatus };

export function useMeeting(roomId: string, key: string, me: Identity) {
  const [doc, setDoc] = useState<Y.Doc | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const { doc, persistence, ready } = openDoc(roomId);
    let s: Sync | null = null;
    let untrack = () => {};
    let alive = true;
    ready.then(() => {
      if (!alive) return;
      const job = pending.get(roomId);
      pending.delete(roomId);
      if (job?.update) Y.applyUpdate(doc, job.update);
      if (job?.init && !job.afterLoad && !readMeta(doc)) initMeeting(doc, job.init);
      untrack = trackIndex(roomId, key, doc);
      return createSync(doc, roomId, key).then(async (created) => {
        if (job?.init && job.afterLoad) {
          await whenLoaded(created);
          if (alive && !readMeta(doc)) initMeeting(doc, job.init);
        }
        if (!alive) return created.destroy();
        s = created;
        setDoc(doc);
        setSync(created);
      });
    });
    return () => {
      alive = false;
      untrack();
      s?.destroy();
      persistence.destroy();
      doc.destroy();
    };
  }, [roomId, key]);

  // Re-render on document, presence and connection changes.
  useEffect(() => {
    if (!doc || !sync) return;
    let frame = 0;
    const bump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTick((t) => t + 1));
    };
    // Own edits re-render straight away so controlled inputs never flicker back; remote ones are batched per frame.
    const onUpdate = (_u: Uint8Array, _o: unknown, _d: Y.Doc, tr: Y.Transaction) => (tr.local ? setTick((t) => t + 1) : bump());
    doc.on('update', onUpdate);
    sync.awareness.on('change', bump);
    const off = sync.onChange(bump);
    return () => {
      doc.off('update', onUpdate);
      sync.awareness.off('change', bump);
      off();
      cancelAnimationFrame(frame);
    };
  }, [doc, sync]);

  // Publish who we are.
  useEffect(() => {
    if (!sync) return;
    const cur = sync.awareness.getLocalState() ?? {};
    sync.awareness.setLocalState({ ...cur, user: { id: me.id, name: me.name } });
  }, [sync, me.id, me.name]);

  const ops = useMemo(() => (doc ? meetingOps(doc, roomId, me) : null), [doc, roomId, me.id, me.name]);
  const ready = !!doc && !!ops && !!readMeta(doc);

  // Record that I joined (shared, so people who prepared earlier stay visible), and remember the others' names here.
  useEffect(() => {
    if (!ready || !doc || !ops) return;
    const tick = () => {
      if (readMeta(doc)?.status !== 'live') return;
      ops.join();
      rememberPeople([...maps(doc).people.values()].map((p) => p.name));
    };
    tick();
    const i = setInterval(tick, 5 * 60_000);
    return () => clearInterval(i);
  }, [ready, ops]);

  if (!doc || !sync || !ops) return { status: 'loading' } as MeetingState;
  const view = readView(doc);
  if (!view) return { status: 'waiting', sync } as MeetingState;
  const peers: Peer[] = [];
  sync.awareness.getStates().forEach((st: any, clientId) => {
    if (!st?.user) return;
    peers.push({ clientId, id: st.user.id, name: st.user.name, readyEpoch: st.readyEpoch ?? -1, drafts: st.drafts ?? {}, typing: st.typing ?? null, self: clientId === doc.clientID });
  });
  // One entry per person (several tabs collapse).
  const unique = [...new Map(peers.map((p) => [p.id, p])).values()];
  return { status: 'ready', doc, view, ops, sync, peers: unique, syncStatus: sync.status } as MeetingState;
}

export function setPresence(sync: Sync, patch: Record<string, unknown>) {
  const cur = sync.awareness.getLocalState() ?? {};
  sync.awareness.setLocalState({ ...cur, ...patch });
}
