// Run with: node --import tsx e2e/languages.mjs
// Interface languages, tested with German: a browser set to German gets it, the choice can be changed in preferences,
// and a meeting's own content stays as written.
//   BASE_URL=http://localhost:8788/ node --import tsx e2e/languages.mjs   → tests a running server
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const external = process.env.BASE_URL;
const PORT = 8796;
let srv = null;
if (!external) {
  const { createServer } = await import('../server/node/server.ts');
  srv = createServer({ staticDir: 'dist', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-de-')) });
  await new Promise((r) => srv.server.listen(PORT, r));
}
const url = external ?? `http://localhost:${PORT}/`;
const shots = path.resolve('e2e/shots');
fs.mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const assert = (c, m) => { if (!c) throw new Error(m); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'de-DE' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  assert(await page.evaluate(() => document.documentElement.lang) === 'de', 'html lang should be de');
  await page.getByLabel('Ihr Name').fill('Ana');
  await page.getByRole('button', { name: 'Weiter' }).click();
  await page.getByRole('button', { name: 'Neues Meeting' }).first().waitFor();
  await page.locator('footer').getByRole('link', { name: 'Wie Ihre Daten behandelt werden' }).waitFor();
  ok('A browser set to German gets the German interface, from the name prompt on');

  await page.getByRole('button', { name: 'Neues Meeting' }).first().click();
  await page.getByRole('button', { name: 'Meeting erstellen' }).click();
  await page.locator('.meeting-head h1, h1').first().waitFor();
  await page.getByRole('button', { name: 'Einladen' }).waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: 'Agenda' }).first().waitFor();
  await page.getByText('Aufgaben vereinbaren').first().waitFor();
  await page.screenshot({ path: `${shots}/de-meeting.png` });
  // Nothing visible should still be in English on the main meeting screen (a short list of common words).
  const body = await page.locator('body').innerText();
  const english = ['Invite', 'Settings', 'Close meeting', 'Action items', 'Decisions', 'People', 'Minutes', 'Save file', 'Search'].filter((w) => new RegExp(`(^|\\n)${w}(\\n|$)`).test(body));
  assert(!english.length, `English left on the meeting screen: ${english.join(', ')}`);
  ok('A new meeting opens with German controls and a German agenda from the built-in template, and no common English labels left');

  await page.getByRole('button', { name: 'Protokoll' }).first().click();
  await page.getByRole('button', { name: 'Für E-Mail kopieren' }).or(page.getByRole('button', { name: /E-Mail/ })).first().waitFor();
  await page.keyboard.press('Escape');
  ok('The minutes window is in German too');

  // German words are longer: the meeting and home screens must still fit a phone without sideways scrolling.
  const meetingUrl = page.url();
  const phone = await browser.newContext({ viewport: { width: 360, height: 780 }, locale: 'de-DE', isMobile: true, hasTouch: true });
  const p = await phone.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.getByLabel('Ihr Name').fill('Ben');
  await p.getByRole('button', { name: 'Weiter' }).click();
  await p.getByRole('button', { name: 'Neues Meeting' }).first().waitFor();
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(await overflow() <= 0, `home overflows by ${await overflow()}px at 360px`);
  await p.goto(meetingUrl);
  await p.getByRole('button', { name: 'Einladen' }).waitFor({ timeout: 15000 });
  await p.screenshot({ path: `${shots}/de-phone.png`, fullPage: true });
  assert(await overflow() <= 0, `meeting overflows by ${await overflow()}px at 360px`);
  await phone.close();
  ok('In German, home and the meeting still fit a 360px phone screen');

  await page.locator('.me-button').click();
  await page.locator('.modal').getByLabel('Sprache').selectOption('en');
  await Promise.all([page.waitForEvent('load'), page.locator('.modal').getByRole('button', { name: 'Speichern', exact: true }).click()]);
  await page.getByRole('button', { name: 'Invite' }).waitFor({ timeout: 15000 });
  ok('Switching the language to English in the preferences reloads the page in English');

  const menu = await page.locator('.site-footer').getByLabel('Language').boundingBox();
  assert(menu && menu.width < 200, `the footer language menu is ${menu?.width}px wide; it should fit its longest language name`);
  await Promise.all([page.waitForEvent('load'), page.locator('.site-footer').getByLabel('Language').selectOption('de')]);
  await page.getByRole('button', { name: 'Einladen' }).waitFor({ timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.locator('.site-footer').getByLabel('Sprache').selectOption('en')]);
  await page.getByRole('button', { name: 'Invite' }).waitFor({ timeout: 15000 });
  ok('The language menu at the bottom of every page switches the language straight away');

  assert(errors.length === 0, `page errors:\n${errors.join('\n')}`);
  console.log('All German interface checks passed');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (srv) await srv.close();
}
