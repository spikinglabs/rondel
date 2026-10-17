// Applies one site's settings to the built app, so a deployment can differ from the generic defaults
// without editing source: `node scripts/site-config.mjs deploy/example/site.json`.
// The settings are merged into the RONDEL_CONFIG block in dist/index.html, the same block IT can edit by
// hand. YAML files in a `templates/` folder next to the settings file are copied to dist/templates/ and
// added to RONDEL_CONFIG.templates, so they appear for everyone under "From your organisation".
// Sites with their own room server (sync "server") also get a Content-Security-Policy; see scripts/site-html.mjs.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { applySite } from './site-html.mjs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/site-config.mjs <settings.json>');
const site = JSON.parse(readFileSync(file, 'utf8'));
const dist = process.env.RONDEL_DIST ?? new URL('../dist/', import.meta.url).pathname;
const path = join(dist, 'index.html');

const templateDir = join(dirname(file), 'templates');
const templates = [];
if (existsSync(templateDir)) {
  const yamls = readdirSync(templateDir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  mkdirSync(join(dist, 'templates'), { recursive: true });
  for (const f of yamls) copyFileSync(join(templateDir, f), join(dist, 'templates', basename(f)));
  templates.push(...yamls.map((f) => `templates/${f}`));
  if (yamls.length) console.log(`Copied ${yamls.length} template(s) from ${templateDir}`);
}

writeFileSync(path, applySite(readFileSync(path, 'utf8'), site, templates).html);
console.log(`Applied ${file} to dist/index.html`);
