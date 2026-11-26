import { neon } from '@neondatabase/serverless';
import { env } from './env.js';

type Query = (text: string, params: unknown[]) => Promise<unknown[]>;
let client: Promise<Query> | null = null;

/**
 * Production and CI use the real Postgres at DATABASE_URL. A fresh clone with no DATABASE_URL
 * runs its tests on PGlite: the real Postgres engine compiled to WASM, in-process, so the same
 * SQL runs against the same database rules. It is a test-only fallback and is never bundled.
 */
async function connect(): Promise<Query> {
  if (process.env.DATABASE_URL || process.env.CHIRP_DB !== 'pglite') {
    const sql = neon(env.databaseUrl);
    return (text, params) => sql.query(text, params) as Promise<unknown[]>;
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  // Match the Neon driver: int8 and numeric come back as strings.
  const asText = { 20: (v: string) => v, 1700: (v: string) => v };
  return async (text, params) => (await db.query(text, params, { parsers: asText })).rows;
}

/**
 * Run a parameterised query. `$S.` in the text is replaced with the configured schema,
 * so tests can run against an isolated schema in the same real database.
 */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const s = env.schema;
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('invalid schema name');
  client ??= connect();
  const rows = await (await client)(text.replaceAll('$S.', `"${s}".`), params);
  return rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
