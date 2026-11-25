import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const page = (name: string) => resolve(here, `${name}.html`);

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: page('index'),
        console: page('console'),
        mini: page('mini'),
        shop: page('shop'),
        marker: page('marker'),
        test: page('test'),
        privacy: page('privacy'),
      },
    },
  },
  server: {
    // Local development: the API runs from server/local.ts.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
});
