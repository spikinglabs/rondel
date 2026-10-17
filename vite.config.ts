import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Escapes non-ASCII characters in the built JavaScript (\uXXXX works in strings, templates, regexes
// and identifiers), so hosts that are strict about uploaded text accept the bundle.
function asciiOnly(): Plugin {
  return {
    name: 'ascii-only',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') chunk.code = chunk.code.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      }
    },
  };
}

// Writes sw.js (from src/pwa/sw.js) with the list of built files, so the installed app opens offline.
// The cache is named after that list: a new build replaces the old copy.
function serviceWorker(): Plugin {
  const extra = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
  return {
    name: 'service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter((f) => f !== 'index.html' && !f.endsWith('.map')), ...extra].sort();
      const build = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8')
        .replace('self.__FILES__', JSON.stringify(files))
        .replace('self.__BUILD__', JSON.stringify(build));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Builds plain static files into dist/. Relative paths, so the app works from any folder.
// `npm run dev` also starts the Node room server on 8787 and proxies /api to it.
export default defineConfig({
  base: './',
  plugins: [react(), asciiOnly(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});
