import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { Md } from '../src/components/Markdown';

const html = (text: string, inline = false) => renderToStaticMarkup(createElement(Md, { text, inline }));

test('Markdown renders the common formatting', () => {
  assert.equal(html('**bold** and *it* and `x`', true), '<span class="md"><strong>bold</strong> and <em>it</em> and <code>x</code></span>');
  assert.match(html('# Title\n- one\n- two\n\n1. first'), /<h4 class="md-h">Title<\/h4><ul><li>one<\/li><li>two<\/li><\/ul><ol><li>first<\/li><\/ol>/);
  assert.match(html('see [docs](https://example.com) or https://a.b/c.'), /<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">docs<\/a> or <a href="https:\/\/a.b\/c"/);
  assert.match(html('line one\nline two'), /line one<br\/>line two/);
});

test('Markdown never lets HTML or script links through', () => {
  const out = html('<img src=x onerror=alert(1)> [x](javascript:alert(1)) <script>alert(1)</script>');
  assert.ok(!out.includes('<img') && !out.includes('<script') && !out.includes('href="javascript'), out);
  assert.match(out, /&lt;img/);
});
