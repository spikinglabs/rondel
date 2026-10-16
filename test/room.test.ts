import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Room, type Conn } from '../server/core/room';
import { MemoryStore } from '../server/core/memory';
import { PROTOCOL_VERSION, type ServerMessage } from '../server/core/protocol';

function client(room: Room) {
  const got: ServerMessage[] = [];
  let closed = false;
  const conn: Conn = { send: (t) => got.push(JSON.parse(t)), close: () => void (closed = true) };
  room.open(conn);
  return {
    got,
    get closed() {
      return closed;
    },
    send: (m: object) => room.message(conn, JSON.stringify(m)),
    hello: (auth = 'a-secret-auth-token', since = 0) => room.message(conn, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, auth, since })),
    leave: () => room.close(conn),
    last: <T extends ServerMessage['t']>(t: T) => got.filter((m) => m.t === t).at(-1) as Extract<ServerMessage, { t: T }>,
  };
}

test('stores updates, acks them and passes them on', async () => {
  const room = new Room(new MemoryStore());
  const a = client(room);
  await a.hello();
  assert.deepEqual(a.last('welcome').entries, []);
  const b = client(room);
  await b.hello();
  assert.equal(a.last('peers').others, 1);
  await a.send({ t: 'upd', id: 7, data: 'enc1' });
  assert.deepEqual(a.last('ack'), { t: 'ack', id: 7, seq: 1 });
  assert.deepEqual(b.last('upd'), { t: 'upd', seq: 1, data: 'enc1' });
  await b.send({ t: 'aw', data: 'presence' });
  assert.equal(a.last('aw').data, 'presence');
  assert.equal(b.got.filter((m) => m.t === 'aw').length, 0, 'presence is not echoed');
});

test('later joiners get what was stored while they were away', async () => {
  const store = new MemoryStore();
  const room = new Room(store);
  const a = client(room);
  await a.hello();
  await a.send({ t: 'upd', id: 1, data: 'x' });
  await a.send({ t: 'upd', id: 2, data: 'y' });
  a.leave();
  const later = new Room(store); // e.g. after a restart
  const b = client(later);
  await b.hello();
  assert.deepEqual(b.last('welcome').entries.map((e) => e.data), ['x', 'y']);
  const c = client(later);
  await c.hello(undefined, 1);
  assert.deepEqual(c.last('welcome').entries.map((e) => e.data), ['y'], 'only entries after `since`');
});

test('a different link key is refused', async () => {
  const room = new Room(new MemoryStore());
  await client(room).hello('the-right-auth-token');
  const intruder = client(room);
  await intruder.hello('some-other-auth-token');
  assert.equal(intruder.last('error').code, 'forbidden');
  assert.ok(intruder.closed);
});

test('nothing is accepted before hello, and old clients are told to reload', async () => {
  const room = new Room(new MemoryStore());
  const a = client(room);
  await a.send({ t: 'upd', id: 1, data: 'x' });
  assert.equal(a.last('error').code, 'bad-request');
  const old = client(room);
  await old.send({ t: 'hello', v: 0, auth: 'a-secret-auth-token', since: 0 });
  assert.equal(old.last('error').code, 'version');
});

test('compaction replaces old entries with one snapshot and keeps newer ones', async () => {
  const store = new MemoryStore();
  const room = new Room(store);
  const a = client(room);
  await a.hello();
  for (let i = 1; i <= 5; i++) await a.send({ t: 'upd', id: i, data: `u${i}` });
  await a.send({ t: 'compact', upTo: 4, data: 'snap' });
  await a.send({ t: 'upd', id: 6, data: 'u6' });
  assert.deepEqual((await store.entriesSince(0)).map((e) => [e.seq, e.data]), [[4, 'snap'], [5, 'u5'], [6, 'u6']]);
});

test('a connection handed back after the room slept stays authenticated and keeps receiving updates', async () => {
  const store = new MemoryStore();
  const room = new Room(store);
  const a = client(room);
  let remembered = false;
  const got: ServerMessage[] = [];
  const b: Conn = { send: (t) => got.push(JSON.parse(t)), close: () => {}, authed: () => void (remembered = true) };
  room.open(b);
  await a.hello();
  await room.message(b, JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, auth: 'a-secret-auth-token', since: 0 }));
  assert.equal(remembered, true);

  // The adapter recreates the room on waking and hands both sockets back as authenticated.
  const woke = new Room(store);
  const a2: ServerMessage[] = [];
  const conA: Conn = { send: (t) => a2.push(JSON.parse(t)), close: () => {} };
  const conB: Conn = { send: (t) => got.push(JSON.parse(t)), close: () => {} };
  woke.open(conA, true);
  woke.open(conB, true);
  await woke.message(conA, JSON.stringify({ t: 'upd', id: 1, data: 'xyz' }));
  assert.equal(a2.at(-1)?.t, 'ack');
  assert.deepEqual(got.at(-1), { t: 'upd', seq: 1, data: 'xyz' });
});

test('delete removes the meeting for everyone and refuses it afterwards, even from a browser that still has a copy', async () => {
  const store = new MemoryStore();
  const room = new Room(store);
  const a = client(room);
  const b = client(room);
  await a.hello();
  await b.hello();
  await a.send({ t: 'upd', id: 1, data: 'secret' });
  await b.send({ t: 'delete' });
  assert.equal(a.last('deleted')?.t, 'deleted');
  assert.equal(b.last('deleted')?.t, 'deleted');
  assert.ok(a.closed && b.closed);
  assert.deepEqual(await store.entriesSince(0), []);
  assert.equal(await store.getAuthHash(), null);
  const c = client(room);
  await c.hello();
  assert.equal(c.last('error')?.code, 'gone');
});

test('a meeting expires after the retention time without changes, but not while someone has it open', async () => {
  const store = new MemoryStore();
  let now = Date.UTC(2026, 0, 1);
  store.now = () => now;
  const room = new Room(store, 90);
  const a = client(room);
  await a.hello();
  assert.equal(a.last('welcome').expiresAt, null);
  await a.send({ t: 'upd', id: 1, data: 'x' });
  const due = now + 90 * 86_400_000;
  assert.equal(await room.expiresAt(), due);
  now = due + 1;
  assert.ok((await room.expire(now))! > now, 'kept while connected');
  a.leave();
  assert.equal(await room.expire(due - 1), due, 'not yet');
  assert.equal(await room.expire(now), null);
  assert.deepEqual(await store.entriesSince(0), []);
  // Expiry is not a deletion: the link can be used again, e.g. by a browser that kept a copy.
  const b = client(room);
  await b.hello();
  assert.equal(b.last('welcome').t, 'welcome');
});
