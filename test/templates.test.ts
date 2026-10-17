import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { initMeeting, readView } from '../src/lib/model';
import { BUILTIN_TEMPLATES, STARTER_YAML, defaultTitle, parseTemplate, templateFromMeeting, templateToYaml } from '../src/lib/templates';

const FULL = `
name: Sprint retro
type: retro
description: Two-week retro
title: Sprint retro {date}
columns:
  - title: Went well
    description: Wins worth repeating
  - To improve
agenda:
  - title: Review last actions
    minutes: 5
    owner: Facilitator
    notes: |
      Which actions are still open?
  - Board
settings:
  anonymous_cards: false
  votes_per_person: 0
  votes_per_card: 2
  secret_voting: true
`;

test('a full template parses into the meeting model', () => {
  const { template, errors } = parseTemplate(FULL, 'my-');
  assert.deepEqual(errors, []);
  assert.equal(template!.id, 'my-sprint-retro');
  assert.equal(template!.type, 'retro');
  assert.deepEqual(template!.columns.map((c) => [c.title, c.description]), [['Went well', 'Wins worth repeating'], ['To improve', '']]);
  assert.deepEqual(template!.agenda[0], { title: 'Review last actions', durationMin: 5, owner: 'Facilitator', notes: 'Which actions are still open?' });
  assert.deepEqual(template!.agenda[1], { title: 'Board', durationMin: 5 });
  assert.deepEqual(template!.settings, { showAuthors: true, votesPerUser: 0, votesPerCard: 2, secretVoting: true });
  assert.equal(defaultTitle(template!, new Date('2026-10-14T12:00:00Z')), 'Sprint retro 2026-10-14');
});

test('mistakes are reported with their line numbers', () => {
  const { template, errors } = parseTemplate(`name: Weekly
type: weekly
agenda:
  - title: Updates
    minuets: 10
  - title: AOB
    minutes: ten
`);
  assert.equal(template, null);
  assert.deepEqual(errors.map((e) => e.line), [2, 5, 7]);
  assert.match(errors[0].message, /type must be one of/);
  assert.match(errors[1].message, /Unknown field "minuets"/);
  assert.match(errors[2].message, /whole number/);
});

test('YAML syntax errors and missing names are caught', () => {
  const bad = parseTemplate('name: [unclosed\nagenda: x');
  assert.equal(bad.template, null);
  assert.ok(bad.errors[0].line);
  const noName = parseTemplate('agenda:\n  - Topic');
  assert.match(noName.errors[0].message, /name is required/);
  assert.match(parseTemplate('- just a list').errors[0].message, /set of fields/);
});

test('templates survive a round trip through YAML', () => {
  for (const { template } of [...BUILTIN_TEMPLATES, { template: parseTemplate(FULL).template! }]) {
    const again = parseTemplate(templateToYaml(template)).template!;
    assert.deepEqual({ ...again, id: template.id }, template);
  }
  assert.ok(parseTemplate(STARTER_YAML).template);
});

test('a meeting made from a template gets its title, settings, owners and notes', () => {
  const t = parseTemplate(FULL, 'my-').template!;
  const doc = new Y.Doc();
  initMeeting(doc, { title: '', template: t, creatorId: 'u1' });
  const v = readView(doc)!;
  assert.match(v.meta.title, /^Sprint retro \d{4}-\d{2}-\d{2}$/);
  assert.equal(v.meta.settings.showAuthors, true);
  assert.equal(v.meta.settings.votesPerCard, 2);
  assert.equal(v.agenda[0].owner, 'Facilitator');
  assert.equal(doc.getMap<Y.Text>('notes').get(v.agenda[0].id)!.toString(), 'Which actions are still open?');
  assert.deepEqual(v.meta.template, t);

  const saved = templateFromMeeting(v);
  assert.deepEqual(saved.agenda.map((a) => a.title), ['Review last actions', 'Board']);
  assert.ok(parseTemplate(templateToYaml(saved)).template);
});

test('organisation templates shipped in deploy/*/templates parse without errors', async () => {
  const { readdirSync, readFileSync, existsSync } = await import('node:fs');
  for (const site of readdirSync('deploy')) {
    const dir = `deploy/${site}/templates`;
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const { template, errors } = parseTemplate(readFileSync(`${dir}/${f}`, 'utf8'), 'org-');
      assert.deepEqual(errors, [], `${dir}/${f}`);
      assert.ok(template, `${dir}/${f}`);
    }
  }
});
