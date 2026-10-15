import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { IDEA_DOTS, defaultScreen, initMeeting, readView } from '../src/lib/model';
import { BUILTIN_TEMPLATES, parseTemplate } from '../src/lib/templates';
import { LimitError, meetingOps } from '../src/lib/ops';
import { minutesMarkdown } from '../src/lib/minutes';

function meeting() {
  const doc = new Y.Doc();
  initMeeting(doc, { title: 'Offsite', template: BUILTIN_TEMPLATES.find((t) => t.template.type === 'general')!.template, creatorId: 'u1' });
  const ops = meetingOps(doc, 'room-b', { id: 'u1', name: 'Ana' });
  ops.addAgenda('How might we cut onboarding time?', 15, 'brainstorm');
  const item = readView(doc)!.agenda.at(-1)!;
  ops.setCurrent(item.id, false);
  return { doc, ops, item };
}

test('a brainstorm stage puts the brainstorm in the middle', () => {
  assert.deepEqual(defaultScreen('brainstorm').middle, ['brainstorm']);
});

test('ideas belong to the agenda item, dots are limited, and the best become actions or agenda items', () => {
  const { doc, ops, item } = meeting();
  ops.addIdea('Pair new joiners with a buddy', item.id);
  ops.addIdea('Record the setup walkthrough', item.id);
  ops.addIdea('  ', item.id);
  ops.addIdea('Elsewhere', null);
  let v = readView(doc)!;
  const ideas = v.ideas.filter((i) => i.itemId === item.id);
  assert.equal(ideas.length, 2);
  const [buddy, video] = ideas;

  for (let i = 0; i < IDEA_DOTS - 1; i++) ops.voteIdea(buddy.id, 1);
  ops.voteIdea(video.id, 1);
  assert.throws(() => ops.voteIdea(video.id, 1), LimitError);
  // Dots in another brainstorm are counted separately.
  ops.voteIdea(v.ideas.find((i) => i.itemId === null)!.id, 1);
  v = readView(doc)!;
  assert.equal(v.ideaVotes[buddy.id], IDEA_DOTS - 1);

  ops.brainstorm(item.id, { step: 'pick' });
  ops.ideaToAction(buddy.id);
  ops.ideaToAgenda(video.id);
  v = readView(doc)!;
  assert.equal(v.brainstorms[item.id].step, 'pick');
  assert.ok(v.actions.some((a) => a.text === 'Pair new joiners with a buddy'));
  assert.ok(v.agenda.some((a) => a.title === 'Record the setup walkthrough'));
  assert.equal(v.ideas.find((i) => i.id === buddy.id)!.picked, 'action');

  const md = minutesMarkdown(doc, v);
  assert.match(md, /- Pair new joiners with a buddy — 2 dots → action/);
  assert.match(md, /## Brainstorm\n\n\*\*Ideas\*\*\n\n- Elsewhere — 1 dot/);

  ops.deleteIdea(video.id);
  v = readView(doc)!;
  assert.equal(v.ideaVotes[video.id], undefined);
});

test('templates accept brainstorm stages and screens', () => {
  const { template: t, errors } = parseTemplate(`name: Ideas\ntype: general\nagenda:\n  - title: Ideas\n    minutes: 10\n    activity: brainstorm\n    screen:\n      middle: [brainstorm, topic]\n`);
  assert.deepEqual(errors, []);
  assert.equal(t!.agenda[0].activity, 'brainstorm');
  assert.deepEqual(t!.agenda[0].screen?.middle, ['brainstorm', 'topic']);
});
