// Run with: node --import tsx e2e/data.mjs
// The "How your data is handled" page: reachable before entering a name, from the footer, home and the palette.
//   BASE_URL=http://localhost:8788/ node --import tsx e2e/data.mjs   → tests a running server
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const external = process.env.BASE_URL;
const PORT = 8793;
let srv = null;
if (!external) {
  const { createServer } = await import('../server/node/server.ts');
  srv = createServer({ staticDir: 'dist', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-data-')) });
  await new Promise((r) => srv.server.listen(PORT, r));
}
const url = external ?? `http://localhost:${PORT}/`;
const shots = process.env.SHOTS;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors = [];
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const heading = (p) => p.getByRole('heading', { name: 'How your data is handled' });

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator('footer').getByRole('link', { name: 'How your data is handled' }).click();
  await heading(page).waitFor();
  await page.getByText('On this site:').waitFor({ timeout: 8000 });
  if (shots) await page.screenshot({ path: `${shots}/data-desktop.png`, fullPage: true });
  ok('The footer link opens the page before anyone has entered a name');

  await page.goto(url);
  await page.getByLabel('Your name').fill('Ana');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('main, .page').getByRole('link', { name: 'How your data is handled' }).first().click();
  await heading(page).waitFor();
  ok('Home’s How it works card links to it');

  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'New meeting' }).waitFor();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await page.keyboard.type('privacy');
  await page.getByRole('option', { name: /How your data is handled/ }).or(page.getByText('How your data is handled', { exact: true }).last()).first().click();
  await heading(page).waitFor();
  ok('Back returns home, and the command palette finds the page by “privacy”');

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const p2 = await phone.newPage();
  await p2.goto(url + '#/data');
  await heading(p2).waitFor();
  const wide = await p2.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (wide) throw new Error('page scrolls sideways on a phone');
  if (shots) await p2.screenshot({ path: `${shots}/data-phone.png`, fullPage: true });
  ok('It fits a phone screen without sideways scrolling');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('All data page checks passed');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (srv) await srv.close();
}
