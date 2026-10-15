import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { initMeeting, readView } from '../src/lib/model';
import { BUILTIN_TEMPLATES } from '../src/lib/templates';
import { meetingOps } from '../src/lib/ops';
import { basePeriod, nextAfter, nextPeriod, periodLabel, decide, initSeries, isoWeek, occName, occurrenceRoom, periodOf, readSeries, seriesIcs, seriesOps, type Occurrence, type SeriesInfo } from '../src/lib/series';

const template = BUILTIN_TEMPLATES.find((t) => t.template.id === 'start-stop-continue')!.template;
const occ = (o: string, status: Occurrence['status'], createdAt: string): Occurrence => ({ occ: o, title: o, status, createdAt, closedAt: status === 'closed' ? createdAt : null });

test('periods follow the cadence', () => {
  const d = new Date(2026, 9, 15, 9, 30); // Thursday 15 October 2026
  assert.deepEqual(isoWeek(d), [2026, 42]);
  assert.equal(periodOf('weekly', d), '2026-W42');
  assert.equal(periodOf('daily', d), '2026-10-15');
  assert.equal(periodOf('monthly', d), '2026-10');
  assert.equal(periodOf('none', d), 'all');
  assert.deepEqual(isoWeek(new Date(2027, 0, 1)), [2026, 53]);
  // Older two-week series simply make one meeting per week.
  assert.equal(periodOf('biweekly', d), '2026-W42');
});

test('the series link opens, creates, or offers another meeting', () => {
  assert.deepEqual(decide({}, '2026-W42'), { kind: 'create', occ: '2026-W42', n: 1 });
  const week41 = { '2026-W41': occ('2026-W41', 'closed', '2026-10-08T10:00:00Z') };
  assert.deepEqual(decide(week41, '2026-W42'), { kind: 'create', occ: '2026-W42', n: 1 });
  const live = { ...week41, '2026-W42': occ('2026-W42', 'live', '2026-10-15T10:00:00Z') };
  assert.deepEqual(decide(live, '2026-W42'), { kind: 'open', occ: '2026-W42' });
  const closed = { ...week41, '2026-W42': occ('2026-W42', 'closed', '2026-10-15T10:00:00Z') };
  assert.deepEqual(decide(closed, '2026-W42'), { kind: 'closed', last: '2026-W42', next: '2026-W42-2', n: 2 });
  const second = { ...closed, '2026-W42-2': occ('2026-W42-2', 'live', '2026-10-16T10:00:00Z') };
  assert.deepEqual(decide(second, '2026-W42'), { kind: 'open', occ: '2026-W42-2' });
  assert.equal(occName('all', 3), 'all-3');
});

test('everyone with the series key derives the same room; other keys and weeks do not', async () => {
  const a = await occurrenceRoom('series-key-1', '2026-W42');
  assert.deepEqual(a, await occurrenceRoom('series-key-1', '2026-W42'));
  assert.notEqual(a.roomId, (await occurrenceRoom('series-key-1', '2026-W43')).roomId);
  assert.notEqual(a.roomId, (await occurrenceRoom('series-key-2', '2026-W42')).roomId);
  assert.match(a.roomId, /^[\w-]{16}$/);
  assert.match(a.key, /^[\w-]{24}$/);
});

test('two people starting the same series meeting at once get one agenda', () => {
  const prevDoc = new Y.Doc();
  initMeeting(prevDoc, { title: 'Week 41', template, creatorId: 'ana' });
  meetingOps(prevDoc, 'r0', { id: 'ana', name: 'Ana' }).addAction({ text: 'Book the room', owner: 'Ben' });
  const previous = readView(prevDoc)!;
  const input = { title: 'Week 42', template, creatorId: 'x', facilitators: ['ana'], seed: 'room42', series: { id: 's', key: 'k', occ: '2026-W42' }, previous };
  const a = new Y.Doc();
  const b = new Y.Doc();
  initMeeting(a, { ...input, creatorId: 'ben' });
  initMeeting(b, { ...input, creatorId: 'cleo' });
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const v = readView(a)!;
  assert.equal(v.agenda.length, template.agenda.length);
  assert.equal(v.columns.length, template.columns.length);
  assert.equal(v.actions.length, 1);
  assert.equal(v.actions[0].carriedFrom, 'Week 41');
  assert.deepEqual(v.meta.facilitators, ['ana']);
  assert.deepEqual(v.meta.series, { id: 's', key: 'k', occ: '2026-W42' });
  assert.deepEqual(readView(b)!.agenda.map((x) => x.id), v.agenda.map((x) => x.id));
  for (const item of v.agenda) assert.ok(a.getMap('notes').get(item.id) instanceof Y.Text);
});

const info: SeriesInfo = {
  name: 'Team retro, monthly', cadence: 'weekly', template, facilitators: [{ id: 'ana', name: 'Ana' }],
  createdBy: 'ana', createdAt: '2026-10-15T10:00:00Z', start: '2026-10-20T10:00', durationMin: 45,
};

test('series document: facilitators and meeting entries', () => {
  const doc = new Y.Doc();
  initSeries(doc, info);
  const ops = seriesOps(doc);
  ops.addFacilitator({ id: 'ben', name: 'Ben' });
  ops.syncOccurrence('2026-W42', { title: 'Retro', status: 'live', closedAt: null }, '2026-10-15T10:00:00Z');
  ops.syncOccurrence('2026-W42', { title: 'Retro', status: 'closed', closedAt: '2026-10-15T11:00:00Z' }, '2026-10-16T10:00:00Z');
  const s = readSeries(doc)!;
  assert.deepEqual(s.info.facilitators.map((f) => f.id), ['ana', 'ben']);
  assert.equal(s.occurrences['2026-W42'].status, 'closed');
  assert.equal(s.occurrences['2026-W42'].createdAt, '2026-10-15T10:00:00Z');
  ops.removeFacilitator('ben');
  assert.equal(readSeries(doc)!.info.facilitators.length, 1);
});

test('calendar file repeats weekly and carries the link', () => {
  const link = 'https://rondel.example/#/s/abcdefgh/key';
  const ics = seriesIcs('abcdefgh', info, link, new Date('2026-10-15T08:00:00Z'));
  assert.match(ics, /RRULE:FREQ=WEEKLY\r\n/);
  assert.match(ics, /DTSTART:20261020T100000\r\n/);
  assert.match(ics, /DURATION:PT45M\r\n/);
  assert.match(ics, /SUMMARY:Team retro\\, monthly\r\n/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.ok(ics.replace(/\r\n /g, '').includes(`URL:${link}`));
});


test('next occurrence and titles', () => {
  assert.equal(basePeriod('weekly', '2026-W42-2'), '2026-W42');
  assert.equal(basePeriod('monthly', '2026-10-2'), '2026-10');
  assert.equal(basePeriod('daily', '2026-10-15-2'), '2026-10-15');
  assert.equal(nextPeriod('weekly', '2026-W42-2'), '2026-W43');
  assert.equal(nextPeriod('weekly', '2026-W53'), '2027-W01');
  assert.equal(nextPeriod('monthly', '2026-12'), '2027-01');
  assert.equal(nextPeriod('daily', '2026-10-31'), '2026-11-01');
  assert.deepEqual(nextAfter('weekly', '2026-W42', { '2026-W43': occ('2026-W43', 'live', '2026-10-15T10:00:00Z') }), { occ: '2026-W43', n: 1, exists: true });
  assert.deepEqual(nextAfter('none', 'all', { all: occ('all', 'live', '2026-10-15T10:00:00Z') }), { occ: 'all-2', n: 2, exists: false });
  assert.equal(periodLabel('weekly', '2026-W42'), 'Week 42, 2026');
  assert.equal(periodLabel('monthly', '2026-10'), 'October 2026');
});
