import './setup';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES } from '../src/i18n/languages';
import { t, tn, useLangForTests } from '../src/lib/i18n';
import { placeholders, wrappedTexts } from '../scripts/i18n-texts.mjs';

const texts = wrappedTexts();

test('the source has interface texts to translate', () => {
  assert.ok(texts.size > 100, `found only ${texts.size} wrapped texts`);
});

test('languages have unique codes, names and a valid locale', () => {
  assert.equal(new Set(LANGUAGES.map((l) => l.id)).size, LANGUAGES.length);
  assert.equal(new Set(LANGUAGES.map((l) => l.label)).size, LANGUAGES.length);
  for (const l of LANGUAGES) assert.doesNotThrow(() => new Intl.DateTimeFormat(l.locale), l.id);
});

for (const l of LANGUAGES.filter((x) => x.id !== 'en')) {
  test(`${l.label}: every interface text is translated, with the same placeholders`, () => {
    const missing = [...texts.keys()].filter((s) => !l.texts[s]);
    if (l.partial) {
      if (missing.length) console.log(`${l.label} is partial: ${missing.length} of ${texts.size} texts show in English`);
    } else {
      assert.deepEqual(missing, [], `texts without ${l.label} (npm run i18n -- sync ${l.id})`);
    }
    const mismatched = [...texts.keys()].filter((s) => l.texts[s] && placeholders(s).join() !== placeholders(l.texts[s]).join());
    assert.deepEqual(mismatched, [], `${l.label} texts whose {placeholders} differ`);
  });

  test(`${l.label}: no entry is left over from a text that changed`, () => {
    assert.deepEqual(Object.keys(l.texts).filter((k) => !texts.has(k)), []);
  });
}

test('t fills placeholders and falls back to English', () => {
  useLangForTests('en');
  assert.equal(t('Saved {file} in {folder}', { file: 'a.md', folder: 'OneDrive' }), 'Saved a.md in OneDrive');
  assert.equal(tn('{n} vote', '{n} votes', 2), '2 votes');
  useLangForTests('de');
  assert.equal(t('No such text, so English'), 'No such text, so English');
  useLangForTests('en');
});
