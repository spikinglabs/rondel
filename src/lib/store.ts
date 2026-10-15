import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { randomId, readMeta, type MeetingType, type MiddleBlock, type Settings } from './model';

// Everything here lives in this browser only (localStorage / IndexedDB).

function load<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full or blocked: the meeting still works for this session */
  }
}

// ------------------------------------------------------------ identity

export interface Identity {
  id: string;
  name: string;
}

export function getIdentity(): Identity {
  const id = load<Identity | null>('rondel:me', null);
  if (id?.id) return id;
  const fresh = { id: randomId(), name: '' };
  save('rondel:me', fresh);
  return fresh;
}
export function setName(name: string) {
  const me = getIdentity();
  save('rondel:me', { ...me, name: name.trim().slice(0, 60) });
}

// ------------------------------------------------------------ preferences remembered in this browser

export type Theme = 'system' | 'light' | 'dark';
export interface Prefs {
  theme: Theme;
  /** Card and voting settings for new meetings; a template's own settings still win. */
  meetingDefaults: Partial<Omit<Settings, 'votesRevealed'>> | null;
  lastTemplateId: string | null;
  lastSeries: string[];
}
const PREFS_DEFAULT: Prefs = { theme: 'system', meetingDefaults: null, lastTemplateId: null, lastSeries: [] };
export const getPrefs = (): Prefs => ({ ...PREFS_DEFAULT, ...load<Partial<Prefs>>('rondel:prefs', {}) });
export function setPrefs(p: Partial<Prefs>) {
  save('rondel:prefs', { ...getPrefs(), ...p });
  if (p.theme) applyTheme();
}
export function applyTheme() {
  const t = getPrefs().theme;
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

/** Names of people met in meetings in this browser, most recent first, for owner suggestions. */
export const knownPeople = () => load<string[]>('rondel:people', []);
export function rememberPeople(names: string[]) {
  const me = getIdentity().name;
  const fresh = names.map((n) => n.trim()).filter((n) => n && n !== me);
  if (!fresh.length) return;
  const all = [...new Set([...fresh, ...knownPeople()])].slice(0, 200);
  if (JSON.stringify(all) !== JSON.stringify(knownPeople())) save('rondel:people', all);
}

/** A random voter id per meeting, so votes in the shared document can't be tied to a person. */
export function voterId(roomId: string) {
  const key = `rondel:voter:${roomId}`;
  let v = load<string | null>(key, null);
  if (!v) {
    v = randomId();
    save(key, v);
  }
  return v;
}

// ------------------------------------------------------------ meeting index

export interface MeetingEntry {
  roomId: string;
  key: string;
  title: string;
  type: MeetingType;
  status: 'live' | 'closed';
  openActions: number;
  updatedAt: string;
}

export function listMeetings(): MeetingEntry[] {
  return load<MeetingEntry[]>('rondel:meetings', []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export function upsertMeeting(e: MeetingEntry) {
  const all = load<MeetingEntry[]>('rondel:meetings', []).filter((x) => x.roomId !== e.roomId);
  save('rondel:meetings', [e, ...all]);
}
export async function forgetMeeting(roomId: string) {
  save('rondel:meetings', load<MeetingEntry[]>('rondel:meetings', []).filter((x) => x.roomId !== roomId));
  localStorage.removeItem(`rondel:drafts:${roomId}`);
  localStorage.removeItem(`rondel:mine:${roomId}`);
  localStorage.removeItem(`rondel:voter:${roomId}`);
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(`rondel-${roomId}`);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

export function meetingLink(roomId: string, key: string) {
  const share = window.RONDEL_CONFIG?.shareUrl;
  // Hosts like claude.ai only pass a plain #token through to the page, so use the dotted form there.
  if (share) return `${share.split('#')[0]}#m.${roomId}.${key}`;
  return `${location.origin}${location.pathname}#/m/${roomId}/${key}`;
}

// ------------------------------------------------------------ private drafts and own cards

export interface Draft {
  id: string;
  columnId: string;
  text: string;
  color: string | null;
  createdAt: string;
}
// How the meeting screen is arranged: agenda open or folded to a rail, right column width, folded panels.
export type Layout = { agendaOpen: boolean; rightWidth: number; folded: Record<string, boolean>; middle?: MiddleBlock[] };
export const LAYOUT_DEFAULT: Layout = { agendaOpen: true, rightWidth: 320, folded: {} };
export const getLayout = (): Layout => ({ ...LAYOUT_DEFAULT, ...load<Partial<Layout>>('rondel:layout', {}) });
export const saveLayout = (l: Layout) => save('rondel:layout', l);

export const loadDrafts = (roomId: string) => load<Draft[]>(`rondel:drafts:${roomId}`, []);
export const saveDrafts = (roomId: string, d: Draft[]) => save(`rondel:drafts:${roomId}`, d);
export const loadMine = (roomId: string) => new Set(load<string[]>(`rondel:mine:${roomId}`, []));
export function addMine(roomId: string, cardId: string) {
  const s = loadMine(roomId);
  s.add(cardId);
  save(`rondel:mine:${roomId}`, [...s]);
}

// ------------------------------------------------------------ open a meeting document

export interface OpenDoc {
  doc: Y.Doc;
  persistence: IndexeddbPersistence;
  ready: Promise<void>;
}

export function openDoc(roomId: string): OpenDoc {
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`rondel-${roomId}`, doc);
  const ready = persistence.whenSynced.then(() => undefined);
  return { doc, persistence, ready };
}

/** Keep the home-page index in step with a meeting's title, status and open actions. */
export function trackIndex(roomId: string, key: string, doc: Y.Doc) {
  const sync = () => {
    const meta = readMeta(doc);
    if (!meta) return;
    let open = 0;
    doc.getMap<any>('actions').forEach((a) => a.status === 'open' && open++);
    const prev = listMeetings().find((m) => m.roomId === roomId);
    if (prev && prev.title === meta.title && prev.status === meta.status && prev.openActions === open) return;
    upsertMeeting({ roomId, key, title: meta.title, type: meta.type, status: meta.status, openActions: open, updatedAt: new Date().toISOString() });
  };
  sync();
  doc.on('update', sync);
  return () => doc.off('update', sync);
}
