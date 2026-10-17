// End-to-end check of peer-to-peer mode: static files only, browsers syncing through a local Nostr relay.
// Run `npm run build` first. Uses a throwaway relay on localhost so it works offline.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { startRelay } from './nostr-relay.mjs';

const RELAY_PORT = 7461;
const WEB_PORT = 5191;
const dist = path.resolve('dist/index.html');
const shots = path.resolve('e2e/shots');
fs.mkdirSync(shots, { recursive: true });

const relay = await startRelay(RELAY_PORT);
// A plain static host with no Rondel server behind it, so the app falls back to peer-to-peer.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((req, res) => {
  const file = path.join(path.dirname(dist), new URL(req.url, 'http://x').pathname);
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  if (!target && req.url.includes('/api/')) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(target ?? dist)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(target ?? dist));
}).listen(WEB_PORT);
const url = `http://localhost:${WEB_PORT}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);

async function person(name) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((port) => { window.RONDEL_CONFIG = { strategy: 'nostr', relayUrls: [`ws://localhost:${port}`], turn: [] }; }, RELAY_PORT);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name} console: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(url);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  return page;
}
const card = (page, text) => page.locator('.bcard', { hasText: text });

try {
  // ---------------------------------------------------------------- create & join
  const ana = await person('Ana');
  await ana.getByRole('button', { name: 'New meeting' }).click();
  await ana.getByRole('button', { name: /^Start \/ Stop \/ Continue/ }).click();
  await ana.getByLabel('Title').fill('Sprint 12 retro');
  await ana.getByLabel('Series name').fill('Team retro');
  await ana.getByRole('button', { name: 'Create meeting' }).click();
  await ana.getByRole('heading', { name: 'Sprint 12 retro' }).waitFor();
  const link = ana.url();
  ok('Ana created a retro on a plain static host (peer-to-peer mode)');

  const ben = await person('Ben');
  await ben.goto(link);
  await ben.getByRole('heading', { name: 'Sprint 12 retro' }).waitFor({ timeout: 30000 });
  await ana.getByText('1 connected').waitFor({ timeout: 15000 });
  ok('Ben opened the invite link and the meeting arrived directly from Ana\'s browser');

  // ---------------------------------------------------------------- private drafts
  const col = (page, title) => page.locator('section.board-col', { has: page.getByRole('heading', { name: title }) });
  await col(ben, 'Start').getByRole('button', { name: '+ Add card' }).click();
  await ben.getByLabel('New card').fill('Pair on code reviews');
  await ben.getByLabel('New card').press('Enter');
  await ben.getByLabel('New card').fill('Write release notes earlier');
  await ben.getByLabel('New card').press('Enter');
  await card(ben, 'Pair on code reviews').getByText('Draft · only you').waitFor();
  await ana.getByText('2 private drafts from others').waitFor({ timeout: 10000 });
  assert(!(await ana.content()).includes('Pair on code reviews'), 'draft text must not reach Ana');
  ok('Ben\'s drafts stay in his browser; Ana only sees "2 private drafts from others"');

  await col(ana, 'Stop').getByRole('button', { name: '+ Add card' }).click();
  await ana.getByLabel('New card').fill('Deploying on Fridays');
  await ana.getByLabel('New card').press('Enter');
  await ana.getByRole('button', { name: 'Share my 1 draft' }).click();
  await ben.getByRole('button', { name: 'Share my 2 drafts' }).click();
  await card(ana, 'Pair on code reviews').waitFor({ timeout: 10000 });
  await card(ben, 'Deploying on Fridays').waitFor({ timeout: 10000 });
  ok('Both shared their drafts and see each other\'s cards');
  await ana.screenshot({ path: `${shots}/1-write.png`, fullPage: true });

  // ---------------------------------------------------------------- group & vote
  await ana.locator('.agenda-item', { hasText: 'Group similar cards' }).click();
  await card(ana, 'Write release notes earlier').dragTo(card(ana, 'Pair on code reviews'));
  await ana.getByLabel('Group name').fill('Team habits');
  await ana.getByLabel('Group name').press('Enter');
  await ben.locator('.group-title', { hasText: 'Team habits' }).or(ben.locator('.group-title input[value="Team habits"]')).first().waitFor({ timeout: 10000 });
  ok('Ana grouped two cards and named the group; Ben sees the group');

  await ana.locator('.agenda-item', { hasText: /^\d*Vote/ }).click();
  await ben.locator('.agenda-item.current', { hasText: 'Vote' }).waitFor({ timeout: 10000 });
  await card(ben, 'Deploying on Fridays').getByRole('button', { name: 'Add vote' }).click();
  await card(ben, 'Deploying on Fridays').getByRole('button', { name: 'Add vote' }).click();
  await card(ana, 'Deploying on Fridays').getByRole('button', { name: 'Add vote' }).click();
  await ana.locator('.agenda-item', { hasText: 'Discuss' }).click();
  await card(ben, 'Deploying on Fridays').locator('.count', { hasText: '3' }).waitFor({ timeout: 10000 });
  ok('Votes were anonymous during voting and revealed (3) when discussion started');

  // ---------------------------------------------------------------- agenda, notes, decisions, actions
  await ana.locator('.agenda-item').first().click();
  await ben.getByRole('heading', { level: 3, name: (await ana.locator('.agenda-item .title').first().textContent()) }).waitFor({ timeout: 10000 });
  await ana.getByLabel('Notes').fill('Friday deploys caused two incidents.');
  await ben.getByLabel('Notes').press('End');
  await ben.getByLabel('Notes').type(' Agreed to stop.');
  const merged = 'Friday deploys caused two incidents. Agreed to stop.';
  const notesOf = (p) => p.getByLabel('Notes').inputValue();
  await until(async () => (await notesOf(ana)) === merged && (await notesOf(ben)) === merged,
    async () => `notes merged in both browsers (Ana: "${await notesOf(ana)}", Ben: "${await notesOf(ben)}")`);
  ok('Both typed into the same notes and the text merged');

  await ben.getByLabel('New decision').first().fill('No deploys after Thursday noon');
  await ben.getByLabel('New decision').first().press('Enter');
  const actionForm = ana.locator('form', { has: ana.getByLabel('New action') });
  await ana.getByLabel('New action').fill('Add a deploy freeze check to CI');
  await actionForm.getByLabel('Owner').fill('Ben');
  await actionForm.getByRole('button', { name: 'Add', exact: true }).click();
  await ana.getByLabel('New action').fill('Share retro notes with the wider team');
  await actionForm.getByRole('button', { name: 'Add', exact: true }).click();
  await ben.getByText('Add a deploy freeze check to CI').waitFor({ timeout: 10000 });
  await ana.getByText('No deploys after Thursday noon').first().waitFor({ timeout: 10000 });
  await ben.locator('.action', { hasText: 'Share retro notes' }).getByRole('checkbox').check();
  await ana.locator('.action.done', { hasText: 'Share retro notes' }).waitFor({ timeout: 10000 });
  ok('Decisions and action items sync both ways');
  await ben.screenshot({ path: `${shots}/2-discuss.png`, fullPage: true });

  // ---------------------------------------------------------------- close, minutes, file
  await ana.getByRole('button', { name: 'Close meeting' }).click();
  await ana.getByRole('button', { name: 'OK' }).click();
  await ben.getByText('This meeting is closed.').waitFor({ timeout: 10000 });
  // Stand in for the folder picker with the browser's private file system, which has the same API.
  await ana.evaluate(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await ana.getByRole('button', { name: 'Minutes', exact: true }).first().click();
  const [minutesDl] = await Promise.all([ana.waitForEvent('download'), ana.getByRole('button', { name: 'Download .md' }).click()]);
  const minutes = fs.readFileSync(await minutesDl.path(), 'utf8');
  for (const s of ['Sprint 12 retro', 'Friday deploys caused two incidents', 'No deploys after Thursday noon', 'Deploying on Fridays', '3 votes', '| ☐ | Add a deploy freeze check to CI | Ben |', 'Team habits']) {
    assert(minutes.includes(s), `minutes include "${s}"`);
  }
  fs.writeFileSync(`${shots}/minutes.md`, minutes);
  await ana.getByRole('button', { name: 'Save to folder…' }).click();
  await ana.getByText(/^Saved .*-sprint-12-retro-minutes\.md in /).waitFor();
  await ana.getByRole('button', { name: 'Change folder' }).waitFor();
  const saved = await ana.evaluate(async () => { const dir = await navigator.storage.getDirectory(); for await (const [name, h] of dir.entries()) if (name.endsWith('-minutes.md')) return (await h.getFile()).text(); return ''; });
  assert(saved === minutes, 'minutes saved into the chosen folder');
  const [csvDl] = await Promise.all([ana.waitForEvent('download'), ana.getByRole('button', { name: 'Actions as CSV' }).click()]);
  const csv = fs.readFileSync(await csvDl.path(), 'utf8');
  assert(csvDl.suggestedFilename().endsWith('-actions.csv') && csv.startsWith('\uFEFFAction,Owner,Due,Status,Meeting,Created') && csv.includes('Add a deploy freeze check to CI,Ben,') && csv.includes('Share retro notes with the wider team,,,Done,Sprint 12 retro'), `actions CSV: ${csv}`);
  // The minutes view copies formatted HTML for email, with a real table for the actions.
  await ana.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await ana.locator('.minutes-view table').waitFor();
  await ana.getByRole('button', { name: 'Copy for email' }).click();
  await ana.getByText('Minutes copied. Paste them into an email.').waitFor();
  const html = await ana.evaluate(async () => { const items = await navigator.clipboard.read(); const item = items[0]; if (!item.types.includes('text/html')) return 'TYPES:' + item.types.join(','); return (await item.getType('text/html')).text(); });
  assert(/<h1 style="[^"]*">Sprint 12 retro<\/h1>/.test(html) && /<table style=/.test(html) && html.includes('Add a deploy freeze check to CI') && !html.includes('class='), `email HTML: ${html.slice(0, 300)}`);
  await ana.screenshot({ path: `${shots}/3-minutes.png` });
  await ana.keyboard.press('Escape');
  const [fileDl] = await Promise.all([ana.waitForEvent('download'), ana.getByRole('button', { name: 'Save file' }).click()]);
  const filePath = `${shots}/${fileDl.suggestedFilename()}`;
  await fileDl.saveAs(filePath);
  ok(`Closed the meeting, downloaded Markdown minutes and the meeting file (${fileDl.suggestedFilename()})`);

  // ---------------------------------------------------------------- persistence with nobody else online
  await ben.context().close();
  await ana.reload();
  await ana.getByRole('heading', { name: 'Sprint 12 retro' }).waitFor();
  await ana.getByText('Add a deploy freeze check to CI').waitFor();
  ok('After Ben left and Ana reloaded, the meeting was still there from her browser storage');

  // ---------------------------------------------------------------- next meeting with carry-over
  await ana.getByRole('button', { name: 'Start next meeting' }).click();
  await ana.getByLabel('Title').fill('Sprint 13 retro');
  await ana.getByRole('button', { name: 'Create meeting' }).click();
  await ana.getByRole('heading', { name: 'Sprint 13 retro' }).waitFor();
  await ana.getByText('From Sprint 12 retro').waitFor();
  await ana.getByText('Add a deploy freeze check to CI').waitFor();
  assert(!(await ana.getByText('Share retro notes with the wider team').count()), 'done actions are not carried over');
  ok('Started Sprint 13: the open action carried over, the done one did not');
  await ana.screenshot({ path: `${shots}/3-next.png`, fullPage: true });

  // ---------------------------------------------------------------- open a saved file in a fresh browser
  const cara = await person('Cara');
  await cara.locator('input[type=file]').setInputFiles(filePath);
  await cara.getByRole('button', { name: 'Open this meeting' }).click();
  await cara.getByRole('heading', { name: 'Sprint 12 retro' }).waitFor();
  await cara.getByText('No deploys after Thursday noon').first().waitFor();
  await cara.goto(url);
  await cara.getByText('Sprint 12 retro').waitFor();
  ok('Cara opened the saved file in a new browser and it appears in her meeting list');

  // ---------------------------------------------------------------- mobile
  await cara.setViewportSize({ width: 390, height: 844 });
  await cara.getByText('Sprint 12 retro').click();
  await cara.getByRole('heading', { name: 'Sprint 12 retro' }).waitFor();
  const overflow = await cara.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= 1, `no sideways scrolling on a phone (overflow ${overflow}px)`);
  await cara.screenshot({ path: `${shots}/4-mobile.png`, fullPage: true });
  ok('Works at phone width without sideways scrolling');

  // The app probes api/health to see whether a Rondel server is there; on a static host that is a 404.
  const real = errors.filter((e) => !/WebSocket|ERR_CONNECTION|favicon|status of 404/.test(e));
  assert(real.length === 0, `no page errors:\n${real.join('\n')}`);
  ok('No errors in any browser console');
  console.log('\nAll checks passed.');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  web.close();
  relay.close?.();
  setTimeout(() => process.exit(), 100);
}

async function until(check, msg, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 200))) if (await check()) return;
  throw new Error(await msg());
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
