import * as Y from 'yjs';
import type { TemplateDef } from './model';
import type { Sync } from './sync';

// A recurring meeting series. One stable link (#/s/<id>/<key>) goes into the calendar invite; opening it
// lands on the meeting for the current period. Each period's meeting has its own room, derived from the
// series key and the period's name, so everyone with the link computes the same room without asking a server.
// The first person to open it creates the meeting; extra meetings in the same period get a suffix (2026-W42-2).

// Deliberately coarse: a series makes at most one meeting per calendar day, week or month. A team that meets every
// two weeks still gets one meeting per week it actually opens the link; the week or month is in the title.
// 'biweekly' only exists in series created by 0.13 and is treated as weekly.
export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'none';
export const CADENCES: Cadence[] = ['daily', 'weekly', 'monthly', 'none'];
export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily', weekly: 'Weekly, or every few weeks', biweekly: 'Weekly, or every few weeks', monthly: 'Monthly, or every few months', none: 'Irregular (next one starts when the last is closed)',
};
export const CADENCE_SHORT: Record<Cadence, string> = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Weekly', monthly: 'Monthly', none: 'Irregular' };
/** How the period reads in "Start another meeting this …". */
export const PERIOD_WORD: Record<Cadence, string> = { daily: 'today', weekly: 'this week', biweekly: 'this week', monthly: 'this month', none: '' };

export interface Facilitator { id: string; name: string }
export interface SeriesInfo {
  name: string;
  cadence: Cadence;
  template: TemplateDef;
  facilitators: Facilitator[];
  createdBy: string;
  createdAt: string;
  /** For the calendar file: first meeting as local date and time (YYYY-MM-DDTHH:mm) and length. */
  start: string | null;
  durationMin: number;
}
export interface Occurrence {
  occ: string;
  title: string;
  status: 'live' | 'closed';
  createdAt: string;
  closedAt: string | null;
}

/** What a meeting stores about the series it belongs to. */
export interface SeriesRef { id: string; key: string; occ: string }

// ------------------------------------------------------------ periods

const pad = (n: number) => String(n).padStart(2, '0');
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** ISO 8601 week of a local date: [year, week]. */
export function isoWeek(d: Date): [number, number] {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return [year, week];
}

/** The period a moment falls in, e.g. 2026-10-15, 2026-W42, 2026-10; "all" for an irregular series. */
export function periodOf(cadence: Cadence, now = new Date()): string {
  switch (cadence) {
    case 'daily':
      return localDate(now);
    case 'weekly':
    case 'biweekly': {
      const [y, w] = isoWeek(now);
      return `${y}-W${pad(w)}`;
    }
    case 'monthly':
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    default:
      return 'all';
  }
}

export const occName = (period: string, n: number) => (n <= 1 ? period : `${period}-${n}`);

/** The period a meeting belongs to, without its suffix: 2026-W42-2 → 2026-W42. */
export function basePeriod(cadence: Cadence, occ: string): string {
  if (cadence === 'none') return 'all';
  const m = occ.match(/^(\d{4}-W\d{2}|\d{4}-\d{2}-\d{2}|\d{4}-\d{2})/);
  if (!m) return occ;
  // A monthly name is YYYY-MM, so "2026-10-2" is October's second meeting, not a date.
  return cadence === 'monthly' ? m[1].slice(0, 7) : m[1];
}

/** A day inside a period: the Monday of a week, the first of a month. */
function periodStart(period: string): Date | null {
  let m = period.match(/^(\d{4})-W(\d{2})/);
  if (m) {
    const jan4 = new Date(Number(m[1]), 0, 4);
    const monday = new Date(jan4.getFullYear(), 0, 4 - ((jan4.getDay() + 6) % 7));
    return new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + (Number(m[2]) - 1) * 7);
  }
  m = period.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
  return null;
}

/** The next period after a meeting's own: next week, month or day. */
export function nextPeriod(cadence: Cadence, occ: string): string {
  const start = periodStart(basePeriod(cadence, occ));
  if (!start || cadence === 'none') return 'all';
  const d = new Date(start);
  if (cadence === 'monthly') d.setMonth(d.getMonth() + 1);
  else if (cadence === 'daily') d.setDate(d.getDate() + 1);
  else d.setDate(d.getDate() + 7);
  return periodOf(cadence, d);
}

/**
 * The meeting "Start next occurrence" leads to from a meeting: the next week's (month's, day's) meeting, or
 * for an irregular series the next one in the chain. Opens it if it already exists.
 */
export function nextAfter(cadence: Cadence, occ: string, occurrences: Record<string, Occurrence>): { occ: string; n: number; exists: boolean } {
  if (cadence === 'none') {
    let n = 1;
    while (occurrences[occName('all', n)]) n++;
    return { occ: occName('all', n), n, exists: false };
  }
  const p = nextPeriod(cadence, occ);
  return { occ: p, n: 1, exists: !!occurrences[p] };
}

/** How a period reads in a meeting title: "Week 42, 2026", "October 2026", "15 Oct 2026". */
export function periodLabel(cadence: Cadence, period: string): string {
  const w = period.match(/^(\d{4})-W(\d{2})/);
  if (w) return `Week ${Number(w[2])}, ${w[1]}`;
  const d = periodStart(period);
  if (!d) return new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return cadence === 'monthly' ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export type Decision =
  | { kind: 'open'; occ: string }
  | { kind: 'create'; occ: string; n: number }
  | { kind: 'closed'; last: string; next: string; n: number };

/**
 * Which meeting the series link should open now: the first meeting of this period that is still open;
 * a new one if the period has none yet; or, when this period's last meeting is closed, that one
 * (people may only want to read its minutes; starting another is their choice).
 */
export function decide(occurrences: Record<string, Occurrence>, period: string): Decision {
  let n = 1;
  while (occurrences[occName(period, n)]?.status === 'closed') n++;
  const occ = occName(period, n);
  if (occurrences[occ]) return { kind: 'open', occ };
  if (n > 1) return { kind: 'closed', last: occName(period, n - 1), next: occ, n };
  return { kind: 'create', occ, n };
}

export function latest(occurrences: Record<string, Occurrence>): Occurrence | null {
  return Object.values(occurrences).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

// ------------------------------------------------------------ rooms

const enc = new TextEncoder();
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function digest(text: string, bytes: number) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))).subarray(0, bytes));
}

/** The room and key of one meeting in the series. Only holders of the series key can compute them. */
export async function occurrenceRoom(seriesKey: string, occ: string) {
  return {
    roomId: await digest(`rondel-series-room:${seriesKey}:${occ}`, 12),
    key: await digest(`rondel-series-key:${seriesKey}:${occ}`, 18),
  };
}

// ------------------------------------------------------------ the series document

export const seriesMaps = (doc: Y.Doc) => ({ info: doc.getMap<any>('series'), occurrences: doc.getMap<Occurrence>('occurrences') });

export function readSeries(doc: Y.Doc): { info: SeriesInfo; occurrences: Record<string, Occurrence> } | null {
  const { info, occurrences } = seriesMaps(doc);
  if (!info.get('name')) return null;
  return {
    info: {
      name: info.get('name'),
      cadence: info.get('cadence') ?? 'weekly',
      template: info.get('template'),
      facilitators: info.get('facilitators') ?? [],
      createdBy: info.get('createdBy') ?? '',
      createdAt: info.get('createdAt') ?? '',
      start: info.get('start') ?? null,
      durationMin: info.get('durationMin') ?? 60,
    },
    occurrences: Object.fromEntries(occurrences.entries()),
  };
}

export function initSeries(doc: Y.Doc, s: SeriesInfo) {
  const { info } = seriesMaps(doc);
  doc.transact(() => {
    for (const [k, v] of Object.entries(s)) info.set(k, v);
  });
}

export function seriesOps(doc: Y.Doc) {
  const { info, occurrences } = seriesMaps(doc);
  const facilitators = (): Facilitator[] => info.get('facilitators') ?? [];
  return {
    addOccurrence: (o: Occurrence) => !occurrences.get(o.occ) && occurrences.set(o.occ, o),
    /** Keep a meeting's entry in step with the meeting itself (title, open or closed). */
    syncOccurrence: (occ: string, p: Pick<Occurrence, 'title' | 'status' | 'closedAt'>, createdAt: string) => {
      const cur = occurrences.get(occ);
      if (cur && cur.title === p.title && cur.status === p.status && cur.closedAt === p.closedAt) return;
      occurrences.set(occ, { occ, createdAt: cur?.createdAt ?? createdAt, ...p });
    },
    addFacilitator: (f: Facilitator) => info.set('facilitators', [...facilitators().filter((x) => x.id !== f.id), f]),
    removeFacilitator: (id: string) => info.set('facilitators', facilitators().filter((x) => x.id !== id)),
    rename: (name: string) => name.trim() && info.set('name', name.trim().slice(0, 120)),
  };
}

// ------------------------------------------------------------ syncing

/** Resolve once a sync has received the stored or shared state, or after a timeout (alone, offline). */
export function whenLoaded(sync: Sync, ms = 6000) {
  return new Promise<void>((resolve) => {
    if (sync.loaded) return resolve();
    const t = setTimeout(done, ms);
    const off = sync.onChange(() => sync.loaded && done());
    function done() {
      clearTimeout(t);
      off();
      resolve();
    }
  });
}

// ------------------------------------------------------------ links and invites

export function seriesLink(id: string, key: string) {
  const share = window.RONDEL_CONFIG?.shareUrl;
  if (share) return `${share.split('#')[0]}#s.${id}.${key}`;
  return `${location.origin}${location.pathname}#/s/${id}/${key}`;
}

export function inviteText(info: SeriesInfo, link: string) {
  const lines = [
    `Meeting board (Rondel): ${link}`,
    `This link always opens the current meeting. No sign-up needed; the part after # is the key, so keep the link within the team.`,
  ];
  const agenda = info.template.agenda;
  if (agenda.length) lines.push('', 'Agenda:', ...agenda.map((a) => `- ${a.title}${a.durationMin ? ` (${a.durationMin} min)` : ''}`));
  return lines.join('\n');
}

// Only a starting point: people set the exact rhythm (every two weeks, first Monday…) in Outlook.
const RRULE: Record<Cadence, string | null> = {
  daily: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', biweekly: 'FREQ=WEEKLY;INTERVAL=2', monthly: 'FREQ=MONTHLY', none: null,
};
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines longer than 75 bytes are folded, as the calendar format requires. */
function fold(line: string) {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** A recurring calendar event with the series link, to open in Outlook and send to the team. */
export function seriesIcs(id: string, info: SeriesInfo, link: string, now = new Date()) {
  const start = info.start ?? `${localDate(now)}T10:00`;
  const dt = start.replace(/[-:]/g, '') + '00';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const rule = RRULE[info.cadence];
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rondel//Meeting series//EN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${id}@rondel`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dt}`,
    `DURATION:PT${Math.max(5, info.durationMin)}M`,
    ...(rule ? [`RRULE:${rule}`] : []),
    `SUMMARY:${icsText(info.name)}`,
    `LOCATION:${icsText(link)}`,
    `URL:${link}`,
    `DESCRIPTION:${icsText(inviteText(info, link))}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ series index in this browser

export interface SeriesEntry { id: string; key: string; name: string; cadence: Cadence; updatedAt: string }
const INDEX = 'rondel:series';
function loadIndex(): SeriesEntry[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX) ?? '[]');
  } catch {
    return [];
  }
}
export const listSeries = () => loadIndex().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
export function upsertSeries(e: SeriesEntry) {
  try {
    localStorage.setItem(INDEX, JSON.stringify([e, ...loadIndex().filter((x) => x.id !== e.id)]));
  } catch {
    /* storage blocked: the series still works from its link */
  }
}
export function forgetSeries(id: string) {
  try {
    localStorage.setItem(INDEX, JSON.stringify(loadIndex().filter((x) => x.id !== id)));
  } catch {
    /* ignore */
  }
}
