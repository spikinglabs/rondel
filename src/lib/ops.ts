import * as Y from 'yjs';
import {
  IDEA_DOTS, brainstormKey, idleTimer, isBoardActivity, maps, nextPosition, positionAt, randomId, readMeta, readView,
  type ActionItem, type AgendaItem, type Brainstorm, type Card, type Column, type RetroPhase, type Settings, type Timer,
} from './model';
import { addMine, voterId } from './store';
import { t } from './i18n';

const COLORS = ['#3b7dd8', '#2f9e6b', '#d4504a', '#d99a1e', '#8a5cd1', '#1f9aa5', '#c2557f', '#6b7280'];

export class LimitError extends Error {}

/** All changes to a meeting go through here. Everyone can edit; facilitator-only controls are a UI convention. */
export function meetingOps(doc: Y.Doc, roomId: string, me: { id: string; name: string }) {
  const m = maps(doc);
  const meta = () => readMeta(doc)!;
  const setMeta = (k: string, v: unknown) => m.meta.set(k, v);
  const patch = <T extends object>(map: Y.Map<T>, id: string, p: Partial<T>) => {
    const cur = map.get(id);
    if (cur) map.set(id, { ...cur, ...p });
  };
  const timer = () => meta().timer;
  const saveTimer = (t: Timer) => setMeta('timer', t);

  return {
    // ---- meeting
    rename: (title: string) => title.trim() && setMeta('title', title.trim().slice(0, 200)),
    settings: (s: Partial<Settings>) => setMeta('settings', { ...meta().settings, ...s }),
    phase: (p: RetroPhase) =>
      doc.transact(() => {
        setMeta('phase', p);
        setMeta('readyEpoch', meta().readyEpoch + 1);
        if ((p === 'discuss' || p === 'actions') && !meta().settings.votesRevealed) setMeta('settings', { ...meta().settings, votesRevealed: true });
      }),
    close: () => doc.transact(() => { setMeta('status', 'closed'); setMeta('closedAt', new Date().toISOString()); saveTimer(idleTimer()); }),
    reopen: () => doc.transact(() => { setMeta('status', 'live'); setMeta('closedAt', null); }),
    /** Note that I am in this meeting (and under which name), at most every five minutes. */
    join: () => {
      if (meta().removed.some((r) => r.id === me.id)) return;
      const cur = m.people.get(me.id);
      const now = new Date().toISOString();
      if (cur && cur.name === me.name && Date.parse(now) - Date.parse(cur.lastSeen) < 5 * 60_000) return;
      m.people.set(me.id, { id: me.id, name: me.name, firstSeen: cur?.firstSeen ?? now, lastSeen: now });
    },
    /** The creator removes someone: they leave the people list and their app closes the meeting for them. */
    removePerson: (id: string) =>
      doc.transact(() => {
        const mt = meta();
        if (id === mt.createdBy) return;
        const name = m.people.get(id)?.name ?? '';
        m.people.delete(id);
        setMeta('facilitators', mt.facilitators.filter((f) => f !== id));
        setMeta('removed', [...mt.removed.filter((r) => r.id !== id), { id, name }]);
      }),
    allowBack: (id: string) => setMeta('removed', meta().removed.filter((r) => r.id !== id)),
    addFacilitator: (id: string) => setMeta('facilitators', [...new Set([...meta().facilitators, id])]),
    clearReady: () => setMeta('readyEpoch', meta().readyEpoch + 1),

    // ---- timer
    timerStart: (ms: number, label: string | null = null) => saveTimer({ running: true, endsAt: Date.now() + ms, remainingMs: ms, durationMs: ms, label }),
    timerPause: () => {
      const t = timer();
      if (t.running && t.endsAt) saveTimer({ ...t, running: false, endsAt: null, remainingMs: Math.max(0, t.endsAt - Date.now()) });
    },
    timerResume: () => {
      const t = timer();
      if (!t.running && t.remainingMs > 0) saveTimer({ ...t, running: true, endsAt: Date.now() + t.remainingMs });
    },
    timerAdd: (ms: number) => {
      const t = timer();
      if (t.running && t.endsAt) saveTimer({ ...t, endsAt: t.endsAt + ms, durationMs: t.durationMs + ms });
      else saveTimer({ ...t, remainingMs: Math.max(0, t.remainingMs + ms), durationMs: t.durationMs + ms });
    },
    timerReset: () => saveTimer(idleTimer()),

    // ---- columns
    addColumn: (c: { title: string; description?: string; color?: string }) => {
      const cols = [...m.columns.values()];
      const id = randomId();
      m.columns.set(id, { id, title: c.title.trim().slice(0, 80), description: (c.description ?? '').slice(0, 300), color: c.color ?? COLORS[cols.length % COLORS.length], position: nextPosition(cols) });
    },
    updateColumn: (id: string, p: Partial<Column>) => patch(m.columns, id, p),
    moveColumn: (id: string, to: number) => {
      const cols = [...m.columns.values()].sort((a, b) => a.position - b.position);
      patch(m.columns, id, { position: positionAt(cols, id, to) });
    },
    deleteColumn: (id: string) =>
      doc.transact(() => {
        m.columns.delete(id);
        m.cards.forEach((c, cid) => c.columnId === id && m.cards.delete(cid));
      }),

    // ---- cards (only shared cards live in the document; drafts stay in this browser)
    shareCard: (d: { id?: string; columnId: string; text: string; color: string | null; createdAt?: string }) => {
      const id = d.id ?? randomId();
      const card: Card = {
        id, columnId: d.columnId, text: d.text.trim().slice(0, 2000), color: d.color,
        authorName: meta().settings.showAuthors || meta().settings.openBoard ? me.name : null,
        groupId: null, groupTitle: null, createdAt: d.createdAt ?? new Date().toISOString(),
      };
      addMine(roomId, id);
      m.cards.set(id, card);
      return id;
    },
    updateCard: (id: string, p: Partial<Card>) =>
      doc.transact(() => {
        const c = m.cards.get(id);
        if (!c) return;
        m.cards.set(id, { ...c, ...p });
        // Moving a grouped card moves its group.
        if (p.columnId && c.groupId) m.cards.forEach((x, xid) => x.groupId === c.groupId && m.cards.set(xid, { ...x, columnId: p.columnId! }));
      }),
    deleteCard: (id: string) =>
      doc.transact(() => {
        const c = m.cards.get(id);
        m.cards.delete(id);
        m.votes.forEach((_, k) => k.startsWith(id + '|') && m.votes.delete(k));
        if (c?.groupId) dissolveSingles();
      }),
    group: (id: string, intoId: string) =>
      doc.transact(() => {
        const c = m.cards.get(id);
        const t = m.cards.get(intoId);
        if (!c || !t || id === intoId) return;
        const gid = t.groupId ?? t.id;
        if (!t.groupId) m.cards.set(t.id, { ...t, groupId: gid });
        const oldGroup = c.groupId;
        m.cards.forEach((x, xid) => {
          if (xid === id || (oldGroup && oldGroup !== gid && x.groupId === oldGroup)) m.cards.set(xid, { ...x, groupId: gid, groupTitle: null, columnId: t.columnId });
        });
        dissolveSingles();
      }),
    ungroup: (id: string) =>
      doc.transact(() => {
        const c = m.cards.get(id);
        if (!c?.groupId) return;
        const title = c.groupId === c.id ? c.groupTitle : null;
        m.cards.set(id, { ...c, groupId: null, groupTitle: null });
        if (c.groupId === c.id) {
          // Hand the group (and its name) to another member.
          const next = [...m.cards.values()].find((x) => x.groupId === c.id);
          if (next) m.cards.forEach((x, xid) => x.groupId === c.id && m.cards.set(xid, { ...x, groupId: next.id, groupTitle: xid === next.id ? title : x.groupTitle }));
        }
        dissolveSingles();
      }),
    groupTitle: (cardId: string, title: string) => {
      const c = m.cards.get(cardId);
      const leader = c?.groupId ?? cardId;
      patch(m.cards, leader, { groupTitle: title.trim().slice(0, 120) || null });
    },

    // ---- votes (keyed by an anonymous per-meeting voter id)
    vote: (cardId: string, delta: 1 | -1) => {
      const v = readView(doc)!;
      const voter = voterId(roomId);
      const key = `${cardId}|${voter}`;
      const cur = m.votes.get(key) ?? 0;
      if (delta > 0) {
        const used = Object.values(v.votesByVoter[voter] ?? {}).reduce((a, b) => a + b, 0);
        if (v.meta.settings.votesPerUser && used >= v.meta.settings.votesPerUser) throw new LimitError(t('You have used all your votes'));
        if (v.meta.settings.votesPerCard && cur >= v.meta.settings.votesPerCard) throw new LimitError(t('Vote limit for this card reached'));
      }
      const next = Math.max(0, cur + delta);
      if (next) m.votes.set(key, next);
      else m.votes.delete(key);
    },

    // ---- agenda
    addAgenda: (title: string, durationMin = 5, activity?: AgendaItem['activity']) => {
      const id = randomId();
      doc.transact(() => {
        m.agenda.set(id, { id, title: title.trim().slice(0, 200), durationMin, owner: '', done: false, position: nextPosition([...m.agenda.values()]), ...(activity && activity !== 'topic' ? { activity } : {}) });
        if (isBoardActivity(activity) && !meta().phase) setMeta('phase', activity);
        // Created together with the item: if two people created it lazily at the same time, one copy would win and the other's typing would be lost.
        m.notes.set(id, new Y.Text());
      });
    },
    updateAgenda: (id: string, p: Partial<AgendaItem>) => patch(m.agenda, id, p),
    moveAgenda: (id: string, to: number) => {
      const items = [...m.agenda.values()].sort((a, b) => a.position - b.position);
      patch(m.agenda, id, { position: positionAt(items, id, to) });
    },
    deleteAgenda: (id: string) =>
      doc.transact(() => {
        m.agenda.delete(id);
        m.notes.delete(id);
        if (meta().currentAgendaId === id) setMeta('currentAgendaId', null);
      }),
    setCurrent: (id: string, startTimer = true) =>
      doc.transact(() => {
        const prev = meta().currentAgendaId;
        if (prev && prev !== id) patch(m.agenda, prev, { done: true });
        setMeta('currentAgendaId', id);
        const a = m.agenda.get(id);
        // Starting a board stage moves the board into that mode.
        if (a && isBoardActivity(a.activity) && meta().phase !== a.activity) {
          setMeta('phase', a.activity);
          setMeta('readyEpoch', meta().readyEpoch + 1);
          if ((a.activity === 'discuss' || a.activity === 'actions') && !meta().settings.votesRevealed) setMeta('settings', { ...meta().settings, votesRevealed: true });
        }
        if (startTimer && a && a.durationMin > 0) {
          const ms = a.durationMin * 60_000;
          saveTimer({ running: true, endsAt: Date.now() + ms, remainingMs: ms, durationMs: ms, label: a.title });
        }
      }),
    /** The shared notes for an agenda item, creating them for items from older meetings that have none. */
    notesFor: (id: string) => {
      let t = m.notes.get(id);
      if (!t) {
        t = new Y.Text();
        m.notes.set(id, t);
      }
      return t;
    },

    // ---- brainstorm: many short ideas, then dots, then the best become actions or agenda items
    addIdea: (text: string, itemId: string | null) => {
      const t = text.trim().slice(0, 500);
      if (!t) return;
      const id = randomId();
      m.ideas.set(id, { id, text: t, itemId, by: voterId(roomId), createdAt: new Date().toISOString() });
    },
    editIdea: (id: string, text: string) => text.trim() && patch(m.ideas, id, { text: text.trim().slice(0, 500) }),
    deleteIdea: (id: string) =>
      doc.transact(() => {
        m.ideas.delete(id);
        for (const k of [...m.ideaVotes.keys()]) if (k.startsWith(`${id}|`)) m.ideaVotes.delete(k);
      }),
    brainstorm: (itemId: string | null, p: Partial<Brainstorm>) => {
      const k = brainstormKey(itemId);
      m.brainstorms.set(k, { step: 'collect', hidden: false, ...m.brainstorms.get(k), ...p });
    },
    /** Dot-vote an idea: IDEA_DOTS dots per person for each brainstorm, any number on one idea. */
    voteIdea: (ideaId: string, delta: 1 | -1) => {
      const idea = m.ideas.get(ideaId);
      if (!idea) return;
      const v = readView(doc)!;
      const voter = voterId(roomId);
      const key = `${ideaId}|${voter}`;
      const cur = m.ideaVotes.get(key) ?? 0;
      if (delta > 0) {
        const mine = v.ideaVotesByVoter[voter] ?? {};
        const used = v.ideas.filter((i) => i.itemId === idea.itemId).reduce((n, i) => n + (mine[i.id] ?? 0), 0);
        if (used >= IDEA_DOTS) throw new LimitError(t('You have used your {n} dots', { n: IDEA_DOTS }));
      }
      const next = Math.max(0, cur + delta);
      if (next) m.ideaVotes.set(key, next);
      else m.ideaVotes.delete(key);
    },
    ideaToAction: (ideaId: string) => {
      const idea = m.ideas.get(ideaId);
      if (!idea) return;
      doc.transact(() => {
        const id = randomId();
        m.actions.set(id, { id, text: idea.text, owner: '', due: null, status: 'open', cardId: null, createdAt: new Date().toISOString(), carriedFrom: null });
        patch(m.ideas, ideaId, { picked: 'action' });
      });
    },
    ideaToAgenda: (ideaId: string) => {
      const idea = m.ideas.get(ideaId);
      if (!idea) return;
      doc.transact(() => {
        const id = randomId();
        m.agenda.set(id, { id, title: idea.text.split('\n')[0].slice(0, 200), durationMin: 10, owner: '', done: false, position: nextPosition([...m.agenda.values()]) });
        m.notes.set(id, new Y.Text());
        patch(m.ideas, ideaId, { picked: 'agenda' });
      });
    },

    // ---- decisions & actions
    addDecision: (text: string, agendaItemId: string | null) => {
      const id = randomId();
      m.decisions.set(id, { id, text: text.trim().slice(0, 2000), agendaItemId, createdAt: new Date().toISOString() });
    },
    deleteDecision: (id: string) => m.decisions.delete(id),
    addAction: (a: { text: string; owner?: string; due?: string | null; cardId?: string | null }) => {
      const id = randomId();
      const item: ActionItem = { id, text: a.text.trim().slice(0, 2000), owner: (a.owner ?? '').trim(), due: a.due || null, status: 'open', cardId: a.cardId ?? null, createdAt: new Date().toISOString(), carriedFrom: null };
      m.actions.set(id, item);
    },
    updateAction: (id: string, p: Partial<ActionItem>) => patch(m.actions, id, p),
    deleteAction: (id: string) => m.actions.delete(id),
  };

  function dissolveSingles() {
    const counts = new Map<string, number>();
    m.cards.forEach((c) => c.groupId && counts.set(c.groupId, (counts.get(c.groupId) ?? 0) + 1));
    m.cards.forEach((c, id) => {
      if (c.groupId && (counts.get(c.groupId) ?? 0) < 2) m.cards.set(id, { ...c, groupId: null, groupTitle: null });
    });
  }
}

export type Ops = ReturnType<typeof meetingOps>;
