// German (Deutsch). Formal "Sie"; glossary in src/i18n/README.md.
import type { Language } from '../languages';
import { texts } from './texts';
import { TEMPLATES_DE } from './templates';

export const de: Language = {
  id: 'de',
  label: 'Deutsch',
  locale: 'de-DE',
  texts,
  templates: TEMPLATES_DE,
  keepsCapitals: true,
};
