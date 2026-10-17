// Finds every interface text in the app's source: the English strings wrapped in t('…') or tn('…', '…').
// Shared by test/i18n.test.ts and scripts/i18n.mjs.
import fs from 'node:fs';
import path from 'node:path';

const lit = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;
const one = new RegExp(String.raw`\bt\(\s*${lit}`, 'g');
const two = new RegExp(String.raw`\btn\(\s*${lit}\s*,\s*${lit}`, 'g');
const str = (l) => new Function(`return ${l}`)();

/** English text → the source file it first appears in, in file order. Translations in src/i18n are skipped. */
export function wrappedTexts(root = 'src') {
  const out = new Map();
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (p !== path.join(root, 'i18n')) walk(p);
        continue;
      }
      if (!/\.tsx?$/.test(f.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      const found = [];
      for (const m of src.matchAll(one)) found.push([m.index, str(m[1])]);
      for (const m of src.matchAll(two)) found.push([m.index, str(m[1])], [m.index + 1, str(m[2])]);
      for (const [, s] of found.sort((a, b) => a[0] - b[0])) if (!out.has(s)) out.set(s, p);
    }
  };
  walk(root);
  return out;
}

/** The {placeholders} in a text, sorted. */
export const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
