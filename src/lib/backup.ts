import * as Y from 'yjs';
import { openDoc } from './store';

// A backup of everything Rondel keeps in this browser, to move to another browser or device:
// your identity (so you stay facilitator), preferences, My templates, the meeting and series lists with their
// link keys, per-meeting voter ids and drafts, layout, and the stored copy of each meeting and series document.
// The file holds meeting keys, so it opens those meetings just like their links do. A passphrase encrypts it.

export interface BackupData {
  local: Record<string, string>;
  /** IndexedDB database name (rondel-<room>) to the document's state, base64. */
  docs: Record<string, string>;
}
interface PlainFile { format: 'rondel-backup'; version: 1; exportedAt: string; encrypted: false; data: BackupData }
interface EncryptedFile { format: 'rondel-backup'; version: 1; exportedAt: string; encrypted: true; kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }; iv: string; data: string }
export type BackupFile = PlainFile | EncryptedFile;

const PREFIX = 'rondel:';
const DB_PREFIX = 'rondel-';
const ITERATIONS = 310_000;

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ------------------------------------------------------------ the file

async function passKey(passphrase: string, salt: BufferSource, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function makeBackupFile(data: BackupData, passphrase?: string): Promise<BackupFile> {
  const exportedAt = new Date().toISOString();
  if (!passphrase) return { format: 'rondel-backup', version: 1, exportedAt, encrypted: false, data };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passKey(passphrase, salt, ITERATIONS);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data))));
  return { format: 'rondel-backup', version: 1, exportedAt, encrypted: true, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toB64(salt) }, iv: toB64(iv), data: toB64(sealed) };
}

export function parseBackupFile(text: string): BackupFile {
  let f: any;
  try { f = JSON.parse(text); } catch { throw new Error('This is not a Rondel backup file'); }
  if (f?.format !== 'rondel-backup') throw new Error(f?.format === 'rondel-meeting' ? 'This is a meeting file. Open it from the home page with "Open meeting file".' : 'This is not a Rondel backup file');
  if (f.version !== 1) throw new Error('This backup was made by a newer version of Rondel');
  return f as BackupFile;
}

export async function readBackupFile(f: BackupFile, passphrase?: string): Promise<BackupData> {
  if (!f.encrypted) return f.data;
  if (!passphrase) throw new Error('This backup is protected. Enter its passphrase.');
  try {
    const key = await passKey(passphrase, fromB64(f.kdf.salt), f.kdf.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(f.iv) }, key, fromB64(f.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('Wrong passphrase, or the file is damaged');
  }
}

// ------------------------------------------------------------ merging into what this browser already has

const parse = (s: string | undefined) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const unionBy = <T>(a: T[], b: T[], id: (x: T) => string, newer: (x: T, y: T) => T = (x) => x) => {
  const m = new Map<string, T>();
  for (const x of a) m.set(id(x), x);
  for (const y of b) { const k = id(y); const x = m.get(k); m.set(k, x ? newer(x, y) : y); }
  return [...m.values()];
};
const byUpdated = <T extends { updatedAt?: string }>(x: T, y: T) => ((y.updatedAt ?? '') > (x.updatedAt ?? '') ? y : x);

export interface MergeResult { changes: Record<string, string>; meetings: number; series: number; templates: number; identity: 'kept' | 'taken' | 'same' }

/** What to write to this browser's storage so it also has the backup's contents. Lists are merged; settings this
 *  browser already has are kept. `takeIdentity`: become the person in the backup (keeps their facilitator role). */
export function mergeLocal(current: Record<string, string>, incoming: Record<string, string>, takeIdentity: boolean): MergeResult {
  const changes: Record<string, string> = {};
  const set = (k: string, v: unknown) => { const s = JSON.stringify(v); if (s !== current[k]) changes[k] = s; };
  const curMeetings: any[] = parse(current['rondel:meetings']) ?? [];
  const curSeries: any[] = parse(current['rondel:series']) ?? [];
  const curTemplates: string[] = parse(current['rondel:templates']) ?? [];
  let identity: MergeResult['identity'] = 'kept';
  for (const [k, raw] of Object.entries(incoming)) {
    if (!k.startsWith(PREFIX)) continue;
    const v = parse(raw);
    if (v === undefined) continue;
    const cur = parse(current[k]);
    if (k === 'rondel:me') {
      if (cur?.id === v.id) identity = 'same';
      else if (takeIdentity || !cur?.id) { set(k, { id: v.id, name: cur?.name || v.name }); identity = 'taken'; }
    } else if (k === 'rondel:meetings') set(k, unionBy(curMeetings, v, (m: any) => m.roomId, byUpdated));
    else if (k === 'rondel:series') set(k, unionBy(curSeries, v, (s: any) => s.id, byUpdated));
    else if (k === 'rondel:templates' || k === 'rondel:people' || k.startsWith('rondel:mine:')) set(k, [...new Set([...(cur ?? []), ...v])]);
    else if (k.startsWith('rondel:drafts:')) set(k, unionBy(cur ?? [], v, (d: any) => d.id ?? JSON.stringify(d)));
    else if (k === 'rondel:prefs') set(k, { ...v, ...(cur ?? {}), lastSeries: [...new Set([...(cur?.lastSeries ?? []), ...(v.lastSeries ?? [])])] });
    else if (current[k] === undefined) changes[k] = raw; // voter ids, layout and the like: keep this browser's own if it has one
  }
  const count = (k: string, before: unknown[]) => (changes[k] ? (parse(changes[k]) as unknown[]).length - before.length : 0);
  return { changes, meetings: count('rondel:meetings', curMeetings), series: count('rondel:series', curSeries), templates: count('rondel:templates', curTemplates), identity };
}

// ------------------------------------------------------------ this browser

function localEntries(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX)) out[k] = localStorage.getItem(k)!;
  }
  return out;
}

/** Names of the stored meeting and series documents. */
async function docNames(local: Record<string, string>): Promise<string[]> {
  const names = new Set<string>();
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name?.startsWith(DB_PREFIX)) names.add(d.name);
  } catch { /* older browsers: use the lists below */ }
  for (const m of parse(local['rondel:meetings']) ?? []) names.add(DB_PREFIX + m.roomId);
  for (const s of parse(local['rondel:series']) ?? []) names.add(DB_PREFIX + s.id);
  return [...names];
}

export async function collectBackup(): Promise<BackupData> {
  const local = localEntries();
  const docs: Record<string, string> = {};
  for (const name of await docNames(local)) {
    const { doc, persistence, ready } = openDoc(name.slice(DB_PREFIX.length));
    await ready;
    const state = Y.encodeStateAsUpdate(doc);
    if (doc.share.size) docs[name] = toB64(state);
    await persistence.destroy();
    doc.destroy();
  }
  return { local, docs };
}

export const backupSummary = (d: BackupData) => ({
  meetings: (parse(d.local['rondel:meetings']) ?? []).length as number,
  series: (parse(d.local['rondel:series']) ?? []).length as number,
  templates: (parse(d.local['rondel:templates']) ?? []).length as number,
  name: (parse(d.local['rondel:me'])?.name ?? '') as string,
});

/** Add a backup to this browser: lists merged, meeting documents merged (they are CRDTs, so nothing is lost). */
export async function restoreBackup(d: BackupData, takeIdentity: boolean): Promise<MergeResult> {
  const result = mergeLocal(localEntries(), d.local, takeIdentity);
  for (const [k, v] of Object.entries(result.changes)) localStorage.setItem(k, v);
  for (const [name, state] of Object.entries(d.docs)) {
    if (!name.startsWith(DB_PREFIX)) continue;
    const { doc, persistence, ready } = openDoc(name.slice(DB_PREFIX.length));
    await ready;
    Y.applyUpdate(doc, fromB64(state));
    // Let y-indexeddb write the update before closing.
    await new Promise((r) => setTimeout(r, 50));
    await persistence.destroy();
    doc.destroy();
  }
  return result;
}
