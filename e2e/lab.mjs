// Run with: node --import tsx e2e/lab.mjs
// Lab rollout basics: the Lab tag, version and feedback link, and the error screen instead of a blank page.
//   BASE_URL=https://rondel-staging.spikinglabs.workers.dev/ node --import tsx e2e/lab.mjs   → tests a deployed site as configured
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const external = process.env.BASE_URL;
const PORT = 8794;
let srv = null;
if (!external) {
  const { createServer } = await import('../server/node/server.ts');
  srv = createServer({ staticDir: 'dist', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-lab-')) });
  await new Promise((r) => srv.server.listen(PORT, r));
}
const url = external ?? `http://localhost:${PORT}/`;
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);
const check = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  if (!external) await ctx.addInitScript(() => { window.RONDEL_CONFIG = { sync: 'auto', lab: true, feedback: 'https://github.com/example/rondel/issues/new' }; });
  await ctx.addInitScript(() => localStorage.setItem('rondel:me', JSON.stringify({ id: 'lab-test-user', name: 'Ana' })));
  const page = await ctx.newPage();
  await page.goto(url);
  await page.locator('.lab-tag').waitFor();
  const footer = await page.locator('footer').innerText();
  check(footer.includes(`Rondel ${version}`), `footer shows ${footer}`);
  const href = await page.locator('footer').getByRole('link', { name: 'Send feedback' }).getAttribute('href');
  check(/\/issues\/new\?/.test(href) && decodeURIComponent(href.replace(/\+/g, ' ')).includes(`Rondel feedback (${version})`), `feedback link ${href}`);
  ok(`Lab tag, version ${version} in the footer, and Send feedback opens a new issue with the version filled in`);

  // What search engines and AI assistants read without running the app; staging stays out of search results.
  const html = await (await fetch(url)).text();
  check(html.includes('<meta name="description"') && html.includes('<main class="boot">'), 'description and start-up text in the page');
  const staging = /staging/.test(url);
  check(html.includes('<meta name="robots" content="noindex"') === staging, staging ? 'staging is noindex' : 'the site is indexable');
  check((await (await fetch(new URL('robots.txt', url))).text()).includes('User-agent'), 'robots.txt is served');
  ok(`The page carries a description and readable text, robots.txt is served, and ${staging ? 'staging is kept out of search results' : 'the site can be indexed'}`);

  await page.goto(`${url}#/crash-test`);
  await page.getByRole('heading', { name: 'Something went wrong on this page' }).waitFor();
  const details = await page.getByLabel('Error details').inputValue();
  check(details.includes(`Rondel ${version}`) && details.includes('Crash test'), `details: ${details.slice(0, 80)}`);
  check(!details.includes('#/'), 'details must not contain the page address');
  ok('A page that fails to render shows the error screen with copyable details and no link');

  await page.getByRole('link', { name: 'Back to my meetings' }).click();
  await page.getByRole('heading', { name: 'Meetings' }).first().waitFor();
  ok('Back to my meetings clears the error screen');

  // Retention and deleting a meeting from the server.
  await page.getByRole('button', { name: 'New meeting' }).click();
  await page.getByLabel('Title').fill('Lab delete test');
  await page.getByRole('button', { name: 'Create meeting' }).click();
  await page.getByRole('heading', { name: 'Lab delete test' }).waitFor();
  await page.getByText('● Saved').waitFor({ timeout: 10000 });
  const link = page.url();
  const ben = await browser.newContext();
  await ben.addInitScript(() => localStorage.setItem('rondel:me', JSON.stringify({ id: 'lab-test-ben', name: 'Ben' })));
  const benPage = await ben.newPage();
  await benPage.goto(link);
  await benPage.getByRole('heading', { name: 'Lab delete test' }).waitFor({ timeout: 15000 });
  await benPage.goto(`${url}#/`);
  await page.getByRole('button', { name: 'Settings' }).click();
  const until = await page.getByText(/Stored, encrypted, until/).innerText();
  const year = new Date(Date.now() + 90 * 86_400_000).getFullYear();
  check(until.includes(String(year)), `expiry shown: ${until}`);
  ok(`Meeting settings say how long the server keeps the meeting: "${until.slice(0, 60)}…"`);

  await page.getByRole('button', { name: 'Delete from server…' }).click();
  await page.locator('.dialog, [role=dialog]').last().getByRole('button', { name: /^(OK|Yes|Delete|Confirm)$/ }).click();
  await page.getByRole('heading', { name: 'This meeting was deleted' }).waitFor({ timeout: 10000 });
  await benPage.goto(link);
  await benPage.getByRole('heading', { name: 'This meeting was deleted' }).waitFor({ timeout: 15000 });
  await benPage.goto(`${url}#/`);
  await benPage.getByRole('heading', { name: 'Meetings' }).first().waitFor();
  check((await benPage.getByText('Lab delete test').count()) === 0, "Ben's browser still lists the deleted meeting");
  await ben.close();
  ok("A facilitator deleted the meeting from the server; Ben's browser, which had a copy, can't bring it back and drops it");
  console.log('\nAll lab checks passed.');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  if (srv) await srv.close();
}
