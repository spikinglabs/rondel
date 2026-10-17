// Interface language. Texts are written in English in the code and looked up with t(); each language in
// src/i18n/ maps the English text to its own. Anything without a translation shows in English.
// Meeting content (what people write) is not translated.
import { ENGLISH, LANGUAGES, type Language } from '../i18n/languages';

export type Lang = string;
export const LANGS: { id: Lang; label: string }[] = LANGUAGES.map(({ id, label }) => ({ id, label }));
const KEY = 'rondel:lang';

const find = (l: unknown) => LANGUAGES.find((x) => x.id === l);

/** This browser's choice, else the site's default (RONDEL_CONFIG.language), else the browser's language. */
function pick(): Language {
  try {
    const saved = find(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch { /* storage blocked */ }
  const site = find((globalThis as any).window?.RONDEL_CONFIG?.language);
  if (site) return site;
  const nav: readonly string[] = (globalThis as any).navigator?.languages ?? [];
  for (const l of nav) {
    const found = find(l.slice(0, 2).toLowerCase());
    if (found) return found;
  }
  return ENGLISH;
}

let lang: Language = pick();
if (typeof document !== 'undefined') document.documentElement.lang = lang.id;

export const getLang = (): Lang => lang.id;

/** Change the language for this browser. The page reloads so every text, including fixed labels, switches. */
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l);
  } catch { /* storage blocked: applies until reload */ }
  lang = find(l) ?? ENGLISH;
  location.reload();
}

/** For tests. */
export function useLangForTests(l: Lang) {
  lang = find(l) ?? ENGLISH;
}

/** The text in the interface language. `{name}` placeholders are filled from `vars`. */
export function t(text: string, vars?: Record<string, string | number>): string {
  const out = lang.texts[text] || text;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

/** Singular or plural: tn('{n} vote', '{n} votes', n). */
export function tn(one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

/** Dates and numbers in the interface language. */
export const locale = () => lang.locale;

/** The built-in templates in the interface language, or null for the English ones. */
export const languageTemplates = () => lang.templates;

/** Whether words keep their capital inside a sentence in the interface language. */
export const keepsCapitals = () => !!lang.keepsCapitals;
