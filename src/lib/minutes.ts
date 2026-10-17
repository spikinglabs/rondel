import * as Y from 'yjs';
import { maps, type ActionItem, type View } from './model';
import { t, tn } from './i18n';

const esc = (s: string) => s.replace(/\r?\n/g, ' ').trim();
const fmt = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '');

/** Markdown minutes. `participants` are the names of everyone who opened the meeting. */
export function minutesMarkdown(doc: Y.Doc, view: View, participants: string[] = []): string {
  const { meta } = view;
  const notes = maps(doc).notes;
  const out: string[] = [`# ${meta.title}`, ''];
  if (meta.seriesName) out.push(`- **${t('Series')}:** ${meta.seriesName}`);
  out.push(`- **${t('Date')}:** ${fmt(meta.createdAt)}`);
  if (meta.closedAt) out.push(`- **${t('Closed')}:** ${fmt(meta.closedAt)}`);
  if (participants.length) out.push(`- **${t('Participants')}:** ${participants.join(', ')}`);
  out.push('');

  if (view.agenda.length) {
    out.push(`## ${t('Agenda and notes')}`, '');
    for (const a of view.agenda) {
      out.push(`### ${a.done ? '✓ ' : ''}${a.title}${a.owner ? ` (${a.owner})` : ''}`);
      const n = notes.get(a.id)?.toString().trim();
      if (n) out.push('', n);
      const ds = view.decisions.filter((d) => d.agendaItemId === a.id);
      if (ds.length) out.push('', ...ds.map((d) => `- **${t('Decision')}:** ${esc(d.text)}`));
      out.push(...ideaLines(view, a.id));
      out.push('');
    }
  }

  if (view.columns.length) {
    out.push(`## ${t('Board')}`, '');
    for (const col of view.columns) {
      const cards = view.cards.filter((c) => c.columnId === col.id);
      out.push(`### ${col.title}`, '');
      if (!cards.length) out.push(`_${t('No cards')}_`);
      const groups = new Map<string, typeof cards>();
      for (const c of cards) groups.set(c.groupId ?? c.id, [...(groups.get(c.groupId ?? c.id) ?? []), c]);
      const entries = [...groups.values()]
        .map((cs) => ({ cs, votes: cs.reduce((n, c) => n + (view.votes[c.id] ?? 0), 0), title: cs.find((c) => c.groupTitle)?.groupTitle }))
        .sort((a, b) => b.votes - a.votes);
      const v = (n: number) => (n ? ` — ${tn('{n} vote', '{n} votes', n)}` : '');
      for (const e of entries) {
        if (e.cs.length > 1) {
          out.push(`- **${e.title ?? t('Group')}**${v(e.votes)}`);
          for (const c of e.cs) out.push(`  - ${esc(c.text)}${c.authorName ? ` (${c.authorName})` : ''}`);
        } else {
          const c = e.cs[0];
          out.push(`- ${esc(c.text)}${c.authorName ? ` (${c.authorName})` : ''}${v(e.votes)}`);
        }
      }
      out.push('');
    }
  }

  const loose = ideaLines(view, null);
  if (loose.length) out.push(`## ${t('Brainstorm')}`, ...loose, '');

  const general = view.decisions.filter((d) => !d.agendaItemId);
  if (general.length) out.push(`## ${t('Decisions')}`, '', ...general.map((d) => `- ${esc(d.text)}`), '');

  // Action items as a table: it pastes into email as a real table.
  const cell = (s: string) => esc(s).replace(/\|/g, '/');
  const table = (as: ActionItem[]) => [
    `| ${t('Done')} | ${t('Action')} | ${t('Owner')} | ${t('Due')} |`,
    '| --- | --- | --- | --- |',
    ...as.map((a) => `| ${a.status === 'done' ? '☑' : a.status === 'dropped' ? t('Dropped') : '☐'} | ${cell(a.text)} | ${a.owner ? cell(a.owner) : ''} | ${a.due ?? ''} |`),
  ];
  const fresh = view.actions.filter((a) => !a.carriedFrom);
  const carried = view.actions.filter((a) => a.carriedFrom);
  if (fresh.length) out.push(`## ${t('Action items')}`, '', ...table(fresh), '');
  if (carried.length) out.push(`## ${t('Actions from previous meetings')}`, '', ...table(carried), '');
  return out.join('\n');
}

/** A brainstorm's ideas, most dots first, with what became of them. */
function ideaLines(view: View, itemId: string | null): string[] {
  const ideas = view.ideas.filter((i) => i.itemId === itemId).sort((a, b) => (view.ideaVotes[b.id] ?? 0) - (view.ideaVotes[a.id] ?? 0));
  if (!ideas.length) return [];
  return ['', `**${t('Ideas')}**`, '', ...ideas.map((i) => {
    const n = view.ideaVotes[i.id] ?? 0;
    return `- ${esc(i.text)}${n ? ` — ${tn('{n} dot', '{n} dots', n)}` : ''}${i.picked === 'action' ? ` ${t('→ action')}` : i.picked === 'agenda' ? ` ${t('→ agenda')}` : ''}`;
  })];
}

/** Action items as CSV for Excel, Jira, Planner or Azure DevOps import. Starts with a BOM so Excel reads UTF-8. */
export function actionsCsv(view: View): string {
  const q = (s: string) => (/[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const status = { open: t('Open'), done: t('Done'), dropped: t('Dropped') } as Record<string, string>;
  const rows = [
    [t('Action'), t('Owner'), t('Due'), t('Status'), t('Meeting'), t('Created')],
    ...view.actions.map((a) => [esc(a.text), a.owner, a.due ?? '', status[a.status] ?? a.status, a.carriedFrom ?? view.meta.title, a.createdAt.slice(0, 10)]),
  ];
  return '﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
