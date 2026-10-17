import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Y from 'yjs';
import { readView } from '../src/lib/model';
import { docFromFile, parseMeetingFile } from '../src/lib/files';
import { parseTemplate } from '../src/lib/templates';
import { deriveKeys, open } from '../src/lib/crypto';
import { occurrenceRoom, readSeries } from '../src/lib/series';
import { parseBackupFile, readBackupFile } from '../src/lib/backup';
import { holds, notesText } from './compat-read';

// Meetings, links, backups and templates that people made with an older Rondel must keep opening.
// test/compat/<version>.json holds data saved by that version and what it read back from it
// (written by scripts/compat-fixture.ts). This version must read at least the same from each one.

const fixtures = fs.readdirSync('test/compat').filter((f) => f.endsWith('.json')).sort();
const ok = (then: unknown, now: unknown) => {
  const diff = holds(then, now);
  assert.equal(diff, null, diff ?? '');
};

test('there is a compatibility fixture', () => assert.ok(fixtures.length >= 1));

for (const name of fixtures) {
  const f = JSON.parse(fs.readFileSync(`test/compat/${name}`, 'utf8'));

  test(`${f.version}: a meeting file opens with all its content`, () => {
    const doc = docFromFile(parseMeetingFile(JSON.stringify(f.meeting.file)));
    ok(f.meeting.view, JSON.parse(JSON.stringify(readView(doc))));
    ok(f.meeting.notes, notesText(doc));
  });

  test(`${f.version}: the meeting link still decrypts what the server stored`, async () => {
    const keys = await deriveKeys(f.encryption.linkKey, f.encryption.roomId);
    assert.equal(keys.auth, f.encryption.auth, 'the server would refuse the link');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await open(keys.key, f.encryption.sealedUpdate));
    ok(f.meeting.view, JSON.parse(JSON.stringify(readView(doc))));
  });

  test(`${f.version}: a series link finds the same meetings`, async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Uint8Array.from(Buffer.from(f.series.update, 'base64')));
    ok(f.series.read, JSON.parse(JSON.stringify(readSeries(doc))));
    assert.deepEqual(await occurrenceRoom(f.series.key, f.series.occurrence.occ), f.series.occurrence.room);
  });

  test(`${f.version}: a protected backup restores`, async () => {
    const file = parseBackupFile(JSON.stringify(f.backup.file));
    assert.deepEqual(await readBackupFile(file, f.backup.passphrase), f.backup.data);
  });

  test(`${f.version}: the template YAML still reads the same`, () => {
    const { template, errors } = parseTemplate(f.template.yaml);
    assert.deepEqual(errors, []);
    ok(f.template.parsed, JSON.parse(JSON.stringify(template)));
  });
}
