import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { initMeeting, readView } from '../src/lib/model';
import { BUILTIN_TEMPLATES } from '../src/lib/templates';

const builtin = (id: string) => BUILTIN_TEMPLATES.find((t) => t.template.id === id)!.template;
import { LimitError, meetingOps } from '../src/lib/ops';
import { actionsCsv, minutesMarkdown } from '../src/lib/minutes';
import { docFromFile, exportMeeting, parseMeetingFile } from '../src/lib/files';

const me = { id: 'u1', name: 'Ana' };

function retro(roomId = 'room1') {
  const doc = new Y.Doc();
  initMeeting(doc, { title: 'Sprint 12 retro', template: builtin('start-stop-continue'), creatorId: me.id });
  return { doc, ops: meetingOps(doc, roomId, me) };
}

/** Connect two docs the way peers do: every update is applied to the other side. */
function link(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  a.on('update', (u: Uint8Array, origin: unknown) => origin !== 'peer' && Y.applyUpdate(b, u, 'peer'));
  b.on('update', (u: Uint8Array, origin: unknown) => origin !== 'peer' && Y.applyUpdate(a, u, 'peer'));
}

test('every template creates a valid meeting', () => {
  assert.ok(BUILTIN_TEMPLATES.length >= 12);
  for (const { template: t } of BUILTIN_TEMPLATES) {
    const doc = new Y.Doc();
    initMeeting(doc, { title: '', template: t, creatorId: 'x' });
    const v = readView(doc)!;
    assert.equal(v.meta.type, t.type);
    assert.equal(v.columns.length, t.columns.length);
    assert.equal(v.agenda.length, t.agenda.length);
    assert.deepEqual(v.meta.facilitators, ['x']);
    assert.ok(v.meta.title.length > 0);
  }
});

test('cards are anonymous unless the meeting shows authors', () => {
  const { doc, ops } = retro();
  const col = readView(doc)!.columns[0].id;
  ops.shareCard({ columnId: col, text: 'anon', color: null });
  ops.settings({ showAuthors: true });
  ops.shareCard({ columnId: col, text: 'named', color: null });
  const cards = readView(doc)!.cards;
  assert.equal(cards.find((c) => c.text === 'anon')!.authorName, null);
  assert.equal(cards.find((c) => c.text === 'named')!.authorName, 'Ana');
  assert.ok(!JSON.stringify(Y.encodeStateAsUpdate(doc)).includes('u1|'), 'votes never use the user id');
});

test('vote limits per person and per card', () => {
  const { doc, ops } = retro('room-votes');
  const col = readView(doc)!.columns[0].id;
  ops.settings({ votesPerUser: 3, votesPerCard: 2 });
  const a = ops.shareCard({ columnId: col, text: 'a', color: null });
  const b = ops.shareCard({ columnId: col, text: 'b', color: null });
  ops.vote(a, 1);
  ops.vote(a, 1);
  assert.throws(() => ops.vote(a, 1), LimitError);
  ops.vote(b, 1);
  assert.throws(() => ops.vote(b, 1), LimitError);
  ops.vote(a, -1);
  ops.vote(b, 1);
  const v = readView(doc)!;
  assert.equal(v.votes[a], 1);
  assert.equal(v.votes[b], 2);
});

test('grouping, ungrouping and deleting keep groups consistent', () => {
  const { doc, ops } = retro();
  const [c1, c2] = readView(doc)!.columns;
  const a = ops.shareCard({ columnId: c1.id, text: 'a', color: null });
  const b = ops.shareCard({ columnId: c2.id, text: 'b', color: null });
  const c = ops.shareCard({ columnId: c2.id, text: 'c', color: null });
  ops.group(b, a);
  ops.group(c, a);
  ops.groupTitle(b, 'Release pain');
  let cards = readView(doc)!.cards;
  assert.ok(cards.every((x) => x.groupId === a && x.columnId === c1.id));
  assert.equal(cards.find((x) => x.id === a)!.groupTitle, 'Release pain');
  ops.ungroup(a);
  cards = readView(doc)!.cards;
  const leader = cards.find((x) => x.id === b)!;
  assert.equal(leader.groupId, b);
  assert.equal(leader.groupTitle, 'Release pain');
  assert.equal(cards.find((x) => x.id === a)!.groupId, null);
  ops.deleteCard(c);
  assert.equal(readView(doc)!.cards.find((x) => x.id === b)!.groupId, null, 'a group of one dissolves');
});

test('two peers editing at once converge, including shared notes', () => {
  const { doc: a, ops: opsA } = retro();
  const b = new Y.Doc();
  link(a, b);
  const opsB = meetingOps(b, 'room1', { id: 'u2', name: 'Ben' });
  const item = readView(a)!.agenda[0].id;
  opsA.setCurrent(item);
  opsA.notesFor(item).insert(0, 'Hello');
  opsB.notesFor(item).insert(5, ' world');
  opsB.addAction({ text: 'Fix CI', owner: 'Ben' });
  opsA.addDecision('Ship Friday', item);
  const va = readView(a)!;
  const vb = readView(b)!;
  assert.deepEqual(va, vb);
  assert.equal(a.getMap<Y.Text>('notes').get(item)!.toString(), 'Hello world');
  assert.equal(va.meta.currentAgendaId, item);
  assert.ok(va.meta.timer.running);
});

test('phases bump the ready round and reveal votes for discussion', () => {
  const { doc, ops } = retro();
  ops.settings({ secretVoting: true });
  ops.phase('vote');
  assert.equal(readView(doc)!.meta.settings.votesRevealed, false);
  ops.phase('discuss');
  const m = readView(doc)!.meta;
  assert.equal(m.settings.votesRevealed, true);
  assert.equal(m.readyEpoch, 2);
});

test('meeting files round-trip and reject other files', () => {
  const { doc, ops } = retro();
  ops.addAction({ text: 'Write runbook', owner: 'Ana', due: '2026-11-01' });
  const text = JSON.stringify(exportMeeting(doc, 'room1', 'secret'));
  const f = parseMeetingFile(text);
  assert.equal(f.roomId, 'room1');
  assert.equal(f.key, 'secret');
  assert.deepEqual(readView(docFromFile(f)), readView(doc));
  assert.throws(() => parseMeetingFile('{"hello":1}'), /not a Rondel meeting file/);
  assert.throws(() => parseMeetingFile('not json'), /not a Rondel meeting file/);
});

test('the next meeting carries open actions and uncovered topics', () => {
  const { doc, ops } = retro();
  ops.addAction({ text: 'Open one', owner: 'Ana' });
  ops.addAction({ text: 'Done one' });
  const done = readView(doc)!.actions.find((a) => a.text === 'Done one')!;
  ops.updateAction(done.id, { status: 'done' });
  ops.addAgenda('Leftover topic');
  ops.settings({ votesPerUser: 7 });
  ops.close();
  const prev = readView(doc)!;
  const next = new Y.Doc();
  initMeeting(next, { title: 'Sprint 13 retro', template: builtin('start-stop-continue'), creatorId: 'u1', previous: prev });
  const v = readView(next)!;
  assert.deepEqual(v.actions.map((a) => [a.text, a.carriedFrom]), [['Open one', 'Sprint 12 retro']]);
  assert.ok(v.agenda.some((a) => a.title === 'Leftover topic'));
  assert.equal(v.meta.settings.votesPerUser, 7);
  assert.equal(v.meta.previousTitle, 'Sprint 12 retro');
  assert.equal(v.meta.status, 'live');
});

test('minutes include decisions, votes, actions and carried items', () => {
  const { doc, ops } = retro();
  const v0 = readView(doc)!;
  const item = v0.agenda[0];
  const card = ops.shareCard({ columnId: v0.columns[0].id, text: 'Deploys are slow', color: null });
  ops.vote(card, 1);
  ops.notesFor(item.id).insert(0, 'We talked about deploys');
  ops.addDecision('Adopt trunk-based development', item.id);
  ops.addAction({ text: 'Set up canary', owner: 'Ben', due: '2026-11-02' });
  ops.close();
  const md = minutesMarkdown(doc, readView(doc)!, ['Ana', 'Ben']);
  for (const s of ['Sprint 12 retro', 'Ana, Ben', 'We talked about deploys', 'Adopt trunk-based development', 'Deploys are slow', '1 vote', '| ☐ | Set up canary | Ben | 2026-11-02 |']) {
    assert.ok(md.includes(s), `minutes should include ${s}\n${md}`);
  }
});

test('two people opening the same topic at once type into the same notes', () => {
  const { doc: a, ops: opsA } = retro();
  const b = new Y.Doc();
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const opsB = meetingOps(b, 'room1', { id: 'u2', name: 'Ben' });
  opsA.addAgenda('New topic');
  const id = readView(a)!.agenda.find((x) => x.title === 'New topic')!.id;
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  // Both open the topic while not yet connected, then sync.
  opsA.notesFor(id).insert(0, 'from Ana.');
  opsB.notesFor(id).insert(0, 'from Ben.');
  link(a, b);
  const text = a.getMap<Y.Text>('notes').get(id)!.toString();
  assert.equal(text, b.getMap<Y.Text>('notes').get(id)!.toString());
  assert.ok(text.includes('from Ana.') && text.includes('from Ben.'), text);
});

test('actions export as CSV that Excel and Jira can read', () => {
  const { doc, ops } = retro();
  ops.addAction({ text: 'Fix the "flaky" test, then rerun', owner: 'Ben', due: '2026-10-30' });
  ops.addAction({ text: 'Line one\nline two; with semicolon' });
  const csv = actionsCsv(readView(doc)!);
  const lines = csv.split('\r\n');
  assert.equal(lines[0], '﻿Action,Owner,Due,Status,Meeting,Created');
  assert.match(lines[1], /^"Fix the ""flaky"" test, then rerun",Ben,2026-10-30,Open,Sprint 12 retro,\d{4}-\d\d-\d\d$/);
  assert.match(lines[2], /^"Line one line two; with semicolon",,,Open,Sprint 12 retro,/);
  assert.equal(lines.at(-1), '');
});
