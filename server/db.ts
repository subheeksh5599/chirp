import { neon } from '@neondatabase/serverless';
import { env } from './env.js';

type Sql = ReturnType<typeof neon>;
let client: Sql | null = null;

function sql(): Sql {
  client ??= neon(env.databaseUrl);
  return client;
}

/**
 * Run a parameterised query. `$S.` in the text is replaced with the configured schema,
 * so tests can run against an isolated schema in the same real database.
 */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const s = env.schema;
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('invalid schema name');
  const rows = await sql().query(text.replaceAll('$S.', `"${s}".`), params);
  return rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}
