import { LineCounter, parseDocument, stringify } from 'yaml';
import { ACTIVITIES, MIDDLE_BLOCKS, MIDDLE_MAX, SCREEN_BLOCKS, fillTitle, type Activity, type MiddleBlock, type Screen, type ScreenBlock, type MeetingType, type Settings, type TemplateDef } from './model';
import { BUILTIN_YAML } from '../templates/builtin';
import { languageTemplates, t } from './i18n';

// Meeting templates are written in YAML. The format, with every field:
//
//   name: Sprint retro                 # required
//   type: retro                        # retro | standup | planning | one_on_one | general (default general)
//   description: One line for the picker
//   title: Sprint retro {date}         # default meeting title; {date} = today's date, {month} = e.g. October 2026
//   columns:                           # the card board (leave out for no board)
//     - title: Went well
//       description: Wins worth repeating
//   agenda:
//     - title: Review last actions
//       minutes: 5
//       activity: topic                # topic | round | brainstorm | write | group | vote | discuss | actions | break
//                                      # (write..actions switch the card board into that stage)
//       owner: Facilitator
//       notes: |                       # pre-filled notes, e.g. questions to answer
//         Which actions are still open?
//       screen:                        # optional: what the screen shows during this stage
//         middle: [board, topic]       # up to 2 of board, brainstorm, topic, actions, decisions, people
//         people: folded               # agenda, people, board, brainstorm, topic, actions, decisions: open | folded
//   settings:
//     anonymous_cards: true            # hide who wrote each card
//     votes_per_person: 5              # 0 = unlimited
//     votes_per_card: 3                # 0 = unlimited
//     secret_voting: true              # hide votes until the facilitator reveals them
//     open_board: true                 # cards appear live with names, like a whiteboard (no private drafts)

export const MEETING_TYPES: MeetingType[] = ['retro', 'standup', 'planning', 'one_on_one', 'general'];

export interface TemplateError {
  message: string;
  line?: number;
}

export type TemplateSource = 'builtin' | 'organisation' | 'mine';
export interface ListedTemplate {
  template: TemplateDef;
  source: TemplateSource;
  yaml: string;
}

const LIMITS = { columns: 12, agenda: 40, text: 200, notes: 4000, minutes: 600 };
const SETTING_KEYS: Record<string, Exclude<keyof Settings, 'votesRevealed'>> = {
  anonymous_cards: 'showAuthors',
  votes_per_person: 'votesPerUser',
  votes_per_card: 'votesPerCard',
  secret_voting: 'secretVoting',
  open_board: 'openBoard',
};
const TOP_KEYS = ['id', 'name', 'type', 'description', 'title', 'columns', 'agenda', 'settings'];
const COLUMN_KEYS = ['title', 'description', 'color'];
const AGENDA_KEYS = ['title', 'minutes', 'activity', 'owner', 'notes', 'screen'];

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

/** Parse and check a YAML template. Returns every problem found, with line numbers where possible. */
export function parseTemplate(text: string, idPrefix = ''): { template: TemplateDef | null; errors: TemplateError[] } {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
  const errors: TemplateError[] = doc.errors.map((e) => ({ message: e.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), line: lines.linePos(e.pos[0]).line }));
  if (errors.length) return { template: null, errors };

  const lineOf = (path: (string | number)[]) => {
    const node: any = doc.getIn(path, true);
    return node?.range ? lines.linePos(node.range[0]).line : undefined;
  };
  const err = (path: (string | number)[], message: string) => errors.push({ message, line: lineOf(path) });
  const raw = doc.toJS();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { template: null, errors: [{ message: t('A template is a set of fields such as "name:", "columns:" and "agenda:".') }] };
  }

  const unknown = (obj: object, allowed: string[], path: (string | number)[], where: string) => {
    for (const k of Object.keys(obj)) {
      if (!allowed.includes(k)) err([...path, k], t('Unknown field "{field}" in {where}. Allowed: {allowed}.', { field: k, where, allowed: allowed.join(', ') }));
    }
  };
  const text_ = (v: unknown, path: (string | number)[], label: string, opts: { required?: boolean; max?: number } = {}) => {
    if (v === undefined || v === null || v === '') {
      if (opts.required) err(path, t('{label} is required.', { label }));
      return '';
    }
    if (typeof v !== 'string' && typeof v !== 'number') {
      err(path, t('{label} must be text.', { label }));
      return '';
    }
    const s = String(v).trim();
    const max = opts.max ?? LIMITS.text;
    if (s.length > max) err(path, t('{label} is too long ({length} characters, at most {max}).', { label, length: s.length, max }));
    return s.slice(0, max);
  };
  const list = (v: unknown, path: string[], label: string, max: number): unknown[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      err(path, t('{label} must be a list, with each entry starting with "- ".', { label }));
      return [];
    }
    if (v.length > max) err(path, t('{label} has {count} entries; at most {max} are allowed.', { label, count: v.length, max }));
    return v.slice(0, max);
  };

  unknown(raw, TOP_KEYS, [], t('the template'));
  const name = text_(raw.name, ['name'], 'name', { required: true, max: 80 });
  let type: MeetingType = 'general';
  if (raw.type !== undefined) {
    if (MEETING_TYPES.includes(raw.type)) type = raw.type;
    else err(['type'], t('type must be one of {list}.', { list: MEETING_TYPES.join(', ') }));
  }

  const columns = list(raw.columns, ['columns'], 'columns', LIMITS.columns).map((c, i) => {
    const path = ['columns', i];
    if (typeof c === 'string') return { title: text_(c, path, t('Column {n}', { n: i + 1 }), { required: true, max: 80 }), description: '', color: '#6b7280' };
    if (!c || typeof c !== 'object') {
      err(path, t('Column {n} must have a title.', { n: i + 1 }));
      return { title: '', description: '', color: '#6b7280' };
    }
    unknown(c, COLUMN_KEYS, path, t('column {n}', { n: i + 1 }));
    const o = c as Record<string, unknown>;
    return {
      title: text_(o.title, [...path, 'title'], t('Column {n} title', { n: i + 1 }), { required: true, max: 80 }),
      description: text_(o.description, [...path, 'description'], t('Column {n} description', { n: i + 1 }), { max: 300 }),
      color: typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? o.color : '#6b7280',
    };
  });

  const agenda = list(raw.agenda, ['agenda'], 'agenda', LIMITS.agenda).map((a, i) => {
    const path = ['agenda', i];
    if (typeof a === 'string') return { title: text_(a, path, t('Agenda item {n}', { n: i + 1 }), { required: true }), durationMin: 5 };
    if (!a || typeof a !== 'object') {
      err(path, t('Agenda item {n} must have a title.', { n: i + 1 }));
      return { title: '', durationMin: 5 };
    }
    unknown(a, AGENDA_KEYS, path, t('agenda item {n}', { n: i + 1 }));
    const o = a as Record<string, unknown>;
    let minutes = 5;
    if (o.minutes !== undefined) {
      if (typeof o.minutes === 'number' && Number.isInteger(o.minutes) && o.minutes >= 0 && o.minutes <= LIMITS.minutes) minutes = o.minutes;
      else err([...path, 'minutes'], t('Agenda item {n}: minutes must be a whole number from 0 to {max}.', { n: i + 1, max: LIMITS.minutes }));
    }
    let activity: Activity = 'topic';
    if (o.activity !== undefined && o.activity !== null) {
      if (ACTIVITIES.includes(o.activity as Activity)) activity = o.activity as Activity;
      else err([...path, 'activity'], t('Agenda item {n}: activity must be one of {list}.', { n: i + 1, list: ACTIVITIES.join(', ') }));
    }
    const owner = text_(o.owner, [...path, 'owner'], t('Agenda item {n} owner', { n: i + 1 }), { max: 80 });
    const notes = text_(o.notes, [...path, 'notes'], t('Agenda item {n} notes', { n: i + 1 }), { max: LIMITS.notes });
    const screen: Screen = {};
    if (o.screen !== undefined && o.screen !== null) {
      if (typeof o.screen !== 'object' || Array.isArray(o.screen)) err([...path, 'screen'], t('Agenda item {n}: screen must be a set of fields, like board: folded.', { n: i + 1 }));
      else {
        unknown(o.screen, [...SCREEN_BLOCKS, 'middle'], [...path, 'screen'], t('agenda item {n} screen', { n: i + 1 }));
        for (const [k, v] of Object.entries(o.screen as Record<string, unknown>)) {
          if (k === 'middle') {
            const list = Array.isArray(v) ? v : [v];
            if (list.length <= MIDDLE_MAX && list.every((x) => MIDDLE_BLOCKS.includes(x as MiddleBlock))) screen.middle = [...new Set(list as MiddleBlock[])];
            else err([...path, 'screen', k], t('Agenda item {n}: screen middle is up to {max} of {list}.', { n: i + 1, max: MIDDLE_MAX, list: MIDDLE_BLOCKS.join(', ') }));
          } else if ((SCREEN_BLOCKS as string[]).includes(k)) {
            if (v === 'open' || v === 'folded') screen[k as ScreenBlock] = v;
            else err([...path, 'screen', k], t('Agenda item {n}: screen {key} must be open or folded.', { n: i + 1, key: k }));
          }
        }
      }
    }
    return {
      title: text_(o.title, [...path, 'title'], t('Agenda item {n} title', { n: i + 1 }), { required: true }),
      durationMin: minutes,
      ...(activity !== 'topic' ? { activity } : {}),
      ...(owner ? { owner } : {}),
      ...(notes ? { notes } : {}),
      ...(Object.keys(screen).length ? { screen } : {}),
    };
  });

  const settings: Partial<Settings> = {};
  if (raw.settings !== undefined && raw.settings !== null) {
    if (typeof raw.settings !== 'object' || Array.isArray(raw.settings)) err(['settings'], t('settings must be a set of fields.'));
    else {
      unknown(raw.settings, Object.keys(SETTING_KEYS), ['settings'], 'settings');
      for (const [k, v] of Object.entries(raw.settings as Record<string, unknown>)) {
        const key = SETTING_KEYS[k];
        if (!key) continue;
        if (k === 'votes_per_person' || k === 'votes_per_card') {
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 99) (settings as any)[key] = v;
          else err(['settings', k], t('{key} must be a whole number from 0 (unlimited) to 99.', { key: k }));
        } else if (typeof v === 'boolean') {
          (settings as any)[key] = k === 'anonymous_cards' ? !v : v;
        } else err(['settings', k], t('{key} must be true or false.', { key: k }));
      }
    }
  }

  const id = raw.id !== undefined ? slug(String(raw.id)) : slug(name);
  if (errors.length) return { template: null, errors };
  return {
    template: {
      id: idPrefix + (id || 'template'),
      name,
      type,
      description: text_(raw.description, ['description'], 'description', { max: 200 }),
      ...(raw.title ? { title: text_(raw.title, ['title'], 'title', { max: 120 }) } : {}),
      columns,
      agenda,
      ...(Object.keys(settings).length ? { settings } : {}),
    },
    errors,
  };
}

/** Write a template as YAML, in the documented field order and names. */
export function templateToYaml(t: TemplateDef): string {
  const out: Record<string, unknown> = { name: t.name, type: t.type };
  if (t.description) out.description = t.description;
  if (t.title) out.title = t.title;
  if (t.columns.length) out.columns = t.columns.map((c) => (c.description ? { title: c.title, description: c.description } : { title: c.title }));
  if (t.agenda.length) {
    out.agenda = t.agenda.map((a) => ({
      title: a.title,
      minutes: a.durationMin,
      ...(a.activity && a.activity !== 'topic' ? { activity: a.activity } : {}),
      ...(a.owner ? { owner: a.owner } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
      ...(a.screen && Object.keys(a.screen).length ? { screen: a.screen } : {}),
    }));
  }
  if (t.settings && Object.keys(t.settings).length) {
    const s: Record<string, unknown> = {};
    for (const [k, key] of Object.entries(SETTING_KEYS)) {
      const v = t.settings[key];
      if (v !== undefined) s[k] = k === 'anonymous_cards' ? !v : v;
    }
    out.settings = s;
  }
  return stringify(out, { lineWidth: 0 });
}

/** The default meeting title for a template. */
export function defaultTitle(t: TemplateDef, now = new Date()) {
  return fillTitle(t, now);
}

/** What "New template" starts from: a small, commented example. */
export const STARTER_YAML = `# A meeting template. Lines starting with # are comments.
name: Team weekly
type: general   # or retro, standup, planning, one_on_one
description: Weekly sync with time-boxed topics.
title: Team weekly {date}

agenda:
  - title: Review open actions
    minutes: 5
  - title: Updates
    minutes: 15
    activity: round   # topic, round, brainstorm, write, group, vote, discuss, actions or break
    owner: Everyone
    notes: |
      What changed since last week?
      What needs a decision?
  - title: Any other business
    minutes: 5

# Add a card board, for example for a retro:
# columns:
#   - title: Went well
#   - title: To improve
#     description: What should change?

# settings:
#   anonymous_cards: true
#   votes_per_person: 5
#   votes_per_card: 3
#   secret_voting: true
#   open_board: true   # cards appear live with names, like a whiteboard
`;

// ------------------------------------------------------------ the template library

// Languages can bring their own versions of the built-in templates (same ids), so a new meeting's columns and
// agenda are in that language too.
export const BUILTIN_TEMPLATES: ListedTemplate[] = (languageTemplates() ?? BUILTIN_YAML).map((yaml) => {
  const { template, errors } = parseTemplate(yaml);
  if (!template) throw new Error(`Built-in template is invalid: ${errors[0]?.message}`);
  return { template, source: 'builtin' as const, yaml };
});

/** "Team retro" → "Team retro (v2)", "Team retro (v2)" → "Team retro (v3)", skipping names already in use. */
export function nextVersionName(name: string, taken: string[]): string {
  const m = name.match(/^(.*?)\s*\((?:v(\d+)|my version)\)$/);
  const base = (m ? m[1] : name).trim() || 'Template';
  const used = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = m?.[2] ? Number(m[2]) + 1 : 2; ; n++) if (!used.has(`${base} (v${n})`.toLowerCase())) return `${base} (v${n})`;
}

/** A template's YAML as the start of a new, separate template: its own id, and the next version's name. */
export function newVersionYaml(yaml: string, taken: string[]): string {
  const { template } = parseTemplate(yaml);
  const name = nextVersionName(template?.name ?? 'Template', taken);
  const body = yaml.replace(/^id:.*\n/m, '');
  return /^name:.*$/m.test(body) ? body.replace(/^name:.*$/m, `name: ${JSON.stringify(name)}`) : `name: ${JSON.stringify(name)}\n${body}`;
}

/** Names of every template people can already pick, so a new version gets a name of its own. */
export const takenTemplateNames = (extra: ListedTemplate[] = []) => [...BUILTIN_TEMPLATES, ...loadMyTemplates(), ...extra].map((t) => t.template.name);

const MINE_KEY = 'rondel:templates';

/** Templates saved in this browser. */
export function loadMyTemplates(): ListedTemplate[] {
  let stored: string[] = [];
  try {
    stored = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]');
  } catch {
    stored = [];
  }
  return stored.flatMap((yaml) => {
    const { template } = parseTemplate(yaml, 'my-');
    return template ? [{ template, source: 'mine' as const, yaml }] : [];
  });
}

/** Save (or replace, by id) a template in this browser. Returns its id. */
export function saveMyTemplate(yaml: string, replaceId?: string): string {
  const { template } = parseTemplate(yaml, 'my-');
  if (!template) throw new Error(t('The template has errors.'));
  const others = loadMyTemplates().filter((t) => t.template.id !== template.id && t.template.id !== replaceId);
  localStorage.setItem(MINE_KEY, JSON.stringify([...others.map((t) => t.yaml), yaml]));
  return template.id;
}

export function deleteMyTemplate(id: string) {
  localStorage.setItem(MINE_KEY, JSON.stringify(loadMyTemplates().filter((t) => t.template.id !== id).map((t) => t.yaml)));
}

let orgTemplates: Promise<ListedTemplate[]> | null = null;

/**
 * Templates provided with this installation: IT lists YAML files in RONDEL_CONFIG.templates
 * (paths relative to the app, e.g. ["templates/board-meeting.yaml"]).
 */
export function loadOrgTemplates(): Promise<ListedTemplate[]> {
  orgTemplates ??= Promise.all(
    (window.RONDEL_CONFIG?.templates ?? []).map(async (path: string) => {
      try {
        const res = await fetch(new URL(path, location.href), { cache: 'no-cache' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const yaml = await res.text();
        const { template, errors } = parseTemplate(yaml, 'org-');
        if (!template) throw new Error(errors.map((e) => (e.line ? `line ${e.line}: ` : '') + e.message).join('; '));
        return [{ template, source: 'organisation' as const, yaml }];
      } catch (e) {
        console.warn(`Rondel: skipped template ${path}: ${(e as Error).message}`);
        return [];
      }
    }),
  ).then((x) => x.flat());
  return orgTemplates;
}

/** Turn a meeting's current board and agenda into a template, for "Save as template". */
export function templateFromMeeting(v: {
  meta: { title: string; type: MeetingType; settings: Settings; seriesName: string | null };
  columns: { title: string; description: string; color: string }[];
  agenda: { title: string; durationMin: number; owner: string; activity?: Activity; screen?: Screen }[];
}): TemplateDef {
  const s = v.meta.settings;
  return {
    id: slug(v.meta.seriesName ?? v.meta.title),
    name: v.meta.seriesName ?? v.meta.title,
    type: v.meta.type,
    description: '',
    columns: v.columns.map((c) => ({ title: c.title, description: c.description, color: c.color })),
    agenda: v.agenda.map((a) => ({ title: a.title, durationMin: a.durationMin, ...(a.activity && a.activity !== 'topic' ? { activity: a.activity } : {}), ...(a.owner ? { owner: a.owner } : {}), ...(a.screen && Object.keys(a.screen).length ? { screen: a.screen } : {}) })),
    settings: { showAuthors: s.showAuthors, votesPerUser: s.votesPerUser, votesPerCard: s.votesPerCard, secretVoting: s.secretVoting, ...(s.openBoard ? { openBoard: true } : {}) },
  };
}

// ------------------------------------------------------------ design checks

/** Gentle warnings about a meeting design; none of them stop it from being saved. */
export function designChecks(tpl: TemplateDef): string[] {
  const out: string[] = [];
  const stages = tpl.agenda;
  const first = (a: Activity) => stages.findIndex((s) => (s.activity ?? 'topic') === a);
  const total = stages.reduce((n, s) => n + s.durationMin, 0);
  if (!stages.length) out.push(t('Add at least one stage.'));
  const board = stages.filter((s) => s.activity && ['write', 'group', 'vote', 'discuss', 'actions'].includes(s.activity));
  if (board.length && !tpl.columns.length) out.push(t('There are board stages but no columns. Add columns here, or during the meeting.'));
  if (first('vote') >= 0 && first('write') >= 0 && first('vote') < first('write')) out.push(t('Voting comes before writing cards.'));
  if (first('group') >= 0 && first('write') >= 0 && first('group') < first('write')) out.push(t('Grouping comes before writing cards.'));
  if (first('discuss') >= 0 && first('vote') >= 0 && first('discuss') < first('vote')) out.push(t('Discussing comes before voting, so cards are not yet in vote order.'));
  if (total > 90 && first('break') < 0) out.push(t('The meeting runs {n} minutes without a break.', { n: total }));
  for (const s of stages) if (s.durationMin === 0) out.push(t('“{title}” has no time set, so its timer won\'t start.', { title: s.title || t('Untitled') }));
  return out;
}
