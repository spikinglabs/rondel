// Checks that a running Rondel site sends exactly the app built from this source code, so what the data page
// says about encryption holds for that site:
//   git checkout v0.28.0 && npm ci && npm run build      (the version the site's footer shows)
//   npm run verify -- https://rondel.example.com/
// Every built file must be byte for byte the same. The page itself (index.html) carries the site's settings, so
// it is rebuilt from the settings the site sends and must then match too; the settings themselves are printed.
// The site's own templates/ and robots.txt are not code and are not checked.
//   npm run verify -- --list    prints the SHA-256 of every built file; each release publishes this list.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applySite, readSite } from './site-html.mjs';

const dist = process.env.RONDEL_DIST ?? new URL('../dist/', import.meta.url).pathname;
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** The built files that are code (or the app's own assets), relative to dist/. */
export function builtFiles(dir = dist) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(dir, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.filter((f) => !f.startsWith('templates/') && f !== 'robots.txt' && !f.endsWith('.map')).sort();
}

/** The page the site should send, given the settings it does send. */
export function expectedPage(builtHtml, liveHtml) {
  const site = readSite(liveHtml);
  return site ? applySite(builtHtml, site).html : builtHtml;
}

async function get(url) {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { body: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

async function verify(site) {
  const base = new URL(site.endsWith('/') ? site : `${site}/`);
  console.log(`Comparing ${base.href} with this build of Rondel ${version} (${dist})\n`);
  let bad = 0;
  const report = (same, file, detail) => {
    if (!same) bad++;
    console.log(`${same ? '✓' : '✗'} ${file}${detail ? `  ${detail}` : ''}`);
  };

  const page = await get(base.href);
  const live = page.body.toString('utf8');
  const expected = expectedPage(readFileSync(join(dist, 'index.html'), 'utf8'), live);
  report(live === expected, 'index.html', live === expected ? sha(page.body).slice(0, 16) : 'differs from this build with the site’s settings applied');

  for (const file of builtFiles().filter((f) => f !== 'index.html')) {
    const mine = readFileSync(join(dist, file));
    try {
      const { body } = await get(new URL(file, base));
      report(sha(body) === sha(mine), file, sha(body).slice(0, 16));
    } catch (e) {
      report(false, file, `could not be fetched (${e.message})`);
    }
  }

  const settings = readSite(live);
  console.log(`\nThe site's settings: ${settings ? JSON.stringify(settings) : 'not plain JSON (the page must then match the build exactly)'}`);
  const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(live)?.[1] ?? page.headers.get('content-security-policy');
  console.log(`Content-Security-Policy: ${policy ?? 'none'}`);
  if (bad) {
    console.log(`\n${bad} file(s) differ. Check that you built the version the site's footer shows (git checkout v<version>).`);
    process.exit(1);
  }
  console.log('\nSame code: every file the site sends is exactly what this source code builds.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (arg === '--list') for (const f of builtFiles()) console.log(`${sha(readFileSync(join(dist, f)))}  ${f}`);
  else if (arg) await verify(arg);
  else {
    console.error('Usage: npm run verify -- <site address>   or   npm run verify -- --list');
    process.exit(2);
  }
}
