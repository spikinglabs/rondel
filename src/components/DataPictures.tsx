// Small animated pictures for the data page: what the server sees, what the link is made of, and how anyone
// can check the code. Plain SVG drawn with the page's own colours; the motion stops when the browser asks
// for reduced motion, and each picture is explained in its caption for screen readers.
import type { ReactNode } from 'react';
import { t } from '../lib/i18n';

function Figure(props: { view: string; caption: string; children: ReactNode }) {
  return (
    <figure className="data-figure">
      <svg viewBox={props.view} aria-hidden="true" focusable="false">{props.children}</svg>
      <figcaption>{props.caption}</figcaption>
    </figure>
  );
}

function Lock(props: { x: number; y: number }) {
  return (
    <g transform={`translate(${props.x} ${props.y})`} className="dp-icon">
      <path d="M2.5 5V3.5a3 3 0 0 1 6 0V5" fill="none" />
      <rect x="0.5" y="5" width="10" height="7.5" rx="1.5" />
    </g>
  );
}

function Key(props: { x: number; y: number }) {
  return (
    <g transform={`translate(${props.x} ${props.y})`} className="dp-icon">
      <circle cx="4.5" cy="6" r="3.5" fill="none" />
      <path d="M8 6h9M14 6v3.5M17 6v2.5" fill="none" />
    </g>
  );
}

/** A card is written, travels scrambled through the server, and turns back into text for the others. */
export function EncryptionPicture() {
  const card = t('Agree the budget');
  const scrambled = ['k9#Qx2f…', 'Zr7!pW0…', '4m&Tq8s…'];
  return (
    <Figure view="0 0 520 160" caption={t('What people write is encrypted in their browser. The server only stores and passes on scrambled data; the browsers of the others in the meeting turn it back into text.')}>
      <rect className="dp-box" x="6" y="20" width="148" height="120" rx="8" />
      <text className="dp-label" x="80" y="42" textAnchor="middle">{t('Your browser')}</text>
      <rect className="dp-card" x="20" y="62" width="120" height="40" rx="5" />
      <text className="dp-text" x="80" y="86" textAnchor="middle">{card}</text>

      <rect className="dp-box dp-server" x="186" y="20" width="148" height="120" rx="8" />
      <text className="dp-label" x="260" y="42" textAnchor="middle">{t('Server')}</text>
      {scrambled.map((s, i) => (
        <text key={s} className={`dp-mono${i === 2 ? ' dp-stored' : ''}`} x="260" y={66 + i * 18} textAnchor="middle">{s}</text>
      ))}

      <rect className="dp-box" x="366" y="20" width="148" height="120" rx="8" />
      <text className="dp-label" x="440" y="42" textAnchor="middle">{t('Others in the meeting')}</text>
      <rect className="dp-card dp-arrive" x="380" y="62" width="120" height="40" rx="5" />
      <text className="dp-text dp-arrive" x="440" y="86" textAnchor="middle">{card}</text>

      <path className="dp-line" d="M154 120H186M334 120H366" />
      <g className="dp-packet">
        <rect className="dp-pill" x="-42" y="-11" width="84" height="22" rx="11" />
        <Lock x={-34} y={-7} />
        <text className="dp-mono" x="6" y="4" textAnchor="middle">{scrambled[2]}</text>
      </g>
    </Figure>
  );
}

/** The meeting link: the address goes to the server, the part after # stays in the browser. */
export function LinkPicture() {
  return (
    <Figure view="0 0 520 150" caption={t('Browsers send only the address before the # to the server. The rest of the link, with the key, never leaves the browser.')}>
      <rect className="dp-box" x="14" y="10" width="492" height="38" rx="19" />
      <text className="dp-url" x="36" y="34" textLength="166" lengthAdjust="spacingAndGlyphs">rondel.example.com/</text>
      <rect className="dp-keypart" x="206" y="17" width="190" height="24" rx="5" />
      <text className="dp-url dp-strong" x="214" y="34" textLength="174" lengthAdjust="spacingAndGlyphs">#/m/7fK2pQw9/Xk9vR3…</text>

      <path className="dp-line dp-flow" d="M119 50V100" />
      <path className="dp-line" d="M113 92l6 8 6-8" />
      <rect className="dp-soft" x="24" y="102" width="190" height="36" rx="8" />
      <text className="dp-text" x="119" y="125" textAnchor="middle">{t('Sent to the server')}</text>

      <path className="dp-line" d="M301 43V100" />
      <rect className="dp-soft dp-keep" x="266" y="102" width="230" height="36" rx="8" />
      <Key x={280} y={114} />
      <text className="dp-text" x="391" y="125" textAnchor="middle">{t('Never leaves your browser')}</text>
    </Figure>
  );
}

/** The same source code, built by anyone, gives the same fingerprints as the files this site sends. */
export function CheckPicture() {
  const print = 'b8aa a3a7 5617 65…';
  return (
    <Figure view="0 0 520 160" caption={t('Building the open source code gives exactly the same files every time. Their fingerprints match the files this site sends, so anyone can check that it runs that code and nothing else.')}>
      <rect className="dp-box" x="20" y="10" width="190" height="36" rx="8" />
      <text className="dp-text" x="115" y="33" textAnchor="middle">{t('Source code on GitHub')}</text>
      <rect className="dp-box" x="310" y="10" width="190" height="36" rx="8" />
      <text className="dp-text" x="405" y="33" textAnchor="middle">{t('This site')}</text>

      <path className="dp-line" d="M115 46V90M109 82l6 8 6-8M405 46V90M399 82l6 8 6-8" />
      <text className="dp-label" x="123" y="72">{t('build')}</text>
      <text className="dp-label" x="413" y="72">{t('download')}</text>

      <g className="dp-print dp-print-a">
        <rect className="dp-pill" x="30" y="94" width="170" height="26" rx="13" />
        <text className="dp-mono" x="115" y="111" textAnchor="middle">{print}</text>
      </g>
      <g className="dp-print dp-print-b">
        <rect className="dp-pill" x="320" y="94" width="170" height="26" rx="13" />
        <text className="dp-mono" x="405" y="111" textAnchor="middle">{print}</text>
      </g>
      <g className="dp-match">
        <circle cx="260" cy="107" r="15" />
        <path d="M253 107l5 5 9-10" fill="none" />
      </g>
      <text className="dp-label dp-match-label" x="260" y="146" textAnchor="middle">{t('Same files')}</text>
    </Figure>
  );
}
