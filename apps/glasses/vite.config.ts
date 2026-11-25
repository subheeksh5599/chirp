import { defineConfig } from 'vite';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Dev-only: lets the simulator test harness capture the raw mic PCM the app
// received, so failed decodes can be analysed offline. Never part of a build.
const ART = resolve(dirname(fileURLToPath(import.meta.url)), '../../.artifacts');

export default defineConfig({
  plugins: [
    {
      name: 'chirp-capture',
      apply: 'serve',
      configureServer(server) {
        mkdirSync(ART, { recursive: true });
        server.middlewares.use('/__capture', (req, res) => {
          if (req.method === 'DELETE') {
            writeFileSync(resolve(ART, 'capture.pcm'), Buffer.alloc(0));
            res.end('cleared');
            return;
          }
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => {
            appendFileSync(resolve(ART, 'capture.pcm'), Buffer.concat(chunks));
            res.end('ok');
          });
        });
      },
    },
  ],
});
