// Applies one site's settings to the built dist/index.html, so a deployment can differ from the generic
// defaults without editing source: `node scripts/site-config.mjs site/lab.json`.
// The settings are merged into the RONDEL_CONFIG block, the same block IT can edit by hand.
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/site-config.mjs <settings.json>');
const site = JSON.parse(readFileSync(file, 'utf8'));
const path = new URL('../dist/index.html', import.meta.url);
const html = readFileSync(path, 'utf8');
const block = /(window\.RONDEL_CONFIG = window\.RONDEL_CONFIG \|\| )(\{[\s\S]*?\});/;
const m = block.exec(html);
if (!m) throw new Error('No RONDEL_CONFIG block in dist/index.html');
const defaults = new Function(`return ${m[2]}`)();
const merged = JSON.stringify({ ...defaults, ...site }, null, 2).replace(/\n/g, '\n      ');
writeFileSync(path, html.replace(block, `$1${merged};`));
console.log(`Applied ${file} to dist/index.html`);
