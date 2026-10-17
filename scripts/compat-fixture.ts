// Writes test/compat/<version>.json: data saved the way this version saves it (a meeting, a series, an
// encrypted update, a backup, a template), plus what this version reads back from it. test/compat.test.ts
// checks that every later version still opens all of these files the same way.
//
//   node --import tsx scripts/compat-fixture.ts
//
// Run it when a release changes how anything is stored, and commit the new file. Never edit an old one:
// they stand for meetings, links and backups that people already have.
import '../test/setup';
import fs from 'node:fs';
import * as Y from 'yjs';
import { initMeeting, readView } from '../src/lib/model';
import { meetingOps } from '../src/lib/ops';
import { exportMeeting } from '../src/lib/files';
import { parseTemplate } from '../src/lib/templates';
import { deriveKeys, seal } from '../src/lib/crypto';
import { initSeries, occurrenceRoom, readSeries, seriesOps } from '../src/lib/series';
import { makeBackupFile } from '../src/lib/backup';
import { notesText } from '../test/compat-read';

const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const out = `test/compat/${version}.json`;
if (fs.existsSync(out)) throw new Error(`${out} exists; old fixtures are never rewritten`);

// Every template field.
const templateYaml = `id: compat-retro
name: Compatibility retro
type: retro
description: Every template field, for the compatibility test.
title: Compat retro {date}
columns:
  - title: Went well
    description: Wins worth repeating
    color: "#16a34a"
  - To improve
agenda:
  - title: Check-in
    minutes: 3
    activity: round
    owner: Everyone
    notes: |
      One word for the sprint.
  - title: Ideas
    minutes: 5
    activity: brainstorm
    screen:
      middle: [brainstorm]
      people: folded
  - title: Write
    minutes: 5
    activity: write
  - title: Vote
    activity: vote
  - title: Discuss
    minutes: 20
    activity: discuss
  - Wrap-up
settings:
  anonymous_cards: false
  votes_per_person: 4
  votes_per_card: 2
  secret_voting: true
  open_board: false
`;
const { template, errors } = parseTemplate(templateYaml);
if (!template) throw new Error(JSON.stringify(errors));

// A meeting that has been used: cards, a group, votes, brainstorm dots, notes, decisions, actions, closed.
const doc = new Y.Doc();
const roomId = 'compatroom1';
const linkKey = 'q1w2e3r4t5y6u7i8o9p0aSdFgHjKlZxCvBnM-_12345';
const ana = { id: 'user-ana', name: 'Ana' };
const ben = { id: 'user-ben', name: 'Ben' };
initMeeting(doc, { title: 'Sprint 42 retro', template, creatorId: ana.id });
const a = meetingOps(doc, roomId, ana);
const b = meetingOps(doc, roomId, ben);
a.join();
b.join();
a.addFacilitator(ben.id);
const view0 = readView(doc)!;
const [well, improve] = view0.columns;
const [checkIn, ideas, , vote, discuss] = view0.agenda;
const checkInNotes = a.notesFor(checkIn.id);
checkInNotes.insert(checkInNotes.length, '\nAna: calm. Ben: busy.');
a.setCurrent(ideas.id, false);
a.brainstorm(ideas.id, { step: 'vote' });
a.addIdea('Pair on reviews', ideas.id);
b.addIdea('No-meeting Wednesday', ideas.id);
const ideaIds = readView(doc)!.ideas.map((i) => i.id);
a.voteIdea(ideaIds[1], 1);
b.voteIdea(ideaIds[1], 1);
a.ideaToAction(ideaIds[0]);
const c1 = a.shareCard({ columnId: well.id, text: 'Shipped the importer', color: null });
const c2 = b.shareCard({ columnId: well.id, text: 'Importer works on big files', color: '#fde68a' });
const c3 = b.shareCard({ columnId: improve.id, text: 'Too many review rounds', color: null });
a.group(c2, c1);
a.groupTitle(c1, 'Importer');
a.setCurrent(vote.id, false);
a.vote(c1, 1);
a.vote(c3, 1);
b.vote(c3, 1);
a.setCurrent(discuss.id, false);
a.notesFor(discuss.id).insert(0, 'Reviews: agree on one reviewer per PR.');
a.addDecision('One reviewer per pull request', discuss.id);
a.addAction({ text: 'Write the review guideline', owner: 'Ben', due: '2026-11-01', cardId: c3 });
a.updateAction(readView(doc)!.actions[0].id, { status: 'done' });
a.addAgenda('Extra: release date', 10);
a.close();

// A series with two meetings.
const series = new Y.Doc();
const seriesKey = 'SeriesKeyForCompatTest_0123456789abcdef';
initSeries(series, { name: 'Team weekly', cadence: 'weekly', template, facilitators: [{ id: ana.id, name: ana.name }], createdBy: ana.id, createdAt: '2026-10-01T09:00:00.000Z', start: '2026-10-05T10:00', durationMin: 45 });
const so = seriesOps(series);
so.addOccurrence({ occ: '2026-W41', title: 'Team weekly 2026-W41', status: 'closed', createdAt: '2026-10-05T10:00:00.000Z', closedAt: '2026-10-05T10:45:00.000Z' });
// A meeting deleted from the server (0.27.0 and later): its room can't be reused.
so.addOccurrence({ occ: '2026-W40', title: 'Team weekly 2026-W40', status: 'closed', createdAt: '2026-09-28T10:00:00.000Z', closedAt: '2026-09-28T10:45:00.000Z' });
so.markDeleted('2026-W40');
so.addOccurrence({ occ: '2026-W42', title: 'Team weekly 2026-W42', status: 'live', createdAt: '2026-10-12T10:00:00.000Z', closedAt: null });

// An encrypted update as the room server stores it, and the link's server proof.
const keys = await deriveKeys(linkKey, roomId);
const sealedUpdate = await seal(keys.key, Y.encodeStateAsUpdate(doc));

const backupData = { local: { 'rondel:me': JSON.stringify(ana), 'rondel:meetings': JSON.stringify([{ roomId, key: linkKey, title: 'Sprint 42 retro', updatedAt: '2026-10-17T12:00:00.000Z' }]) }, docs: { [`rondel-${roomId}`]: exportMeeting(doc, roomId, linkKey).update } };

const fixture = {
  version,
  template: { yaml: templateYaml, parsed: template },
  meeting: { file: exportMeeting(doc, roomId, linkKey), view: readView(doc), notes: notesText(doc) },
  series: { update: Buffer.from(Y.encodeStateAsUpdate(series)).toString('base64'), read: readSeries(series), key: seriesKey, occurrence: { occ: '2026-W42', room: await occurrenceRoom(seriesKey, '2026-W42') } },
  encryption: { linkKey, roomId, auth: keys.auth, sealedUpdate },
  backup: { passphrase: 'correct horse battery', file: await makeBackupFile(backupData, 'correct horse battery'), data: backupData },
};
fs.mkdirSync('test/compat', { recursive: true });
fs.writeFileSync(out, JSON.stringify(fixture, null, 1) + '\n');
console.log(`Wrote ${out}`);
