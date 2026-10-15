// Every main screen at phone width: no sideways scrolling, nothing wider than the screen.
// Run: node --import tsx e2e/mobile.mjs   (BASE_URL to test a deployed site instead of a local server)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shots = new URL('./shots/', import.meta.url).pathname;
let server = null;
let base = process.env.BASE_URL;
if (!base) {
  const port = 8800 + Math.floor(Math.random() * 100);
  server = spawn(process.execPath, ['--import', 'tsx', 'server/node/server.ts'], { env: { ...process.env, PORT: String(port), DATA_DIR: mkdtempSync(join(tmpdir(), 'rondel-m-')) }, stdio: 'ignore' });
  base = `http://localhost:${port}/`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + 'api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 200)); }
}
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
try {
  for (const width of [360, 390]) {
    const page = await (await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true })).newPage();
    const check = async (name) => {
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const vw = window.innerWidth;
        const wide = [...document.querySelectorAll('body *')].filter((el) => {
          const b = el.getBoundingClientRect();
          return b.width > 0 && b.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.parentElement?.closest('.board');
        }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(el.getBoundingClientRect().right)}`);
        return { overflow: document.documentElement.scrollWidth - vw, wide };
      });
      const modalOver = await page.evaluate(() => { const m = document.querySelector('.modal .body'); return m ? m.scrollWidth - m.clientWidth : 0; });
      await page.screenshot({ path: `${shots}m-${width}-${name}.png`, fullPage: true });
      const bad = r.overflow > 1 || modalOver > 1 || r.wide.length;
      console.log(`${bad ? '✗' : '✓'} ${width}px ${name}${bad ? ` page+${r.overflow} modal+${modalOver} ${r.wide.join(' | ')}` : ''}`);
      if (bad) failures.push(`${width} ${name}`);
    };
    await page.goto(base);
    await page.getByRole('textbox').first().fill('Ana');
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Meetings' }).waitFor();
    await check('home');
    await page.getByRole('button', { name: 'New meeting' }).click();
    await check('new-meeting');
    await page.getByRole('button', { name: 'Design new…' }).click();
    await page.getByRole('button', { name: '+ Retro stages' }).click();
    await check('designer');
    await page.getByRole('button', { name: 'Notes', exact: true }).first().click();
    await check('designer-notes');
    await page.getByRole('tab', { name: 'YAML' }).click();
    await check('designer-yaml');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Create meeting' }).click();
    await page.locator('.meeting-title').waitFor();
    await check('meeting');
    await page.getByRole('button', { name: /^Show .* full screen$/ }).first().click();
    await page.locator('section.board-col.maximized').waitFor();
    await check('column-full-screen');
    await page.getByRole('button', { name: /^Exit full screen/ }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await check('settings');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Invite' }).click();
    await page.getByRole('button', { name: 'QR code' }).click();
    await page.locator('svg.qr').waitFor();
    await check('invite');
    await page.keyboard.press('Escape');
    await page.goto(base);
    await page.getByRole('button', { name: 'New meeting' }).click();
    await page.getByLabel('Repeats').selectOption({ label: 'Weekly, or every few weeks' });
    await check('new-series');
    await page.getByRole('button', { name: 'Create series' }).click();
    await page.getByRole('heading', { name: 'Put this in the calendar invite' }).waitFor();
    await check('series');
  }
} finally {
  await browser.close();
  server?.kill();
}
if (failures.length) { console.error(`\n${failures.length} screens overflow`); process.exit(1); }
console.log('\nAll screens fit at phone width.');
