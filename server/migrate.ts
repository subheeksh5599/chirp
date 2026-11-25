import { readFileSync } from 'node:fs';
import { q } from './db.js';
import { env } from './env.js';

const SCHEMA_SQL = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

/** Create the schema (if needed) and every table. Safe to run repeatedly. */
export async function migrate(): Promise<void> {
  await q(`CREATE SCHEMA IF NOT EXISTS "${env.schema}"`);
  const statements = SCHEMA_SQL.split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
  for (const s of statements) await q(s);
}

export async function dropSchema(): Promise<void> {
  if (env.schema === 'public') throw new Error('refusing to drop the public schema');
  await q(`DROP SCHEMA IF EXISTS "${env.schema}" CASCADE`);
}
