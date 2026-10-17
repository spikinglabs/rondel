// The interface languages. To add one, see "Adding a language" in src/i18n/README.md:
// `npm run i18n -- new <id> <name> <locale>` creates its folder, then add it to LANGUAGES below.
import { de } from './de';

export interface Language {
  /** Two-letter code, as in the browser's language setting ("fr", "pt"). */
  id: string;
  /** The language's name in itself, as shown in the language menu ("Français"). */
  label: string;
  /** For dates and numbers ("fr-FR"). */
  locale: string;
  /** English text in the code → this language. Missing or empty entries show in English. */
  texts: Record<string, string>;
  /** The built-in templates in this language (same order, ids and structure as src/templates/builtin.ts),
   *  or null to use the English ones. */
  templates: string[] | null;
  /** True while a translation is still being filled in: tests then only report what is missing. */
  partial?: boolean;
  /** True if words keep their capital letter inside a sentence (German nouns: "die Diskussion" stays "Diskussion"). */
  keepsCapitals?: boolean;
}

export const ENGLISH: Language = { id: 'en', label: 'English', locale: 'en-GB', texts: {}, templates: null };

export const LANGUAGES: Language[] = [ENGLISH, de];
