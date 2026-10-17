import { useEffect, useState } from 'react';
import type { ActionItem } from '../lib/model';
import type { Ops } from '../lib/ops';
import { Md } from './Markdown';
import { isOverdue, ask } from './ui';
import { t } from '../lib/i18n';

/** Names offered when assigning an owner (participants seen in this meeting). */
export function PeopleList({ names }: { names: string[] }) {
  return <datalist id="rondel-people">{names.map((n) => <option key={n} value={n} />)}</datalist>;
}

export function ActionRow({ action: a, ops, readOnly }: { action: ActionItem; ops: Ops; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(a.text);
  const [owner, setOwner] = useState(a.owner);
  useEffect(() => setOwner(a.owner), [a.owner]);
  useEffect(() => setText(a.text), [a.text]);
  return (
    <div className={`action ${a.status}`} data-find={a.id}>
      <input type="checkbox" style={{ marginTop: 4 }} checked={a.status === 'done'} disabled={readOnly}
        aria-label={a.status === 'done' ? t('Reopen action') : t('Mark action done')}
        onChange={(e) => ops.updateAction(a.id, { status: e.target.checked ? 'done' : 'open' })} />
      <div className="col" style={{ gap: 4, flex: 1, minWidth: 0 }}>
        {editing ? (
          <input value={text} autoFocus aria-label={t('Action text')} onChange={(e) => setText(e.target.value)}
            onBlur={() => { setEditing(false); if (text.trim()) ops.updateAction(a.id, { text: text.trim() }); }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        ) : (
          <span className="text" onDoubleClick={() => !readOnly && setEditing(true)}><Md text={a.text} inline /></span>
        )}
        <div className="row wrap small">
          <input list="rondel-people" placeholder={t('Owner')} value={owner} disabled={readOnly} aria-label={t('Owner')}
            onChange={(e) => setOwner(e.target.value)} onBlur={() => owner !== a.owner && ops.updateAction(a.id, { owner: owner.trim() })}
            style={{ width: 130, minHeight: 26, padding: '0 6px', fontSize: 12 }} />
          <input type="date" value={a.due ?? ''} disabled={readOnly} aria-label={t('Due date')}
            onChange={(e) => ops.updateAction(a.id, { due: e.target.value || null })}
            style={{ width: 'auto', minHeight: 26, padding: '0 6px', fontSize: 12, ...(isOverdue(a.due, a.status) ? { borderColor: 'var(--danger)', color: 'var(--danger)' } : {}) }} />
          {a.carriedFrom && <span className="badge warning" title={t('From {meeting}', { meeting: a.carriedFrom })}>{t('From earlier')}</span>}
          {a.status === 'dropped' && <span className="badge">{t('Dropped')}</span>}
          <span className="spacer" />
          {!readOnly && (
            <>
              {a.status !== 'dropped'
                ? <button className="ghost sm" onClick={() => ops.updateAction(a.id, { status: 'dropped' })} title={t('No longer needed')}>{t('Drop')}</button>
                : <button className="ghost sm" onClick={() => ops.updateAction(a.id, { status: 'open' })}>{t('Reopen')}</button>}
              <button className="ghost icon sm" aria-label={t('Delete action')} onClick={async () => (await ask(t('Delete this action?'))) && ops.deleteAction(a.id)}>✕</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function NewActionForm(props: { ops: Ops; cardId?: string; initialText?: string; autoFocus?: boolean; onCreated?: () => void }) {
  const [text, setText] = useState(props.initialText ?? '');
  const [owner, setOwner] = useState('');
  const [due, setDue] = useState('');
  return (
    <form className="col" style={{ gap: 6 }} onSubmit={(e) => {
      e.preventDefault();
      if (!text.trim()) return;
      props.ops.addAction({ text, owner, due: due || null, cardId: props.cardId ?? null });
      setText(''); setOwner(''); setDue('');
      props.onCreated?.();
    }}>
      <input placeholder={t('Add an action item…')} value={text} autoFocus={props.autoFocus} maxLength={2000} aria-label={t('New action')} onChange={(e) => setText(e.target.value)} />
      {text.trim() && (
        <div className="row wrap">
          <input list="rondel-people" placeholder={t('Owner')} value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('Owner')} style={{ flex: 1, minWidth: 110 }} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t('Due date')} style={{ width: 'auto' }} />
          <button className="primary sm" type="submit">{t('Add')}</button>

        </div>
      )}
    </form>
  );
}
