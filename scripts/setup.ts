// One-off setup against the configured environment: create tables, then point the bot at PUBLIC_URL.
// Usage: node --env-file=.env --import tsx scripts/setup.ts   (or: npm run setup)
import { migrate } from '../server/migrate.js';
import { setupBot } from '../server/bot.js';

await migrate();
console.log('database schema ready');
const info = (await setupBot()) as { url: string; pending_update_count: number; last_error_message?: string };
console.log(`webhook: ${info.url} · pending ${info.pending_update_count}${info.last_error_message ? ` · last error: ${info.last_error_message}` : ''}`);
