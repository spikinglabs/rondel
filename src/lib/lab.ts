import { t } from './i18n';

/** The app's version, from package.json at build time ("dev" when running outside a build, e.g. in tests). */
export const VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

/** True when this installation is marked as a lab test in RONDEL_CONFIG. */
export const isLab = () => !!window.RONDEL_CONFIG?.lab;

/** The header tag: "Lab", or the text RONDEL_CONFIG.lab gives (e.g. "Staging"). */
export const labLabel = () => (typeof window.RONDEL_CONFIG?.lab === 'string' ? window.RONDEL_CONFIG.lab : t('Lab'));

/** Which kind of page is open, without the meeting id or key, so feedback never carries a link. */
function pageKind() {
  const h = location.hash;
  if (h.startsWith('#/m/')) return 'meeting';
  if (h.startsWith('#/s/')) return 'series';
  if (h.startsWith('#/data')) return 'data page';
  return 'home';
}

/**
 * Where "Send feedback" goes: RONDEL_CONFIG.feedback is an email address or a web address (a form).
 * Emails and new GitHub issues (".../issues/new") get the version, page kind and browser filled in.
 * Null when nothing is configured.
 */
export function feedbackHref(): string | null {
  const to = window.RONDEL_CONFIG?.feedback?.trim();
  if (!to) return null;
  const subject = `Rondel feedback (${VERSION})`;
  const body = `\n\n\n---\nRondel ${VERSION}, ${pageKind()}, ${navigator.userAgent}\n${t('(Please don\'t paste meeting links here: they contain the meeting\'s key.)')}`;
  if (/^https?:\/\//.test(to)) {
    if (!/\/issues\/new\/?$/.test(to)) return to;
    const url = new URL(to);
    url.searchParams.set('title', subject);
    url.searchParams.set('body', body);
    return url.toString();
  }
  return `mailto:${to.replace(/^mailto:/, '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
