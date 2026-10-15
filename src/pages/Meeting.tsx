import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { BRAINSTORM_STEPS, IDEA_DOTS, brainstormKey, ACTIVITIES, ACTIVITY_HINT, ACTIVITY_LABEL, RETRO_PHASES, isBoardActivity, TYPE_LABEL, maps, screenFor, MIDDLE_MAX, SCREEN_BLOCK_LABEL, type MiddleBlock, type Screen, type ScreenBlock, type Activity, type AgendaItem, type RetroPhase, type Settings, type View } from '../lib/model';
import { LAYOUT_DEFAULT, voterId, forgetMeeting, getLayout, getPrefs, saveLayout, type Layout, knownPeople, meetingLink, setPrefs, type Identity } from '../lib/store';
import { setPresence, useMeeting, type Peer } from '../lib/useMeeting';
import type { Sync } from '../lib/sync';
import type { Ops } from '../lib/ops';
import { minutesMarkdown } from '../lib/minutes';
import { downloadText, exportMeeting, slug } from '../lib/files';
import { Avatar, Modal, PrefsButton, TopBar, toast, toastError, ask, copyText } from '../components/ui';
import { TimerView } from '../components/Timer';
import { QrCode } from '../components/QrCode';
import { Board } from '../components/Board';
import { SharedText } from '../components/SharedText';
import { Md } from '../components/Markdown';
import { MinutesModal } from '../components/Minutes';
import { focusField, reveal, useCommands, type Command } from '../components/CommandPalette';
import { ActionRow, NewActionForm, PeopleList } from '../components/Actions';
import { NewMeetingModal, startMeeting, startSeries, templateOf } from './Home';
import { useSeriesTracking } from './Series';
import { TemplateEditor } from '../components/TemplateEditor';
import { nextVersionName, takenTemplateNames, templateFromMeeting, templateToYaml } from '../lib/templates';
import * as Y from 'yjs';

const PHASE_LABEL: Record<RetroPhase, string> = { write: '1 Write', group: '2 Group', vote: '3 Vote', discuss: '4 Discuss', actions: '5 Actions' };
const PHASE_HINT: Record<RetroPhase, string> = {
  write: 'Write your thoughts. Drafts stay in your browser until you share them.',
  group: 'Drag similar cards onto each other to group them, and name the groups.',
  vote: 'Vote for the topics you most want to discuss.',
  discuss: 'Discuss topics in vote order. Capture decisions and actions as you go.',
  actions: 'Agree owners and due dates for action items, save the minutes, then close the meeting.',
};

export function MeetingPage({ roomId, roomKey, me, onRename }: { roomId: string; roomKey: string; me: Identity; onRename: () => void }) {
  const state = useMeeting(roomId, roomKey, me);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [templateYaml, setTemplateYaml] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [layout, setLayoutState] = useState<Layout>(getLayout);
  const setLayout = (p: Partial<Layout>) => setLayoutState((l) => { const n = { ...l, ...p }; saveLayout(n); return n; });
  // Changes a person makes to the stage's screen during that stage; they reset when the next stage starts.
  const [stageOverride, setStageOverride] = useState<{ id: string | null; s: Screen }>({ id: null, s: {} });
  const [nextOpen, setNextOpen] = useState(false);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const sync = state.status !== 'loading' ? state.sync : null;
  const onDraftCounts = useCallback((counts: Record<string, number>) => sync && setPresence(sync, { drafts: counts }), [sync]);
  const onTyping = useCallback((typing: Peer['typing']) => sync && setPresence(sync, { typing }), [sync]);
  const series = useSeriesTracking(state.status === 'ready' ? state.view : null, me);
  const commands = useRef<() => Command[]>(() => []);
  useCommands(() => commands.current());

  if (state.status === 'loading') return (<><TopBar /><div className="empty">Opening…</div></>);
  if (state.status === 'waiting') return <Waiting sync={state.sync} />;

  const { view, ops, doc } = state;
  const { meta } = view;
  if (meta.removed.some((r) => r.id === me.id)) return <Removed roomId={roomId} />;
  const peers = state.peers.filter((p) => !meta.removed.some((r) => r.id === p.id));
  const closed = meta.status === 'closed';
  const isFacilitator = meta.facilitators.includes(me.id);
  const facilitatorOnline = peers.some((p) => meta.facilitators.includes(p.id));
  const canStructure = isFacilitator || meta.type !== 'retro';
  const hasBoard = view.columns.length > 0 || meta.type === 'retro';
  const current = view.agenda.find((a) => a.id === meta.currentAgendaId);
  const stageScreen: Screen = current && !closed ? { ...screenFor(current), ...(stageOverride.id === current.id ? stageOverride.s : {}) } : {};
  const isFolded = (b: ScreenBlock) => {
    const v = stageScreen[b];
    if (v) return v === 'folded';
    if (b === 'agenda') return !layout.agendaOpen;
    // Brainstorm starts folded in the side bar until a meeting has ideas.
    return layout.folded[b] ?? (b === 'brainstorm' && !view.ideas.length);
  };
  const setFolded = (b: ScreenBlock, folded: boolean) => {
    if (stageScreen[b] && current) setStageOverride((o) => ({ id: current.id, s: { ...(o.id === current.id ? o.s : {}), [b]: folded ? 'folded' : 'open' } }));
    else if (b === 'agenda') setLayout({ agendaOpen: !folded });
    else setLayout({ folded: { ...layout.folded, [b]: folded } });
  };
  const fold = (b: ScreenBlock): Fold => ({ folded: isFolded(b), onToggle: () => setFolded(b, !isFolded(b)) });
  const available = (b: MiddleBlock) => b !== 'board' || hasBoard;
  const middle = (stageScreen.middle ?? layout.middle ?? (hasBoard ? ['board', 'topic'] : ['topic'])).filter(available).slice(0, MIDDLE_MAX);
  const setMiddle = (m: MiddleBlock[]) => {
    if (current && stageScreen.middle) setStageOverride((o) => ({ id: current.id, s: { ...(o.id === current.id ? o.s : {}), middle: m } }));
    else setLayout({ middle: m });
  };
  const dock = (b: MiddleBlock): Dock => middle.includes(b)
    ? { place: 'middle', folded: false, onToggle: () => {}, onMove: () => setMiddle(middle.filter((x) => x !== b)) }
    : { place: 'side', ...fold(b), onMove: () => setMiddle([b, ...middle].slice(0, MIDDLE_MAX)) };
  const openCount = view.actions.filter((a) => a.status === 'open').length;
  const block = (b: MiddleBlock) => {
    const d = dock(b);
    if (b === 'board') return (
      <section key={b} className={`panel board-block${dockClass(d)}`} aria-label="Board">
        <DockHeader title="Board" dock={d} extra={<span className="faint small">{view.cards.length} card{view.cards.length === 1 ? '' : 's'}</span>} />
        {d.place === 'middle'
          ? <div className="content"><Board roomId={roomId} view={view} ops={ops} canFacilitate={canStructure} othersDrafts={othersDrafts} onDraftCounts={onDraftCounts}
              typing={peers.filter((p) => !p.self && p.typing).map((p) => ({ id: p.id, name: p.name, ...p.typing! }))} onTyping={onTyping} /></div>
          : <ul className="content board-summary">{view.columns.map((c) => <li key={c.id}><span>{c.title}</span><span className="faint small">{view.cards.filter((x) => x.columnId === c.id).length}</span></li>)}</ul>}
      </section>
    );
    if (b === 'topic') return <CurrentItem key={b} doc={doc} view={view} ops={ops} closed={closed} canFacilitate={isFacilitator} dock={d} />;
    if (b === 'brainstorm') return <BrainstormPanel key={b} roomId={roomId} view={view} ops={ops} closed={closed} canFacilitate={canStructure} dock={d} />;
    if (b === 'decisions') return <DecisionsPanel key={b} view={view} ops={ops} closed={closed} dock={d} />;
    if (b === 'people') return <PeoplePanel key={b} view={view} peers={peers} meId={me.id} ops={ops} dock={d} />;
    return (
      <section key={b} className={`panel${dockClass(d)}`} aria-label="Action items">
        <DockHeader title="Action items" dock={d} extra={<span className="faint small">{openCount} open</span>} />
        <div className="content col" style={{ gap: 8 }}>
          {view.actions.some((a) => a.carriedFrom) && (
            <div>
              <h3 className="muted small" style={{ marginBottom: 4 }}>From {meta.previousTitle ?? 'earlier meetings'}</h3>
              {view.actions.filter((a) => a.carriedFrom).map((a) => <ActionRow key={a.id} action={a} ops={ops} readOnly={closed} />)}
            </div>
          )}
          <div>
            {view.actions.some((a) => a.carriedFrom) && <h3 className="muted small" style={{ marginBottom: 4 }}>This meeting</h3>}
            {view.actions.filter((a) => !a.carriedFrom).map((a) => <ActionRow key={a.id} action={a} ops={ops} readOnly={closed} />)}
            {!view.actions.some((a) => !a.carriedFrom) && <p className="faint small">No actions yet.</p>}
          </div>
          {!closed && <NewActionForm ops={ops} />}
        </div>
      </section>
    );
  };
  const agendaOpen = !isFolded('agenda');
  const othersDrafts: Record<string, number> = {};
  for (const p of peers) if (!p.self) for (const [c, n] of Object.entries(p.drafts)) othersDrafts[c] = (othersDrafts[c] ?? 0) + n;
  const names = [...new Set([...view.people.map((p) => p.name), ...peers.map((p) => p.name)])].sort();
  const suggestions = [...new Set([...names, ...knownPeople()])];

  commands.current = () => meetingCommands({
    view, ops, me, roomId, closed, hasBoard, middle, isFacilitator, canStructure, current, available, isFolded, setFolded,
    show: (b) => setMiddle([b, ...middle.filter((x) => x !== b)].slice(0, MIDDLE_MAX)),
    minimize: (b) => setMiddle(middle.filter((x) => x !== b)),
    resetLayout: () => { setStageOverride({ id: null, s: {} }); setLayout({ ...LAYOUT_DEFAULT }); },
    newTemplate: () => saveAsNewTemplate(), templateName: templateOf(meta).name,
    invite: () => setShareOpen(true), minutes: () => setMinutesOpen(true), save: () => saveFile(), settings: () => setSettingsOpen(true),
    next: () => (series ? (location.hash = series.overview) : setNextOpen(true)),
    occurrence: series ? { label: series.nextExists ? 'Open next occurrence' : 'Start next occurrence', run: series.startNext } : null,
    ready: { done: peers.find((p) => p.self)?.readyEpoch === meta.readyEpoch, set: (on) => setPresence(state.sync, { readyEpoch: on ? meta.readyEpoch : -1 }) },
  });
  /** This meeting's board, stages and settings as a new version of the template it came from. */
  const saveAsNewTemplate = () => {
    const from = templateOf(meta);
    const t = templateFromMeeting(view);
    const notes = new Map(from.agenda.map((a) => [a.title, a.notes]));
    setTemplateYaml(templateToYaml({
      ...t,
      name: nextVersionName(from.name || t.name, takenTemplateNames()),
      description: from.description,
      agenda: t.agenda.map((a) => (notes.get(a.title) ? { ...a, notes: notes.get(a.title) } : a)),
    }));
  };
  const saveFile = () => downloadText(`${slug(meta.title)}.rondel.json`, JSON.stringify(exportMeeting(doc, roomId, roomKey)), 'application/json');

  return (
    <>
      <TopBar crumbs={meta.seriesName ? [meta.seriesName] : []} right={
        <span className="row small">
          <ConnectionBadge sync={state.sync} count={peers.length - 1} />
          <PrefsButton me={me} onChange={onRename} />
        </span>
      } />
      <div className="meeting-bar">
        <TitleEditor title={meta.title} canEdit={(isFacilitator || !!series) && !closed} onSave={ops.rename} />
        {closed ? <span className="badge">Closed</span> : <span className="badge success">Open</span>}
        <span className="badge">{TYPE_LABEL[meta.type]}</span>
        {/* Phase buttons only when the agenda doesn't already run the board stages. */}
        {meta.phase && !view.agenda.some((a) => isBoardActivity(a.activity)) && (
          <nav className="phases" aria-label="Board stages">
            {RETRO_PHASES.map((p) => (
              <button key={p} aria-current={meta.phase === p ? 'step' : undefined} disabled={!isFacilitator || closed} onClick={() => ops.phase(p)}>{PHASE_LABEL[p]}</button>
            ))}
          </nav>
        )}
        <span className="spacer" />
        <TimerView timer={meta.timer} canControl={isFacilitator && !closed} ops={ops} />
        <Presence peers={peers} view={view} ops={ops} meId={me.id} isFacilitator={isFacilitator} sync={state.sync} />
        <div className="row wrap">
          {!isFacilitator && !closed && facilitatorOnline && (
            <button className="ghost sm" onClick={() => ops.addFacilitator(me.id)} title="Anyone can facilitate; the current facilitators stay facilitators too.">Facilitate</button>
          )}
          {series && (
            <button className="ghost sm" onClick={series.startNext} title={series.nextLabel ? `${series.nextExists ? 'Open' : 'Create'} the meeting for ${series.nextLabel}, so people can prepare. Open actions carry over.` : undefined}>
              {series.nextExists ? 'Open next occurrence' : 'Start next occurrence'}
            </button>
          )}
          <button className="primary sm" onClick={() => setShareOpen(true)}>Invite</button>
          <button className="sm" onClick={() => setMinutesOpen(true)} title="See the minutes, copy them into an email or download them">Minutes</button>
          <button className="sm" onClick={saveFile} title="Save the whole meeting as a file you can reopen or archive">Save file</button>
          {isFacilitator && <button className="sm" onClick={() => setSettingsOpen(true)}>Settings</button>}
        </div>
      </div>
      {!isFacilitator && !facilitatorOnline && !closed && (
        <div className="row small" style={{ padding: '8px 16px 0' }}>
          <span className="muted">No facilitator is here right now.</span>
          <button className="sm" onClick={() => ops.addFacilitator(me.id)}>Facilitate this meeting</button>
        </div>
      )}
      {meta.phase && !closed && <div className="muted small" style={{ padding: '8px 16px 0' }}>{meta.phase === 'write' && meta.settings.openBoard ? 'Write your notes on the board. Everyone sees them as you post, with your name.' : PHASE_HINT[meta.phase]}</div>}
      {closed && (
        <div className="row wrap small" style={{ padding: '8px 16px 0' }}>
          <span className="muted">This meeting is closed. Save the minutes or the meeting file to keep a record.</span>
          <button className="sm" onClick={() => setMinutesOpen(true)}>Minutes</button>
          {series
            ? <button className="sm primary" onClick={() => (location.hash = series.overview)}>Next meeting</button>
            : <button className="sm primary" onClick={() => setNextOpen(true)}>Start next meeting</button>}
          {isFacilitator && <button className="sm ghost" onClick={ops.reopen}>Reopen</button>}
        </div>
      )}

      <div className={`meeting-layout${hasBoard ? '' : ' no-board'}${agendaOpen ? '' : ' agenda-folded'}`} style={{ '--right-w': `${layout.rightWidth}px` } as CSSProperties}>
        <aside className={`panel sticky-panel${agendaOpen ? '' : ' rail'}`}>
          {agendaOpen
            ? <AgendaPanel view={view} ops={ops} canFacilitate={isFacilitator} closed={closed} onFold={() => setFolded('agenda', true)} />
            : <AgendaRail view={view} onOpen={() => setFolded('agenda', false)} />}
        </aside>
        <main className="col" style={{ gap: 16, minWidth: 0 }} aria-label="Middle">
          {middle.map(block)}
          {middle.length === 0 && <div className="card empty">Show a block from the side bar here with its ⤢ button.</div>}
        </main>
        <ResizeHandle width={layout.rightWidth} onResize={(w) => setLayout({ rightWidth: w })} />
        <aside className="right col sticky-panel" style={{ gap: 12 }} aria-label="Side bar">
          {SIDE_ORDER.filter(available).map((b) => (middle.includes(b)
            ? <DockStub key={b} title={SCREEN_BLOCK_LABEL[b]} onBack={dock(b).onMove} />
            : block(b)))}
          {isFacilitator && !closed && (
            <button onClick={async () => {
              if (!(await ask('Close the meeting? Everything becomes read-only. Save the minutes or meeting file afterwards to keep a record.'))) return;
              ops.close();
            }}>Close meeting</button>
          )}
        </aside>
      </div>
      <PeopleList names={suggestions} />
      {minutesOpen && <MinutesModal markdown={minutesMarkdown(doc, view, names)} fileName={`${slug(meta.title)}-minutes.md`} onClose={() => setMinutesOpen(false)} />}
      {shareOpen && <ShareModal link={meetingLink(roomId, roomKey)} seriesLink={series?.link} seriesOverview={series?.overview} onClose={() => setShareOpen(false)} />}
      {settingsOpen && <SettingsModal settings={meta.settings} ops={ops} peers={peers} facilitators={meta.facilitators} onClose={() => setSettingsOpen(false)}
        onSaveAsTemplate={() => { setSettingsOpen(false); saveAsNewTemplate(); }} />}
      {templateYaml !== null && <TemplateEditor title="Save as a new template" initialYaml={templateYaml} onClose={() => setTemplateYaml(null)} onSaved={() => setTemplateYaml(null)} />}
      {nextOpen && (
        <NewMeetingModal initialTemplate={templateOf(meta)} onClose={() => setNextOpen(false)}
          onCreate={(input) => (input.repeat ? startSeries(me, input) : startMeeting(me, { ...input, seriesName: input.seriesName ?? meta.seriesName ?? meta.title, previous: view }))} />
      )}
    </>
  );
}

function Removed({ roomId }: { roomId: string }) {
  useEffect(() => {
    void forgetMeeting(roomId);
    // Again once the meeting has closed, in case it was still syncing.
    return () => void setTimeout(() => forgetMeeting(roomId), 0);
  }, [roomId]);
  return (
    <>
      <TopBar />
      <div className="page">
        <div className="card stack" style={{ maxWidth: 560, margin: '40px auto' }}>
          <h2>You were removed from this meeting</h2>
          <p className="muted">The person who created it removed you, so its copy in this browser has been deleted. Ask them if you think this is a mistake.</p>
          <a href="#/">Back to my meetings</a>
        </div>
      </div>
    </>
  );
}

function Waiting({ sync }: { sync: Sync }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const server = sync.mode === 'server';
  // On a server, a loaded but empty meeting means the link points at nothing stored there.
  const missing = server && sync.loaded;
  return (
    <>
      <TopBar />
      <div className="page">
        <div className="card stack" style={{ maxWidth: 560, margin: '40px auto' }}>
          <h2>{missing ? 'This meeting was not found' : sync.status === 'alone' ? 'Nobody with this meeting is online' : sync.status === 'offline' ? 'Cannot reach the meeting server' : 'Connecting to the meeting…'}</h2>
          {missing ? (
            <p className="muted">Check that you copied the whole link. If the meeting was created elsewhere, open its saved meeting file from the home page.</p>
          ) : server ? (
            <p className="muted">Rondel keeps trying. Check your network connection. On a work network, a proxy or firewall may be blocking this site's live connection.</p>
          ) : (
            <>
              <p className="muted">Meetings live in the browsers of the people in them. As soon as someone who has this meeting open is online, it appears here.</p>
              {sync.status === 'alone' && <p className="muted">Ask the organiser to open the meeting, or open a saved meeting file from the home page.</p>}
            </>
          )}
          {sync.error && <p className="error-banner">{sync.error}</p>}
          <a href="#/">Back to my meetings</a>
        </div>
      </div>
    </>
  );
}

function ConnectionBadge({ sync, count }: { sync: Sync; count: number }) {
  const { status, error } = sync;
  if (sync.mode === 'server') {
    if (status === 'connected') return <span className="badge success" title="Saved and shared through the meeting server, end-to-end encrypted">● Saved{count > 0 ? ` · ${count} here` : ''}</span>;
    if (status === 'searching') return <span className="badge accent">Connecting…</span>;
    return <span className="badge warning" title={error ?? 'Changes are kept in this browser and sent when the connection is back.'}>Offline, will sync</span>;
  }
  if (status === 'connected') return <span className="badge success" title="Connected directly to the other participants">● {count} connected</span>;
  if (status === 'searching') return <span className="badge accent">Looking for others…</span>;
  return <span className="badge" title={error ?? 'Nobody else has this meeting open right now. Changes are saved in this browser and sync when others join.'}>Only you</span>;
}

function TitleEditor({ title, canEdit, onSave }: { title: string; canEdit: boolean; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  if (editing) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); onSave(value); setEditing(false); }}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => setEditing(false)} style={{ minWidth: 260 }} aria-label="Meeting title" />
      </form>
    );
  }
  return <h1 className="meeting-title" onDoubleClick={() => canEdit && (setValue(title), setEditing(true))} title={canEdit ? 'Double-click to rename' : undefined}>{title}</h1>;
}

function Presence({ peers, view, ops, meId, isFacilitator, sync }: { peers: Peer[]; view: View; ops: Ops; meId: string; isFacilitator: boolean; sync: any }) {
  const epoch = view.meta.readyEpoch;
  const isReady = (p: Peer) => p.readyEpoch === epoch;
  const meReady = peers.some((p) => p.id === meId && isReady(p));
  const ready = peers.filter(isReady).length;
  const closed = view.meta.status === 'closed';
  const allDone = !closed && peers.length >= 2 && ready === peers.length;
  useAllDoneNotice(allDone, epoch, peers.length);
  return (
    <div className="row">
      <div className="here" aria-label={`Here now: ${peers.map((p) => p.name).join(', ')}`}>
        {peers.slice(0, 4).map((p) => (
          <span key={p.id} className="here-chip" title={`${p.name}${p.self ? ' (you)' : ''}${view.meta.facilitators.includes(p.id) ? ' · facilitator' : ''}${isReady(p) ? ' · done' : ''}`}>
            <Avatar id={p.id} name={p.name} ready={isReady(p)} size={22} />
            <span className="here-name">{p.self ? 'You' : p.name.split(' ')[0]}</span>
          </span>
        ))}
        {peers.length > 4 && <span className="badge">+{peers.length - 4}</span>}
      </div>
      {!closed && (
        <button className={`sm${meReady ? ' active' : ''}`} aria-pressed={meReady} onClick={() => setPresence(sync, { readyEpoch: meReady ? -1 : epoch })}>
          {meReady ? '✓ Done' : "I'm done"}
        </button>
      )}
      {allDone ? (
        <span className="badge success all-done" role="status">✓ Everyone is done{isFacilitator && <button className="ghost sm" onClick={ops.clearReady}>Clear</button>}</span>
      ) : ready > 0 && !closed && (
        <span className="small muted">{ready}/{peers.length} done{isFacilitator && <> <button className="ghost sm" onClick={ops.clearReady}>Clear</button></>}</span>
      )}
    </div>
  );
}

/** Who is in the meeting: here now first, then people who joined earlier (for example to prepare). */
function PeoplePanel({ view, peers, meId, ops, dock }: { view: View; peers: Peer[]; meId: string; ops: Ops; dock: Dock }) {
  const isCreator = view.meta.createdBy === meId && view.meta.status === 'live';
  const epoch = view.meta.readyEpoch;
  const here = new Map(peers.map((p) => [p.id, p]));
  const people = [
    ...peers.map((p) => ({ id: p.id, name: p.name, lastSeen: null as string | null })),
    ...view.people.filter((p) => !here.has(p.id)).map((p) => ({ id: p.id, name: p.name, lastSeen: p.lastSeen })),
  ];
  return (
    <section className={`panel${dockClass(dock)}`} aria-label="People">
      <DockHeader title="People" dock={dock} extra={<span className="faint small">{peers.length} here{people.length > peers.length ? ` · ${people.length} joined` : ''}</span>} />
      <ul className="people content">
        {people.map((p) => {
          const peer = here.get(p.id);
          const drafts = peer ? Object.values(peer.drafts).reduce((a, b) => a + b, 0) : 0;
          const status = !peer ? `Last here ${ago(p.lastSeen)}` : peer.readyEpoch === epoch ? 'Done' : drafts ? `Writing ${drafts} card${drafts === 1 ? '' : 's'}` : 'Here';
          return (
            <li key={p.id} className={peer ? '' : 'away'}>
              <Avatar id={p.id} name={p.name} ready={peer?.readyEpoch === epoch} />
              <div className="col" style={{ gap: 0, minWidth: 0, flex: 1 }}>
                <span className="person-name">{p.name}{p.id === meId && <span className="faint"> (you)</span>}</span>
                <span className="small muted">{status}</span>
              </div>
              {view.meta.facilitators.includes(p.id) && <span className="badge">Facilitator</span>}
              {peer && <span className="online-dot" aria-label="online" />}
              {isCreator && p.id !== meId && (
                <button className="ghost sm person-remove" aria-label={`Remove ${p.name}`} onClick={async () => {
                  if (!(await ask(`Remove ${p.name} from this meeting? Their app closes it and deletes its copy. Anyone holding the link could still rejoin under a new name; to shut someone out for good, start a new meeting and share the new link only with the others.`))) return;
                  ops.removePerson(p.id);
                  toast(`${p.name} was removed`);
                }}>Remove</button>
              )}
            </li>
          );
        })}
      </ul>
      {isCreator && view.meta.removed.length > 0 && (
        <div className="content small muted" style={{ paddingTop: 0 }}>
          Removed: {view.meta.removed.map((r, i) => (
            <span key={r.id}>{i > 0 && ', '}{r.name || 'someone'} <button className="ghost sm" onClick={() => ops.allowBack(r.id)}>Allow back</button></span>
          ))}
        </div>
      )}
    </section>
  );
}

function ago(iso: string | null) {
  if (!iso) return '';
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 2) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * When everyone here has pressed "I'm done": a short notice once per round, and a mark in the tab
 * title while the tab is in the background, so people who switched away notice too.
 */
function useAllDoneNotice(allDone: boolean, epoch: number, count: number) {
  const shown = useRef<number | null>(null);
  useEffect(() => {
    if (!allDone) {
      if (document.title.startsWith('✓ ')) document.title = document.title.slice(2);
      return;
    }
    if (shown.current === epoch) return;
    shown.current = epoch;
    toast(`Everyone is done (${count} of ${count})`);
    if (document.hidden && !document.title.startsWith('✓ ')) document.title = '✓ ' + document.title;
    const back = () => { if (!document.hidden && document.title.startsWith('✓ ')) document.title = document.title.slice(2); };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [allDone, epoch]);
}

type Fold = { folded: boolean; onToggle: () => void };
type Dock = { place: 'middle' | 'side'; onMove: () => void } & Fold;
const SIDE_ORDER: MiddleBlock[] = ['people', 'board', 'brainstorm', 'topic', 'actions', 'decisions'];
const dockClass = (d: Dock) => (d.place === 'middle' ? ' in-main' : d.folded ? ' folded' : '');

// Every block has a home in the side bar; its button moves it to the middle work area and back.
function DockHeader({ title, dock, extra }: { title: string; dock: Dock; extra?: ReactNode }) {
  const toMiddle = dock.place === 'side';
  return (
    <header>
      {toMiddle ? <FoldTitle title={title} folded={dock.folded} onToggle={dock.onToggle} /> : <h2>{title}</h2>}
      <span className="spacer" />{extra}
      <button className="ghost sm dock-move" onClick={dock.onMove}
        aria-label={toMiddle ? `Show ${title.toLowerCase()} in the middle` : `Minimize ${title.toLowerCase()} to the side bar`}
        title={toMiddle ? 'Show in the middle' : 'Back to the side bar'}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          {toMiddle ? <path d="M9 2h5v5M14 2 8.5 7.5M7 14H2V9M2 14l5.5-5.5" /> : <path d="M3 9h4v4M7 9l-5 5M13 7H9V3M9 7l5-5" />}
        </svg>
      </button>
    </header>
  );
}

// The block's place in the side bar while it is in the middle, so it is always found in the same spot.
function DockStub({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="dock-stub">
      <span>{title}</span><span className="faint small">in the middle</span><span className="spacer" />
      <button className="ghost sm" onClick={onBack} aria-label={`Move ${title.toLowerCase()} back to the side bar`}>Move back</button>
    </div>
  );
}

function FoldTitle({ title, folded, onToggle }: { title: string } & Fold) {
  return (
    <button className="fold-title" aria-expanded={!folded} onClick={onToggle} title={folded ? `Show ${title.toLowerCase()}` : `Fold ${title.toLowerCase()}`}>
      <span className="chev" aria-hidden="true">{folded ? '▸' : '▾'}</span><h2>{title}</h2>
    </button>
  );
}

// The agenda folded to a narrow rail: one number per item, the current one marked. Opening it brings back the full agenda for editing.
function AgendaRail({ view, onOpen }: { view: View; onOpen: () => void }) {
  return (
    <nav className="agenda-rail" aria-label="Agenda (folded)">
      <button className="ghost icon sm" aria-label="Show the agenda" title="Show the agenda" onClick={onOpen}>»</button>
      {view.agenda.map((a, i) => (
        <button key={a.id} onClick={onOpen} title={`${a.title} · ${a.durationMin} min`} aria-label={`${i + 1}. ${a.title}`}
          className={`step${a.id === view.meta.currentAgendaId ? ' current' : ''}${a.done ? ' done' : ''}`}
          aria-current={a.id === view.meta.currentAgendaId ? 'step' : undefined}>{i + 1}</button>
      ))}
    </nav>
  );
}

// Drag (or arrow keys) to widen the right column. Double-click puts it back.
function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const clamp = (w: number) => Math.round(Math.max(260, Math.min(w, window.innerWidth * 0.6)));
  const start = (e: ReactPointerEvent) => {
    e.preventDefault();
    const x0 = e.clientX; const w0 = width;
    const move = (ev: PointerEvent) => onResize(clamp(w0 + x0 - ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.classList.remove('resizing'); };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize the side panel" aria-valuenow={width} tabIndex={0}
      title="Drag to resize · double-click to reset" onPointerDown={start} onDoubleClick={() => onResize(320)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onResize(clamp(width + 40)); if (e.key === 'ArrowRight') onResize(clamp(width - 40)); }} />
  );
}

function AgendaPanel({ view, ops, canFacilitate, closed, onFold }: { view: View; ops: Ops; canFacilitate: boolean; closed: boolean; onFold: () => void }) {
  const [title, setTitle] = useState('');
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const total = view.agenda.reduce((n, a) => n + a.durationMin, 0);
  const currentIndex = view.agenda.findIndex((a) => a.id === view.meta.currentAgendaId);
  const next = view.agenda[currentIndex + 1];
  return (
    <>
      <header><h2>Agenda</h2><span className="spacer" /><span className="faint small">{total} min</span>
        <button className="ghost icon sm" aria-label="Fold the agenda" title="Fold the agenda to a narrow rail" onClick={onFold}>«</button></header>
      <div className="content col" style={{ gap: 2 }}>
        {view.agenda.length === 0 && <div className="empty small">No agenda items yet.</div>}
        {view.agenda.map((a, i) => (
          <div key={a.id} data-find={a.id}
            className={`agenda-item${a.id === view.meta.currentAgendaId ? ' current' : ''}${a.done ? ' done' : ''}`}
            role={canFacilitate && !closed ? 'button' : undefined} tabIndex={canFacilitate && !closed ? 0 : undefined}
            title={canFacilitate ? 'Make this the current item and start its timer' : undefined}
            onClick={() => canFacilitate && !closed && ops.setCurrent(a.id)}
            onKeyDown={(e) => e.key === 'Enter' && canFacilitate && !closed && ops.setCurrent(a.id)}>
            <span className="faint small" style={{ minWidth: 16, paddingTop: 1 }}>{i + 1}</span>
            <div className="col" style={{ gap: 0, flex: 1, minWidth: 0 }}>
              <span className="title">{a.title}</span>
              <span className="meta">{a.durationMin} min{a.activity && a.activity !== 'topic' ? ` · ${ACTIVITY_LABEL[a.activity]}` : ''}{a.owner ? ` · ${a.owner}` : ''}</span>
            </div>
            {!closed && <button className="ghost sm edit" aria-label={`Edit ${a.title}`} onClick={(e) => { e.stopPropagation(); setEditing(a); }}>Edit</button>}
          </div>
        ))}
        {canFacilitate && !closed && next && (
          <button className="sm" style={{ marginTop: 6 }} onClick={() => ops.setCurrent(next.id)}>{currentIndex < 0 ? 'Start with first item' : 'Next item →'}</button>
        )}
        {!closed && (
          <form style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); if (title.trim()) { ops.addAgenda(title); setTitle(''); } }}>
            <input placeholder="Add a topic…" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="New agenda item" />
          </form>
        )}
      </div>
      {editing && <AgendaItemModal item={editing} view={view} ops={ops} canFacilitate={canFacilitate} onClose={() => setEditing(null)} />}
    </>
  );
}

function AgendaItemModal({ item, view, ops, canFacilitate, onClose }: { item: AgendaItem; view: View; ops: Ops; canFacilitate: boolean; onClose: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [durationMin, setDuration] = useState(item.durationMin);
  const [owner, setOwner] = useState(item.owner);
  const [done, setDone] = useState(item.done);
  const [activity, setActivity] = useState<Activity>(item.activity ?? 'topic');
  const index = view.agenda.findIndex((a) => a.id === item.id);
  return (
    <Modal title="Agenda item" onClose={onClose}>
      <form className="col" onSubmit={(e) => { e.preventDefault(); ops.updateAgenda(item.id, { title: title.trim() || item.title, durationMin: Math.max(0, Math.min(480, Number(durationMin) || 0)), owner: owner.trim(), done, activity }); onClose(); }}>
        <label className="field">Topic<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="row">
          <label className="field" style={{ flex: 1 }}>Minutes<input type="number" min={0} max={480} value={durationMin} onChange={(e) => setDuration(Number(e.target.value))} /></label>
          <label className="field" style={{ flex: 2 }}>Owner<input list="rondel-people" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
        </div>
        <label className="field">Activity
          <select value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
            {ACTIVITIES.map((x) => <option key={x} value={x}>{ACTIVITY_LABEL[x]}</option>)}
          </select>
          <span className="hint">{ACTIVITY_HINT[activity]}</span>
        </label>
        <label className="check"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Covered</label>
        <div className="row">
          {canFacilitate && (
            <>
              <button type="button" className="sm" disabled={index === 0} onClick={() => ops.moveAgenda(item.id, index - 1)}>Move up</button>
              <button type="button" className="sm" disabled={index === view.agenda.length - 1} onClick={() => ops.moveAgenda(item.id, index + 1)}>Move down</button>
              <button type="button" className="sm danger" onClick={async () => { if (await ask('Remove this agenda item?')) { ops.deleteAgenda(item.id); onClose(); } }}>Remove</button>
            </>
          )}
          <span className="spacer" />
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function CurrentItem({ doc, view, ops, closed, canFacilitate, dock }: { doc: Y.Doc; view: View; ops: Ops; closed: boolean; canFacilitate: boolean; dock: Dock }) {
  const item = view.agenda.find((a) => a.id === view.meta.currentAgendaId);
  // Read on every render, so if a peer's copy of the notes wins a concurrent creation we follow it.
  const text = item ? maps(doc).notes.get(item.id) ?? null : null;
  useEffect(() => {
    if (item && !text && !closed) ops.notesFor(item.id);
  }, [item?.id, text, closed]);
  const decisions = item ? view.decisions.filter((d) => d.agendaItemId === item.id) : [];
  const [preview, setPreview] = useState(false);
  const notes = useYText(text);
  const showRendered = !!text && (preview || closed);
  return (
    <section className={`panel current-item${dockClass(dock)}`} aria-label="Discussion">
      <DockHeader title="Discussion" dock={dock} extra={text && !closed ? (
        <button className={`ghost sm${preview ? ' active' : ''}`} aria-pressed={preview} onClick={() => setPreview((x) => !x)} title="Show the notes with their Markdown formatting">{preview ? 'Edit' : 'Preview'}</button>
      ) : undefined} />
      <div className="content col" style={{ gap: 12 }}>
        {!item ? (
          <p className="faint small">{view.agenda.length ? (canFacilitate ? 'Start an agenda item to take its notes and decisions here.' : 'Waiting for the facilitator to start the first agenda item.') : 'Add agenda topics on the left.'}</p>
        ) : (
          <>
            <div className="row">
              <span className="badge accent">Now</span>
              <h3 style={{ flex: 1 }}>{item.title}</h3>
              {item.activity && item.activity !== 'topic' && <span className="small muted">{ACTIVITY_LABEL[item.activity]}</span>}
              {item.owner && <span className="small muted">{item.owner}</span>}
            </div>
            <div className="notes col" style={{ gap: 4 }}>
              {showRendered
                ? (notes.trim() ? <Md text={notes} className="notes-view" /> : <p className="muted">No notes were taken for this topic.</p>)
                : text ? <SharedText key={item.id} text={text} readOnly={closed} label="Notes" placeholder="Shared notes for this topic… everyone can type at once. Markdown works: **bold**, - lists, [links](https://…)" />
                : closed && <p className="muted">No notes were taken for this topic.</p>}
            </div>
            {decisions.map((d) => <div key={d.id} data-find={d.id} className="decision"><strong>Decision:</strong>&nbsp;<Md text={d.text} inline /></div>)}
            {!closed && <DecisionForm ops={ops} agendaItemId={item.id} />}
          </>
        )}
      </div>
    </section>
  );
}

/** The current text of a shared Y.Text, re-rendering as anyone types. */
function useYText(text: Y.Text | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!text) return;
    const f = () => tick((x) => x + 1);
    text.observe(f);
    return () => text.unobserve(f);
  }, [text]);
  return text ? text.toString() : '';
}

function DecisionForm({ ops, agendaItemId }: { ops: Ops; agendaItemId: string | null }) {
  const [text, setText] = useState('');
  return (
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { ops.addDecision(text, agendaItemId); setText(''); } }}>
      <input placeholder="Record a decision…" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} aria-label="New decision" />
      <button type="submit" className="sm" disabled={!text.trim()}>Add</button>
    </form>
  );
}

const STEP_LABEL = { collect: 'Collect', vote: 'Vote', pick: 'Pick' } as const;
const STEP_HINT = {
  collect: 'Write as many ideas as you can, one at a time. No judging yet.',
  vote: `Put your ${IDEA_DOTS} dots on the ideas worth pursuing. You can stack them.`,
  pick: 'Turn the top ideas into action items or new agenda topics.',
} as const;

/** Unlike Discussion (one shared text, written together, in order), a brainstorm collects many short ideas from
 *  everyone at once, optionally unseen by the others, then narrows them down with dots. */
function BrainstormPanel({ roomId, view, ops, closed, canFacilitate, dock }: { roomId: string; view: View; ops: Ops; closed: boolean; canFacilitate: boolean; dock: Dock }) {
  const item = view.agenda.find((a) => a.id === view.meta.currentAgendaId) ?? null;
  const itemId = item?.id ?? null;
  const state = view.brainstorms[brainstormKey(itemId)] ?? { step: 'collect', hidden: false };
  const step = closed ? 'pick' : state.step;
  const me = voterId(roomId);
  const ideas = view.ideas.filter((i) => i.itemId === itemId);
  const myDots = view.ideaVotesByVoter[me] ?? {};
  const dotsLeft = IDEA_DOTS - ideas.reduce((n, i) => n + (myDots[i.id] ?? 0), 0);
  const [text, setText] = useState('');
  const hideOthers = step === 'collect' && state.hidden;
  const shown = step === 'pick'
    ? [...ideas].sort((a, b) => (view.ideaVotes[b.id] ?? 0) - (view.ideaVotes[a.id] ?? 0))
    : hideOthers ? ideas.filter((i) => i.by === me) : ideas;
  const hiddenCount = ideas.length - shown.length;
  const vote = (id: string, d: 1 | -1) => { try { ops.voteIdea(id, d); } catch (e) { toastError(e); } };
  return (
    <section className={`panel brainstorm${dockClass(dock)}`} aria-label="Brainstorm">
      <DockHeader title="Brainstorm" dock={dock} extra={<span className="faint small">{ideas.length} idea{ideas.length === 1 ? '' : 's'}</span>} />
      <div className="content col" style={{ gap: 10 }}>
        {item && <div className="brainstorm-prompt"><Md text={item.title} inline /></div>}
        <div className="row wrap">
          <nav className="phases" aria-label="Brainstorm steps">
            {BRAINSTORM_STEPS.map((s) => (
              <button key={s} aria-current={step === s ? 'step' : undefined} disabled={!canFacilitate || closed} onClick={() => ops.brainstorm(itemId, { step: s })}>{STEP_LABEL[s]}</button>
            ))}
          </nav>
          {step === 'collect' && canFacilitate && !closed && (
            <label className="row small muted" style={{ gap: 6 }}>
              <input type="checkbox" checked={state.hidden} onChange={(e) => ops.brainstorm(itemId, { hidden: e.target.checked })} />
              Hide others' ideas until voting
            </label>
          )}
        </div>
        {!closed && <p className="muted small">{STEP_HINT[step]}{step === 'vote' && ` ${dotsLeft} of ${IDEA_DOTS} left.`}</p>}
        {step === 'collect' && !closed && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { ops.addIdea(text, itemId); setText(''); } }}>
            <input placeholder="An idea, then Enter" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} aria-label="New idea" />
            <button type="submit" className="sm" disabled={!text.trim()}>Add</button>
          </form>
        )}
        {shown.length > 0 && (
          <ul className="idea-grid">
            {shown.map((i) => {
              const total = view.ideaVotes[i.id] ?? 0;
              const mine = myDots[i.id] ?? 0;
              return (
                <li key={i.id} data-find={i.id} className={`idea${i.picked ? ' picked' : ''}`}>
                  <div className="idea-text"><Md text={i.text} inline /></div>
                  <div className="row small" style={{ gap: 4 }}>
                    {step === 'collect' && i.by === me && !closed && <><span className="faint">yours</span><span className="spacer" /><button className="ghost icon sm" aria-label="Remove idea" onClick={() => ops.deleteIdea(i.id)}>✕</button></>}
                    {step === 'vote' && !closed && (
                      <span className="votes">
                        <button className="ghost icon sm" aria-label="Remove dot" disabled={!mine} onClick={() => vote(i.id, -1)}>−</button>
                        <span className="count" title="Your dots">{mine}</span>
                        <button className="ghost icon sm" aria-label="Add dot" disabled={dotsLeft <= 0} onClick={() => vote(i.id, 1)}>+</button>
                      </span>
                    )}
                    {step === 'pick' && (
                      <>
                        <span className="badge" title="Dots">{total} dot{total === 1 ? '' : 's'}</span>
                        <span className="spacer" />
                        {i.picked
                          ? <span className="muted">{i.picked === 'action' ? 'Action added' : 'On the agenda'}</span>
                          : !closed && <>
                              <button className="sm" onClick={() => ops.ideaToAction(i.id)} aria-label={`Make an action: ${i.text}`}>Action</button>
                              <button className="sm" onClick={() => ops.ideaToAgenda(i.id)} aria-label={`Add to agenda: ${i.text}`}>Agenda</button>
                            </>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {hiddenCount > 0 && <p className="faint small">{hiddenCount} more from others, shown when voting starts.</p>}
        {ideas.length === 0 && (closed || step !== 'collect') && <p className="faint small">No ideas yet.</p>}
      </div>
    </section>
  );
}

function DecisionsPanel({ view, ops, closed, dock }: { view: View; ops: Ops; closed: boolean; dock: Dock }) {
  const titleOf = (id: string | null) => view.agenda.find((a) => a.id === id)?.title;
  return (
    <section className={`panel${dockClass(dock)}`} aria-label="Decisions">
      <DockHeader title="Decisions" dock={dock} extra={<span className="faint small">{view.decisions.length}</span>} />
      <div className="content col" style={{ gap: 6 }}>
        {view.decisions.length === 0 && <p className="faint small">No decisions yet.</p>}
        {view.decisions.map((d) => (
          <div key={d.id} data-find={d.id} className="decision">
            <div className="col" style={{ gap: 0, flex: 1 }}>
              <Md text={d.text} inline />
              {titleOf(d.agendaItemId) && <span className="small muted">{titleOf(d.agendaItemId)}</span>}
            </div>
            {!closed && <button className="ghost icon sm" aria-label="Remove decision" onClick={() => ops.deleteDecision(d.id)}>✕</button>}
          </div>
        ))}
        {!closed && <DecisionForm ops={ops} agendaItemId={null} />}
      </div>
    </section>
  );
}

function ShareModal({ link, seriesLink, seriesOverview, onClose }: { link: string; seriesLink?: string; seriesOverview?: string; onClose: () => void }) {
  const [qr, setQr] = useState(false);
  return (
    <Modal title="Invite people" onClose={onClose}>
      {seriesLink && (
        <div className="stack" style={{ marginBottom: 12 }}>
          <p className="muted">This meeting is part of a series. Put the series link in the recurring calendar invite: it always opens the current meeting.</p>
          <div className="row">
            <input readOnly value={seriesLink} aria-label="Series link" onFocus={(e) => e.target.select()} />
            <button className="primary" onClick={() => copyText(seriesLink, 'Series link copied')}>Copy</button>
          </div>
          {seriesOverview && <a className="small" href={seriesOverview} onClick={onClose}>Invite text, calendar file and past meetings</a>}
          <h3 className="muted">Link to this meeting only</h3>
        </div>
      )}
      <p className="muted">Anyone with this link can join and edit the meeting. The part after <code>#</code> is the encryption key and is never sent to any server.</p>
      <div className="row">
        <input readOnly value={link} aria-label="Meeting link" onFocus={(e) => e.target.select()} />
        <button className="primary" onClick={() => copyText(link, 'Link copied')}>Copy</button>
        <button aria-pressed={qr} className={qr ? 'active' : ''} onClick={() => setQr((x) => !x)}>QR code</button>
      </div>
      {qr && (
        <div className="qr-box">
          <QrCode text={link} label="QR code of the meeting link" />
          <span className="small muted">Scan with your phone's camera to open the meeting there. The code is made in this browser; the link isn't sent anywhere.</span>
        </div>
      )}
      {window.RONDEL_CONFIG?.shareUrl ? (
        <p className="small muted">The link opens this preview at the meeting. If someone lands on the home page instead, they can paste the link into Join a meeting.</p>
      ) : location.protocol === 'file:' ? (
        <p className="small error-banner">
          You opened Rondel from a file on your computer, so this link only works for people who have the same file in the same place.
          For easy invites, put rondel.html on an intranet page, SharePoint or GitHub Pages and open it from there.
        </p>
      ) : (
        <p className="small muted">Share it the way you'd share a meeting invite, for example in the calendar event or team chat.</p>
      )}
    </Modal>
  );
}

function SettingsModal({ settings, ops, peers, facilitators, onClose, onSaveAsTemplate }: { settings: Settings; ops: Ops; peers: Peer[]; facilitators: string[]; onClose: () => void; onSaveAsTemplate: () => void }) {
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));
  const [remember, setRemember] = useState(false);
  return (
    <Modal title="Meeting settings" onClose={onClose} wide>
      <form className="col" style={{ gap: 16 }} onSubmit={(e) => {
        e.preventDefault();
        ops.settings(s);
        if (remember) setPrefs({ meetingDefaults: { showAuthors: s.showAuthors, votesPerUser: s.votesPerUser, votesPerCard: s.votesPerCard, secretVoting: s.secretVoting, openBoard: s.openBoard } });
        toast(remember ? 'Settings saved, and used for your new meetings' : 'Settings saved');
        onClose();
      }}>
        <label className="check"><input type="checkbox" checked={s.openBoard} onChange={(e) => set('openBoard', e.target.checked)} /> Open board, like a whiteboard</label>
        <p className="small muted" style={{ marginTop: -10 }}>Cards appear for everyone as they are written, with the writer's name, and others see who is typing where. When off, cards start as private drafts.</p>
        {!s.openBoard && <label className="check"><input type="checkbox" checked={s.showAuthors} onChange={(e) => set('showAuthors', e.target.checked)} /> Show who wrote each card</label>}
        <p className="small muted" style={{ marginTop: -10 }}>When off, cards are anonymous: the author's name is never stored, only this browser remembers which cards are yours. Applies to cards shared from now on.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label className="field">Votes per person<input type="number" min={0} max={100} value={s.votesPerUser} onChange={(e) => set('votesPerUser', Number(e.target.value))} /><span className="hint">0 = unlimited</span></label>
          <label className="field">Max votes per card<input type="number" min={0} max={100} value={s.votesPerCard} onChange={(e) => set('votesPerCard', Number(e.target.value))} /><span className="hint">0 = unlimited</span></label>
        </div>
        <label className="check"><input type="checkbox" checked={s.secretVoting} onChange={(e) => set('secretVoting', e.target.checked)} /> Hide vote totals until revealed</label>
        <p className="small muted" style={{ marginTop: -10 }}>Votes are anonymous. Totals are hidden in the app, but without a server they can't be made tamper-proof; treat this as a courtesy among colleagues.</p>
        <div className="col" style={{ gap: 6 }}>
          <h3>Facilitators</h3>
          <div className="row wrap">
            {peers.map((p) => (
              <label key={p.id} className="check" style={{ minWidth: 150 }}>
                <input type="checkbox" checked={facilitators.includes(p.id)} disabled={facilitators.includes(p.id)} onChange={() => ops.addFacilitator(p.id)} /> {p.name}{p.self ? ' (you)' : ''}
              </label>
            ))}
          </div>
          <span className="small muted">Facilitators move phases, run the timer and agenda, and close the meeting.</span>
        </div>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Use these card and voting settings for my new meetings</label>
        <p className="small muted" style={{ marginTop: -10 }}>Remembered in this browser. A template's own settings still take precedence.{getPrefs().meetingDefaults ? ' You already have saved defaults; this replaces them.' : ''}</p>
        <div className="row"><button type="button" onClick={onSaveAsTemplate} title="Reuse this board, stages and settings for future meetings">Save as a new template…</button><span className="spacer" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit">Save</button></div>
      </form>
    </Modal>
  );
}

type Ctx = {
  view: View; ops: Ops; me: Identity; roomId: string; closed: boolean; hasBoard: boolean; middle: MiddleBlock[]; isFacilitator: boolean; canStructure: boolean;
  current: AgendaItem | undefined; available: (b: MiddleBlock) => boolean; isFolded: (b: ScreenBlock) => boolean; setFolded: (b: ScreenBlock, f: boolean) => void;
  show: (b: MiddleBlock) => void; minimize: (b: MiddleBlock) => void; resetLayout: () => void;
  invite: () => void; minutes: () => void; save: () => void; settings: () => void; next: () => void; newTemplate: () => void; templateName: string;
  occurrence: { label: string; run: () => void } | null;
  ready: { done: boolean; set: (on: boolean) => void };
};

const firstLine = (t: string) => { const l = t.split('\n').find((x) => x.trim()) ?? ''; return l.length > 110 ? `${l.slice(0, 110)}…` : l; };
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Everything the command palette can do in a meeting, given who you are and what the meeting is doing. */
function meetingCommands(c: Ctx): Command[] {
  const { view, ops, closed } = c;
  const { meta } = view;
  const out: Command[] = [];
  const add = (x: Command) => out.push(x);
  const into = (b: MiddleBlock, then?: () => void) => () => { c.show(b); then?.(); };
  const runs = c.isFacilitator && !closed;

  // ---- find things
  for (const card of view.cards) {
    const col = view.columns.find((x) => x.id === card.columnId);
    add({ id: `card-${card.id}`, group: 'Cards', label: firstLine(card.text), hint: col?.title, keywords: card.text, search: true, run: into('board', () => reveal(card.id)) });
  }
  const itemId = c.current?.id ?? null;
  const bs = view.brainstorms[brainstormKey(itemId)];
  const mine = voterId(c.roomId);
  for (const i of view.ideas) {
    if (i.itemId !== itemId) continue;
    if (bs?.hidden && bs.step === 'collect' && i.by !== mine && !closed) continue;
    add({ id: `idea-${i.id}`, group: 'Ideas', label: firstLine(i.text), hint: c.current?.title, keywords: i.text, search: true, run: into('brainstorm', () => reveal(i.id)) });
  }
  for (const a of view.actions) {
    add({ id: `action-${a.id}`, group: 'Action items', label: firstLine(a.text), hint: [a.owner, a.due, a.status !== 'open' ? a.status : ''].filter(Boolean).join(' · '), keywords: `${a.text} ${a.owner}`, search: true, run: into('actions', () => reveal(a.id)) });
  }
  for (const d of view.decisions) {
    add({ id: `decision-${d.id}`, group: 'Decisions', label: firstLine(d.text), keywords: d.text, search: true, run: into('decisions', () => reveal(d.id)) });
  }
  for (const a of view.agenda) {
    add({ id: `agenda-${a.id}`, group: 'Agenda', label: a.title, hint: `${a.durationMin} min · ${ACTIVITY_LABEL[a.activity ?? 'topic']}`, keywords: a.owner, search: true, run: () => { c.setFolded('agenda', false); reveal(a.id); } });
  }

  // ---- run the meeting
  if (runs) {
    const i = c.current ? view.agenda.findIndex((a) => a.id === c.current!.id) : -1;
    const next = view.agenda.slice(i + 1).find((a) => !a.done) ?? view.agenda[i + 1];
    if (next) add({ id: 'next-item', group: 'Run the meeting', label: `Next item: ${next.title}`, keywords: 'agenda start advance', run: () => ops.setCurrent(next.id) });
    for (const a of view.agenda) if (a.id !== c.current?.id) add({ id: `start-${a.id}`, group: 'Run the meeting', label: `Start: ${a.title}`, keywords: 'agenda item begin', search: true, run: () => ops.setCurrent(a.id) });
    const t = meta.timer;
    if (t.running) {
      add({ id: 'timer-pause', group: 'Run the meeting', label: 'Pause the timer', keywords: 'clock stop', run: ops.timerPause });
      add({ id: 'timer-1', group: 'Run the meeting', label: 'Add 1 minute to the timer', keywords: 'clock more time extend', run: () => ops.timerAdd(60_000) });
      add({ id: 'timer-5', group: 'Run the meeting', label: 'Add 5 minutes to the timer', keywords: 'clock more time extend', run: () => ops.timerAdd(300_000) });
    } else if (t.remainingMs > 0) add({ id: 'timer-resume', group: 'Run the meeting', label: 'Resume the timer', keywords: 'clock continue', run: ops.timerResume });
    for (const m of [5, 10]) add({ id: `timer-new-${m}`, group: 'Run the meeting', label: `Start a ${m}-minute timer`, keywords: 'clock countdown', run: () => ops.timerStart(m * 60_000) });
    if (meta.phase) for (const p of RETRO_PHASES) if (p !== meta.phase) add({ id: `phase-${p}`, group: 'Run the meeting', label: `Board: ${ACTIVITY_LABEL[p]}`, keywords: 'stage phase', run: () => ops.phase(p) });
    if (meta.settings.secretVoting && !meta.settings.votesRevealed) add({ id: 'reveal', group: 'Run the meeting', label: 'Reveal votes', run: () => ops.settings({ votesRevealed: true }) });
  }
  if (c.canStructure && !closed && (bs || c.middle.includes('brainstorm') || c.current?.activity === 'brainstorm')) {
    const step = bs?.step ?? 'collect';
    for (const s of BRAINSTORM_STEPS) if (s !== step) add({ id: `bs-${s}`, group: 'Run the meeting', label: `Brainstorm: ${STEP_LABEL[s]}`, keywords: 'ideas step', run: into('brainstorm', () => ops.brainstorm(itemId, { step: s })) });
  }

  // ---- add things
  if (!closed) {
    if (c.hasBoard) add({ id: 'add-card', group: 'Add', label: 'Add a card', keywords: 'new note board', run: into('board', () => setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('main button')].find((b) => b.textContent === '+ Add card')?.click(), 50)) });
    add({ id: 'add-idea', group: 'Add', label: 'Add an idea', keywords: 'new brainstorm', run: into('brainstorm', () => { if ((bs?.step ?? 'collect') === 'collect') focusField('New idea'); }) });
    add({ id: 'add-action', group: 'Add', label: 'Add an action item', keywords: 'new todo task', run: into('actions', () => focusField('New action')) });
    add({ id: 'add-decision', group: 'Add', label: 'Record a decision', keywords: 'new decided', run: into('decisions', () => focusField('New decision')) });
    if (c.current) add({ id: 'add-notes', group: 'Add', label: 'Write notes', hint: c.current.title, keywords: 'discussion notes text', run: into('topic', () => focusField('Notes')) });
    add({ id: 'add-agenda', group: 'Add', label: 'Add an agenda topic', keywords: 'new item agenda', run: () => { c.setFolded('agenda', false); focusField('New agenda item'); } });
  }

  // ---- screen
  for (const b of SIDE_ORDER) {
    if (!c.available(b)) continue;
    const name = SCREEN_BLOCK_LABEL[b];
    if (c.middle.includes(b)) add({ id: `min-${b}`, group: 'Screen', label: `Minimize ${lower(name)} to the side bar`, keywords: 'module panel block hide move', run: () => c.minimize(b) });
    else {
      add({ id: `show-${b}`, group: 'Screen', label: `Show ${lower(name)} in the middle`, keywords: 'module panel block maximize expand open move', run: () => c.show(b) });
      add({ id: `fold-${b}`, group: 'Screen', label: `${c.isFolded(b) ? 'Unfold' : 'Fold'} ${lower(name)} in the side bar`, keywords: 'module panel block collapse expand toggle', run: () => c.setFolded(b, !c.isFolded(b)) });
    }
  }
  add({ id: 'fold-agenda', group: 'Screen', label: c.isFolded('agenda') ? 'Show the agenda' : 'Fold the agenda', keywords: 'module panel collapse expand toggle sidebar', run: () => c.setFolded('agenda', !c.isFolded('agenda')) });
  add({ id: 'reset-layout', group: 'Screen', label: 'Reset my screen layout', keywords: 'default restore panels', run: c.resetLayout });

  // ---- meeting
  add({ id: 'invite', group: 'Meeting', label: 'Invite people', keywords: 'share link qr copy', run: c.invite });
  add({ id: 'minutes', group: 'Meeting', label: 'Minutes', hint: 'Copy for email or download', keywords: 'summary notes export outlook', run: c.minutes });
  add({ id: 'new-template', group: 'Meeting', label: 'Save as a new template', hint: `New version of ${c.templateName}`, keywords: 'template design copy duplicate version reuse save as', run: c.newTemplate });
  add({ id: 'save', group: 'Meeting', label: 'Save meeting file', keywords: 'download export backup archive', run: c.save });
  if (!closed) add({ id: 'ready', group: 'Meeting', label: c.ready.done ? "I'm not done yet" : "I'm done", keywords: 'ready finished', run: () => c.ready.set(!c.ready.done) });
  if (c.isFacilitator) add({ id: 'settings', group: 'Meeting', label: 'Meeting settings', keywords: 'preferences votes anonymous authors facilitators', run: c.settings });
  if (runs) add({ id: 'close', group: 'Meeting', label: 'Close meeting', keywords: 'end finish', run: async () => { if (await ask('Close the meeting? Everything becomes read-only. Save the minutes or meeting file afterwards to keep a record.')) ops.close(); } });
  if (c.occurrence && !closed) add({ id: 'occurrence', group: 'Meeting', label: c.occurrence.label, keywords: 'series next week recurring', run: c.occurrence.run });
  if (closed) {
    add({ id: 'next-meeting', group: 'Meeting', label: 'Next meeting', keywords: 'start new follow-up series', run: c.next });
    if (c.isFacilitator) add({ id: 'reopen', group: 'Meeting', label: 'Reopen meeting', run: ops.reopen });
  }
  return out;
}
