// Run with: node --import tsx e2e/server.mjs
// End-to-end check of server mode: meetings stored by a Rondel room server, people contributing
// at different times, offline edits, a restart, and a wrong key being refused.
//   node e2e/server.mjs                 → starts the Node server itself
//   BASE_URL=http://localhost:8788/ node e2e/server.mjs   → tests a running server (e.g. `wrangler dev`)
import { chromium } from 'playwright';
import jsQR from 'jsqr';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const external = process.env.BASE_URL;
const PORT = 8791;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-e2e-'));
let srv = null;
const start = async () => {
  if (external) return;
  const { createServer } = await import('../server/node/server.ts');
  srv = createServer({ staticDir: 'dist', dataDir });
  await new Promise((r) => srv.server.listen(PORT, r));
};
const stop = async () => srv && (await srv.close(), (srv = null));
const url = external ?? `http://localhost:${PORT}/`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('dialog', (d) => d.accept());
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
  await start();
  // ------------------------------------------------------------- Ana sets up the meeting and leaves
  const ana = await person('Ana');
  await ana.getByRole('button', { name: 'New meeting' }).click();
  await ana.getByRole('button', { name: /^Went well/ }).click();
  await ana.getByLabel('Title').fill('Quarterly planning');
  await ana.getByRole('button', { name: 'Create meeting' }).click();
  await ana.getByRole('heading', { name: 'Quarterly planning' }).waitFor();
  await ana.getByText('● Saved').waitFor({ timeout: 10000 });
  const link = ana.url();
  await ana.getByLabel('New agenda item').fill('Budget for Q1');
  await ana.getByLabel('New agenda item').press('Enter');
  await ana.getByText('Budget for Q1').waitFor();
  await ana.waitForTimeout(500);
  await ana.context().close();
  ok('Ana created a meeting with an agenda topic, saw "Saved" and closed her browser');

  // ------------------------------------------------------------- Ben prepares alone, later
  const ben = await person('Ben');
  await ben.goto(link);
  await ben.getByRole('heading', { name: 'Quarterly planning' }).waitFor({ timeout: 15000 });
  await ben.getByText('Budget for Q1').waitFor();
  ok('Ben opened the link while nobody else was online and got the meeting from the server');
  await addCard(ben, 'Went well', 'Shipped the mobile app');
  await ben.getByRole('button', { name: 'Share my 1 draft' }).click();
  await ben.getByLabel('New action').fill('Collect cost estimates');
  await ben.getByLabel('New action').press('Enter');
  await ben.getByText('Collect cost estimates').waitFor();
  await ben.waitForTimeout(500);
  await ben.context().close();
  ok('Ben prepared a card and an action, then left');

  // ------------------------------------------------------------- a restart keeps everything
  if (!external) {
    await stop();
    await start();
    ok('The server restarted');
  }

  // ------------------------------------------------------------- Cara arrives after both left
  const cara = await person('Cara');
  await cara.goto(link);
  await cara.getByRole('heading', { name: 'Quarterly planning' }).waitFor({ timeout: 15000 });
  await card(cara, 'Shipped the mobile app').waitFor();
  await cara.getByText('Collect cost estimates').waitFor();
  await cara.getByText('Budget for Q1').waitFor();
  ok("Cara, arriving after both had left, sees Ana's and Ben's preparation");
  const people = cara.locator('ul.people');
  await people.locator('li', { hasText: 'Cara' }).getByText('Here').waitFor();
  await people.locator('li', { hasText: 'Ana' }).getByText(/^Last here/).waitFor();
  await people.locator('li', { hasText: 'Ana' }).getByText('Facilitator').waitFor();
  await people.locator('li', { hasText: 'Ben' }).getByText(/^Last here/).waitFor();
  await cara.reload();
  await cara.getByRole('heading', { name: 'Quarterly planning' }).waitFor({ timeout: 15000 });
  await cara.locator('.me-button', { hasText: 'Cara' }).waitFor();
  ok('People lists Cara as here, and Ana (facilitator) and Ben as having joined earlier; after a reload Cara is not asked her name again');

  // ------------------------------------------------------------- live together, then offline edits
  const dan = await person('Dan');
  await dan.goto(link);
  await dan.getByRole('heading', { name: 'Quarterly planning' }).waitFor({ timeout: 15000 });
  await cara.getByText('● Saved · 1 here').waitFor({ timeout: 10000 });
  await cara.getByLabel('New decision').last().fill('Freeze hiring until March');
  await cara.getByLabel('New decision').last().press('Enter');
  await dan.getByText('Freeze hiring until March').first().waitFor({ timeout: 10000 });
  ok('Cara and Dan are both here; a decision appears for Dan as Cara records it');

  await dan.context().setOffline(true);
  await dan.getByText('Offline, will sync').waitFor({ timeout: 15000 });
  await dan.getByLabel('New action').fill('Draft the hiring plan');
  await dan.getByLabel('New action').press('Enter');
  await dan.context().setOffline(false);
  await cara.getByText('Draft the hiring plan').waitFor({ timeout: 40000 });
  ok('Dan lost his connection, kept working, and his action reached Cara when he came back');

  // ------------------------------------------------------------- wrong key
  const eve = await person('Eve');
  const wrong = link.replace(/\/([A-Za-z0-9_-]+)$/, '/AAAAAAAAAAAAAAAAAAAAAAAA');
  await eve.goto(wrong);
  await eve.getByText('This link does not match the meeting').waitFor({ timeout: 15000 });
  assert(!(await eve.getByText('Budget for Q1').count()), 'no content with a wrong key');
  ok('A link with the wrong key is refused and shows nothing');

  // ------------------------------------------------------------- the creator removes someone
  await dan.goto(url);
  await dan.getByRole('button', { name: 'New meeting' }).click();
  await dan.getByLabel('Title').fill('Team sync');
  await dan.getByRole('button', { name: 'Create meeting' }).click();
  await dan.getByRole('heading', { name: 'Team sync' }).waitFor();
  await dan.getByText('● Saved').waitFor({ timeout: 10000 });
  const syncLink = dan.url();
  await cara.goto(syncLink);
  await cara.getByRole('heading', { name: 'Team sync' }).waitFor({ timeout: 15000 });
  assert(await cara.getByRole('button', { name: 'Remove Dan' }).count() === 0, 'only the creator sees Remove');
  await dan.getByRole('button', { name: 'Remove Cara' }).click();
  await dan.locator('.dialog, [role=dialog]').last().getByRole('button', { name: /^(OK|Yes|Remove|Confirm)$/ }).click();
  await cara.getByRole('heading', { name: 'You were removed from this meeting' }).waitFor({ timeout: 10000 });
  await dan.locator('ul.people').getByText('Cara').waitFor({ state: 'detached' });
  await cara.getByRole('link', { name: 'Back to my meetings' }).click();
  await cara.getByRole('heading', { name: 'Meetings' }).waitFor();
  await cara.waitForTimeout(500);
  assert(await cara.getByText('Team sync').count() === 0, 'the meeting is gone from Cara\'s list');
  ok("Dan, who created Team sync, removed Cara: her app left the meeting and dropped it from her list");

  // ------------------------------------------------------------- the whiteboard: wins and challenges, live with names
  await dan.goto(url);
  await dan.getByRole('button', { name: 'New meeting' }).click();
  await dan.getByRole('button', { name: /^Wins and challenges of the month/ }).click();
  await dan.getByRole('button', { name: 'Create meeting' }).click();
  await dan.getByRole('heading', { name: /^Wins and challenges - [A-Z][a-z]+ \d{4}$/ }).waitFor();
  await dan.getByText('● Saved').waitFor({ timeout: 10000 });
  const wallLink = dan.url();
  await dan.getByRole('button', { name: 'Invite' }).click();
  await dan.getByRole('button', { name: 'QR code' }).click();
  const qrPixels = await dan.locator('svg.qr').evaluate(async (svg) => {
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: 400, height: 400 });
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 400, 400);
    return Array.from(g.getImageData(0, 0, 400, 400).data);
  });
  const decoded = jsQR(Uint8ClampedArray.from(qrPixels), 400, 400);
  assert(decoded?.data === wallLink, `QR decodes to the meeting link (got ${decoded?.data})`);
  await dan.keyboard.press('Escape');
  ok('The Invite QR code, made in the browser, scans back to the exact meeting link with its key');
  await cara.goto(wallLink);
  await cara.getByRole('heading', { name: /^Wins and challenges/ }).waitFor({ timeout: 15000 });
  await col(dan, 'Wins of the month').getByRole('button', { name: '+ Add card' }).click();
  await col(dan, 'Wins of the month').getByLabel('New card').pressSequentially('Shipped the new onboarding', { delay: 20 });
  const ghost = col(cara, 'Wins of the month').locator('.bcard.typing');
  await ghost.getByText('Dan', { exact: true }).waitFor({ timeout: 10000 });
  await ghost.getByText('Shipped the new onboarding').waitFor({ timeout: 10000 });
  await col(dan, 'Wins of the month').getByLabel('New card').press('Enter');
  const posted = col(cara, 'Wins of the month').locator('.bcard', { hasText: 'Shipped the new onboarding' }).filter({ hasNot: cara.locator('.caret') });
  await posted.locator('.name-tag', { hasText: 'Dan' }).waitFor({ timeout: 10000 });
  await ghost.waitFor({ state: 'detached', timeout: 10000 });
  await col(cara, 'Challenges').getByRole('button', { name: '+ Add card' }).click();
  await col(cara, 'Challenges').getByLabel('New card').fill('Too many context switches');
  await col(cara, 'Challenges').getByLabel('New card').press('Enter');
  await col(dan, 'Challenges').locator('.bcard', { hasText: 'Too many context switches' }).locator('.name-tag', { hasText: 'Cara' }).waitFor({ timeout: 10000 });
  await col(cara, 'Challenges').getByLabel('New card').fill('Hiring is **slow**');
  await col(cara, 'Challenges').getByRole('button', { name: 'Add', exact: true }).click();
  await col(cara, 'Challenges').getByLabel('New card').fill('Docs are out of date');
  await col(cara, 'Challenges').getByRole('button', { name: 'Done', exact: true }).click();
  for (const t of ['Hiring is slow', 'Docs are out of date']) await col(dan, 'Challenges').locator('.bcard', { hasText: t }).waitFor({ timeout: 10000 });
  await col(dan, 'Challenges').locator('.bcard strong', { hasText: 'slow' }).waitFor();
  ok('A card typed and then added with the Add or Done button is posted, not thrown away, and its Markdown shows as formatting');
  await dan.screenshot({ path: new URL('./shots/6-whiteboard.png', import.meta.url).pathname });
  await cara.getByRole('button', { name: 'Show Wins of the month full screen' }).click();
  const big = cara.locator('section.board-col.maximized');
  await big.getByText('Shipped the new onboarding').waitFor();
  const box = await big.boundingBox();
  assert(box.width >= 1390 && box.height >= 890, `the column fills the screen (${box.width}x${box.height})`);
  await cara.screenshot({ path: new URL('./shots/7-maximized.png', import.meta.url).pathname });
  await big.getByRole('button', { name: 'Next column' }).click();
  await cara.locator('section.board-col.maximized').getByText('Too many context switches').waitFor();
  await cara.keyboard.press('Escape');
  await cara.locator('section.board-col.maximized').waitFor({ state: 'detached' });
  assert(await dan.locator('section.board-col.maximized').count() === 0, 'maximizing is only for the person who does it');
  ok('Cara showed Wins of the month full screen, stepped to Challenges, and Esc brought the board back; Dan\'s view did not change');
  // Side space: fold the agenda to a rail, fold a panel, widen the right column; it is remembered after a reload.
  const boardW = async () => (await cara.locator('.board').boundingBox()).width;
  const w0 = await boardW();
  await cara.getByRole('button', { name: 'Fold the agenda' }).click();
  const rail = cara.getByRole('navigation', { name: 'Agenda (folded)' });
  await rail.getByRole('button', { name: /^1\. / }).waitFor();
  assert(await boardW() > w0 + 200, 'folding the agenda gives the board its space');
  await cara.getByRole('button', { name: 'People', exact: true }).click();
  await cara.locator('section.panel.folded', { hasText: 'People' }).waitFor();
  const handle = cara.getByRole('separator', { name: 'Resize the side panel' });
  const rightW = async () => (await cara.locator('aside.right').boundingBox()).width;
  const r0 = await rightW();
  await handle.focus(); for (let i = 0; i < 3; i++) await cara.keyboard.press('ArrowLeft');
  assert(await rightW() >= r0 + 100, `the right column widens (${r0} -> ${await rightW()})`);
  await cara.reload();
  await rail.waitFor({ timeout: 15000 });
  await cara.locator('section.panel.folded', { hasText: 'People' }).waitFor();
  assert(await rightW() >= r0 + 100, 'the wider right column is remembered');
  await cara.screenshot({ path: new URL('./shots/7b-folded.png', import.meta.url).pathname });
  await rail.getByRole('button', { name: 'Show the agenda' }).click();
  await cara.getByLabel('New agenda item').waitFor();
  await cara.getByRole('button', { name: 'People', exact: true }).click();
  await handle.dblclick();
  ok('Cara folded the agenda to a rail and the People panel, widened the side column, and it stayed that way after a reload');
  // The middle is the work area: any block moves there from its home in the side bar, and back.
  const mid = (p) => p.getByRole('main', { name: 'Middle' });
  const side = (p) => p.getByRole('complementary', { name: 'Side bar' });
  await cara.getByRole('button', { name: 'Show action items in the middle' }).click();
  await mid(cara).getByRole('region', { name: 'Action items' }).waitFor();
  assert((await mid(cara).locator(':scope > section').first().getAttribute('aria-label')) === 'Action items', 'the block just shown goes on top');
  assert(await mid(cara).locator(':scope > section').count() === 2, 'at most two blocks in the middle');
  await side(cara).getByRole('region', { name: 'Discussion' }).waitFor();
  await side(cara).getByRole('button', { name: 'Move action items back to the side bar' }).waitFor();
  await mid(cara).getByLabel('New action').fill('Cara to write up the onboarding lessons');
  await mid(cara).getByLabel('New action').press('Enter');
  await dan.getByText('Cara to write up the onboarding lessons').waitFor({ timeout: 10000 });
  await cara.screenshot({ path: new URL('./shots/7c-actions-middle.png', import.meta.url).pathname });
  await cara.getByRole('button', { name: 'Minimize action items to the side bar' }).click();
  await side(cara).getByRole('region', { name: 'Action items' }).waitFor();
  assert(await mid(cara).getByRole('region', { name: 'Action items' }).count() === 0, 'minimized back to its home');
  ok('Cara moved Action items to the middle (on top, two blocks at most), added an action Dan saw at once, and minimized it back to its place in the side bar');
  // A stage decides the middle: "Agree actions" shows action items and the discussion; the board waits in the side bar.
  await dan.locator('.agenda-item', { hasText: 'Agree actions' }).click();
  await mid(cara).getByRole('region', { name: 'Action items' }).waitFor({ timeout: 10000 });
  await mid(cara).getByRole('region', { name: 'Discussion' }).waitFor();
  await side(cara).getByRole('region', { name: 'Board' }).waitFor();
  await cara.screenshot({ path: new URL('./shots/7d-actions-stage.png', import.meta.url).pathname });
  await cara.getByRole('button', { name: 'Show board in the middle' }).click();
  await mid(cara).locator('section.board-col').first().waitFor();
  await side(dan).getByRole('region', { name: 'Board' }).waitFor();
  await dan.locator('.agenda-item', { hasText: 'Write notes on the board' }).click();
  await mid(dan).locator('section.board-col').first().waitFor({ timeout: 10000 });
  await mid(cara).getByRole('region', { name: 'Action items' }).waitFor({ state: 'detached', timeout: 10000 });
  ok('When Dan started "Agree actions", action items and the discussion took the middle and the board moved to the side bar; Cara could still bring the board up, and the next stage reset the screen');
  await dan.getByRole('button', { name: "I'm done" }).click();
  await cara.getByText('1/2 done').waitFor({ timeout: 10000 });
  assert(await cara.getByText('Everyone is done').count() === 0, 'not everyone is done yet');
  await cara.getByRole('button', { name: "I'm done" }).click();
  await cara.locator('.badge.all-done').waitFor({ timeout: 10000 });
  await dan.locator('.badge.all-done').waitFor({ timeout: 10000 });
  await dan.getByText('Everyone is done (2 of 2)').waitFor({ timeout: 10000 });
  await dan.locator('.badge.all-done').getByRole('button', { name: 'Clear' }).click();
  await cara.locator('.badge.all-done').waitFor({ state: 'detached', timeout: 10000 });
  ok('When Dan and Cara had both pressed "I\'m done", both were told everyone is done; the facilitator cleared it for the next round');
  // Brainstorm: many quick ideas, hidden from the others while collecting, then dots, then the best become actions.
  await cara.getByRole('button', { name: 'Show brainstorm in the middle' }).click();
  const bs = (p) => p.getByRole('region', { name: 'Brainstorm' });
  await mid(cara).getByRole('region', { name: 'Brainstorm' }).waitFor();
  await dan.getByRole('button', { name: 'Show brainstorm in the middle' }).click();
  await bs(dan).getByLabel("Hide others' ideas until voting").check();
  assert(await bs(cara).getByLabel("Hide others' ideas until voting").count() === 0, 'only the facilitator runs the steps');
  for (const idea of ['Quarterly demo day', 'Shadow a support shift']) {
    await bs(cara).getByLabel('New idea').fill(idea);
    await bs(cara).getByLabel('New idea').press('Enter');
  }
  await bs(dan).getByText('2 ideas').waitFor({ timeout: 10000 });
  await bs(dan).getByLabel('New idea').fill('Lunch and learn');
  await bs(dan).getByLabel('New idea').press('Enter');
  await bs(dan).getByText('2 more from others, shown when voting starts').waitFor();
  assert(await bs(dan).getByText('Quarterly demo day').count() === 0, 'others\' ideas stay hidden while collecting');
  await bs(cara).getByText('1 more from others').waitFor({ timeout: 10000 });
  await bs(dan).getByRole('button', { name: 'Vote' }).click();
  const idea = (p, t) => bs(p).locator('.idea', { hasText: t });
  await idea(dan, 'Quarterly demo day').waitFor({ timeout: 10000 });
  await idea(dan, 'Quarterly demo day').getByRole('button', { name: 'Add dot' }).click();
  await idea(dan, 'Quarterly demo day').getByRole('button', { name: 'Add dot' }).click();
  await idea(dan, 'Lunch and learn').getByRole('button', { name: 'Add dot' }).click();
  assert(await idea(dan, 'Shadow a support shift').getByRole('button', { name: 'Add dot' }).isDisabled(), 'three dots each');
  await idea(cara, 'Quarterly demo day').getByRole('button', { name: 'Add dot' }).click();
  await bs(dan).getByRole('button', { name: 'Pick' }).click();
  await bs(dan).locator('.idea').first().getByText('3 dots').waitFor({ timeout: 10000 });
  assert((await bs(dan).locator('.idea').first().innerText()).includes('Quarterly demo day'), 'most dots first');
  await cara.screenshot({ path: new URL('./shots/8-brainstorm.png', import.meta.url).pathname });
  await idea(dan, 'Quarterly demo day').getByRole('button', { name: /^Make an action/ }).click();
  await idea(cara, 'Quarterly demo day').getByText('Action added').waitFor({ timeout: 10000 });
  await side(cara).getByRole('region', { name: 'Action items' }).getByText('Quarterly demo day').waitFor();
  ok('Brainstorm: Cara and Dan added ideas without seeing each other\'s, Dan (facilitating) moved to dots, three each, and the top idea became an action item for everyone');
  // Command palette: Ctrl+K (or the Search button) finds cards, ideas, actions and agenda items, and runs commands.
  const palette = cara.getByRole('dialog', { name: 'Command palette' });
  const paletteInput = palette.getByLabel('Search or type a command');
  await cara.keyboard.press('Control+k');
  await paletteInput.fill('onboarding');
  await palette.getByRole('group', { name: 'Action items' }).getByRole('option', { name: /Cara to write up the onboarding lessons/ }).waitFor();
  await palette.getByRole('group', { name: 'Cards' }).getByRole('option', { name: /Shipped the new onboarding/ }).waitFor();
  await cara.screenshot({ path: new URL('./shots/9-palette.png', import.meta.url).pathname });
  await paletteInput.press('ArrowDown');
  await palette.getByRole('option', { selected: true }).waitFor();
  await paletteInput.fill('write up the onboarding');
  await paletteInput.press('Enter');
  await palette.waitFor({ state: 'detached' });
  await mid(cara).getByRole('region', { name: 'Action items' }).locator('.action.found').waitFor();
  ok('Cara pressed Ctrl+K, typed "onboarding" and saw the matching card and action; Enter brought action items to the middle and highlighted the action');
  await cara.getByRole('button', { name: 'Search and commands' }).click();
  await paletteInput.fill('fold people');
  await paletteInput.press('Enter');
  await cara.locator('section.panel.folded', { hasText: 'People' }).waitFor();
  await cara.keyboard.press('Control+k');
  await paletteInput.fill('theme dark');
  await paletteInput.press('Enter');
  assert(await cara.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'the theme switched to dark');
  await cara.keyboard.press('Control+k');
  await paletteInput.fill('theme system');
  await paletteInput.press('Enter');
  await cara.keyboard.press('Control+k');
  await paletteInput.fill('zzzz nothing');
  await palette.getByText('Nothing found').waitFor();
  await cara.keyboard.press('Escape');
  await palette.waitFor({ state: 'detached' });
  await cara.keyboard.press('Control+k');
  await paletteInput.fill('unfold people');
  await paletteInput.press('Enter');
  ok('From the palette Cara folded People, switched to the dark theme and back, and Esc closed it');
  ok('Wins and challenges: Cara watched Dan type a win live under his name tag, and notes post straight to the board with names, no drafts');

  // Moving to another browser: Dan backs up with a passphrase and restores it in a fresh browser, where he is still facilitator.
  const winsUrl = dan.url();
  await dan.keyboard.press('Control+k');
  await dan.getByLabel('Search or type a command').fill('back up');
  await dan.getByLabel('Search or type a command').press('Enter');
  const bk = dan.getByRole('dialog', { name: 'Move to another browser' });
  await bk.getByText('anyone who has it can open them').waitFor();
  await bk.getByLabel('Passphrase (optional)').fill('blue ladder 42');
  await bk.getByLabel('Repeat passphrase').fill('blue ladder 42');
  await dan.screenshot({ path: new URL('./shots/10-backup.png', import.meta.url).pathname });
  const [dl] = await Promise.all([dan.waitForEvent('download'), bk.getByRole('button', { name: 'Download backup' }).click()]);
  const backupPath = await dl.path();
  const backupText = fs.readFileSync(backupPath, 'utf8');
  assert(dl.suggestedFilename().startsWith('rondel-backup-'), 'backup file name');
  assert(backupText.includes('"encrypted":true') && !backupText.includes('Wins and challenges'), 'the protected backup has nothing readable in it');
  const laptop = await person('Dan');
  await laptop.getByRole('button', { name: 'Dan' }).first().click();
  await laptop.getByRole('button', { name: 'Back up or restore…' }).click();
  const rs = laptop.getByRole('dialog', { name: 'Move to another browser' });
  await rs.getByLabel('Backup file').setInputFiles(backupPath);
  await rs.getByText('· protected').waitFor();
  assert(await rs.getByRole('button', { name: 'Restore' }).isDisabled(), 'needs the passphrase');
  await rs.getByLabel('Backup passphrase').fill('wrong');
  await rs.getByRole('button', { name: 'Restore' }).click();
  await laptop.getByText('Wrong passphrase').waitFor();
  await rs.getByLabel('Backup passphrase').fill('blue ladder 42');
  assert(await rs.getByRole('checkbox', { name: /Be the same person/ }).isChecked(), 'a fresh browser takes the identity by default');
  await rs.getByRole('button', { name: 'Restore' }).click();
  await laptop.getByRole('dialog', { name: 'Backup restored' }).getByText(/Added [2-9] meetings/).waitFor();
  await laptop.getByRole('button', { name: 'Done' }).click();
  await laptop.locator('li.link', { hasText: 'Wins and challenges' }).waitFor({ timeout: 10000 });
  await laptop.goto(winsUrl);
  await laptop.getByRole('heading', { name: /^Wins and challenges/ }).waitFor({ timeout: 15000 });
  await laptop.getByRole('button', { name: 'Settings' }).waitFor();
  ok('Dan backed up his browser with a passphrase from the palette and restored it in a new browser (a wrong passphrase was refused): his meetings are listed there and he is still facilitator');
  // A new version of the template, from inside the meeting and from the template picker.
  await laptop.keyboard.press('Control+k');
  await laptop.getByLabel('Search or type a command').fill('new template');
  await laptop.getByLabel('Search or type a command').press('Enter');
  const ed = laptop.getByRole('dialog', { name: 'Save as a new template' });
  const v2 = await ed.getByRole('textbox', { name: 'Name', exact: true }).inputValue();
  assert(/ \(v2\)$/.test(v2), `the new version is named as one (${v2})`);
  await ed.getByRole('button', { name: 'Save template' }).click();
  await ed.waitFor({ state: 'detached' });
  await laptop.goto(url);
  await laptop.getByRole('button', { name: 'New meeting' }).click();
  await laptop.locator('.template-slot', { hasText: v2 }).hover();
  await laptop.screenshot({ path: new URL('./shots/11-new-version.png', import.meta.url).pathname });
  await laptop.getByRole('button', { name: `New version of ${v2}` }).click();
  const ed3 = laptop.getByRole('dialog').filter({ has: laptop.getByRole('button', { name: 'Save template' }) });
  assert(await ed3.getByRole('textbox', { name: 'Name', exact: true }).inputValue() === v2.replace('(v2)', '(v3)'), 'a version of a version is the next number');
  await ed3.getByRole('button', { name: 'Save template' }).click();
  await laptop.getByRole('button', { name: `New version of ${v2.replace('(v2)', '(v3)')}` }).waitFor();
  assert(await laptop.getByRole('button', { name: `Edit ${v2}` }).count() === 1, 'the earlier version is still there');
  ok('Dan saved the meeting as a new version of its template ("… (v2)"), then made a v3 from the picker; v2 stayed as it was');

  // ------------------------------------------------------------- installable, and opens offline
  const fay = await person('Fay');
  const manifest = await fay.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert(manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512'), `manifest: ${JSON.stringify(manifest)}`);
  await fay.evaluate(() => navigator.serviceWorker.ready);
  await fay.reload();
  await fay.waitForFunction(() => !!navigator.serviceWorker.controller);
  await fay.context().setOffline(true);
  await fay.reload();
  await fay.getByRole('button', { name: 'New meeting' }).waitFor({ timeout: 10000 });
  await fay.context().setOffline(false);
  ok('Rondel can be installed as an app (manifest, service worker), and Fay could reopen it with no connection');

  if (!external) {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(path.join(dataDir, 'rondel.sqlite'));
    const all = db.prepare('SELECT data FROM entries').all().map((r) => Buffer.from(r.data, 'base64').toString('latin1')).join('');
    db.close();
    for (const s of ['Quarterly planning', 'Budget for Q1', 'Shipped the mobile app', 'Freeze hiring']) assert(!all.includes(s), `server must not hold "${s}" in plain text`);
    ok('The server database holds only encrypted data (no meeting text found in it)');
  }

  assert(errors.length === 0, `no page errors:\n${errors.join('\n')}`);
  ok('No errors in any browser');
  console.log('\nAll server-mode checks passed.');
} catch (e) {
  console.error('\nFAILED:', e.message);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  await stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
  setTimeout(() => process.exit(), 100);
}
