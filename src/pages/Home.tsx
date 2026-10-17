import { focusField, useCommands } from '../components/CommandPalette';
import { useEffect, useRef, useState } from 'react';
import { syncMode, type SyncMode } from '../lib/sync';
import * as Y from 'yjs';
import { TYPE_LABEL, randomId, readView, type TemplateDef, type View } from '../lib/model';
import { BUILTIN_TEMPLATES, defaultTitle, loadMyTemplates, loadOrgTemplates, newVersionYaml, parseTemplate, takenTemplateNames, templateToYaml, type ListedTemplate } from '../lib/templates';
import { STARTER_YAML, TemplateEditor } from '../components/TemplateEditor';
import { forgetMeeting, getPrefs, listMeetings, meetingLink, setPrefs, type Identity } from '../lib/store';
import { docFromFile, parseMeetingFile } from '../lib/files';
import { queueImport, queueNewMeeting } from '../lib/useMeeting';
import { Modal, PrefsButton, TopBar, fmtDate, toast, toastError, ask } from '../components/ui';
import { CADENCES, CADENCE_LABEL, CADENCE_SHORT, forgetSeries, listSeries, type Cadence } from '../lib/series';
import { queueNewSeries } from './Series';
import { t, tn } from '../lib/i18n';

/** A text with `{hash}` in it, with the # shown as code. */
const withHash = (text: string) => text.split('{hash}').flatMap((part, i) => (i ? [<code key={i}>#</code>, part] : [part]));

export interface NewMeetingChoice {
  title: string;
  template: TemplateDef;
  seriesName: string | null;
  /** Set when the meeting repeats: a series with one link for the calendar invite. */
  repeat?: { cadence: Cadence; start: string | null; durationMin: number } | null;
}

/** Set up a recurring series and show its link, ready for the calendar invite. */
export function startSeries(me: Identity, input: NewMeetingChoice) {
  if (!input.repeat) return;
  const id = randomId(12);
  const key = randomId(18);
  queueNewSeries(id, {
    name: input.seriesName?.trim() || input.title.trim() || input.template.name,
    cadence: input.repeat.cadence,
    template: input.template,
    facilitators: [{ id: me.id, name: me.name }],
    createdBy: me.id,
    createdAt: new Date().toISOString(),
    start: input.repeat.start,
    durationMin: input.repeat.durationMin,
  });
  setPrefs({ lastTemplateId: input.template.id });
  location.hash = `#/s/${id}/${key}/overview`;
}

/** The template a meeting was made from: the copy stored with it, else the built-in with that id. */
export function templateOf(meta: { templateId: string; template: TemplateDef | null }): TemplateDef {
  return meta.template ?? BUILTIN_TEMPLATES.find((t) => t.template.id === meta.templateId)?.template ?? BUILTIN_TEMPLATES[0].template;
}

export function startMeeting(me: Identity, input: { title: string; template: TemplateDef; seriesName?: string | null; previous?: View | null }) {
  const roomId = randomId(12);
  const key = randomId(18);
  const prefs = getPrefs();
  setPrefs({
    lastTemplateId: input.template.id,
    ...(input.seriesName ? { lastSeries: [input.seriesName, ...prefs.lastSeries.filter((s) => s !== input.seriesName)].slice(0, 20) } : {}),
  });
  queueNewMeeting(roomId, { ...input, creatorId: me.id, defaults: prefs.meetingDefaults });
  location.hash = `#/m/${roomId}/${key}`;
}

export function HomePage({ me, onRename }: { me: Identity; onRename: () => void }) {
  const [creating, setCreating] = useState<false | { template?: TemplateDef }>(false);
  const [designing, setDesigning] = useState(false);
  const [, refresh] = useState(0);
  const [fileView, setFileView] = useState<{ file: ReturnType<typeof parseMeetingFile>; view: View } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const meetings = listMeetings();
  const series = listSeries();
  useCommands(() => [
    { id: 'new-meeting', group: t('Start'), label: t('New meeting'), keywords: 'create start series neu erstellen starten serie', run: () => setCreating({}) },
    { id: 'design', group: t('Start'), label: t('Design a meeting'), keywords: 'template agenda stages yaml vorlage gestalten schritte', run: () => setDesigning(true) },
    { id: 'open-file', group: t('Start'), label: t('Open meeting file…'), keywords: 'import json load importieren laden datei öffnen', run: () => fileInput.current?.click() },
    { id: 'join', group: t('Start'), label: t('Join a meeting by link'), keywords: 'paste invite einfügen einladung teilnehmen beitreten', run: () => focusField(t('Meeting link')) },
    ...listSeries().map((x) => ({ id: `series-${x.id}`, group: t('Series'), label: x.name, keywords: 'recurring open serie wiederkehrend öffnen', search: true, run: () => (location.hash = `#/s/${x.id}/${x.key}`) })),
  ]);

  const openFile = async (f: File) => {
    try {
      const file = parseMeetingFile(await f.text());
      const view = readView(docFromFile(file))!;
      setFileView({ file, view });
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <>
      <TopBar right={
        <span className="row small">
          <PrefsButton me={me} onChange={onRename} />
        </span>
      } />
      <div className="page">
        <div className="home-grid">
          <div className="stack">
            <div className="row wrap page-head">
              <h1>{t('Meetings')}</h1>
              <span className="spacer" />
              <button onClick={() => fileInput.current?.click()}>{t('Open meeting file…')}</button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openFile(f); e.target.value = ''; }} />
              <button onClick={() => setDesigning(true)}>{t('Design a meeting')}</button>
              <button className="primary" onClick={() => setCreating({})}>{t('New meeting')}</button>
            </div>
            {series.length > 0 && (
              <div className="card flush">
                <ul className="list">
                  {series.map((x) => (
                    <li key={x.id} className="link" onClick={() => (location.hash = `#/s/${x.id}/${x.key}`)}>
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <a href={`#/s/${x.id}/${x.key}`}>{x.name}</a>
                        <span className="faint small">{t('Series')} · {CADENCE_SHORT[x.cadence]} · <a href={`#/s/${x.id}/${x.key}/overview`} onClick={(e) => e.stopPropagation()}>{t('All meetings and invite')}</a></span>
                      </div>
                      <span className="spacer" />
                      <span className="badge">{t('Series')}</span>
                      <button className="ghost sm" title={t('Remove from this browser')} aria-label={t('Remove {name} from this browser', { name: x.name })} onClick={async (e) => {
                        e.stopPropagation();
                        if (!(await ask(t('Remove the series “{name}” from this browser? The link keeps working for everyone.', { name: x.name })))) return;
                        forgetSeries(x.id);
                        refresh((n) => n + 1);
                      }}>✕</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="card flush">
              {meetings.length === 0 ? (
                <div className="empty">{t('No meetings in this browser yet. Start one, or open a link someone shared with you.')}</div>
              ) : (
                <ul className="list">
                  {meetings.map((m) => (
                    <li key={m.roomId} className="link" onClick={() => (location.hash = `#/m/${m.roomId}/${m.key}`)}>
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <a href={`#/m/${m.roomId}/${m.key}`}>{m.title}</a>
                        <span className="faint small">{fmtDate(m.updatedAt)}{m.openActions ? ` · ${tn('{n} open action', '{n} open actions', m.openActions)}` : ''}</span>
                      </div>
                      <span className="spacer" />
                      <span className="badge">{TYPE_LABEL[m.type]}</span>
                      <span className={`badge ${m.status === 'live' ? 'success' : ''}`}>{m.status === 'live' ? t('Open') : t('Closed')}</span>
                      <button className="ghost sm" title={t('Remove from this browser')} aria-label={t('Remove {name} from this browser', { name: m.title })} onClick={async (e) => {
                        e.stopPropagation();
                        if (!(await ask(t('Remove “{name}” from this browser? Other participants keep their copies.', { name: m.title })))) return;
                        await forgetMeeting(m.roomId);
                        refresh((x) => x + 1);
                      }}>✕</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <aside className="stack">
            <JoinByLink />
            <div className="card stack">
              <HowItWorks />
            </div>
          </aside>
        </div>
      </div>
      {creating && <NewMeetingModal initialTemplate={creating.template} onClose={() => setCreating(false)} onCreate={(input) => (input.repeat ? startSeries(me, input) : startMeeting(me, input))} />}
      {designing && (
        <TemplateEditor initialYaml={STARTER_YAML} onClose={() => setDesigning(false)}
          onSaved={(id) => { setDesigning(false); setCreating({ template: loadMyTemplates().find((t) => t.template.id === id)?.template }); }} />
      )}
      {fileView && (
        <Modal title={fileView.view.meta.title} onClose={() => setFileView(null)}>
          <p className="muted">{tn('Saved {date} · {n} open action', 'Saved {date} · {n} open actions', fileView.view.actions.filter((a) => a.status === 'open').length, { date: fmtDate(fileView.file.exportedAt) })}</p>
          <div className="col">
            <button className="primary" onClick={() => {
              const update = Y.encodeStateAsUpdate(docFromFile(fileView.file));
              queueImport(fileView.file.roomId, update);
              location.hash = `#/m/${fileView.file.roomId}/${fileView.file.key}`;
              setFileView(null);
            }}>{t('Open this meeting')}</button>
            <span className="small muted">{t('Rejoins the same meeting link, so anyone still in it sees your copy merged with theirs.')}</span>
            <button onClick={() => {
              const prev = fileView.view;
              setFileView(null);
              startMeeting(me, { title: '', template: templateOf(prev.meta), seriesName: prev.meta.seriesName ?? prev.meta.title, previous: prev });
              toast(t('Started the next meeting with open actions carried over'));
            }}>{t('Start the next meeting from it')}</button>
            <span className="small muted">{t('New link, same template and settings. Open actions and uncovered topics carry over.')}</span>
          </div>
        </Modal>
      )}
    </>
  );
}

export function NewMeetingModal({ onClose, onCreate, initialTemplate }: { onClose: () => void; onCreate: (i: NewMeetingChoice) => void; initialTemplate?: TemplateDef }) {
  const [templateId, setTemplateId] = useState(initialTemplate?.id ?? getPrefs().lastTemplateId ?? 'start-stop-continue');
  const [title, setTitle] = useState('');
  const [series, setSeries] = useState('');
  const [repeat, setRepeat] = useState<Cadence | 'once'>('once');
  const [startAt, setStartAt] = useState(() => {
    const d = new Date(Date.now() + 86400000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T10:00`;
  });
  const [mine, setMine] = useState(loadMyTemplates);
  const [org, setOrg] = useState<ListedTemplate[]>([]);
  const [editor, setEditor] = useState<{ yaml: string; editingId?: string } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => void loadOrgTemplates().then(setOrg), []);

  const known = [...BUILTIN_TEMPLATES, ...org, ...mine];
  // A meeting made from someone else's template still offers it for the next meeting.
  const extra = initialTemplate && !known.some((t) => t.template.id === initialTemplate.id) ? [{ template: initialTemplate, source: 'mine' as const, yaml: '' }] : [];
  const all = [...known, ...extra];
  const template = all.find((t) => t.template.id === templateId)?.template ?? BUILTIN_TEMPLATES[0].template;
  const groups: [string, ListedTemplate[]][] = [
    [t('Retrospectives'), BUILTIN_TEMPLATES.filter((x) => x.template.type === 'retro')],
    [t('Meetings'), BUILTIN_TEMPLATES.filter((x) => x.template.type !== 'retro')],
    [t('From your organisation'), org],
    [t('This meeting'), extra],
    [t('My templates'), mine],
  ];

  const importFile = async (f: File) => {
    const yaml = await f.text();
    const { errors } = parseTemplate(yaml, 'my-');
    setEditor({ yaml });
    if (errors.length) toastError(new Error(t('The file has problems; they are listed under the template.')));
  };

  return (
    <Modal title={t('New meeting')} onClose={onClose} wide>
      <form className="col" style={{ gap: 14 }} onSubmit={(e) => {
        e.preventDefault();
        const durationMin = template.agenda.reduce((n, a) => n + (a.durationMin || 0), 0) || 60;
        onCreate({ title, template, seriesName: series.trim() || null, repeat: repeat === 'once' ? null : { cadence: repeat, start: startAt || null, durationMin } });
      }}>
        <div className="row wrap">
          <span className="small muted">{t('Pick a template, or design your own.')}</span>
          <span className="spacer" />
          <button type="button" className="sm" onClick={() => importInput.current?.click()}>{t('Import .yaml…')}</button>
          <input ref={importInput} type="file" accept=".yaml,.yml,text/yaml,application/yaml,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }} />
          <button type="button" className="sm" onClick={() => setEditor({ yaml: STARTER_YAML })}>{t('Design new…')}</button>
        </div>
        {groups.filter(([, ts]) => ts.length > 0).map(([label, ts]) => (
          <div key={label} className="col" style={{ gap: 6 }}>
            <h3 className="muted">{label}</h3>
            <div className="templates">
              {ts.map(({ template: tpl, source, yaml }) => (
                <div key={tpl.id} className="template-slot">
                  <button type="button" className={`template${tpl.id === templateId ? ' selected' : ''}`} aria-pressed={tpl.id === templateId} onClick={() => setTemplateId(tpl.id)}>
                    <strong>{tpl.name}</strong>
                    <span className="small muted">{tpl.description || (tpl.columns.length
                      ? tn('{n} agenda item, {columns} columns', '{n} agenda items, {columns} columns', tpl.agenda.length, { columns: tpl.columns.length })
                      : tn('{n} agenda item', '{n} agenda items', tpl.agenda.length))}</span>
                  </button>
                  <span className="template-actions">
                    {source === 'mine' && yaml && <button type="button" className="ghost sm" aria-label={t('Edit {name}', { name: tpl.name })} title={t('Change this template')} onClick={() => setEditor({ yaml, editingId: tpl.id })}>{t('Edit')}</button>}
                    <button type="button" className="ghost sm" aria-label={t('New version of {name}', { name: tpl.name })} title={t('Start a new template from this one; the original stays as it is')}
                      onClick={() => setEditor({ yaml: newVersionYaml(yaml || templateToYaml(tpl), takenTemplateNames(org)) })}>{t('New version')}</button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <label className="field">{t('Title')}<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle(template)} /></label>
          <label className="field">{t('Series name')}<input value={series} list="rondel-series" onChange={(e) => setSeries(e.target.value)} placeholder={t('Optional, e.g. Sprint retro')} />
            <datalist id="rondel-series">{getPrefs().lastSeries.map((s) => <option key={s} value={s} />)}</datalist><span className="hint">{t('Shown in the minutes so recurring meetings are easy to find.')}</span></label>
          <label className="field">{t('Repeats')}
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Cadence | 'once')}>
              <option value="once">{t('Does not repeat')}</option>
              {CADENCES.map((c) => <option key={c} value={c}>{CADENCE_LABEL[c]}</option>)}
            </select>
            <span className="hint">{repeat === 'once' ? t('A recurring meeting gets one link for the calendar invite.')
              : repeat === 'none' ? t('You get one link for the calendar invite. It opens the current meeting; a new one starts after the last is closed.')
              : repeat === 'monthly' ? t('You get one link for the calendar invite. It opens this month’s meeting, with the month in its title.')
              : repeat === 'daily' ? t('You get one link for the calendar invite. It opens this day’s meeting, with the date in its title.')
              : t('You get one link for the calendar invite. It opens this week’s meeting, with the week number in its title.')}</span>
          </label>
          {repeat !== 'once' && (
            <label className="field">{t('First meeting')}<input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              <span className="hint">{t('Only used for the calendar file.')}</span></label>
          )}
        </div>
        <div className="row"><span className="spacer" /><button type="button" onClick={onClose}>{t('Cancel')}</button><button className="primary" type="submit">{repeat === 'once' ? t('Create meeting') : t('Create series')}</button></div>
      </form>
      {editor && (
        <TemplateEditor initialYaml={editor.yaml} editingId={editor.editingId} onClose={() => { setEditor(null); setMine(loadMyTemplates()); }}
          onSaved={(id) => { setEditor(null); setMine(loadMyTemplates()); setTemplateId(id); }} />
      )}
    </Modal>
  );
}

export { meetingLink };

/** Join from a pasted invite, for when a link can't open the meeting directly (for example inside a preview). */
function JoinByLink() {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const m = text.match(/#\/([ms])\/([\w-]{8,64})\/([\w-]+)/) ?? text.match(/#([ms])\.([\w-]{8,64})\.([\w-]+)/);
    if (!m) return setBad(true);
    location.hash = `#/${m[1]}/${m[2]}/${m[3]}`;
  };
  return (
    <form className="card stack" onSubmit={join}>
      <h2>{t('Join a meeting')}</h2>
      <div className="row">
        <input value={text} onChange={(e) => { setText(e.target.value); setBad(false); }} placeholder={t('Paste the meeting link')} aria-label={t('Meeting link')} />
        <button type="submit" className="primary" disabled={!text.trim()}>{t('Join')}</button>
      </div>
      {bad && <span className="small error-banner">{t('That doesn\'t look like a Rondel meeting link. Copy the whole link, including the part after #.')}</span>}
    </form>
  );
}

function HowItWorks() {
  const [mode, setMode] = useState<SyncMode | null>(null);
  useEffect(() => void syncMode().then(setMode), []);
  if (!mode) return null;
  return (
    <>
      <h2>{t('How it works')}</h2>
      {mode === 'artifact' ? (
        <>
          <p className="muted">{t('This is a preview of Rondel running inside claude.ai. Meetings are stored in the preview\'s shared storage, so people can work on them live or at different times.')}</p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            <li>{t('Everything is encrypted in your browser first. The storage only holds unreadable blobs.')}</li>
            <li>{t('To invite someone, share the meeting link from Invite. If it opens this home page instead of the meeting, paste it into Join a meeting.')}</li>
            <li>{t('People need access to this preview to join. To add or edit, they need Contributor access or above.')}</li>
            <li>{t('Unshared drafts never leave your browser.')}</li>
          </ul>
          <a className="small" href="#/data">{t('How your data is handled')}</a>
        </>
      ) : mode === 'server' ? (
        <>
          <p className="muted">{t('Share a meeting link and everyone works on the same meeting, live or at different times, for example to prepare before it starts.')}</p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            <li>{t('Meetings are stored on this site\'s server, encrypted in your browser first. The server can\'t read them.')}</li>
            <li>{withHash(t('The secret part of the link (after {hash}) is the key and never leaves your browser. Anyone with the full link can join, so share it like a meeting invite.'))}</li>
            <li>{t('Save the meeting file or minutes to keep your own copy. Open the file later to continue, or to start the next meeting with open actions carried over.')}</li>
            <li>{t('Unshared drafts never leave your browser.')}</li>
          </ul>
          <a className="small" href="#/data">{t('How your data is handled')}</a>
        </>
      ) : (
        <>
          <p className="muted">{t('There is no meeting server here, so browsers connect to each other directly, encrypted end to end.')}</p>
          <ul className="muted small" style={{ paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            <li>{t('Meetings are stored in the browsers of the people who joined, so someone who has the meeting must be online for others to get it.')}</li>
            <li>{withHash(t('The secret part of the link (after {hash}) never leaves your browser. Anyone with the full link can join, so share it like a meeting invite.'))}</li>
            <li>{t('Save the meeting file or minutes when you\'re done. Open the file later to continue, or to start the next meeting with open actions carried over.')}</li>
            <li>{t('Unshared drafts never leave your browser.')}</li>
          </ul>
          <a className="small" href="#/data">{t('How your data is handled')}</a>
        </>
      )}
    </>
  );
}
