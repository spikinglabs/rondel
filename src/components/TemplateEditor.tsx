import { useMemo, useRef, useState } from 'react';
import { Modal, ask, toast } from './ui';
import { ACTIVITY_LABEL, TYPE_LABEL } from '../lib/model';
import { deleteMyTemplate, defaultTitle, parseTemplate, saveMyTemplate, slug, templateToYaml } from '../lib/templates';
import { MeetingDesigner } from './MeetingDesigner';
export { STARTER_YAML } from '../lib/templates';
import { downloadText } from '../lib/files';
import { t } from '../lib/i18n';


/** Design a meeting template with the visual designer, or write it as YAML; both edit the same template. */
export function TemplateEditor(props: { initialYaml: string; editingId?: string; title?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const [yaml, setYaml] = useState(props.initialYaml);
  const area = useRef<HTMLTextAreaElement>(null);
  const { template, errors } = useMemo(() => parseTemplate(yaml, 'my-'), [yaml]);
  // The designer starts from the template as it was when it opened, and reports every edit back as YAML.
  const [designFrom, setDesignFrom] = useState(() => ({ template, version: 0 }));
  const [mode, setMode] = useState<'design' | 'yaml'>(template ? 'design' : 'yaml');
  const toDesign = () => {
    if (!template) return toast(t('Fix the problems in the YAML first; they are listed under it.'));
    setDesignFrom((x) => ({ template, version: x.version + 1 }));
    setMode('design');
  };
  const total = template?.agenda.reduce((n, a) => n + a.durationMin, 0) ?? 0;

  const goToLine = (line?: number) => {
    const el = area.current;
    if (!el || !line) return;
    const start = yaml.split('\n').slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
    el.focus();
    el.setSelectionRange(start, start + (yaml.split('\n')[line - 1]?.length ?? 0));
  };

  const save = () => {
    try {
      const id = saveMyTemplate(yaml, props.editingId);
      toast(t('Template saved in this browser'));
      props.onSaved(id);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Modal title={props.title ?? (props.editingId ? t('Edit meeting design') : t('Design a meeting'))} onClose={props.onClose} width={1080}>
      <div className="tabs" role="tablist" style={{ marginBottom: 0 }}>
        <button type="button" role="tab" aria-selected={mode === 'design'} onClick={() => mode !== 'design' && toDesign()}>{t('Designer')}</button>
        <button type="button" role="tab" aria-selected={mode === 'yaml'} onClick={() => setMode('yaml')}>YAML</button>
      </div>
      {mode === 'design' && designFrom.template && (
        <>
          <MeetingDesigner key={designFrom.version} value={designFrom.template} onChange={(t) => setYaml(templateToYaml(t))} />
          {errors.length > 0 && <ul className="template-errors" aria-live="polite">{errors.map((e, i) => <li key={i}><span>{e.message}</span></li>)}</ul>}
        </>
      )}
      {mode === 'yaml' && <div className="template-editor">
        <div className="col" style={{ gap: 6, minWidth: 0 }}>
          <label htmlFor="template-yaml" className="small muted">{t('Template (YAML)')}</label>
          <textarea id="template-yaml" ref={area} className="code" value={yaml} spellCheck={false} autoCapitalize="off" autoCorrect="off"
            onChange={(e) => setYaml(e.target.value)}
            onKeyDown={(e) => {
              // Tab inserts two spaces, as YAML indentation expects.
              if (e.key !== 'Tab' || e.shiftKey) return;
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              setYaml(yaml.slice(0, a) + '  ' + yaml.slice(b));
              requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
            }} />
          {errors.length > 0 ? (
            <ul className="template-errors" aria-live="polite">
              {errors.map((e, i) => (
                <li key={i}>
                  {e.line ? <button type="button" className="ghost sm" onClick={() => goToLine(e.line)}>{t('Line {n}', { n: e.line })}</button> : null}
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">{t('No problems found.')}</p>
          )}
          <details className="small muted">
            <summary>{t('All fields')}</summary>
            <pre className="code-sample">{FIELD_HELP}</pre>
          </details>
        </div>
        <section className="template-preview" aria-label={t('Preview')}>
          <span className="small muted">{t('Preview')}</span>
          {template ? (
            <>
              <div>
                <h3>{template.name}</h3>
                <p className="small muted">{[TYPE_LABEL[template.type], template.description].filter(Boolean).join(' · ')}</p>
                <p className="small faint">{t('New meetings are called “{title}”.', { title: defaultTitle(template) })}</p>
              </div>
              {template.columns.length > 0 && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="label">{t('Board')}</span>
                  <div className="preview-columns">
                    {template.columns.map((c, i) => (
                      <div key={i} className="preview-column"><strong>{c.title}</strong>{c.description && <span className="small muted">{c.description}</span>}</div>
                    ))}
                  </div>
                </div>
              )}
              {template.agenda.length > 0 && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="label">{t('Agenda · {n} min', { n: total })}</span>
                  <ol className="preview-agenda">
                    {template.agenda.map((a, i) => (
                      <li key={i}>
                        <span>{a.title}<span className="faint"> · {ACTIVITY_LABEL[a.activity ?? 'topic']}{a.owner ? ` · ${a.owner}` : ''}</span></span>
                        <span className="faint">{t('{n} min', { n: a.durationMin })}</span>
                        {a.notes && <span className="notes small muted">{a.notes}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {template.settings && (
                <div className="col" style={{ gap: 4 }}>
                  <span className="label">{t('Settings')}</span>
                  <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {template.settings.showAuthors !== undefined && <li>{template.settings.showAuthors ? t('Card authors shown') : t('Cards are anonymous')}</li>}
                    {template.settings.votesPerUser !== undefined && <li>{template.settings.votesPerUser ? t('{n} votes per person', { n: template.settings.votesPerUser }) : t('Unlimited votes per person')}</li>}
                    {template.settings.votesPerCard !== undefined && <li>{template.settings.votesPerCard ? t('{n} votes per card', { n: template.settings.votesPerCard }) : t('Unlimited votes per card')}</li>}
                    {template.settings.openBoard && <li>{t('Open board: cards appear live with names')}</li>}
                    {template.settings.secretVoting !== undefined && <li>{template.settings.secretVoting ? t('Votes hidden until revealed') : t('Votes visible while voting')}</li>}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="small muted">{t('Fix the problems on the left to see the preview.')}</p>
          )}
        </section>
      </div>}
      <div className="row wrap">
        {props.editingId && (
          <button type="button" className="danger" onClick={async () => {
            if (!(await ask(t('Delete this template from this browser? Meetings made from it are not affected.')))) return;
            deleteMyTemplate(props.editingId!);
            toast(t('Template deleted'));
            props.onClose();
          }}>{t('Delete')}</button>
        )}
        <button type="button" onClick={() => downloadText(`${slug(template?.name ?? 'template') || 'template'}.yaml`, yaml, 'application/yaml')}>{t('Download .yaml')}</button>
        <span className="spacer" />
        <button type="button" onClick={props.onClose}>{t('Cancel')}</button>
        <button type="button" className="primary" disabled={!template} onClick={save}>{t('Save template')}</button>
      </div>
    </Modal>
  );
}

const FIELD_HELP = `name: Sprint retro            required
type: retro                   retro | standup | planning | one_on_one | general
description: Shown in the template picker
title: Sprint retro {date}    default meeting title; also {month}
columns:                      the card board; leave out for none
  - title: Went well
    description: Optional hint under the column title
agenda:
  - title: Review last actions
    minutes: 5                whole minutes (default 5)
    activity: topic           topic | round | write | group | vote | discuss | actions | break
    owner: Facilitator        optional
    notes: |                  optional, pre-filled meeting notes
      Which actions are still open?
settings:
  anonymous_cards: true       hide who wrote each card
  votes_per_person: 5         0 = unlimited
  votes_per_card: 3           0 = unlimited
  secret_voting: true         hide votes until revealed
  open_board: true            cards appear live with names, like a whiteboard`;
