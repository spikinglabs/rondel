// Saving minutes into a folder on this computer, such as a OneDrive, SharePoint or Google Drive folder that the
// desktop app keeps in sync. Uses the browser's File System Access API (Edge and Chrome); the chosen folder is
// remembered in this browser only. Nothing goes through Rondel's server.

// Deliberately not "rondel-…": that prefix is for meeting documents, which backups copy.
const DB = 'rondel.folders';
const STORE = 'handles';
const KEY = 'minutes';

/** Whether this browser can write into a folder the person picks. Not inside frames such as claude.ai previews. */
export const canSaveToFolder = () => typeof (window as any).showDirectoryPicker === 'function' && window.self === window.top;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    d.close();
  }
}

/** The remembered minutes folder, if any. */
export async function savedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idb<FileSystemDirectoryHandle | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Ask for a folder and remember it. Null if the person cancels. */
export async function chooseFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const dir: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({ id: 'rondel-minutes', mode: 'readwrite' });
    await idb('readwrite', (s) => s.put(dir, KEY));
    return dir;
  } catch (e: any) {
    if (e?.name === 'AbortError') return null;
    throw e;
  }
}

export async function forgetFolder() {
  await idb('readwrite', (s) => s.delete(KEY)).catch(() => {});
}

/** Write a text file into the folder, replacing a file of the same name. Asks for permission again if needed. */
export async function saveIntoFolder(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<boolean> {
  const h = dir as any;
  const allowed = async (ask: 'queryPermission' | 'requestPermission') => !h[ask] || (await h[ask]({ mode: 'readwrite' })) === 'granted';
  if (!(await allowed('queryPermission')) && !(await allowed('requestPermission'))) return false;
  const file = await dir.getFileHandle(name, { create: true });
  const w = await file.createWritable();
  await w.write(text);
  await w.close();
  return true;
}
