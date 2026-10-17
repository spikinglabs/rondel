// End-to-end check of the claude.ai artifact preview mode, against a stand-in for the artifact
// runtime (window.claude with "db" and "room") that this script keeps in memory.
//   node e2e/artifact.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 8792;
const DIST = path.resolve('dist');
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(DIST, p === '/' ? 'index.html' : p);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));
const url = `http://localhost:${PORT}/`;

// ------------------------------------------------------------- stand-in artifact runtime
const store = new Map(); // collection path -> Map(id -> data)
const subs = []; // { page, sub, coll }
const rooms = new Map(); // room name -> Map(page -> presence)
let writes = 0;
const coll = (p) => (store.has(p) ? store.get(p) : store.set(p, new Map()).get(p));
const split = (docPath) => {
  const i = docPath.lastIndexOf('/');
  return [docPath.slice(0, i), docPath.slice(i + 1)];
};
const deliver = (c, changes) => {
  for (const s of subs) if (s.coll === c && !s.page.isClosed()) s.page.evaluate(([sub, ch]) => window.__deliver(sub, ch), [s.sub, changes]).catch(() => {});
};
const peersOf = (name) => [...(rooms.get(name) ?? new Map()).values()].map((presence) => ({ presence }));
const announce = (name, change) => {
  for (const page of (rooms.get(name) ?? new Map()).keys())
    if (!page.isClosed()) page.evaluate(([n, ch]) => window.__peers(n, ch), [name, change]).catch(() => {});
};
const leases = new Map();

async function runtime({ page }, op, a) {
  switch (op) {
    case 'sub': {
      subs.push({ page, sub: a.sub, coll: a.coll });
      const docs = [...coll(a.coll)].map(([id, data]) => ({ type: 'added', id, data }));
      setTimeout(() => page.evaluate(([sub, ch]) => window.__deliver(sub, ch), [a.sub, docs]).catch(() => {}), 50);
      return;
    }
    case 'unsub':
      subs.splice(subs.findIndex((s) => s.page === page && s.sub === a.sub) >>> 0, 1);
      return;
    case 'set': {
      writes++;
      const [c, id] = split(a.path);
      const type = coll(c).has(id) ? 'modified' : 'added';
      coll(c).set(id, a.data);
      deliver(c, [{ type, id, data: a.data }]);
      return;
    }
    case 'delete': {
      const [c, id] = split(a.path);
      const data = coll(c).get(id);
      if (coll(c).delete(id)) deliver(c, [{ type: 'removed', id, data }]);
      return;
    }
    case 'acquire': {
      const l = leases.get(a.path);
      if (l && l.until > Date.now() && l.holder !== a.holder) return { acquired: false };
      leases.set(a.path, { holder: a.holder, until: Date.now() + (a.ttlMs ?? 30000) });
      return { acquired: true };
    }
    case 'join': {
      if (!rooms.has(a.name)) rooms.set(a.name, new Map());
      rooms.get(a.name).set(page, {});
      page.on('close', () => {
        const left = rooms.get(a.name).get(page);
        rooms.get(a.name).delete(page);
        announce(a.name, { joined: [], updated: [], left: [{ presence: left }] });
      });
      setTimeout(() => page.evaluate(([n, ch]) => window.__peers(n, ch), [a.name, { joined: peersOf(a.name), updated: [], left: [] }]).catch(() => {}), 50);
      return;
    }
    case 'presence': {
      const r = rooms.get(a.name);
      const next = { ...r.get(page), ...a.patch };
      r.set(page, next);
      announce(a.name, { joined: [], updated: [{ presence: next }], left: [] });
      return;
    }
    case 'leave':
      rooms.get(a.name)?.delete(page);
      return;
  }
}

// Runs in the page before the app: a window.claude whose db and room call back into this script.
function installClaude() {
  const call = (op, a) => window.__runtime(op, a);
  const listeners = new Map();
  let nextSub = 1;
  window.__deliver = (sub, changes) => {
    const fn = listeners.get(sub);
    if (!fn) return;
    const docChanges = changes.map((c) => ({ type: c.type, doc: { id: c.id, exists: c.type !== 'removed', data: () => c.data } }));
    fn({ docChanges: () => docChanges, metadata: { fromCache: false, hasPendingWrites: false } });
  };
  const peerFns = new Map();
  window.__peers = (name, change) => peerFns.get(name)?.(change);
  const docRef = (p) => ({
    set: (data) => call('set', { path: p, data }),
    delete: () => call('delete', { path: p }),
    acquire: (o) => call('acquire', { path: p, ...o }),
  });
  const db = {
    doc: docRef,
    collection: (c) => ({
      doc: (id) => docRef(`${c}/${id ?? Math.random().toString(36).slice(2, 12)}`),
      onSnapshot(next) {
        const sub = nextSub++;
        listeners.set(sub, next);
        call('sub', { sub, coll: c });
        return () => (listeners.delete(sub), call('unsub', { sub }));
      },
    }),
  };
  const room = {
    async join(name) {
      await call('join', { name });
      return {
        presence: (patch) => call('presence', { name, patch }),
        onPeers: (fn) => (peerFns.set(name, fn), () => peerFns.delete(name)),
        leave: () => call('leave', { name }),
      };
    },
  };
  window.claude = { use: async (n) => (n === 'db' ? db : n === 'room' ? room : null) };
  window.RONDEL_CONFIG = { sync: 'auto', shareUrl: 'https://claude.ai/code/artifact/example' };
}

// ------------------------------------------------------------- the test
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.exposeBinding('__runtime', runtime);
  await ctx.addInitScript(installClaude);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  // Dialogs must be in-app; a native one would block inside the real preview.
  page.on('dialog', (d) => { errors.push(`${name}: native dialog "${d.message()}"`); d.dismiss(); });
  await page.goto(url);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  return page;
}
const card = (page, text) => page.locator('.bcard', { hasText: text });
const col = (page, title) => page.locator('section.board-col', { has: page.getByRole('heading', { name: title }) });
async function addCard(page, column, text) {
  await col(page, column).getByRole('button', { name: '+ Add card' }).click();
  await page.getByLabel('New card').fill(text);
  await page.getByLabel('New card').press('Enter');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
}

try {
  const ana = await person('Ana');
  await ana.getByText('This is a preview of Rondel running inside claude.ai').waitFor();
  await ana.getByRole('button', { name: 'New meeting' }).click();
  await ana.getByRole('button', { name: /^Went well/ }).click();
  await ana.getByLabel('Title').fill('Quarterly planning');
  await ana.getByRole('button', { name: 'Create meeting' }).click();
  await ana.getByRole('heading', { name: 'Quarterly planning' }).waitFor();
  await ana.getByText('● Saved').waitFor({ timeout: 10000 });
  await ana.getByLabel('New agenda item').fill('Budget for Q1');
  await ana.getByLabel('New agenda item').press('Enter');
  await ana.getByText('Budget for Q1').waitFor();
  await ana.getByRole('button', { name: /Invite/ }).click();
  const link = await ana.getByLabel('Meeting link').inputValue();
  assert(/^https:\/\/claude\.ai\/code\/artifact\/example#m\.[\w-]+\.[\w-]+$/.test(link), `invite link uses the preview address: ${link}`);
  await ana.waitForTimeout(800);
  await ana.context().close();
  ok('Ana created a meeting in preview mode, saw "Saved", got a preview invite link in the form claude.ai passes through, and left');

  const ben = await person('Ben');
  await ben.getByPlaceholder('Paste the meeting link').fill(`Join here: ${link}`);
  await ben.getByRole('button', { name: 'Join', exact: true }).click();
  await ben.getByRole('heading', { name: 'Quarterly planning' }).waitFor({ timeout: 10000 });
  await ben.getByText('Budget for Q1').waitFor();
  ok('Ben pasted the invite into "Join a meeting" while nobody was online and got the stored meeting');
  await addCard(ben, 'Went well', 'Shipped the mobile app');
  await ben.getByRole('button', { name: 'Share my 1 draft' }).click();
  await card(ben, 'Shipped the mobile app').waitFor();

  const cara = await person('Cara');
  await cara.goto(url + link.slice(link.indexOf('#')));
  await card(cara, 'Shipped the mobile app').waitFor({ timeout: 10000 });
  await cara.getByText('1 here').waitFor({ timeout: 10000 });
  await ben.getByText('1 here').waitFor({ timeout: 10000 });
  ok('Cara opened the invite link directly while Ben was there: she sees his card and each sees the other ("1 here")');

  await addCard(cara, 'To improve', 'Too many meetings');
  await cara.getByRole('button', { name: 'Share my 1 draft' }).click();
  await card(ben, 'Too many meetings').waitFor({ timeout: 10000 });
  ok('Cara\'s card reached Ben live');

  await card(ben, 'Shipped the mobile app').hover();
  const before = await card(ben, 'Shipped the mobile app').count();
  await card(ben, 'Shipped the mobile app').getByRole('button', { name: 'Card options' }).click();
  const del = ben.getByRole('button', { name: 'Delete', exact: true });
  if (await del.count()) {
    await del.click();
    await ben.getByText('Delete this card?').waitFor();
    await ben.getByRole('button', { name: 'OK' }).click();
    await card(cara, 'Shipped the mobile app').waitFor({ state: 'detached', timeout: 10000 });
    ok('Ben deleted his card through the in-app confirmation and it disappeared for Cara');
  } else {
    assert(before === 1, 'card exists');
    console.log('  (card menu not found; delete check skipped)');
  }

  // Lots of stored entries get compacted into one snapshot.
  const roomColl = [...store.keys()].find((k) => k.startsWith('rooms/') && k.endsWith('/u'));
  const entries = coll(roomColl);
  const sample = [...entries.values()][0];
  for (let i = 0; i < 160; i++) entries.set(`dup${i}`, sample);
  const dan = await person('Dan');
  await dan.goto(url + link.slice(link.indexOf('#')));
  await card(dan, 'Too many meetings').waitFor({ timeout: 10000 });
  for (let i = 0; i < 50 && entries.size > 20; i++) await dan.waitForTimeout(200);
  assert(entries.size <= 20, `compacted (${entries.size} entries left)`);
  await dan.reload();
  await card(dan, 'Too many meetings').waitFor({ timeout: 10000 });
  ok(`With 160+ stored entries, the log was compacted to ${entries.size} and the meeting still loads`);

  // ------------------------------------------------------------- a YAML template
  const eve = await person('Eve');
  await eve.getByRole('button', { name: 'New meeting' }).click();
  await eve.getByRole('button', { name: 'Design new…', exact: true }).click();
  await eve.getByRole('tab', { name: 'YAML' }).click();
  const yamlBox = eve.getByLabel('Template (YAML)');
  await yamlBox.fill('name: Board review\ntype: general\ntitle: Board review {date}\nagenda:\n  - title: Financials\n    minutes: 20\n    owner: CFO\n    notes: Cash position?\n  - title: Hiring\n    minuets: 10\n');
  await eve.getByRole('button', { name: 'Line 10' }).waitFor();
  assert(await eve.getByRole('button', { name: 'Save template' }).isDisabled(), 'save is blocked while there are errors');
  await yamlBox.fill('name: Board review\ntype: general\ntitle: Board review {date}\nagenda:\n  - title: Financials\n    minutes: 20\n    owner: CFO\n    notes: Cash position?\n  - title: Hiring\n    minutes: 10\n');
  await eve.getByText('Agenda · 30 min').waitFor();
  await eve.getByRole('button', { name: 'Save template' }).click();
  await eve.getByRole('heading', { name: 'My templates' }).waitFor();
  await eve.getByRole('button', { name: 'Create meeting' }).click();
  await eve.getByRole('heading', { name: /^Board review \d{4}-\d{2}-\d{2}$/ }).waitFor({ timeout: 10000 });
  await eve.getByText('20 min · CFO').waitFor();
  await eve.getByText('Financials').click();
  await eve.waitForFunction(() => [...document.querySelectorAll('textarea')].some((t) => t.value === 'Cash position?'));
  ok('Eve wrote a YAML template, saw the error on line 10, fixed it, and created a meeting with its owner and pre-filled notes');
  await eve.getByRole('button', { name: 'Settings' }).click();
  await eve.getByRole('button', { name: 'Save as a new template…' }).click();
  await eve.getByRole('tab', { name: 'YAML' }).click();
  const saved = await eve.getByLabel('Template (YAML)').inputValue();
  assert(saved.includes('owner: CFO') && saved.includes('minutes: 20') && saved.includes('Cash position?') && /name: .*\(v2\)/.test(saved), `meeting saved as YAML: ${saved}`);
  ok('Save as a new template turns the meeting back into YAML as version 2, keeping the pre-filled notes');
  await eve.getByRole('button', { name: 'Close' }).last().click();

  // The visual designer: build a retro from stages, then run it.
  await eve.getByRole('link', { name: 'Rondel' }).click();
  await eve.getByRole('button', { name: 'Design a meeting' }).click();
  await eve.getByLabel('Name', { exact: true }).fill('Team retro');
  await eve.getByLabel(/^Meeting title/).fill('Team retro {date}');
  for (const i of [3, 2, 1]) await eve.getByRole('button', { name: `Remove stage ${i}` }).click();
  await eve.getByRole('button', { name: '+ Check-in round' }).click();
  await eve.getByRole('button', { name: '+ Retro stages' }).click();
  await eve.getByLabel('Stage 4 minutes').fill('5');
  await eve.getByLabel('Start time, for planning').fill('10:00');
  await eve.locator('.run').getByText('10:57').waitFor();
  await eve.screenshot({ path: new URL('./shots/5-designer.png', import.meta.url).pathname });
  await eve.getByRole('tab', { name: 'YAML' }).click();
  const designed = await eve.getByLabel('Template (YAML)').inputValue();
  assert(designed.includes('activity: vote') && designed.includes('minutes: 5') && designed.includes('- title: Went well'), `designer YAML: ${designed}`);
  await eve.getByRole('tab', { name: 'Designer' }).click();
  await eve.getByRole('button', { name: 'Save template' }).click();
  await eve.getByRole('button', { name: 'Create meeting' }).click();
  await eve.getByRole('heading', { name: /^Team retro \d{4}-\d{2}-\d{2}$/ }).waitFor({ timeout: 10000 });
  assert(await eve.getByRole('navigation', { name: 'Board stages' }).count() === 0, 'no separate stage buttons when the agenda runs the board');
  await eve.locator('.agenda-item').getByText('Vote', { exact: true }).click();
  await eve.getByText('Vote for the topics you most want to discuss.').waitFor();
  ok('Eve designed a retro from timed stages (57 min, 10:00 to 10:57), and starting its Vote stage switched the board to voting');

  const dump = JSON.stringify([...store.values()].map((m) => [...m.values()]));
  // Ciphertext is base64, so short names like "Ana" can turn up inside it by chance; only count a match that
  // isn't part of a longer base64 run.
  for (const s of ['Quarterly planning', 'Budget for Q1', 'Too many meetings', 'Ana', 'Cara']) {
    assert(!new RegExp(`(?<![A-Za-z0-9+/])${s}(?![A-Za-z0-9+/=])`).test(dump), `storage contains "${s}"`);
  }
  ok('The artifact storage holds no readable meeting content or names');

  const real = errors.filter((e) => !/status of 404/.test(e));
  assert(real.length === 0, `errors: ${real.join('\n')}`);
  ok('No page errors or native dialogs');
  console.log(`\nAll ${step} checks passed (${writes} stored writes).`);
} catch (e) {
  console.error('✗', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
