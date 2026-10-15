import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { initMeeting, readView, screenFor } from '../src/lib/model';
import { meetingOps } from '../src/lib/ops';
import { BUILTIN_TEMPLATES, defaultTitle, designChecks, parseTemplate, templateFromMeeting, templateToYaml } from '../src/lib/templates';

const DESIGN = `
name: Team retro
type: general
columns: [Went well, To improve]
agenda:
  - title: Check-in
    minutes: 5
    activity: round
  - title: Write
    minutes: 8
    activity: write
  - title: Vote
    minutes: 3
    activity: vote
  - title: Discuss
    minutes: 20
    activity: discuss
`;

test('stage activities survive YAML, meetings and "save as design"', () => {
  const { template, errors } = parseTemplate(DESIGN);
  assert.deepEqual(errors, []);
  assert.deepEqual(template!.agenda.map((a) => a.activity), ['round', 'write', 'vote', 'discuss']);
  assert.deepEqual(parseTemplate(templateToYaml(template!)).template, template);

  const doc = new Y.Doc();
  initMeeting(doc, { title: '', template: template!, creatorId: 'u1' });
  const v = readView(doc)!;
  assert.equal(v.meta.phase, 'write', 'a general meeting with board stages gets a staged board');
  assert.deepEqual(templateFromMeeting(v).agenda.map((a) => a.activity), ['round', 'write', 'vote', 'discuss']);
});

test('an unknown activity is reported with its line', () => {
  const { errors } = parseTemplate('name: X\nagenda:\n  - title: A\n    activity: dance\n');
  assert.equal(errors[0].line, 4);
  assert.match(errors[0].message, /activity must be one of/);
});

test('starting a board stage switches the board and reveals votes for discussion', () => {
  const doc = new Y.Doc();
  initMeeting(doc, { title: '', template: parseTemplate(DESIGN).template!, creatorId: 'u1' });
  const ops = meetingOps(doc, 'r', { id: 'u1', name: 'Ana' });
  const item = (t: string) => readView(doc)!.agenda.find((a) => a.title === t)!.id;
  ops.setCurrent(item('Vote'));
  assert.equal(readView(doc)!.meta.phase, 'vote');
  assert.equal(readView(doc)!.meta.timer.durationMs, 3 * 60_000);
  ops.setCurrent(item('Check-in'));
  assert.equal(readView(doc)!.meta.phase, 'vote', 'non-board stages leave the board alone');
  ops.setCurrent(item('Discuss'));
  assert.equal(readView(doc)!.meta.phase, 'discuss');
  assert.equal(readView(doc)!.meta.settings.votesRevealed, true);
});

test('design checks point out odd orders, missing columns and long meetings', () => {
  const t = parseTemplate(`name: X
agenda:
  - { title: Vote, minutes: 3, activity: vote }
  - { title: Write, minutes: 8, activity: write }
  - { title: Long, minutes: 90 }
  - { title: Open, minutes: 0 }
`).template!;
  const checks = designChecks(t);
  assert.ok(checks.some((c) => /no columns/.test(c)));
  assert.ok(checks.some((c) => /Voting comes before writing/.test(c)));
  assert.ok(checks.some((c) => /without a break/.test(c)));
  assert.ok(checks.some((c) => /“Open” has no time/.test(c)));
  assert.deepEqual(designChecks(parseTemplate(DESIGN).template!), []);
});

test('people who opened the meeting are kept, renamed in place, and listed in the view', () => {
  const doc = new Y.Doc();
  initMeeting(doc, { title: 'Weekly', template: parseTemplate(DESIGN).template!, creatorId: 'u1' });
  meetingOps(doc, 'r', { id: 'u1', name: 'Ana' }).join();
  meetingOps(doc, 'r', { id: 'u2', name: 'Ben' }).join();
  meetingOps(doc, 'r', { id: 'u2', name: 'Ben Ng' }).join();
  assert.deepEqual(readView(doc)!.people.map((p) => p.name), ['Ana', 'Ben Ng']);
});

test('browser defaults apply to new meetings unless the template sets its own', () => {
  const doc = new Y.Doc();
  const t = parseTemplate('name: X\nagenda: [A]\nsettings:\n  votes_per_card: 2\n').template!;
  initMeeting(doc, { title: '', template: t, creatorId: 'u1', defaults: { votesPerUser: 9, votesPerCard: 7, showAuthors: false } });
  const s = readView(doc)!.meta.settings;
  assert.equal(s.votesPerUser, 9);
  assert.equal(s.showAuthors, false);
  assert.equal(s.votesPerCard, 2);
});

test('the creator can remove someone and allow them back; the removed person cannot rejoin the list', () => {
  const doc = new Y.Doc();
  initMeeting(doc, { title: 'Weekly', template: parseTemplate(DESIGN).template!, creatorId: 'u1' });
  const ana = meetingOps(doc, 'r', { id: 'u1', name: 'Ana' });
  const ben = meetingOps(doc, 'r', { id: 'u2', name: 'Ben' });
  ana.join(); ben.join(); ana.addFacilitator('u2');
  ana.removePerson('u2');
  let v = readView(doc)!;
  assert.deepEqual(v.people.map((p) => p.name), ['Ana']);
  assert.deepEqual(v.meta.facilitators, ['u1']);
  assert.deepEqual(v.meta.removed, [{ id: 'u2', name: 'Ben' }]);
  ben.join();
  assert.equal(readView(doc)!.people.length, 1);
  ana.removePerson('u1');
  assert.equal(readView(doc)!.meta.removed.length, 1, 'the creator cannot be removed');
  ana.allowBack('u2');
  ben.join();
  assert.deepEqual(readView(doc)!.people.map((p) => p.name), ['Ana', 'Ben']);
});

test('the wins and challenges template is an open board titled by month, and open boards always name the writer', () => {
  const t = BUILTIN_TEMPLATES.find((x) => x.template.id === 'wins-challenges')!.template;
  assert.equal(t.settings?.openBoard, true);
  assert.equal(defaultTitle(t, new Date('2026-10-15T12:00:00Z')), 'Wins and challenges - October 2026');
  assert.deepEqual({ ...parseTemplate(templateToYaml(t)).template, id: t.id }, t);
  const doc = new Y.Doc();
  initMeeting(doc, { title: '', template: t, creatorId: 'u1' });
  const ops = meetingOps(doc, 'r', { id: 'u1', name: 'Ana' });
  ops.settings({ showAuthors: false });
  ops.shareCard({ columnId: readView(doc)!.columns[0].id, text: 'Win', color: null });
  assert.equal(readView(doc)!.cards[0].authorName, 'Ana');
});

test('a stage can say what goes in the middle; actions stages show action items, not the board', () => {
  assert.deepEqual(screenFor({ activity: 'actions' }), { middle: ['actions', 'topic'] });
  assert.deepEqual(screenFor({ activity: 'discuss' }), { middle: ['board', 'topic'] });
  assert.deepEqual(screenFor({ activity: 'write' }), { middle: ['board'] });
  assert.deepEqual(screenFor({ activity: 'round' }), {});
  assert.deepEqual(screenFor({ activity: 'actions', screen: { middle: ['board'], people: 'folded' } }), { middle: ['board'], people: 'folded' });
  const yaml = `name: Screens\ntype: retro\ncolumns: [Wins]\nagenda:\n  - title: Talk\n    minutes: 10\n    screen:\n      middle: [decisions, topic]\n      people: folded\n`;
  const { template, errors } = parseTemplate(yaml);
  assert.deepEqual(errors, []);
  assert.deepEqual(template!.agenda[0].screen, { middle: ['decisions', 'topic'], people: 'folded' });
  const again = parseTemplate(templateToYaml(template!)).template!;
  assert.deepEqual(again.agenda[0].screen, template!.agenda[0].screen);
  const bad = parseTemplate(`name: X\ntype: general\nagenda:\n  - title: T\n    screen:\n      board: hidden\n      middle: [board, topic, actions]\n`);
  assert.equal(bad.errors.length, 2);
  assert.match(bad.errors[0].message, /board must be open or folded/);
});

test('a new version of a template gets its own name and id, and the original is kept', async () => {
  const { nextVersionName, newVersionYaml, parseTemplate, saveMyTemplate, loadMyTemplates } = await import('../src/lib/templates');
  assert.equal(nextVersionName('Team retro', []), 'Team retro (v2)');
  assert.equal(nextVersionName('Team retro (v2)', ['Team retro (v3)']), 'Team retro (v4)');
  assert.equal(nextVersionName('Board meeting (my version)', []), 'Board meeting (v2)');
  const yaml = 'id: weekly\nname: Weekly sync\ntype: general\nagenda:\n  - title: Updates\n    minutes: 10\n    notes: |\n      Private prep notes\n';
  const copy = newVersionYaml(yaml, ['Weekly sync']);
  const { template } = parseTemplate(copy, 'my-');
  assert.equal(template!.name, 'Weekly sync (v2)');
  assert.equal(template!.agenda[0].notes?.trim(), 'Private prep notes');
  localStorage.removeItem('rondel:templates');
  saveMyTemplate(yaml);
  saveMyTemplate(copy);
  assert.deepEqual(loadMyTemplates().map((t) => t.template.name).sort(), ['Weekly sync', 'Weekly sync (v2)']);
});
