// End-to-end encryption for stored and relayed meeting data. The key comes from the meeting
// link's fragment (after #), which browsers never send to any server.

const enc = new TextEncoder();

export function b64(u: Uint8Array) {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const unb64url = (s: string) => unb64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));

export interface RoomKeys {
  /** AES-GCM key for meeting content. */
  key: CryptoKey;
  /** Proves to the server that a client holds the link key, without revealing it. */
  auth: string;
}

export async function deriveKeys(linkKey: string, roomId: string): Promise<RoomKeys> {
  const base = await crypto.subtle.importKey('raw', unb64url(linkKey), 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = enc.encode(`rondel:${roomId}`);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('content-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const auth = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('auth-v1') }, base, 256));
  return { key, auth: b64(auth) };
}

export async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer> | Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return b64(out);
}

export async function open(key: CryptoKey, text: string): Promise<Uint8Array> {
  const raw = unb64(text);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, key, raw.subarray(12)));
}
