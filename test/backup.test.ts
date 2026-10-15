import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBackupFile, mergeLocal, parseBackupFile, readBackupFile } from '../src/lib/backup';

const j = JSON.stringify;

test('a backup with a passphrase can only be read with it', async () => {
  const data = { local: { 'rondel:me': j({ id: 'a', name: 'Ana' }) }, docs: { 'rondel-r1': 'AAEC' } };
  const f = parseBackupFile(j(await makeBackupFile(data, 'correct horse')));
  assert.equal(f.encrypted, true);
  assert.ok(!j(f).includes('Ana'), 'nothing readable in the file');
  await assert.rejects(readBackupFile(f), /protected/);
  await assert.rejects(readBackupFile(f, 'wrong'), /Wrong passphrase/);
  assert.deepEqual(await readBackupFile(f, 'correct horse'), data);
  const plain = parseBackupFile(j(await makeBackupFile(data)));
  assert.deepEqual(await readBackupFile(plain), data);
  assert.throws(() => parseBackupFile(j({ format: 'rondel-meeting' })), /meeting file/);
});

test('restoring merges lists and keeps what this browser already has', () => {
  const current = {
    'rondel:me': j({ id: 'new', name: 'Ana (laptop)' }),
    'rondel:meetings': j([{ roomId: 'r1', title: 'Old title', updatedAt: '2026-10-01' }, { roomId: 'r3', title: 'Only here', updatedAt: '2026-10-02' }]),
    'rondel:prefs': j({ theme: 'dark', lastSeries: ['x'] }),
    'rondel:voter:r1': j('mine'),
  };
  const incoming = {
    'rondel:me': j({ id: 'old', name: 'Ana' }),
    'rondel:meetings': j([{ roomId: 'r1', title: 'New title', updatedAt: '2026-10-05' }, { roomId: 'r2', title: 'Planning', updatedAt: '2026-10-03' }]),
    'rondel:series': j([{ id: 's1', key: 'k', name: 'Weekly', updatedAt: '2026-10-04' }]),
    'rondel:templates': j(['id: t1\nname: Mine']),
    'rondel:prefs': j({ theme: 'light', lastSeries: ['y'], lastTemplateId: 't1' }),
    'rondel:voter:r1': j('theirs'),
    'rondel:voter:r2': j('v2'),
    'other:key': j('ignored'),
  };
  const r = mergeLocal(current, incoming, false);
  assert.equal(r.identity, 'kept');
  assert.equal(r.changes['rondel:me'], undefined);
  const meetings = JSON.parse(r.changes['rondel:meetings']);
  assert.deepEqual(meetings.map((m: any) => [m.roomId, m.title]).sort(), [['r1', 'New title'], ['r2', 'Planning'], ['r3', 'Only here']]);
  assert.equal(r.meetings, 1);
  assert.equal(r.series, 1);
  assert.equal(r.templates, 1);
  assert.deepEqual(JSON.parse(r.changes['rondel:prefs']), { theme: 'dark', lastTemplateId: 't1', lastSeries: ['x', 'y'] });
  assert.equal(r.changes['rondel:voter:r1'], undefined, 'this browser keeps its own voter id');
  assert.equal(r.changes['rondel:voter:r2'], j('v2'));
  assert.equal(r.changes['other:key'], undefined);

  const taken = mergeLocal(current, incoming, true);
  assert.equal(taken.identity, 'taken');
  assert.deepEqual(JSON.parse(taken.changes['rondel:me']), { id: 'old', name: 'Ana (laptop)' });
  assert.equal(mergeLocal({}, incoming, false).identity, 'taken', 'a fresh browser takes the identity');
});
