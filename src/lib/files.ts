import { toast } from '../components/ui';
import * as Y from 'yjs';
import { readMeta } from './model';
import { t } from './i18n';

// A meeting file holds the whole shared document, so it can be reopened, archived in a
// shared drive, or used to start the next meeting with open actions carried over.

export interface MeetingFile {
  format: 'rondel-meeting';
  version: 1;
  roomId: string;
  key: string;
  title: string;
  exportedAt: string;
  update: string; // base64 Yjs update
}

const toB64 = (u: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function exportMeeting(doc: Y.Doc, roomId: string, key: string): MeetingFile {
  return {
    format: 'rondel-meeting',
    version: 1,
    roomId,
    key,
    title: readMeta(doc)?.title ?? 'Meeting',
    exportedAt: new Date().toISOString(),
    update: toB64(Y.encodeStateAsUpdate(doc)),
  };
}

export function parseMeetingFile(text: string): MeetingFile {
  let f: any;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error(t('This is not a Rondel meeting file'));
  }
  if (f?.format !== 'rondel-meeting' || typeof f.update !== 'string' || typeof f.roomId !== 'string') {
    throw new Error(t('This is not a Rondel meeting file'));
  }
  return f as MeetingFile;
}

export function docFromFile(f: MeetingFile): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, fromB64(f.update));
  if (!readMeta(doc)) throw new Error(t('The meeting file is empty or damaged'));
  return doc;
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'meeting';
}

export async function downloadText(filename: string, text: string, type = 'text/plain') {
  // Inside a claude.ai preview, plain download links are blocked; the page asks the viewer to save instead.
  const claude = (window as any).claude;
  const downloads = typeof claude?.use === 'function' ? await claude.use('downloads').catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: new Blob([text], { type }) });
    } catch (e: any) {
      if (e?.code !== 'declined') toast(t('Could not save the file: {error}', { error: e?.message ?? e }));
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
