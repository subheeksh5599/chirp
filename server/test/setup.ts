// Test setup. With a .env (or CI secrets) the server tests run against the real Neon database, in a
// throwaway schema per run. On a fresh clone with no .env they run on PGlite (real Postgres in WASM,
// in-process) with throwaway local values, so `npm test` works with nothing configured.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
process.env.DB_SCHEMA = `test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
process.env.PUBLIC_URL ??= 'https://chirp.example.test';

const local: string[] = [];
const fallback = (name: string, value: () => string) => {
  if (process.env[name]) return;
  process.env[name] = value();
  local.push(name);
};
if (!process.env.DATABASE_URL) {
  process.env.CHIRP_DB = 'pglite';
  local.push('DATABASE_URL (PGlite)');
}
// Telegram messages in tests are recorded, never sent, so the token only has to sign test initData.
if (!process.env.TELEGRAM_BOT_TOKEN) process.env.CHIRP_LOCAL_BOT = '1';
fallback('TELEGRAM_BOT_TOKEN', () => '123456:local-test-token');
fallback('TELEGRAM_WEBHOOK_SECRET', () => 'local-test-secret');
// A fresh ed25519 key per run: presence records are signed and verified for real.
fallback('PRESENCE_SIGNING_KEY', () =>
  generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
);
// The project's public testnet payer wallet: a real address with a short history that never receives a
// Chirp payment comment, so "unpaid until it is on-chain" is still checked against live testnet.
fallback('TON_WALLET_ADDRESS', () => '0QAnATkrjg3hzlJn8mOdBpH-eUGbLJKatMTw9XAEQlY5nNV8');

if (local.length && !(globalThis as { __chirpSaid?: boolean }).__chirpSaid) {
  (globalThis as { __chirpSaid?: boolean }).__chirpSaid = true;
  console.log(
    `[tests] no .env: using local ${local.join(', ')}.` +
      (process.env.GROQ_API_KEY ? '' : ' Speech-to-text tests skip without GROQ_API_KEY.') +
      (local.includes('TELEGRAM_BOT_TOKEN') ? ' The bot-name check skips without a real TELEGRAM_BOT_TOKEN.' : ''),
  );
}
