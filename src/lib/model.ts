import * as Y from 'yjs';

// ------------------------------------------------------------ types

export type MeetingType = 'retro' | 'standup' | 'planning' | 'one_on_one' | 'general';
export type RetroPhase = 'write' | 'group' | 'vote' | 'discuss' | 'actions';
export const RETRO_PHASES: RetroPhase[] = ['write', 'group', 'vote', 'discuss', 'actions'];

/**
 * What happens during an agenda item. Board stages (write, group, vote, discuss, actions) switch the
 * card board into that mode when the item starts, so a retro can be designed as timed stages.
 */
export type Activity = 'topic' | 'round' | 'brainstorm' | RetroPhase | 'break';
export const ACTIVITIES: Activity[] = ['topic', 'round', 'brainstorm', 'write', 'group', 'vote', 'discuss', 'actions', 'break'];
export const ACTIVITY_LABEL: Record<Activity, string> = {
  topic: 'Discussion', round: 'Round', brainstorm: 'Brainstorm', write: 'Write cards', group: 'Group cards', vote: 'Vote', discuss: 'Discuss cards', actions: 'Actions', break: 'Break',
};
export const ACTIVITY_HINT: Record<Activity, string> = {
  topic: 'Shared notes and decisions for one topic.',
  round: 'Everyone speaks in turn, for example a check-in or updates.',
  brainstorm: 'Everyone adds ideas at once, without judging; then dot-vote and turn the best into actions.',
  write: 'People write cards on the board. Drafts stay private until shared.',
  group: 'Cluster similar cards and name the groups.',
  vote: 'Everyone votes for the cards to discuss.',
  discuss: 'Talk through cards in vote order.',
  actions: 'Agree owners and due dates for actions.',
  break: 'A pause. The timer runs; nothing to capture.',
};
export const isBoardActivity = (a: Activity | undefined): a is RetroPhase => !!a && (RETRO_PHASES as string[]).includes(a);

// The meeting screen: a middle work area (up to two blocks, newest on top) and a fixed home in the side bar for every block.
// A stage can say what goes in the middle and what is folded; each person can still rearrange their own screen.
export type MiddleBlock = 'board' | 'brainstorm' | 'topic' | 'actions' | 'decisions' | 'people';
export const MIDDLE_BLOCKS: MiddleBlock[] = ['board', 'brainstorm', 'topic', 'actions', 'decisions', 'people'];
export type ScreenBlock = 'agenda' | MiddleBlock;
export const SCREEN_BLOCKS: ScreenBlock[] = ['agenda', 'people', 'board', 'brainstorm', 'topic', 'actions', 'decisions'];
export const SCREEN_BLOCK_LABEL: Record<ScreenBlock, string> = { agenda: 'Agenda', people: 'People', board: 'Board', brainstorm: 'Brainstorm', topic: 'Discussion', actions: 'Action items', decisions: 'Decisions' };
export const MIDDLE_MAX = 2;
export type Screen = Partial<Record<ScreenBlock, 'open' | 'folded'>> & { middle?: MiddleBlock[] };
/** What each kind of stage puts in the middle unless the design says otherwise. */
export function defaultScreen(a: Activity | undefined): Screen {
  if (a === 'write' || a === 'group' || a === 'vote') return { middle: ['board'] };
  if (a === 'brainstorm') return { middle: ['brainstorm'] };
  if (a === 'discuss') return { middle: ['board', 'topic'] };
  if (a === 'actions') return { middle: ['actions', 'topic'] };
  if (a === 'break') return { middle: ['topic'] };
  return {};
}
export const screenFor = (item: { activity?: Activity; screen?: Screen }): Screen => ({ ...defaultScreen(item.activity), ...item.screen });

export interface Settings {
  /** Show card authors' names, or keep cards anonymous (names are never stored). */
  showAuthors: boolean;
  votesPerUser: number; // 0 = unlimited
  votesPerCard: number; // 0 = unlimited
  secretVoting: boolean;
  votesRevealed: boolean;
  /** Like a whiteboard: cards appear for everyone as they are written, with the writer's name, instead of as private drafts. */
  openBoard: boolean;
}

export interface Timer {
  running: boolean;
  endsAt: number | null;
  remainingMs: number;
  durationMs: number;
  label: string | null;
}

export interface Meta {
  title: string;
  type: MeetingType;
  templateId: string;
  createdAt: string;
  createdBy: string;
  facilitators: string[];
  phase: RetroPhase | null;
  settings: Settings;
  timer: Timer;
  currentAgendaId: string | null;
  status: 'live' | 'closed';
  closedAt: string | null;
  readyEpoch: number;
  seriesName: string | null;
  previousTitle: string | null;
  /** The template the meeting was made from, so the next meeting in a series can use it too. */
  template: TemplateDef | null;
  /** People the creator removed: their apps leave the meeting and delete their copy. */
  removed: { id: string; name: string }[];
  /** The recurring series this meeting belongs to, if it was opened from a series link. */
  series: { id: string; key: string; occ: string } | null;
}

export interface Column { id: string; title: string; description: string; color: string; position: number }
export interface Card {
  id: string;
  columnId: string;
  text: string;
  color: string | null;
  authorName: string | null;
  groupId: string | null;
  groupTitle: string | null;
  createdAt: string;
}
export interface AgendaItem { id: string; title: string; durationMin: number; owner: string; done: boolean; position: number; activity?: Activity; screen?: Screen }
/** One brainstorm idea, for the agenda item it was written under (null: none was running). `by` is the writer's
 *  anonymous per-meeting id, so people can see and edit their own ideas; names are not stored. */
export interface Idea { id: string; text: string; itemId: string | null; by: string; createdAt: string; picked?: 'action' | 'agenda' }
export type BrainstormStep = 'collect' | 'vote' | 'pick';
export const BRAINSTORM_STEPS: BrainstormStep[] = ['collect', 'vote', 'pick'];
/** How a brainstorm for one agenda item is running. `hidden`: while collecting, people see only their own ideas. */
export interface Brainstorm { step: BrainstormStep; hidden: boolean }
export const IDEA_DOTS = 3;
export const brainstormKey = (itemId: string | null) => itemId ?? '_';
export interface Decision { id: string; text: string; agendaItemId: string | null; createdAt: string }
export type ActionStatus = 'open' | 'done' | 'dropped';
export interface ActionItem {
  id: string;
  text: string;
  owner: string;
  due: string | null;
  status: ActionStatus;
  cardId: string | null;
  createdAt: string;
  /** Title of the meeting it came from, when carried over from an earlier meeting. */
  carriedFrom: string | null;
}

/** Someone who has opened the meeting, kept so people who prepared earlier still show. */
export interface Person { id: string; name: string; firstSeen: string; lastSeen: string }

/** Plain, read-only view of the shared document, recomputed after every change. */
export interface View {
  meta: Meta;
  columns: Column[];
  cards: Card[];
  /** Total votes per card. */
  votes: Record<string, number>;
  /** Votes per card cast by each anonymous voter id. */
  votesByVoter: Record<string, Record<string, number>>;
  agenda: AgendaItem[];
  decisions: Decision[];
  actions: ActionItem[];
  people: Person[];
  ideas: Idea[];
  /** Total dots per idea. */
  ideaVotes: Record<string, number>;
  /** Dots per idea by each anonymous voter id. */
  ideaVotesByVoter: Record<string, Record<string, number>>;
  /** Brainstorm state per agenda item (brainstormKey). */
  brainstorms: Record<string, Brainstorm>;
}

/** A meeting template; written by people as YAML (see templates.ts). */
export interface TemplateDef {
  id: string;
  name: string;
  type: MeetingType;
  description: string;
  /** Default meeting title; {date} becomes today's date, {month} e.g. October 2026. */
  title?: string;
  columns: { title: string; description: string; color: string }[];
  agenda: { title: string; durationMin: number; owner?: string; notes?: string; activity?: Activity; screen?: Screen }[];
  settings?: Partial<Omit<Settings, 'votesRevealed'>>;
}

export const TYPE_LABEL: Record<MeetingType, string> = {
  retro: 'Retro', standup: 'Stand-up', planning: 'Planning', one_on_one: '1:1', general: 'Meeting',
};

export function defaultSettings(type: MeetingType): Settings {
  const retro = type === 'retro';
  return { showAuthors: !retro, votesPerUser: retro ? 5 : 3, votesPerCard: retro ? 3 : 1, secretVoting: retro, votesRevealed: false, openBoard: false };
}

export const idleTimer = (): Timer => ({ running: false, endsAt: null, remainingMs: 0, durationMs: 0, label: null });

// ------------------------------------------------------------ ids

export function randomId(bytes = 9) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ------------------------------------------------------------ document access

export const maps = (doc: Y.Doc) => ({
  meta: doc.getMap<any>('meta'),
  columns: doc.getMap<Column>('columns'),
  cards: doc.getMap<Card>('cards'),
  votes: doc.getMap<number>('votes'),
  agenda: doc.getMap<AgendaItem>('agenda'),
  notes: doc.getMap<Y.Text>('notes'),
  decisions: doc.getMap<Decision>('decisions'),
  actions: doc.getMap<ActionItem>('actions'),
  people: doc.getMap<Person>('people'),
  ideas: doc.getMap<Idea>('ideas'),
  ideaVotes: doc.getMap<number>('ideaVotes'),
  brainstorms: doc.getMap<Brainstorm>('brainstorms'),
});

export function readMeta(doc: Y.Doc): Meta | null {
  const m = maps(doc).meta;
  if (!m.get('title')) return null;
  const type = (m.get('type') ?? 'general') as MeetingType;
  return {
    title: m.get('title'),
    type,
    templateId: m.get('templateId') ?? '',
    createdAt: m.get('createdAt') ?? '',
    createdBy: m.get('createdBy') ?? '',
    facilitators: m.get('facilitators') ?? [],
    phase: m.get('phase') ?? null,
    settings: { ...defaultSettings(type), ...(m.get('settings') ?? {}) },
    timer: m.get('timer') ?? idleTimer(),
    currentAgendaId: m.get('currentAgendaId') ?? null,
    status: m.get('status') ?? 'live',
    closedAt: m.get('closedAt') ?? null,
    readyEpoch: m.get('readyEpoch') ?? 0,
    seriesName: m.get('seriesName') ?? null,
    previousTitle: m.get('previousTitle') ?? null,
    template: m.get('template') ?? null,
    removed: m.get('removed') ?? [],
    series: m.get('series') ?? null,
  };
}

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;
const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

export function readView(doc: Y.Doc): View | null {
  const meta = readMeta(doc);
  if (!meta) return null;
  const m = maps(doc);
  const votes: Record<string, number> = {};
  const votesByVoter: Record<string, Record<string, number>> = {};
  m.votes.forEach((n, key) => {
    const [cardId, voter] = key.split('|');
    if (!n || n < 0) return;
    votes[cardId] = (votes[cardId] ?? 0) + n;
    (votesByVoter[voter] ??= {})[cardId] = n;
  });
  const ideaVotes: Record<string, number> = {};
  const ideaVotesByVoter: Record<string, Record<string, number>> = {};
  m.ideaVotes.forEach((n, key) => {
    const [ideaId, voter] = key.split('|');
    if (!n || n < 0 || !m.ideas.has(ideaId)) return;
    ideaVotes[ideaId] = (ideaVotes[ideaId] ?? 0) + n;
    (ideaVotesByVoter[voter] ??= {})[ideaId] = n;
  });
  return {
    meta,
    columns: [...m.columns.values()].sort(byPos),
    cards: [...m.cards.values()].sort(byCreated),
    votes,
    votesByVoter,
    agenda: [...m.agenda.values()].sort(byPos),
    decisions: [...m.decisions.values()].sort(byCreated),
    actions: [...m.actions.values()].sort(byCreated),
    people: [...m.people.values()].sort((a, b) => a.firstSeen.localeCompare(b.firstSeen)),
    ideas: [...m.ideas.values()].sort(byCreated),
    ideaVotes,
    ideaVotesByVoter,
    brainstorms: Object.fromEntries(m.brainstorms.entries()),
  };
}

export function nextPosition(items: { position: number }[]) {
  return items.reduce((p, x) => Math.max(p, x.position), 0) + 1;
}

/** Position for moving an item to index `to` within an ordered list (fractional, conflict-free). */
export function positionAt(items: { id: string; position: number }[], movingId: string, to: number) {
  const rest = items.filter((x) => x.id !== movingId);
  const i = Math.max(0, Math.min(rest.length, to));
  const before = rest[i - 1]?.position;
  const after = rest[i]?.position;
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

export interface NewMeetingInput {
  title: string;
  template: TemplateDef;
  creatorId: string;
  seriesName?: string | null;
  /** The meeting this one follows: open actions and uncovered topics carry over. */
  previous?: View | null;
  /** This browser's preferred card and voting settings; the template's own settings win. */
  defaults?: Partial<Omit<Settings, 'votesRevealed'>> | null;
  /** Facilitators other than the creator, e.g. a series' facilitators (then the creator is not added). */
  facilitators?: string[];
  series?: { id: string; key: string; occ: string } | null;
  /**
   * Makes every id depend only on this seed, so two people starting the same series meeting at the same
   * moment write the same entries instead of two copies of the agenda.
   */
  seed?: string;
}

/** A short id derived from text (not secret; only needs to be the same for everyone). */
export function seededId(seed: string, ...parts: (string | number)[]) {
  const text = [seed, ...parts].join('|');
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const bytes = new Uint8Array(9);
  for (let i = 0; i < 4; i++) {
    bytes[i] = (h1 >>> (i * 8)) & 255;
    bytes[4 + i] = (h2 >>> (i * 8)) & 255;
  }
  bytes[8] = text.length & 255;
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Fill an empty document with a new meeting from a template. */
export function initMeeting(doc: Y.Doc, input: NewMeetingInput) {
  const t = input.template;
  const m = maps(doc);
  const prev = input.previous;
  const newId = (...parts: (string | number)[]) => (input.seed ? seededId(input.seed, ...parts) : randomId());
  doc.transact(() => {
    m.meta.set('title', input.title.trim() || fillTitle(t));
    m.meta.set('type', t.type);
    m.meta.set('templateId', t.id);
    m.meta.set('template', t);
    m.meta.set('createdAt', new Date().toISOString());
    m.meta.set('createdBy', input.creatorId);
    m.meta.set('facilitators', input.facilitators?.length ? input.facilitators : [input.creatorId]);
    if (input.series) m.meta.set('series', input.series);
    m.meta.set('phase', initialPhase(t));
    m.meta.set('settings', prev ? { ...prev.meta.settings, votesRevealed: false } : { ...defaultSettings(t.type), ...input.defaults, ...t.settings });
    m.meta.set('timer', idleTimer());
    m.meta.set('status', 'live');
    m.meta.set('readyEpoch', 0);
    m.meta.set('seriesName', input.seriesName ?? prev?.meta.seriesName ?? null);
    m.meta.set('previousTitle', prev?.meta.title ?? null);
    t.columns.forEach((c, i) => {
      const id = newId('column', i);
      m.columns.set(id, { id, ...c, position: i + 1 });
    });
    let pos = 1;
    for (const a of t.agenda) {
      const id = newId('agenda', pos);
      m.agenda.set(id, { id, title: a.title, durationMin: a.durationMin, owner: a.owner ?? '', done: false, position: pos++, ...(a.activity && a.activity !== 'topic' ? { activity: a.activity } : {}), ...(a.screen && Object.keys(a.screen).length ? { screen: a.screen } : {}) });
      m.notes.set(id, new Y.Text(a.notes ?? ''));
    }
    if (prev) {
      const templateTitles = new Set(t.agenda.map((a) => a.title));
      for (const a of prev.agenda) {
        if (a.done || templateTitles.has(a.title) || (a.activity && a.activity !== 'topic')) continue;
        const id = newId('carried-topic', a.id);
        m.agenda.set(id, { ...a, id, done: false, position: pos++ });
        m.notes.set(id, new Y.Text());
      }
      for (const a of prev.actions) {
        if (a.status !== 'open') continue;
        const id = newId('carried-action', a.id);
        m.actions.set(id, { ...a, id, cardId: null, carriedFrom: a.carriedFrom ?? prev.meta.title });
      }
    }
  });
}

/** Board meetings start in the first board stage of the design (or Write, for a retro). */
export function initialPhase(t: TemplateDef): RetroPhase | null {
  const first = t.agenda.find((a) => isBoardActivity(a.activity))?.activity as RetroPhase | undefined;
  return first ?? (t.type === 'retro' ? 'write' : null);
}

/** A template's default meeting title, with {date} and {month} filled in. */
export function fillTitle(t: { name: string; title?: string }, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const month = now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return t.title ? t.title.replace(/\{date\}/g, date).replace(/\{month\}/g, month) : `${t.name} – ${date}`;
}

export function snapshotFile(doc: Y.Doc) {
  return Y.encodeStateAsUpdate(doc);
}
