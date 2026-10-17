# Interface languages

Rondel's interface can be shown in any number of languages. Each person picks theirs under
Your preferences → Language; until they do, the browser's language decides (or the site's `language` setting).
Meeting content (cards, agenda texts, names) is never translated: it stays as people wrote it.

How it works: texts are written in English in the code and wrapped in `t('…')` (or `tn('one', 'other', n)` for
plurals), from `src/lib/i18n.ts`. Each language is a folder here that maps the English text to its own:

```
src/i18n/
  languages.ts      the list of languages (one line each)
  de/index.ts       name, locale, and what the folder contains
  de/texts.ts       English text → German, grouped by the file the text appears in
  de/templates.ts   German versions of the built-in templates (optional)
```

Anything a language does not translate (missing or empty) shows in English, so a new language can go live
half done.

## Adding a language

1. `npm run i18n -- new fr Français fr-FR` (code, the name in its own language, locale for dates).
   This creates `src/i18n/fr/` with every interface text in `texts.ts`, empty, and adds `fr` to `languages.ts`.
2. Fill in `texts.ts`. Keep `{placeholders}` exactly as they are; their order in the sentence can change.
   Add a glossary section to this file for the words that must stay consistent (see the German one below).
3. Optional: translate the built-in templates. Copy `de/templates.ts` to `fr/templates.ts`, translate the
   names, descriptions, column titles, prompts and agenda texts (keep ids, types, durations and activities), and set
   `templates` in `fr/index.ts`. A test checks they match the English ones in everything but text.
4. When every text is translated, remove `partial: true` from `fr/index.ts`. From then on the tests fail if a new
   text in the app has no French entry.
5. `npm test` and `npm run i18n -- status` show what is missing.

The language menu, the browser-language detection and the site setting pick it up from `languages.ts`.
If words in the language keep their capital inside a sentence (German nouns), set `keepsCapitals: true`.

## When you change or add a text in the app

Wrap it in `t('…')`, then run `npm run i18n -- sync de` (and for each other complete language). It adds the new
texts, empty, at the end of `texts.ts` and lists entries that are no longer used. `npm test` fails until every
complete language has the new text, so a change can't silently leave part of the interface in English.

Rules for wrapped texts:
- The argument is a plain string literal. Values go in `{placeholders}`: `t('Saved {file} in {folder}', { file, folder })`,
  never a template literal.
- Whole sentences, not fragments glued together, so other languages can order words their way.
- Meeting content stays as written: card and agenda texts, names, and what a template puts into a meeting.

## German glossary

Formal "Sie". Keep these consistent:

| English | Deutsch |
| --- | --- |
| meeting | Meeting |
| retro, retrospective | Retro, Retrospektive |
| facilitator / facilitate | Moderator·in → use "Moderation" / moderieren |
| agenda, agenda item | Agenda, Agendapunkt |
| board, card, column | Board, Karte, Spalte |
| vote, votes | abstimmen, Stimmen |
| action item(s), action(s) | Aufgabe(n) |
| owner, due | Verantwortlich, Fällig |
| decision | Entscheidung |
| minutes | Protokoll |
| notes | Notizen |
| series | Serie |
| template | Vorlage |
| draft | Entwurf |
| brainstorm, idea, dot | Brainstorming, Idee, Punkt |
| invite / invite link | Einladen / Einladungslink |
| close the meeting | Meeting beenden |
| settings / preferences | Einstellungen |
| backup / restore | Sicherung / wiederherstellen |
| side bar, work area | Seitenleiste, Arbeitsbereich |
| encrypted | verschlüsselt |
| server | Server |
| stage (agenda step), activity | Schritt, Aktivität |
