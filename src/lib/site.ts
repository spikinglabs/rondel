import type { Operator } from './sync';

/** The product name this installation shows (RONDEL_CONFIG.name), "Rondel" by default. */
export const appName = () => window.RONDEL_CONFIG?.name?.trim() || 'Rondel';

/** Who runs this installation (RONDEL_CONFIG.operator), or null when it doesn't say. */
export function operator(): Operator | null {
  const op = window.RONDEL_CONFIG?.operator;
  return op?.name ? op : null;
}

/** Where to ask the operator something: their contact (email or web address), else their site. */
export function contactHref(op: Operator): string | null {
  const to = (op.contact || op.url || '').trim();
  if (!to) return null;
  return /^https?:\/\//.test(to) ? to : `mailto:${to.replace(/^mailto:/, '')}`;
}

/** Where the source code lives, for the footer. */
export const SOURCE_URL = 'https://github.com/spikinglabs/rondel';
