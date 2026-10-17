// How a site's settings change the built index.html. Used by site-config.mjs (applies settings to a build) and
// verify.mjs (rebuilds the page a site should send from the settings it actually sends, to compare them).
import { createHash } from 'node:crypto';

export const CONFIG_BLOCK = /(window\.RONDEL_CONFIG = window\.RONDEL_CONFIG \|\| )(\{[\s\S]*?\});/;
const CSP_TAG = /\n\s*<meta http-equiv="Content-Security-Policy"[^>]*>/;
const ROBOTS_TAG = /\n\s*<meta name="robots"[^>]*>/;

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&amp;/g, '&');

/**
 * The Content-Security-Policy for a site with its own room server: the page may load only its own files and
 * the settings block, and connect only to its own server, so it has no way to send anything anywhere else.
 * Sites that can fall back to peer-to-peer (sync "auto" or "p2p") talk to relays and get none.
 */
export function contentSecurityPolicy(settings, configScript) {
  if (settings.sync !== 'server') return null;
  const connect = ["'self'"];
  if (settings.serverUrl) {
    const u = new URL(settings.serverUrl);
    connect.push(u.origin, `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`);
  }
  const hash = createHash('sha256').update(configScript).digest('base64');
  return [
    "default-src 'self'",
    `script-src 'self' 'sha256-${hash}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
}

/** index.html with a site's settings applied: merged into RONDEL_CONFIG, the page's name, robots and CSP tags. */
export function applySite(html, site, extraTemplates = []) {
  const m = CONFIG_BLOCK.exec(html);
  if (!m) throw new Error('No RONDEL_CONFIG block in index.html');
  const defaults = new Function(`return ${m[2]}`)();
  // robots is for the page, not the app: e.g. "noindex" keeps a staging copy out of search results.
  const { robots, ...settings } = site;
  const merged = { ...defaults, ...settings };
  if (extraTemplates.length) merged.templates = [...new Set([...(merged.templates ?? []), ...extraTemplates])];

  const json = JSON.stringify(merged, null, 2).replace(/\n/g, '\n      ');
  let out = html.replace(CONFIG_BLOCK, (_, start) => `${start}${json};`);
  // The page's own name (tab, link previews, the text before the app starts), so it matches what the app shows.
  if (merged.name?.trim()) {
    const name = esc(merged.name.trim());
    out = out
      .replace(/<title>[^<]*<\/title>/, () => `<title>${name}</title>`)
      .replace(/(<meta property="og:title" content=")[^"]*/, (_, start) => start + name)
      .replace(/(<main class="boot">\s*<h1>)[^<]*/, (_, start) => start + name);
  }
  // Applying the settings again (a container restart) replaces the tags rather than adding second ones.
  out = out.replace(ROBOTS_TAG, '').replace(CSP_TAG, '');
  if (robots) out = out.replace('</title>', () => `</title>\n    <meta name="robots" content="${esc(robots)}" />`);
  const script = /<script>([\s\S]*?)<\/script>/.exec(out)?.[1];
  const policy = script !== undefined && contentSecurityPolicy(merged, script);
  if (policy) out = out.replace('<meta charset="UTF-8" />', (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${esc(policy)}" />`);
  return { html: out, settings: merged };
}

/**
 * The settings a site's index.html carries, read without running anything from it: null when the block isn't
 * plain JSON (it then has to match the build exactly).
 */
export function readSite(html) {
  const m = CONFIG_BLOCK.exec(html);
  if (!m) return null;
  let settings;
  try {
    settings = JSON.parse(m[2]);
  } catch {
    return null;
  }
  const robots = /<meta name="robots" content="([^"]*)"/.exec(html)?.[1];
  return robots ? { ...settings, robots: unesc(robots) } : settings;
}
