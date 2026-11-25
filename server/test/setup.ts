// Server tests run against the real Neon database, in a throwaway schema per run.
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
