// Installing Rondel as an app, and opening it offline, through a service worker (src/pwa/sw.js).

/** Chrome and Edge's install prompt, kept until someone asks to install. */
let prompt: any = null;
const listeners = new Set<() => void>();

export function registerApp() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => {
    prompt = null;
    listeners.forEach((f) => f());
  });
  // Not in development, inside frames (claude.ai previews) or on plain http, where browsers refuse anyway.
  if (import.meta.env.DEV || !('serviceWorker' in navigator) || window.self !== window.top || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(() => { /* the app works the same without it */ });
}

/** Whether the browser offers to install Rondel right now. */
export const canInstall = () => !!prompt;
export function onInstallable(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export async function installApp() {
  if (!prompt) return;
  const p = prompt;
  prompt = null;
  await p.prompt();
  listeners.forEach((f) => f());
}
