import { useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Column, View } from '../lib/model';
import { randomId } from '../lib/model';
import { loadDrafts, loadMine, saveDrafts, voterId, type Draft } from '../lib/store';
import type { Ops } from '../lib/ops';
import { Modal, toast, toastError, ask } from './ui';
import { Md } from './Markdown';
import { NewActionForm } from './Actions';
import { t, tn } from '../lib/i18n';

const CARD_COLORS = [null, '#4f7d66', '#a4554e', '#4f6c98', '#a07a35', '#6f6390'];

interface Props {
  roomId: string;
  view: View;
  ops: Ops;
  canFacilitate: boolean;
  /** Unshared drafts per column, summed over everyone else in the meeting. */
  othersDrafts: Record<string, number>;
  onDraftCounts: (counts: Record<string, number>) => void;
  /** Others writing a card right now (text only on an open board). */
  typing: Typing[];
  onTyping: (t: { columnId: string; text: string | null } | null) => void;
}
type Typing = { id: string; name: string; columnId: string; text: string | null };

/** A card as displayed: shared cards from the document plus this browser's private drafts. */
type Shown = (Card & { draft: false; mine: boolean }) | (Draft & { draft: true; mine: true; groupId: null; groupTitle: null; authorName: null });

export function Board({ roomId, view, ops, canFacilitate, othersDrafts, onDraftCounts, typing, onTyping }: Props) {
  const { meta } = view;
  const closed = meta.status === 'closed';
  // A board with stages (every retro, or a design with board stages) drafts, votes and discusses in turn.
  const isRetro = meta.phase !== null;
  const votingOpen = !closed && (!isRetro || meta.phase === 'vote');
  const sortByVotes = isRetro && (meta.phase === 'discuss' || meta.phase === 'actions' || closed);
  const [drafts, setDraftsState] = useState<Draft[]>(() => loadDrafts(roomId));
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<Card | null>(null);
  const [addingColumn, setAddingColumn] = useState(false);
  // One column shown full screen, just for me.
  const [maxCol, setMaxCol] = useState<string | null>(null);
  const maxIndex = view.columns.findIndex((c) => c.id === maxCol);
  useEffect(() => {
    if (maxIndex < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role=dialog]')) return;
      if (e.key === 'Escape') setMaxCol(null);
      if (e.key === 'ArrowLeft' && maxIndex > 0) setMaxCol(view.columns[maxIndex - 1].id);
      if (e.key === 'ArrowRight' && maxIndex < view.columns.length - 1) setMaxCol(view.columns[maxIndex + 1].id);
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('no-scroll'); };
  }, [maxIndex, view.columns]);
  const mine = loadMine(roomId);
  const voter = voterId(roomId);
  const myVotes = view.votesByVoter[voter] ?? {};
  const votesUsed = Object.values(myVotes).reduce((a, b) => a + b, 0);
  const votesLeft = meta.settings.votesPerUser ? meta.settings.votesPerUser - votesUsed : null;
  const showTotals = !meta.settings.secretVoting || meta.settings.votesRevealed || closed;
  const open = meta.settings.openBoard;
  const privateDrafts = isRetro && meta.phase === 'write' && !open;

  // Let others see where I'm writing (and, on an open board, what), a few times a second at most.
  const typingTimer = useRef<number | undefined>(undefined);
  const typingNext = useRef<{ columnId: string; text: string | null } | null>(null);
  const reportTyping = (columnId: string, text: string) => {
    clearTimeout(typingTimer.current);
    if (!text.trim()) {
      typingNext.current = null;
      onTyping(null);
      return;
    }
    typingNext.current = { columnId, text: open ? text.slice(0, 500) : null };
    typingTimer.current = window.setTimeout(() => onTyping(typingNext.current), 250);
  };
  useEffect(() => () => onTyping(null), []);

  const setDrafts = (d: Draft[]) => {
    setDraftsState(d);
    saveDrafts(roomId, d);
  };
  // Tell others how many drafts we're holding per column (counts only, never content).
  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const d of drafts) counts[d.columnId] = (counts[d.columnId] ?? 0) + 1;
    onDraftCounts(counts);
  }, [drafts]);

  const share = (d: Draft) => {
    ops.shareCard(d);
    setDrafts(loadDrafts(roomId).filter((x) => x.id !== d.id));
  };
  const shareAll = () => {
    for (const d of drafts) ops.shareCard(d);
    setDrafts([]);
  };
  const addCard = (columnId: string, text: string) => {
    if (!text.trim()) return;
    reportTyping(columnId, '');
    if (privateDrafts) {
      setDrafts([...loadDrafts(roomId), { id: randomId(), columnId, text: text.trim().slice(0, 2000), color: null, createdAt: new Date().toISOString() }]);
    } else {
      ops.shareCard({ columnId, text, color: null });
    }
  };
  const vote = (cardId: string, d: 1 | -1) => {
    try {
      ops.vote(cardId, d);
    } catch (e) {
      toastError(e);
    }
  };

  const onDropColumn = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const id = e.dataTransfer.getData('text/card');
    const card = view.cards.find((c) => c.id === id);
    if (card && card.columnId !== columnId) ops.updateCard(id, { columnId });
    else if (card?.groupId) ops.ungroup(id);
    const draft = drafts.find((d) => d.id === id);
    if (draft) setDrafts(drafts.map((d) => (d.id === id ? { ...d, columnId } : d)));
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap">
        {drafts.length > 0 && !closed && <button className="primary sm" onClick={shareAll}>{tn('Share my {n} draft', 'Share my {n} drafts', drafts.length)}</button>}
        {votingOpen && (
          <span className="badge accent">
            {votesLeft === null ? t('Unlimited votes') : tn('{n} vote left', '{n} votes left', votesLeft)}
            {meta.settings.secretVoting && !meta.settings.votesRevealed ? ` · ${t('secret')}` : ''}
          </span>
        )}
        {canFacilitate && votingOpen && meta.settings.secretVoting && !meta.settings.votesRevealed && (
          <button className="sm" onClick={() => ops.settings({ votesRevealed: true })}>{t('Reveal votes')}</button>
        )}
        <span className="spacer" />
        {isRetro && meta.phase === 'write' && !closed && <span className="small muted">{open ? t('Open board: notes appear for everyone as you post them.') : t('New cards are private drafts in your browser until you share them.')}</span>}
        {canFacilitate && !closed && <button className="sm" onClick={() => setAddingColumn(true)}>{t('+ Column')}</button>}
      </div>

      {view.columns.length === 0 ? (
        <div className="card empty">{t('No columns yet.')} {canFacilitate ? t('Add one to start collecting cards.') : t('The facilitator will add some.')}</div>
      ) : (
        <div className={`board${open ? ' wall' : ''}${maxIndex >= 0 ? ' has-max' : ''}`}>
          {view.columns.map((col, idx) => {
            const shown: Shown[] = [
              ...drafts.filter((d) => d.columnId === col.id).map((d) => ({ ...d, draft: true as const, mine: true as const, groupId: null, groupTitle: null, authorName: null })),
              ...view.cards.filter((c) => c.columnId === col.id).map((c) => ({ ...c, draft: false as const, mine: mine.has(c.id) })),
            ];
            return (
              <ColumnView
                key={col.id}
                col={col}
                maximized={col.id === maxCol}
                onMaximize={(on) => setMaxCol(on ? col.id : null)}
                onStep={(d) => { const c = view.columns[idx + d]; if (c) setMaxCol(c.id); }}
                index={idx}
                count={view.columns.length}
                cards={shown}
                view={view}
                ops={ops}
                closed={closed}
                canFacilitate={canFacilitate}
                votingOpen={votingOpen}
                showTotals={showTotals}
                sortByVotes={sortByVotes}
                myVotes={myVotes}
                othersDrafts={othersDrafts[col.id] ?? 0}
                typing={typing.filter((t) => t.columnId === col.id)}
                onTyping={(text) => reportTyping(col.id, text)}
                dragOver={dragOverCol === col.id}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('text/card')) { e.preventDefault(); setDragOverCol(col.id); } }}
                onDragLeave={() => setDragOverCol(null)}
                onDrop={(e) => onDropColumn(e, col.id)}
                onAdd={(t) => addCard(col.id, t)}
                onShare={share}
                onEditDraft={(id, text) => setDrafts(drafts.map((d) => (d.id === id ? { ...d, text } : d)))}
                onDeleteDraft={(id) => setDrafts(drafts.filter((d) => d.id !== id))}
                onVote={vote}
                onMakeAction={setActionFor}
                placeholder={privateDrafts ? t('Write a private draft… (Enter to save)') : open ? t('Write a note… (Enter to post)') : t('Write a card… (Enter to add)')}
              />
            );
          })}
        </div>
      )}

      {addingColumn && <ColumnModal onClose={() => setAddingColumn(false)} onSave={(v) => { ops.addColumn(v); setAddingColumn(false); }} />}
      {actionFor && (
        <Modal title={t('New action from card')} onClose={() => setActionFor(null)}>
          <p className="muted">“{actionFor.text}”</p>
          <NewActionForm ops={ops} cardId={actionFor.id} initialText={actionFor.text} autoFocus onCreated={() => { setActionFor(null); toast(t('Action added')); }} />
        </Modal>
      )}
    </div>
  );
}

function ColumnView(props: {
  col: Column; maximized: boolean; onMaximize: (on: boolean) => void; onStep: (d: 1 | -1) => void; index: number; count: number; cards: Shown[]; view: View; ops: Ops; closed: boolean; canFacilitate: boolean;
  votingOpen: boolean; showTotals: boolean; sortByVotes: boolean; myVotes: Record<string, number>; othersDrafts: number;
  typing: Typing[]; onTyping: (text: string) => void;
  dragOver: boolean; onDragOver: (e: React.DragEvent) => void; onDragLeave: () => void; onDrop: (e: React.DragEvent) => void;
  onAdd: (text: string) => void; onShare: (d: Draft) => void; onEditDraft: (id: string, text: string) => void; onDeleteDraft: (id: string) => void;
  onVote: (cardId: string, d: 1 | -1) => void; onMakeAction: (c: Card) => void; placeholder: string;
}) {
  const { col, ops, view } = props;
  const [editing, setEditing] = useState(false);
  const units = useMemo(() => {
    const groups = new Map<string, Shown[]>();
    const singles: Shown[] = [];
    for (const c of props.cards) {
      if (c.groupId) groups.set(c.groupId, [...(groups.get(c.groupId) ?? []), c]);
      else singles.push(c);
    }
    const score = (cs: Shown[]) => cs.reduce((n, c) => n + (view.votes[c.id] ?? 0), 0);
    const list = [
      ...[...groups.entries()].map(([k, cs]) => ({ key: k, cards: cs, score: score(cs), created: cs[0].createdAt, draft: false })),
      ...singles.map((c) => ({ key: c.id, cards: [c], score: score([c]), created: c.createdAt, draft: c.draft })),
    ];
    list.sort((a, b) => {
      if (a.draft !== b.draft) return a.draft ? -1 : 1;
      if (props.sortByVotes && b.score !== a.score) return b.score - a.score;
      return a.created.localeCompare(b.created);
    });
    return list;
  }, [props.cards, view.votes, props.sortByVotes]);

  const renderCard = (c: Shown) => (
    <CardView key={c.id} card={c} {...props} />
  );

  return (
    <section className={`board-col${props.dragOver ? ' drop' : ''}${props.maximized ? ' maximized' : ''}`} onDragOver={props.onDragOver} onDragLeave={props.onDragLeave} onDrop={props.onDrop} aria-label={col.title}>
      <header>
        <div className="row">
          <h3 style={{ flex: 1 }}>{col.title}</h3>
          <span className="faint small">{props.cards.filter((c) => !c.draft).length}</span>
          {props.maximized && (
            <span className="row max-nav" style={{ gap: 2 }}>
              <button className="ghost sm" disabled={props.index === 0} aria-label={t('Previous column')} onClick={() => props.onStep(-1)}>{t('‹ Previous')}</button>
              <span className="faint small">{props.index + 1} / {props.count}</span>
              <button className="ghost sm" disabled={props.index === props.count - 1} aria-label={t('Next column')} onClick={() => props.onStep(1)}>{t('Next ›')}</button>
            </span>
          )}
          {!props.maximized && props.canFacilitate && !props.closed && (
            <span className="col-tools">
              <button className="ghost icon sm" aria-label={t('Move column left')} disabled={props.index === 0} onClick={() => ops.moveColumn(col.id, props.index - 1)}>‹</button>
              <button className="ghost icon sm" aria-label={t('Move column right')} disabled={props.index === props.count - 1} onClick={() => ops.moveColumn(col.id, props.index + 1)}>›</button>
              <button className="ghost sm" aria-label={t('Edit column')} onClick={() => setEditing(true)}>{t('Edit')}</button>
            </span>
          )}
          <button className={`ghost sm max-toggle${props.maximized ? ' on' : ''}`} onClick={() => props.onMaximize(!props.maximized)}
          aria-label={props.maximized ? t('Exit full screen for {column}', { column: col.title }) : t('Show {column} full screen', { column: col.title })} title={props.maximized ? t('Back to the board (Esc)') : t('Show this column full screen')}>
          {props.maximized ? t('Exit full screen') : (
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /></svg>
          )}
        </button>
        </div>
        {col.description && <p className="desc">{col.description}</p>}
      </header>
      <div className="cards">
        {!props.closed && <Composer onAdd={props.onAdd} placeholder={props.placeholder} onTyping={props.onTyping} />}
        {props.typing.map((w) => (
          <article key={w.id} className="bcard typing" aria-label={t('{name} is writing', { name: w.name })}>
            <div className="text">{w.text ?? ''}<span className="caret" aria-hidden="true" /></div>
            <div className="foot"><span className="name-tag">{w.name}</span><span className="faint">{t('is writing…')}</span></div>
          </article>
        ))}
        {props.othersDrafts > 0 && <div className="hidden-drafts">{tn('{n} private draft from others', '{n} private drafts from others', props.othersDrafts)}</div>}
        {units.map((u) =>
          u.cards.length > 1 ? (
            <Group key={u.key} cards={u.cards} total={props.showTotals ? u.score : null} ops={ops} editable={props.canFacilitate && !props.closed}>
              {u.cards.map(renderCard)}
            </Group>
          ) : renderCard(u.cards[0]),
        )}
      </div>
      {editing && (
        <ColumnModal
          col={col}
          onClose={() => setEditing(false)}
          onSave={(v) => { ops.updateColumn(col.id, v); setEditing(false); }}
          onDelete={async () => { if (await ask(t('Delete column “{column}” and its cards?', { column: col.title }))) { ops.deleteColumn(col.id); setEditing(false); } }}
        />
      )}
    </section>
  );
}

function Composer({ onAdd, placeholder, onTyping }: { onAdd: (t: string) => void; placeholder: string; onTyping: (t: string) => void }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  if (!open) return <button className="ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => setOpen(true)}>{t('+ Add card')}</button>;
  const add = () => { if (text.trim()) onAdd(text); setText(''); };
  const close = () => { add(); setOpen(false); onTyping(''); };
  return (
    <div className="composer col" style={{ gap: 4 }}>
      <textarea
        ref={box} autoFocus value={text} maxLength={2000} placeholder={placeholder} aria-label={t('New card')}
        onChange={(e) => { setText(e.target.value); onTyping(e.target.value); }}
        onBlur={() => onTyping('')}
        onFocus={() => onTyping(text)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); }
          if (e.key === 'Escape') { setOpen(false); setText(''); onTyping(''); }
        }}
      />
      <div className="row"><span className="faint small">{t('Enter to add · Shift+Enter for a new line · **Markdown** and :rocket: work')}</span><span className="spacer" />
        <button className="sm primary" disabled={!text.trim()} onMouseDown={(e) => e.preventDefault()} onClick={() => { add(); box.current?.focus(); }}>{t('Add')}</button>
        <button className="sm ghost" onClick={close}>{t('Done')}</button>
      </div>
    </div>
  );
}

function Group(props: { cards: Shown[]; total: number | null; ops: Ops; editable: boolean; children: React.ReactNode }) {
  const leader = props.cards.find((c) => c.id === c.groupId) ?? props.cards[0];
  const [title, setTitle] = useState(leader.groupTitle ?? '');
  useEffect(() => setTitle(leader.groupTitle ?? ''), [leader.groupTitle]);
  return (
    <div className="group">
      <div className="group-title">
        {props.editable ? (
          <input value={title} placeholder={t('Name this group')} aria-label={t('Group name')} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== (leader.groupTitle ?? '') && props.ops.groupTitle(leader.id, title)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        ) : <span>{leader.groupTitle || t('Group')}</span>}
        {props.total !== null && <span className="badge accent">{props.total}</span>}
      </div>
      {props.children}
    </div>
  );
}

function CardView(props: {
  card: Shown; ops: Ops; view: View; closed: boolean; canFacilitate: boolean; votingOpen: boolean; showTotals: boolean;
  myVotes: Record<string, number>; onShare: (d: Draft) => void; onEditDraft: (id: string, text: string) => void;
  onDeleteDraft: (id: string) => void; onVote: (cardId: string, d: 1 | -1) => void; onMakeAction: (c: Card) => void;
}) {
  const { card, ops, closed } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(card.text);
  const [menu, setMenu] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);
  const canEdit = card.mine && !closed;
  const canDelete = (card.mine || props.canFacilitate) && !closed;
  const draggable = !closed && (card.draft || props.canFacilitate || card.mine);
  const total = props.view.votes[card.id] ?? 0;
  const mineVotes = props.myVotes[card.id] ?? 0;

  const saveText = () => {
    setEditing(false);
    if (!text.trim() || text === card.text) return;
    if (card.draft) props.onEditDraft(card.id, text.trim());
    else ops.updateCard(card.id, { text: text.trim() });
  };

  return (
    <article
      data-find={card.id}
      className={`bcard${card.draft ? ' draft' : ''}${dropTarget ? ' drop' : ''}`}
      style={card.color ? { ['--card' as any]: card.color } : undefined}
      draggable={draggable}
      onDragStart={(e) => { e.dataTransfer.setData('text/card', card.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => {
        if (card.draft || !props.canFacilitate || closed || !e.dataTransfer.types.includes('text/card')) return;
        e.preventDefault(); e.stopPropagation(); setDropTarget(true);
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        setDropTarget(false);
        const id = e.dataTransfer.getData('text/card');
        if (!id || id === card.id || card.draft || !props.canFacilitate || !props.view.cards.some((c) => c.id === id)) return;
        e.preventDefault(); e.stopPropagation();
        ops.group(id, card.id);
      }}
    >
      {editing ? (
        <textarea autoFocus value={text} aria-label={t('Edit card')} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveText(); }
            if (e.key === 'Escape') { setText(card.text); setEditing(false); }
          }}
          onBlur={saveText} />
      ) : (
        <div className="text" onDoubleClick={() => canEdit && (setText(card.text), setEditing(true))}><Md text={card.text} /></div>
      )}
      <div className="foot">
        {card.draft && <span className="badge">{t('Draft · only you')}</span>}
        {!card.draft && (card.authorName || card.mine) && <span className="name-tag">{card.mine ? t('You') : card.authorName}</span>}
        <span className="spacer" />
        {card.draft && !closed && <button className="sm primary" onClick={() => props.onShare(card)}>{t('Share')}</button>}
        {!card.draft && (props.votingOpen || total > 0 || mineVotes > 0) && (
          <span className="votes">
            {props.votingOpen && <button className="ghost icon sm" aria-label={t('Remove vote')} disabled={mineVotes === 0} onClick={() => props.onVote(card.id, -1)}>−</button>}
            <span className="count" title={props.showTotals ? t('Total votes') : t('Your votes (totals hidden until revealed)')}>{props.showTotals ? total : mineVotes}</span>
            {props.showTotals && mineVotes > 0 && <span className="faint small">{t('({n} mine)', { n: mineVotes })}</span>}
            {props.votingOpen && <button className="ghost icon sm" aria-label={t('Add vote')} onClick={() => props.onVote(card.id, 1)}>+</button>}
          </span>
        )}
        {!closed && (
          <span style={{ position: 'relative' }}>
            <button className="ghost icon sm" aria-label={t('Card options')} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>⋯</button>
            {menu && (
              <div className="panel col" style={{ position: 'absolute', right: 0, top: 28, zIndex: 10, padding: 6, gap: 2, minWidth: 170, boxShadow: 'var(--shadow-lg)' }} onMouseLeave={() => setMenu(false)}>
                {canEdit && <button className="ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); setText(card.text); setEditing(true); }}>{t('Edit')}</button>}
                {!card.draft && <button className="ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); props.onMakeAction(card as Card); }}>{t('Create action…')}</button>}
                {!card.draft && card.groupId && props.canFacilitate && <button className="ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => { setMenu(false); ops.ungroup(card.id); }}>{t('Remove from group')}</button>}
                {!card.draft && (card.mine || props.canFacilitate) && (
                  <div className="color-row" style={{ padding: '4px 8px' }}>
                    {CARD_COLORS.map((c) => (
                      <button key={c ?? 'none'} aria-label={c ? t('Colour {color}', { color: c }) : t('No colour')} aria-pressed={card.color === c}
                        style={{ background: c ?? 'var(--surface-2)', border: '1px solid var(--border)' }} onClick={() => ops.updateCard(card.id, { color: c })} />
                    ))}
                  </div>
                )}
                {canDelete && <button className="ghost sm danger" style={{ justifyContent: 'flex-start' }} onClick={async () => {
                  setMenu(false);
                  if (!(await ask(t('Delete this card?')))) return;
                  if (card.draft) props.onDeleteDraft(card.id);
                  else ops.deleteCard(card.id);
                }}>{t('Delete')}</button>}
              </div>
            )}
          </span>
        )}
      </div>
    </article>
  );
}

function ColumnModal(props: { col?: Column; onClose: () => void; onSave: (v: { title: string; description: string; color: string }) => void; onDelete?: () => void }) {
  const [title, setTitle] = useState(props.col?.title ?? '');
  const [description, setDescription] = useState(props.col?.description ?? '');
  // Columns keep a colour in the data (exports, older versions) but the board no longer shows it.
  const color = props.col?.color ?? '#6b7280';
  return (
    <Modal title={props.col ? t('Edit column') : t('New column')} onClose={props.onClose}>
      <form className="col" onSubmit={(e) => (e.preventDefault(), props.onSave({ title, description, color }))}>
        <label className="field">{t('Title')}<input required autoFocus maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field">{t('Description')}<input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className="row">
          {props.onDelete && <button type="button" className="danger" onClick={props.onDelete}>{t('Delete column')}</button>}
          <span className="spacer" />
          <button type="button" onClick={props.onClose}>{t('Cancel')}</button>
          <button className="primary" type="submit">{t('Save')}</button>

        </div>
      </form>
    </Modal>
  );
}
