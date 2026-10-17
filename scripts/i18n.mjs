// Interface translations. Run with `npm run i18n -- <command>`:
//   status                       how complete each language is
//   new <id> <name> <locale>     start a language, e.g. `new fr Français fr-FR`
//   sync <id>                    add texts that are new in the app (empty, to translate) and list unused ones
// See src/i18n/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { placeholders, wrappedTexts } from './i18n-texts.mjs';

const DIR = 'src/i18n';
const REGISTRY = path.join(DIR, 'languages.ts');
const quote = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
const area = (file) => path.relative('src', file).replace(/\.tsx?$/, '');

async function languages() {
  const { LANGUAGES } = await import(path.resolve(REGISTRY));
  return LANGUAGES.filter((l) => l.id !== 'en');
}

/** Texts grouped by the source file they come from, with a comment per file so translators see the context. */
function block(entries, indent = '  ') {
  let out = '';
  let last = '';
  for (const [text, file] of entries) {
    if (area(file) !== last) out += `${indent}// ${(last = area(file))}\n`;
    out += `${indent}${quote(text)}: '',\n`;
  }
  return out;
}

async function status() {
  const texts = wrappedTexts();
  for (const l of await languages()) {
    const done = [...texts.keys()].filter((s) => l.texts[s]).length;
    const unused = Object.keys(l.texts).filter((s) => !texts.has(s)).length;
    const bad = [...texts.keys()].filter((s) => l.texts[s] && placeholders(s).join() !== placeholders(l.texts[s]).join()).length;
    console.log(`${l.id} ${l.label}: ${done} of ${texts.size} texts translated (${Math.floor((done / texts.size) * 100)}%)` +
      `${l.templates ? ', templates translated' : ', templates in English'}${unused ? `, ${unused} unused` : ''}` +
      `${bad ? `, ${bad} with wrong {placeholders}` : ''}${l.partial ? ' [partial]' : ''}`);
  }
}

function add(id, label, locale) {
  if (!/^[a-z]{2,3}$/.test(id ?? '') || !label || !/^[a-z]{2,3}-[A-Z]{2}$/.test(locale ?? '')) {
    throw new Error('Usage: npm run i18n -- new <id> <name> <locale>, for example: new fr Français fr-FR');
  }
  const dir = path.join(DIR, id);
  if (fs.existsSync(dir)) throw new Error(`${dir} already exists`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'texts.ts'),
    `// ${label} interface texts: English text in the code → ${label}. Empty entries show in English.\n` +
    `// Keep {placeholders} as they are. Guidelines in ../README.md.\n` +
    `export const texts: Record<string, string> = {\n${block(wrappedTexts())}};\n`);
  fs.writeFileSync(path.join(dir, 'index.ts'),
    `// ${label}.\nimport type { Language } from '../languages';\nimport { texts } from './texts';\n\n` +
    `export const ${id}: Language = {\n  id: '${id}',\n  label: ${quote(label)},\n  locale: '${locale}',\n  texts,\n` +
    `  // To translate the built-in templates too, copy ../de/templates.ts here, translate it and import it.\n` +
    `  templates: null,\n  // Remove once every text is translated: the tests then require it to stay complete.\n  partial: true,\n};\n`);
  let reg = fs.readFileSync(REGISTRY, 'utf8');
  reg = reg.replace(/(import \{ \w+ \} from '\.\/\w+';\n)(?!import)/, `$1import { ${id} } from './${id}';\n`);
  reg = reg.replace(/(export const LANGUAGES: Language\[\] = \[[^\]]*)\]/, `$1, ${id}]`);
  fs.writeFileSync(REGISTRY, reg);
  console.log(`Created ${dir}/ and added ${id} to ${REGISTRY}. Translate ${dir}/texts.ts.`);
}

async function sync(id) {
  const l = (await languages()).find((x) => x.id === id);
  if (!l) throw new Error(`No language "${id}" in ${REGISTRY}`);
  const file = path.join(DIR, id, 'texts.ts');
  const texts = wrappedTexts();
  const missing = [...texts].filter(([s]) => !(s in l.texts));
  if (missing.length) {
    const src = fs.readFileSync(file, 'utf8');
    const end = src.lastIndexOf('};');
    fs.writeFileSync(file, `${src.slice(0, end)}  // ---- new, to translate ----\n${block(missing)}${src.slice(end)}`);
  }
  console.log(`${id}: added ${missing.length} new texts to ${file}.`);
  const unused = Object.keys(l.texts).filter((s) => !texts.has(s));
  if (unused.length) console.log(`No longer used (delete or update them):\n${unused.map((s) => `  ${quote(s)}`).join('\n')}`);
}

const [cmd, ...args] = process.argv.slice(2);
try {
  if (cmd === 'status' || !cmd) await status();
  else if (cmd === 'new') add(...args);
  else if (cmd === 'sync') await sync(args[0]);
  else throw new Error(`Unknown command "${cmd}". Commands: status, new, sync`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
