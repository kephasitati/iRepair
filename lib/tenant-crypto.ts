import 'server-only';
import { decrypt, encrypt, generateDataKey, parseKey, unwrapDataKey, wrapDataKey } from './core/crypto';
import { servicePool, type Tx } from './db';
import { env } from './env';

/** Per-tenant data keys wrapped by APP_MASTER_KEY (DECISIONS D-5). */

const keyCache = new Map<string, { key: Buffer; version: number }>();

export async function tenantKey(tenantId: string, tx?: Tx): Promise<{ key: Buffer; version: number }> {
  const hit = keyCache.get(tenantId);
  if (hit) return hit;
  const sql = tx ?? servicePool();
  const master = parseKey(env().APP_MASTER_KEY);
  let [row] = await sql`select wrapped_data_key, key_version from tenant_keys where tenant_id = ${tenantId}`;
  if (!row) {
    const dk = generateDataKey();
    [row] = await sql`insert into tenant_keys (tenant_id, wrapped_data_key) values (${tenantId}, ${wrapDataKey(dk, master, tenantId)})
      on conflict (tenant_id) do update set wrapped_data_key = tenant_keys.wrapped_data_key returning wrapped_data_key, key_version`;
  }
  const out = { key: unwrapDataKey(row.wrapped_data_key, master, tenantId), version: Number(row.key_version) };
  keyCache.set(tenantId, out);
  return out;
}

export async function encryptForTenant(tenantId: string, plaintext: string, aad: string, tx?: Tx) {
  const { key, version } = await tenantKey(tenantId, tx);
  return { ciphertext: encrypt(plaintext, key, aad), version };
}

export async function decryptForTenant(tenantId: string, ciphertext: string, aad: string, tx?: Tx) {
  const { key } = await tenantKey(tenantId, tx);
  return decrypt(ciphertext, key, aad);
}

export async function encryptJson(tenantId: string, value: unknown, aad: string, tx?: Tx) {
  return (await encryptForTenant(tenantId, JSON.stringify(value), aad, tx)).ciphertext;
}

export async function decryptJson<T>(tenantId: string, ciphertext: string | null | undefined, aad: string, tx?: Tx): Promise<T | null> {
  if (!ciphertext) return null;
  return JSON.parse(await decryptForTenant(tenantId, ciphertext, aad, tx)) as T;
}
