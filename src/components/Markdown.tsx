import type { ReactNode } from 'react';
import { emojify } from './emoji';

// A small, safe Markdown renderer. It builds React elements (never HTML strings), so raw HTML in the text
// is shown as text, and links only open http(s) and mailto addresses.
// Supported: **bold**, *italic*, ~~strike~~, `code`, [links](https://…), bare URLs; and, outside inline mode,
// # headings, - and 1. lists, > quotes and ``` code blocks.

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(~~[^~\n]+~~)|(\*[^*\s\n][^*\n]*\*|\b_[^_\s\n][^_\n]*_\b)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g;

export const safeHref = (url: string) => (/^(https?:\/\/|mailto:)/i.test(url) ? url : null);

function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index!;
    if (at > last) out.push(emojify(text.slice(last, at)));
    const k = `${key}.${n++}`;
    const [all, code, bold, strike, em, link, url] = m;
    if (code) out.push(<code key={k}>{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={k}>{inline(bold.slice(2, -2), k)}</strong>);
    else if (strike) out.push(<s key={k}>{inline(strike.slice(2, -2), k)}</s>);
    else if (em) out.push(<em key={k}>{inline(em.slice(1, -1), k)}</em>);
    else if (link) {
      const [, label, href] = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      const safe = safeHref(href);
      out.push(safe ? <a key={k} href={safe} target="_blank" rel="noopener noreferrer">{inline(label, k)}</a> : all);
    } else if (url) out.push(<a key={k} href={url} target="_blank" rel="noopener noreferrer">{url}</a>);
    last = at + all.length;
  }
  if (last < text.length) out.push(emojify(text.slice(last)));
  return out;
}

/** Lines joined with line breaks, each line's inline Markdown rendered. */
const lines = (ls: string[], key: string) => ls.flatMap((l, i) => (i ? [<br key={`${key}br${i}`} />, ...inline(l, `${key}.${i}`)] : inline(l, `${key}.${i}`)));

function blocks(text: string, doc: boolean): ReactNode[] {
  const src = text.replace(/\r\n?/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    const k = `b${i}`;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < src.length && !src[i].startsWith('```')) body.push(src[i++]);
      i++;
      out.push(<pre key={k}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = (doc ? (['h1', 'h2', 'h3'] as const) : (['h4', 'h5', 'h6'] as const))[h[1].length - 1];
      out.push(<Tag key={k} className="md-h">{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    const isBullet = (l: string) => /^\s*[-*+]\s+/.test(l);
    const isNumber = (l: string) => /^\s*\d+[.)]\s+/.test(l);
    if (isBullet(line) || isNumber(line)) {
      const ordered = isNumber(line);
      const test = ordered ? isNumber : isBullet;
      const items: string[] = [];
      while (i < src.length && test(src[i])) items.push(src[i++].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={k}>{items.map((it, j) => {
        const task = it.match(/^\[([ xX])\]\s+(.*)$/);
        return <li key={j}>{task ? <>{task[1] === ' ' ? '☐' : '☑'} {inline(task[2], `${k}.${j}`)}</> : inline(it, `${k}.${j}`)}</li>;
      })}</List>);
      continue;
    }
    const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (line.trim().startsWith('|') && i + 1 < src.length && /^\s*\|?\s*:?-{3,}/.test(src[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < src.length && src[i].trim().startsWith('|')) rows.push(cells(src[i++]));
      out.push(
        <table key={k}>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${k}h${j}`)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, j) => <td key={j}>{inline(r[j] ?? '', `${k}.${ri}.${j}`)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (line.startsWith('>')) {
      const q: string[] = [];
      while (i < src.length && src[i].startsWith('>')) q.push(src[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={k}>{lines(q, k)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < src.length && src[i].trim() && !/^(```|#{1,3}\s|>|\s*\||\s*[-*+]\s|\s*\d+[.)]\s)/.test(src[i])) para.push(src[i++]);
    out.push(<p key={k}>{lines(para, k)}</p>);
  }
  return out;
}

/** Markdown text as React elements. `inline` keeps it to one paragraph's worth (for action items and decisions);
 *  `doc` makes # headings full-size (for the minutes) instead of small ones inside a card or note. */
export function Md({ text, inline: one = false, doc = false, className }: { text: string; inline?: boolean; doc?: boolean; className?: string }) {
  if (one) return <span className={`md${className ? ` ${className}` : ''}`}>{lines(text.split('\n'), 'l')}</span>;
  return <div className={`md${doc ? ' md-doc' : ''}${className ? ` ${className}` : ''}`}>{blocks(text, doc)}</div>;
}
