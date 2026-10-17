// Run with: node --import tsx e2e/series.mjs
// Recurring series: one link for the calendar invite opens the current meeting, the first opener creates it,
// a closed meeting offers another one with open actions carried over, and series facilitators stay facilitators.
//   BASE_URL=http://localhost:8788/ node --import tsx e2e/series.mjs   → tests a running server
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const external = process.env.BASE_URL;
const PORT = 8792;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-series-'));
let srv = null;
if (!external) {
  const { createServer } = await import('../server/node/server.ts');
  srv = createServer({ staticDir: 'dist', dataDir });
  await new Promise((r) => srv.server.listen(PORT, r));
}
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
  await page.goto(url);
  await page.getByLabel('Your name').fill(name);
  await page.getByRole('button', { name: 'Continue' }).click();
  return page;
}
const meetingHeading = (page) => page.locator('.meeting-head h1, h1').first();
async function createSeries(page, template, name, repeat) {
  await page.goto(url);
  await page.getByRole('button', { name: 'New meeting' }).click();
  await page.getByRole('button', { name: template }).click();
  await page.getByLabel('Series name').fill(name);
  await page.getByLabel('Repeats').selectOption({ label: repeat });
  await page.getByRole('button', { name: 'Create series' }).click();
  await page.getByRole('heading', { name: 'Put this in the calendar invite' }).waitFor();
  await page.getByText(/Saved|Connected/).first().waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page.getByLabel('Series link').inputValue();
}

try {
  // ------------------------------------------------------------- Ana sets up a weekly series
  const ana = await person('Ana');
  const link = await createSeries(ana, /^Went well/, 'Team retro', 'Weekly, or every few weeks');
  assert(link.includes('#/s/'), `series link looks wrong: ${link}`);
  const ics = await Promise.all([ana.waitForEvent('download'), ana.getByRole('button', { name: /calendar file/ }).click()]).then(([d]) => d.path()).then((p) => fs.readFileSync(p, 'utf8'));
  assert(ics.includes('RRULE:FREQ=WEEKLY') && ics.replace(/\r\n /g, '').includes(link), 'calendar file lacks the rule or link');
  ok('Ana created a weekly series and got one link plus a calendar file with it');

  await ana.goto(link);
  await ana.getByRole('heading', { name: /^Team retro – / }).waitFor({ timeout: 15000 });
  const week1 = ana.url();
  assert(week1.includes('#/m/'), 'series link did not open a meeting');
  await ana.getByLabel('New action').fill('Book the offsite room');
  await ana.getByLabel('New action').press('Enter');
  await ana.getByText('Book the offsite room').waitFor();
  await ana.getByText('● Saved').waitFor({ timeout: 10000 });
  ok('Opening the series link created this week’s meeting');
  const weekTitle = await ana.getByRole('heading', { name: /^Team retro – Week \d+, \d{4}$/ }).textContent();
  ok(`The meeting is titled with its week: “${weekTitle}”`);

  // ------------------------------------------------------------- Ben uses the same link
  const ben = await person('Ben');
  await ben.goto(link);
  await ben.getByText('Book the offsite room').waitFor({ timeout: 15000 });
  assert(ben.url() === week1, `Ben landed elsewhere: ${ben.url()}`);
  ok('Ben opened the same link and joined the same meeting, not a new one');

  // ------------------------------------------------------------- Ana closes; Ben starts another one this week
  await ana.getByRole('button', { name: 'Close meeting' }).click();
  await ana.getByRole('button', { name: 'OK' }).click();
  await ana.getByText('This meeting is closed').first().waitFor();
  await ana.waitForTimeout(1500);
  await ben.goto(url);
  await ben.goto(link);
  await ben.getByRole('heading', { name: /is closed$/ }).waitFor({ timeout: 15000 });
  ok('After Ana closed it, the link shows the closed meeting instead of silently making a new one');
  await ben.getByRole('button', { name: 'Start another meeting this week' }).click();
  await ben.getByRole('heading', { name: /\(2\)$/ }).waitFor({ timeout: 20000 });
  await ben.getByText('● Saved').waitFor({ timeout: 10000 });
  assert(!(await ben.getByText('Book the offsite room').count()), 'actions should not carry over');
  const week1b = ben.url();
  assert(week1b !== week1, 'second meeting reused the first room');
  ok('Ben started a second meeting this week; it starts fresh, nothing carried over');
  await ben.getByText('● Saved').waitFor({ timeout: 10000 });
  assert(!(await ben.getByRole('button', { name: 'Close meeting' }).isVisible()), 'Ben should not be facilitator');
  ok('Ben started it but Ana, the series facilitator, stays the facilitator');
  await ben.getByRole('button', { name: 'Facilitate', exact: true }).or(ben.getByRole('button', { name: 'Facilitate this meeting' })).first().click();
  await ben.getByRole('button', { name: 'Close meeting' }).waitFor();
  ok('Ben claimed facilitation with one click and got the facilitator controls');

  const cleo = await person('Cleo');
  await cleo.goto(link);
  await cleo.getByRole('heading', { name: /\(2\)$/ }).waitFor({ timeout: 15000 });
  assert(cleo.url() === week1b, 'Cleo did not land on the second meeting');
  await cleo.goto(link.replace(/\/?$/, '') + '/overview');
  await cleo.getByText(/Team retro – .*\(2\)/).waitFor();
  ok('Cleo’s link opened the second meeting; the overview lists both');

  // ------------------------------------------------------------- anyone can prepare next week's meeting early
  await cleo.goto(link);
  await cleo.getByRole('heading', { name: /\(2\)$/ }).waitFor({ timeout: 15000 });
  await cleo.getByRole('button', { name: 'Start next occurrence' }).click();
  const nextTitle = (n) => new RegExp(`^Team retro – Week ${n}, \\d{4}$`);
  const thisWeek = Number(weekTitle.match(/Week (\d+)/)[1]);
  const nextWeek = thisWeek >= 52 ? null : thisWeek + 1;
  if (nextWeek) await cleo.getByRole('heading', { name: nextTitle(nextWeek) }).waitFor({ timeout: 20000 });
  const prepared = cleo.url();
  assert(prepared !== week1b, 'next occurrence reused this week’s room');
  await cleo.getByText('● Saved').waitFor({ timeout: 10000 });
  await cleo.goto(link);
  await cleo.getByRole('heading', { name: /\(2\)$/ }).waitFor({ timeout: 15000 });
  await cleo.getByRole('button', { name: 'Open next occurrence' }).click();
  await cleo.waitForURL(prepared, { timeout: 10000 });
  ok('Cleo started next week’s meeting early; the series link still opens this week’s, and “Open next occurrence” returns to it');

  // ------------------------------------------------------------- a facilitator deletes one series meeting
  await ben.goto(week1b);
  await ben.getByRole('heading', { name: /\(2\)$/ }).waitFor({ timeout: 15000 });
  await ben.getByRole('button', { name: 'Settings' }).click();
  await ben.getByRole('button', { name: 'Delete from server…' }).click();
  await ben.getByRole('button', { name: 'OK' }).click();
  await ben.getByRole('heading', { name: 'This meeting was deleted' }).waitFor({ timeout: 15000 });
  await cleo.goto(url);
  await cleo.goto(link);
  await cleo.getByRole('heading', { name: /\(2\) was deleted$/ }).waitFor({ timeout: 15000 });
  assert(!(await cleo.getByRole('button', { name: 'Open the minutes' }).count()), 'a deleted meeting has no minutes to open');
  await cleo.getByText('Deleted', { exact: true }).waitFor();
  ok('Ben deleted the second meeting from the server; the series link says so and offers another meeting this week');


  // ------------------------------------------------------------- two people open a fresh series at the same moment
  const link2 = await createSeries(ana, /^Daily stand-up/, 'Stand-up', 'Daily');
  await Promise.all([ben.goto(link2), cleo.goto(link2)]);
  await Promise.all([ben, cleo].map((p) => p.getByRole('heading', { name: /^Stand-up – / }).waitFor({ timeout: 20000 })));
  assert(ben.url() === cleo.url(), 'simultaneous openers got different meetings');
  await ben.waitForTimeout(2000);
  const counts = await Promise.all([ben, cleo].map((p) => p.locator('.agenda-item, [data-agenda-item]').count()));
  assert(counts.every((n) => n === 2), `expected the stand-up's 2 agenda items once, got ${counts.join('/')}`);
  ok('Ben and Cleo opened a new series at the same moment and share one meeting with one agenda');

  // ------------------------------------------------------------- the series facilitator deletes the whole series
  const standup = ben.url();
  await ana.goto(link2.replace(/\/?$/, '') + '/overview');
  await ana.getByRole('button', { name: 'Delete series from server…' }).click();
  await ana.getByRole('button', { name: 'OK' }).click();
  await ana.waitForURL(/#\/$/, { timeout: 30000 });
  assert(!(await ana.locator('.page').getByText(/^Stand-up/).count()), 'the deleted series is still listed on Ana’s home page');
  await ben.getByRole('heading', { name: 'This meeting was deleted' }).waitFor({ timeout: 15000 });
  await cleo.goto(url);
  await cleo.goto(link2);
  await cleo.getByRole('heading', { name: 'This meeting series was deleted' }).waitFor({ timeout: 15000 });
  assert(standup.includes('#/m/'), 'Ben was not in the stand-up meeting');
  ok('Ana deleted the stand-up series: its meeting closed for Ben, and the series link now says it was deleted');

  assert(errors.length === 0, `page errors:\n${errors.join('\n')}`);
  console.log('All series checks passed');
} catch (e) {
  console.error(e);
  if (errors.length) console.error(errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  if (srv) await srv.close();
}
