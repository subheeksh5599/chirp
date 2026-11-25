// Local server for development and live tests: same router as production.
import { createServer } from 'node:http';
import { nodeHandler } from './router.js';
import { migrate } from './migrate.js';

const port = Number(process.env.PORT ?? 8787);
await migrate();
createServer((req, res) => void nodeHandler(req, res)).listen(port, () => {
  console.log(`chirp api on http://127.0.0.1:${port}`);
});
