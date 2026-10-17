// Run with: node --import tsx e2e/site.mjs
// Self-hosting settings: the product name, who runs the site (footer and data page), and a templates folder
// copied in by scripts/site-config.mjs. Also checks the defaults when no operator is set.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 8795;
const check = (cond, msg) => { if (!cond) throw new Error(msg); };
let step = 0;
const ok = (msg) => console.log(`✓ ${++step}. ${msg}`);

// Apply deploy/example to a copy of dist, the way the Docker image does at start.
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-site-dist-'));
fs.cpSync('dist', dist, { recursive: true });
execFileSync('node', ['scripts/site-config.mjs', 'deploy/example/site.json'], { env: { ...process.env, RONDEL_DIST: dist + '/' } });
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
check(html.includes('"Example Corp IT"') && html.includes('templates/weekly-team-meeting.yaml'), 'site settings merged into index.html');
check(fs.existsSync(path.join(dist, 'templates/weekly-team-meeting.yaml')), 'templates copied');
check(!fs.readFileSync('dist/index.html', 'utf8').includes('Example Corp'), 'the original dist is untouched');
ok('site-config merges the settings into index.html and copies the templates folder');

const { createServer } = await import('../server/node/server.ts');
const srv = createServer({ staticDir: dist, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rondel-site-')) });
await new Promise((r) => srv.server.listen(PORT, r));
const url = `http://localhost:${PORT}/`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => localStorage.setItem('rondel:me', JSON.stringify({ id: 'site-test-user', name: 'Ana' })));
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByRole('heading', { name: 'Meetings' }).first().waitFor();
  const footer = page.locator('footer');
  check((await footer.innerText()).includes('Run by Example Corp IT'), `footer: ${await footer.innerText()}`);
  check(await footer.getByRole('link', { name: 'Example Corp IT' }).getAttribute('href') === 'https://intranet.example.com/it', 'operator link');
  check(await footer.getByRole('link', { name: 'Open source' }).getAttribute('href') === 'https://github.com/spikinglabs/rondel', 'source link');
  ok('The footer says who runs the site and links to the source');

  await page.getByRole('button', { name: 'New meeting' }).click();
  await page.getByText('Weekly team meeting').first().waitFor();
  ok('The organisation template from the templates folder is offered for a new meeting');

  await page.goto(`${url}#/data`);
  const body = page.locator('body');
  await body.getByText("Rondel runs on Example Corp's own servers in Frankfurt.").waitFor();
  await body.getByText('nobody has changed it for 90 days and nobody').waitFor();
  check(await page.locator('.data-section').getByRole('link', { name: 'Example Corp IT' }).getAttribute('href') === 'mailto:it-help@example.com', 'contact link');
  ok('The data page shows the hosting sentence, retention and the contact address');

  // A site with its own name and no operator.
  const plain = await browser.newContext();
  await plain.addInitScript(() => {
    window.RONDEL_CONFIG = { sync: 'server', name: 'Huddle' };
    localStorage.setItem('rondel:me', JSON.stringify({ id: 'site-test-ben', name: 'Ben' }));
  });
  const p2 = await plain.newPage();
  await p2.goto(url);
  await p2.getByRole('heading', { name: 'Meetings' }).first().waitFor();
  check(await p2.title() === 'Huddle', `title ${await p2.title()}`);
  const f2 = await p2.locator('footer').innerText();
  check(f2.startsWith('Huddle ') && !f2.includes('Run by'), `footer: ${f2}`);
  await p2.goto(`${url}#/data`);
  await p2.locator('body').getByText('is run by your organisation or whoever set it up').waitFor();
  await p2.locator('body').getByText('(the default; whoever runs this site can change it)').waitFor();
  ok('Without an operator the name is used in the title and footer, and the data page falls back to generic wording');
} finally {
  await browser.close();
  srv.server.close();
}
