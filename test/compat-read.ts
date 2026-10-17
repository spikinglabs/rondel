import * as Y from 'yjs';
import { maps } from '../src/lib/model';

/** The shared notes of a meeting as plain text, by agenda item id. */
export const notesText = (doc: Y.Doc) => Object.fromEntries([...maps(doc).notes.entries()].map(([id, t]) => [id, t.toString()]).sort());

/**
 * Whether `now` still holds everything `then` held: same values, but new fields in objects are fine,
 * since a later version may read more than an older one stored.
 */
export function holds(then: unknown, now: unknown, path = '$'): string | null {
  if (then === null || typeof then !== 'object') return Object.is(then, now) ? null : `${path}: was ${JSON.stringify(then)}, now ${JSON.stringify(now)}`;
  if (now === null || typeof now !== 'object' || Array.isArray(then) !== Array.isArray(now)) return `${path}: was ${JSON.stringify(then)}, now ${JSON.stringify(now)}`;
  if (Array.isArray(then)) {
    if (then.length !== (now as unknown[]).length) return `${path}: had ${then.length} entries, now ${(now as unknown[]).length}`;
    for (let i = 0; i < then.length; i++) {
      const e = holds(then[i], (now as unknown[])[i], `${path}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  for (const [k, v] of Object.entries(then)) {
    const e = holds(v, (now as Record<string, unknown>)[k], `${path}.${k}`);
    if (e) return e;
  }
  return null;
}
