import { useEffect, useRef, useState } from 'react';
import {
  ACTIVITIES, ACTIVITY_HINT, ACTIVITY_LABEL, TYPE_LABEL, defaultSettings, isBoardActivity,
  type Activity, type MeetingType, type Settings, type TemplateDef,
} from '../lib/model';
import { MEETING_TYPES, designChecks } from '../lib/templates';
import { MIDDLE_BLOCKS, SCREEN_BLOCKS, SCREEN_BLOCK_LABEL, defaultScreen, type MiddleBlock, type Screen, type ScreenBlock } from '../lib/model';
import { t } from '../lib/i18n';

type Stage = TemplateDef['agenda'][number] & { key: string };
type Column = TemplateDef['columns'][number] & { key: string };
type Design = Omit<TemplateDef, 'agenda' | 'columns'> & { agenda: Stage[]; columns: Column[] };

let nextKey = 0;
const key = () => `k${++nextKey}`;
const GREY = '#6b7280';

/** Ready-made sequences people add with one click. */
const BLOCKS: { label: string; title: string; stages: { title: string; durationMin: number; activity: Activity }[] }[] = [
  {
    label: t('Retro stages'), title: t('Write, group, vote, discuss and agree actions on the board'),
    stages: [
      { title: t('Write cards'), durationMin: 8, activity: 'write' },
      { title: t('Group similar cards'), durationMin: 5, activity: 'group' },
      { title: t('Vote'), durationMin: 3, activity: 'vote' },
      { title: t('Discuss top topics'), durationMin: 24, activity: 'discuss' },
      { title: t('Agree action items'), durationMin: 10, activity: 'actions' },
    ],
  },
  { label: t('Check-in round'), title: t('Everyone says a sentence on how they are'), stages: [{ title: t('Check-in'), durationMin: 5, activity: 'round' }] },
  { label: t('Brainstorm'), title: t('Collect ideas from everyone, dot-vote, and turn the best into actions'), stages: [{ title: t('Ideas for…'), durationMin: 15, activity: 'brainstorm' }] },
  { label: t('Discussion'), title: t('A topic with shared notes and decisions'), stages: [{ title: t('New topic'), durationMin: 10, activity: 'topic' }] },
  { label: t('Break'), title: t('A timed pause'), stages: [{ title: t('Break'), durationMin: 10, activity: 'break' }] },
];

/** Column sets for the board; the first word set is the default. `id` is the select's value. */
const BOARD_PRESETS: { id: string; label: string; columns: string[] }[] = [
  { id: 'start-stop-continue', label: t('Start / Stop / Continue'), columns: ['Start', 'Stop', 'Continue'] },
  { id: 'went-well', label: t('Went well / To improve / Ideas'), columns: [t('Went well'), t('To improve'), t('Ideas')] },
  { id: 'mad-sad-glad', label: t('Mad / Sad / Glad'), columns: [t('Mad'), t('Sad'), t('Glad')] },
  { id: '4ls', label: t('4Ls'), columns: [t('Liked'), t('Learned'), t('Lacked'), t('Longed for')] },
  { id: 'sailboat', label: t('Sailboat'), columns: [t('Wind'), t('Anchors'), t('Rocks'), t('Island')] },
];
const preset = (id: string) => BOARD_PRESETS.find((p) => p.id === id)?.columns;

const toDesign = (t: TemplateDef): Design => ({
  ...t,
  agenda: t.agenda.map((a) => ({ ...a, key: key() })),
  columns: t.columns.map((c) => ({ ...c, key: key() })),
});
const fromDesign = (d: Design): TemplateDef => ({
  ...d,
  agenda: d.agenda.map(({ key: _k, ...a }) => ({
    title: a.title, durationMin: a.durationMin,
    ...(a.activity && a.activity !== 'topic' ? { activity: a.activity } : {}),
    ...(a.owner ? { owner: a.owner } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    ...(a.screen && Object.keys(a.screen).length ? { screen: a.screen } : {}),
  })),
  columns: d.columns.map(({ key: _k, ...c }) => c),
});

const move = <T,>(xs: T[], from: number, to: number) => {
  if (to < 0 || to >= xs.length || from === to) return xs;
  const out = [...xs];
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
};

/** "10:00" + minutes, as a clock time. */
function clock(start: string, minutes: number) {
  const [h, m] = start.split(':').map(Number);
  const t = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
const elapsed = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

/** Design a meeting as timed stages, with a board for collaborative stages, without writing YAML. */
export function MeetingDesigner({ value, onChange }: { value: TemplateDef; onChange: (t: TemplateDef) => void }) {
  const [d, setD] = useState<Design>(() => toDesign(value));
  const [start, setStart] = useState(() => {
    try { return localStorage.getItem('rondel:designer-start') ?? ''; } catch { return ''; }
  });
  const [openNotes, setOpenNotes] = useState<string | null>(null);
  const [openScreen, setOpenScreen] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const first = useRef(true);
  useEffect(() => {
    // Only report real edits, so opening the designer doesn't rewrite the YAML (and drop its comments).
    if (first.current) first.current = false;
    else onChange(fromDesign(d));
  }, [d]);
  useEffect(() => {
    try { localStorage.setItem('rondel:designer-start', start); } catch { /* not kept */ }
  }, [start]);

  const set = (p: Partial<Design>) => setD((x) => ({ ...x, ...p }));
  const setStage = (i: number, p: Partial<Stage>) => setD((x) => ({ ...x, agenda: x.agenda.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const setColumn = (i: number, p: Partial<Column>) => setD((x) => ({ ...x, columns: x.columns.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
  const settings: Omit<Settings, 'votesRevealed'> = { ...defaultSettings(d.type), ...d.settings };
  const setSetting = <K extends keyof typeof settings>(k: K, v: (typeof settings)[K]) => set({ settings: { ...settings, [k]: v } });

  const total = d.agenda.reduce((n, s) => n + s.durationMin, 0);
  const offsets = d.agenda.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + d.agenda[i - 1].durationMin], []);
  const at = (minutes: number) => (start ? clock(start, minutes) : elapsed(minutes));
  const checks = designChecks(fromDesign(d));
  const usesBoard = d.columns.length > 0 || d.agenda.some((s) => isBoardActivity(s.activity)) || d.type === 'retro';

  const addBlock = (b: (typeof BLOCKS)[number]) => {
    setD((x) => {
      const columns = b.stages.some((s) => isBoardActivity(s.activity)) && !x.columns.length
        ? preset('went-well')!.map((title) => ({ title, description: '', color: GREY, key: key() }))
        : x.columns;
      return { ...x, columns, agenda: [...x.agenda, ...b.stages.map((s) => ({ ...s, key: key() }))] };
    });
  };

  return (
    <div className="designer">
      <div className="col designer-main">
        <section className="designer-section">
          <h3>{t('Meeting')}</h3>
          <div className="designer-basics">
            <label className="field">{t('Name')}<input value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={t('e.g. Sprint retro')} /></label>
            <label className="field">{t('Kind')}
              <select value={d.type} onChange={(e) => set({ type: e.target.value as MeetingType })}>
                {MEETING_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </label>
            <label className="field wide">{t('Description')}<input value={d.description} maxLength={200} onChange={(e) => set({ description: e.target.value })} placeholder={t('One line shown when picking a template')} /></label>
            <label className="field wide">{t('Meeting title')}<input value={d.title ?? ''} maxLength={120} onChange={(e) => set({ title: e.target.value || undefined })} placeholder={`${d.name || t('Meeting')} – {date}`} /><span className="hint">{t('{date} becomes the meeting\'s date, {month} its month.', { date: '{date}', month: '{month}' })}</span></label>
          </div>
        </section>

        <section className="designer-section">
          <div className="row wrap">
            <h3>{t('Stages')}</h3>
            <span className="faint small">{t('{count} · {n} min', { count: d.agenda.length, n: total })}</span>
            <span className="spacer" />
            <label className="row small muted" style={{ gap: 6 }}>{t('Starts at')}
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ width: 110 }} aria-label={t('Start time, for planning')} />
            </label>
          </div>
          {total > 0 && (
            <div className="timeline" aria-hidden="true">
              {d.agenda.map((s, i) => s.durationMin > 0 && (
                <span key={s.key} className={`seg ${s.activity ?? 'topic'}`} style={{ flexGrow: s.durationMin }} title={t('{title} · {n} min', { title: s.title, n: s.durationMin })}>
                  <span>{i + 1}</span>
                </span>
              ))}
            </div>
          )}
          <ol className="stages">
            {d.agenda.map((s, i) => (
              <li key={s.key} className={`stage${dragging === i ? ' dragging' : ''}`}
                onDragOver={(e) => { if (dragging !== null) { e.preventDefault(); if (dragging !== i) { setD((x) => ({ ...x, agenda: move(x.agenda, dragging, i) })); setDragging(i); } } }}
                onDrop={(e) => { e.preventDefault(); setDragging(null); }}>
                <span className="handle" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); setDragging(i); }} onDragEnd={() => setDragging(null)} title={t('Drag to reorder')} aria-hidden="true">⋮⋮</span>
                <span className="when">{at(offsets[i])}</span>
                <select className="kind" value={s.activity ?? 'topic'} aria-label={t('Stage {n} activity', { n: i + 1 })} title={ACTIVITY_HINT[s.activity ?? 'topic']}
                  onChange={(e) => setStage(i, { activity: e.target.value as Activity })}>
                  {ACTIVITIES.map((a) => <option key={a} value={a}>{ACTIVITY_LABEL[a]}</option>)}
                </select>
                <input className="title" value={s.title} maxLength={200} aria-label={t('Stage {n} title', { n: i + 1 })} placeholder={t('Title')} onChange={(e) => setStage(i, { title: e.target.value })} />
                <label className="mins"><input type="number" min={0} max={600} value={s.durationMin} aria-label={t('Stage {n} minutes', { n: i + 1 })}
                  onChange={(e) => setStage(i, { durationMin: Math.max(0, Math.min(600, Math.round(Number(e.target.value) || 0))) })} /><span className="faint small">{t('min')}</span></label>
                <input className="owner" value={s.owner ?? ''} maxLength={80} aria-label={t('Stage {n} owner', { n: i + 1 })} placeholder={t('Owner')} onChange={(e) => setStage(i, { owner: e.target.value || undefined })} />
                <span className="tools">
                  <button type="button" className={`ghost sm${s.screen && Object.keys(s.screen).length ? ' active' : ''}`} aria-expanded={openScreen === s.key} onClick={() => setOpenScreen(openScreen === s.key ? null : s.key)} title={t('What the screen shows while this stage runs')}>{t('Screen')}</button>
                  <button type="button" className={`ghost sm${s.notes ? ' active' : ''}`} aria-expanded={openNotes === s.key} onClick={() => setOpenNotes(openNotes === s.key ? null : s.key)} title={t('Notes or questions shown when this stage runs')}>{t('Notes')}</button>
                  <button type="button" className="ghost icon sm" aria-label={t('Move stage {n} up', { n: i + 1 })} disabled={i === 0} onClick={() => set({ agenda: move(d.agenda, i, i - 1) })}>↑</button>
                  <button type="button" className="ghost icon sm" aria-label={t('Move stage {n} down', { n: i + 1 })} disabled={i === d.agenda.length - 1} onClick={() => set({ agenda: move(d.agenda, i, i + 1) })}>↓</button>
                  <button type="button" className="ghost icon sm" aria-label={t('Remove stage {n}', { n: i + 1 })} onClick={() => set({ agenda: d.agenda.filter((_, j) => j !== i) })}>✕</button>
                </span>
                {openScreen === s.key && <StageScreen stage={s} onChange={(screen) => setStage(i, { screen })} />}
                {openNotes === s.key && (
                  <textarea className="stage-notes" value={s.notes ?? ''} maxLength={4000} rows={3} aria-label={t('Stage {n} notes', { n: i + 1 })}
                    placeholder={t('Pre-filled notes, e.g. questions to answer')} onChange={(e) => setStage(i, { notes: e.target.value || undefined })} />
                )}
              </li>
            ))}
          </ol>
          {d.agenda.length === 0 && <p className="faint small">{t('No stages yet. Add one below.')}</p>}
          <div className="row wrap">
            <span className="small muted">{t('Add')}</span>
            {BLOCKS.map((b) => <button key={b.label} type="button" className="sm" title={b.title} onClick={() => addBlock(b)}>{t('+ {label}', { label: b.label })}</button>)}
          </div>
          {d.agenda.length > 0 && <p className="small faint">{t('Ends at {time}. When a facilitator starts a stage, its timer runs and board stages switch the board to that step.', { time: at(total) })}</p>}
        </section>

        {usesBoard && (
          <section className="designer-section">
            <div className="row wrap">
              <h3>{t('Board columns')}</h3>
              <span className="spacer" />
              <select className="sm-select" value="" aria-label={t('Use a column preset')} onChange={(e) => {
                const p = preset(e.target.value);
                if (p) set({ columns: p.map((title) => ({ title, description: '', color: GREY, key: key() })) });
              }}>
                <option value="">{t('Use a preset…')}</option>
                {BOARD_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <ol className="columns-edit">
              {d.columns.map((c, i) => (
                <li key={c.key}>
                  <input value={c.title} maxLength={80} placeholder={t('Column title')} aria-label={t('Column {n} title', { n: i + 1 })} onChange={(e) => setColumn(i, { title: e.target.value })} />
                  <input value={c.description} maxLength={300} placeholder={t('Prompt, e.g. What should we start doing?')} aria-label={t('Column {n} prompt', { n: i + 1 })} onChange={(e) => setColumn(i, { description: e.target.value })} />
                  <span className="tools">
                    <button type="button" className="ghost icon sm" aria-label={t('Move column {n} left', { n: i + 1 })} disabled={i === 0} onClick={() => set({ columns: move(d.columns, i, i - 1) })}>↑</button>
                    <button type="button" className="ghost icon sm" aria-label={t('Move column {n} right', { n: i + 1 })} disabled={i === d.columns.length - 1} onClick={() => set({ columns: move(d.columns, i, i + 1) })}>↓</button>
                    <button type="button" className="ghost icon sm" aria-label={t('Remove column {n}', { n: i + 1 })} onClick={() => set({ columns: d.columns.filter((_, j) => j !== i) })}>✕</button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="row"><button type="button" className="sm" disabled={d.columns.length >= 12} onClick={() => set({ columns: [...d.columns, { title: '', description: '', color: GREY, key: key() }] })}>{t('+ Column')}</button></div>
          </section>
        )}

        {usesBoard && (
          <section className="designer-section">
            <h3>{t('Cards and voting')}</h3>
            <label className="check"><input type="checkbox" checked={settings.openBoard} onChange={(e) => setSetting('openBoard', e.target.checked)} /> {t('Open board: notes appear for everyone as they are written, with names, like a whiteboard')}</label>
            {!settings.openBoard && <label className="check"><input type="checkbox" checked={!settings.showAuthors} onChange={(e) => setSetting('showAuthors', !e.target.checked)} /> {t('Anonymous cards')}</label>}
            <label className="check"><input type="checkbox" checked={settings.secretVoting} onChange={(e) => setSetting('secretVoting', e.target.checked)} /> {t('Hide votes until discussion starts')}</label>
            <div className="row wrap" style={{ gap: 16 }}>
              <label className="row small" style={{ gap: 6 }}>{t('Votes per person')}<input type="number" min={0} max={99} value={settings.votesPerUser} style={{ width: 72 }} onChange={(e) => setSetting('votesPerUser', Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))))} /></label>
              <label className="row small" style={{ gap: 6 }}>{t('Per card')}<input type="number" min={0} max={99} value={settings.votesPerCard} style={{ width: 72 }} onChange={(e) => setSetting('votesPerCard', Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))))} /></label>
              <span className="faint small">{t('0 = unlimited')}</span>
            </div>
          </section>
        )}
      </div>

      <aside className="designer-side">
        <span className="label">{t('Run of show')}</span>
        <ol className="run">
          {d.agenda.map((s, i) => (
            <li key={s.key}>
              <span className="when">{at(offsets[i])}</span>
              <span className="what">{s.title || <span className="faint">{t('Untitled')}</span>}{isBoardActivity(s.activity) && <span className="faint small"> · {t('board')}</span>}</span>
              <span className="faint small">{s.durationMin}′</span>
            </li>
          ))}
          {d.agenda.length > 0 && <li className="end"><span className="when">{at(total)}</span><span className="what muted">{t('End')}</span></li>}
        </ol>
        {checks.length > 0 && (
          <div className="col" style={{ gap: 4 }}>
            <span className="label">{t('Worth a look')}</span>
            <ul className="checks">{checks.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
      </aside>
    </div>
  );
}

/** Per stage: what goes in the middle and which side blocks are folded. "Auto" follows the stage type. */
function StageScreen({ stage, onChange }: { stage: { activity?: Activity; screen?: Screen }; onChange: (s: Screen | undefined) => void }) {
  const auto = defaultScreen(stage.activity);
  const cur = stage.screen ?? {};
  const update = (next: Screen) => onChange(Object.keys(next).length ? next : undefined);
  const setFold = (b: ScreenBlock, v: string) => { const n: Screen = { ...cur }; if (v) n[b] = v as 'open' | 'folded'; else delete n[b]; update(n); };
  const setMiddle = (pos: 0 | 1, v: string) => {
    const n: Screen = { ...cur };
    if (pos === 0 && v === '') { delete n.middle; return update(n); }
    const base = cur.middle ?? auto.middle ?? [];
    const top = pos === 0 ? v : base[0];
    const below = pos === 1 ? v : base[1];
    n.middle = [top, below].filter((x, k, xs): x is MiddleBlock => !!x && x !== 'none' && xs.indexOf(x) === k);
    update(n);
  };
  const autoMiddle = auto.middle?.length ? SCREEN_BLOCK_LABEL[auto.middle[0]] : t('no change');
  const shown = cur.middle ?? auto.middle ?? [];
  return (
    <div className="stage-screen" role="group" aria-label={t('Screen during this stage')}>
      <label className="col small">
        <span className="muted">{t('Middle, top')}</span>
        <select value={cur.middle ? cur.middle[0] ?? 'none' : ''} aria-label={t('Middle area during this stage')} onChange={(e) => setMiddle(0, e.target.value)}>
          <option value="">{t('Auto: {block}', { block: autoMiddle })}</option>
          <option value="none">{t('Nothing')}</option>
          {MIDDLE_BLOCKS.map((m) => <option key={m} value={m}>{SCREEN_BLOCK_LABEL[m]}</option>)}
        </select>
      </label>
      <label className="col small">
        <span className="muted">{t('Middle, below')}</span>
        <select value={cur.middle ? cur.middle[1] ?? 'none' : ''} disabled={!cur.middle?.length} aria-label={t('Second block in the middle during this stage')} onChange={(e) => setMiddle(1, e.target.value)}>
          {!cur.middle && <option value="">{shown[1] ? SCREEN_BLOCK_LABEL[shown[1]] : t('Nothing')}</option>}
          <option value="none">{t('Nothing')}</option>
          {MIDDLE_BLOCKS.filter((m) => m !== cur.middle?.[0]).map((m) => <option key={m} value={m}>{SCREEN_BLOCK_LABEL[m]}</option>)}
        </select>
      </label>
      {SCREEN_BLOCKS.map((b) => (
        <label key={b} className="col small">
          <span className="muted">{b === 'agenda' ? SCREEN_BLOCK_LABEL[b] : t('{block} in side bar', { block: SCREEN_BLOCK_LABEL[b] })}</span>
          <select value={cur[b] ?? ''} aria-label={t('{block} during this stage', { block: SCREEN_BLOCK_LABEL[b] })} onChange={(e) => setFold(b, e.target.value)}>
            <option value="">{t('Auto (no change)')}</option>
            <option value="open">{t('Open')}</option>
            <option value="folded">{t('Folded')}</option>
          </select>
        </label>
      ))}
      <p className="faint small" style={{ gridColumn: '1 / -1', margin: 0 }}>{t('Applied for everyone when the stage starts. Anyone can still move or fold a block for themselves.')}</p>
    </div>
  );
}
