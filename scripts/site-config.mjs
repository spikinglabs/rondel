// Applies one site's settings to the built app, so a deployment can differ from the generic defaults
// without editing source: `node scripts/site-config.mjs deploy/example/site.json`.
// The settings are merged into the RONDEL_CONFIG block in dist/index.html, the same block IT can edit by
// hand. YAML files in a `templates/` folder next to the settings file are copied to dist/templates/ and
// added to RONDEL_CONFIG.templates, so they appear for everyone under "From your organisation".
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/site-config.mjs <settings.json>');
const site = JSON.parse(readFileSync(file, 'utf8'));
const dist = process.env.RONDEL_DIST ?? new URL('../dist/', import.meta.url).pathname;
const path = join(dist, 'index.html');
const html = readFileSync(path, 'utf8');
const block = /(window\.RONDEL_CONFIG = window\.RONDEL_CONFIG \|\| )(\{[\s\S]*?\});/;
const m = block.exec(html);
if (!m) throw new Error('No RONDEL_CONFIG block in dist/index.html');
const defaults = new Function(`return ${m[2]}`)();
// robots is for the page, not the app: e.g. "noindex" keeps a staging copy out of search results.
const { robots, ...settings } = site;
const merged = { ...defaults, ...settings };

const templateDir = join(dirname(file), 'templates');
if (existsSync(templateDir)) {
  const yamls = readdirSync(templateDir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  mkdirSync(join(dist, 'templates'), { recursive: true });
  for (const f of yamls) copyFileSync(join(templateDir, f), join(dist, 'templates', basename(f)));
  merged.templates = [...new Set([...(merged.templates ?? []), ...yamls.map((f) => `templates/${f}`)])];
  if (yamls.length) console.log(`Copied ${yamls.length} template(s) from ${templateDir}`);
}

const json = JSON.stringify(merged, null, 2).replace(/\n/g, '\n      ');
let out = html.replace(block, (_, start) => `${start}${json};`);
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
// The page's own name (tab, link previews, the text before the app starts), so it matches what the app shows.
if (merged.name?.trim()) {
  const name = esc(merged.name.trim());
  out = out
    .replace(/<title>[^<]*<\/title>/, () => `<title>${name}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*/, (_, start) => start + name)
    .replace(/(<main class="boot">\s*<h1>)[^<]*/, (_, start) => start + name);
}
// Running it again (a container restart) replaces the tag rather than adding a second one.
out = out.replace(/\n\s*<meta name="robots"[^>]*>/, '');
if (robots) out = out.replace('</title>', () => `</title>\n    <meta name="robots" content="${esc(robots)}" />`);
writeFileSync(path, out);
console.log(`Applied ${file} to dist/index.html`);
