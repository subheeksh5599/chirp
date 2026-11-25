// Single Vercel function; vercel.json rewrites every /api/* path here.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nodeHandler } from '../server/router.js';

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // Vercel passes the original path in the rewrite query; restore it for the router.
  const u = new URL(req.url ?? '/', 'http://local');
  const original = u.searchParams.get('__path');
  if (original !== null) {
    u.searchParams.delete('__path');
    const qs = u.searchParams.toString();
    req.url = `/api/${original}${qs ? `?${qs}` : ''}`;
  }
  return nodeHandler(req, res);
}
