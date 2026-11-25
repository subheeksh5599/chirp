import { randomInt } from 'node:crypto';
import { one, q } from './db.js';
import { HttpError } from './env.js';
import { randomHex, safeEqualHex, sha256 } from './crypto.js';

export type Device = {
  id: string;
  tg_user_id: string | null;
  tg_name: string | null;
  tg_username: string | null;
  pair_code: string | null;
};

export async function createDevice(): Promise<{ deviceId: string; token: string; pairCode: string }> {
  const id = crypto.randomUUID();
  const secret = randomHex(24);
  for (let attempt = 0; attempt < 5; attempt++) {
    const pairCode = String(randomInt(100000, 1000000));
    const row = await one(
      `INSERT INTO $S.devices (id, secret_hash, pair_code) VALUES ($1, $2, $3)
       ON CONFLICT (pair_code) DO NOTHING RETURNING id`,
      [id, sha256(secret), pairCode],
    );
    if (row) return { deviceId: id, token: `${id}.${secret}`, pairCode };
  }
  throw new HttpError(503, 'could not allocate a pairing code, try again');
}

/** Resolve `Authorization: Bearer <deviceId>.<secret>`. */
export async function deviceFromAuth(header: string | undefined): Promise<Device> {
  const m = /^Bearer ([0-9a-f-]{36})\.([0-9a-f]{48})$/i.exec(header ?? '');
  if (!m) throw new HttpError(401, 'missing or malformed device token');
  const row = await one<Device & { secret_hash: string }>(
    `SELECT id, secret_hash, tg_user_id, tg_name, tg_username, pair_code FROM $S.devices WHERE id = $1`,
    [m[1]],
  );
  if (!row || !safeEqualHex(row.secret_hash, sha256(m[2]))) throw new HttpError(401, 'unknown device');
  const { secret_hash: _, ...device } = row;
  return device;
}

export function requirePaired(d: Device): asserts d is Device & { tg_user_id: string } {
  if (!d.tg_user_id) throw new HttpError(403, 'not paired yet');
}

export async function pairDevice(
  code: string,
  user: { id: number; name: string; username?: string },
): Promise<Device | null> {
  if (!/^\d{6}$/.test(code)) return null;
  return one<Device>(
    `UPDATE $S.devices SET tg_user_id = $2, tg_name = $3, tg_username = $4, paired_at = now(), pair_code = NULL
     WHERE pair_code = $1 RETURNING id, tg_user_id, tg_name, tg_username, pair_code`,
    [code, user.id, user.name, user.username ?? null],
  );
}

export async function devicesOfUser(tgUserId: number | string): Promise<Device[]> {
  return q<Device>(
    `SELECT id, tg_user_id, tg_name, tg_username, pair_code FROM $S.devices WHERE tg_user_id = $1 ORDER BY paired_at DESC`,
    [tgUserId],
  );
}

export async function logHeard(deviceId: string, kind: string, ref: string, title: string, detail: object = {}) {
  await q(
    `INSERT INTO $S.heard_log (device_id, kind, ref, title, detail) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (device_id, kind, ref) DO UPDATE SET heard_at = now()`,
    [deviceId, kind, ref, title, JSON.stringify(detail)],
  );
}
