import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JavaScript scripts
import { applySite, readSite } from '../scripts/site-html.mjs';
// @ts-ignore
import { expectedPage } from '../scripts/verify.mjs';

const built = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const lab = { sync: 'server', lab: true, operator: { name: 'Spiking Labs & Co', hosting: 'cloudflare' }, robots: 'noindex' };
const policy = (html: string) => /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1].replace(/&quot;/g, '"');

test('a server site gets a policy that allows only its own files, its settings block and its own server', () => {
  const { html } = applySite(built, lab);
  const csp = policy(html)!;
  assert.match(csp, /connect-src 'self';/);
  assert.match(csp, /default-src 'self'/);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(script).digest('base64')}'`), 'the settings block is allowed by its hash');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script>'), 'the policy comes before any script');
  assert.equal(applySite(html, lab).html, html, 'applying the settings again changes nothing');

  const remote = policy(applySite(built, { sync: 'server', serverUrl: 'https://rooms.example.com/x' }).html)!;
  assert.match(remote, /connect-src 'self' https:\/\/rooms\.example\.com wss:\/\/rooms\.example\.com;/);
  for (const sync of ['auto', 'p2p']) assert.equal(policy(applySite(built, { sync }).html), undefined, `${sync} can use relays, so no policy`);
});

test('the page a site should send is rebuilt from the settings it sends', () => {
  const { html: live } = applySite(built, lab);
  assert.deepEqual(readSite(live), { ...readSite(applySite(built, {}).html), ...lab });
  assert.equal(expectedPage(built, live), live);
  assert.equal(expectedPage(built, built), built, 'an untouched build is compared as it is');
  assert.equal(readSite(built), null, 'the default block is not JSON, so it is never run or trusted');

  const extra = live.replace('</head>', '<script src="https://evil.example/x.js"></script></head>');
  assert.notEqual(expectedPage(built, extra), extra, 'an added script is caught');
  const sneaky = live.replace('"lab": true', '"lab": true, "x": (fetch("https://evil.example"), 1)');
  assert.equal(readSite(sneaky), null);
  assert.notEqual(expectedPage(built, sneaky), sneaky, 'code inside the settings block is caught');
});
