import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

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

// Builds plain static files into dist/. Relative paths, so the app works from any folder.
// `npm run dev` also starts the Node room server on 8787 and proxies /api to it.
export default defineConfig({
  base: './',
  plugins: [react(), asciiOnly()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/api': { target: 'http://localhost:8787', ws: true } } },
});
