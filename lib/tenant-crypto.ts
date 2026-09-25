import 'server-only';
import { decrypt, encrypt, generateDataKey, parseKey, unwrapDataKey, wrapDataKey } from './core/crypto';
import { servicePool } from './db';
import { env } from './env';

/**
 * Per-tenant data keys wrapped by APP_MASTER_KEY (DECISIONS D-5).
 *
 * `tenant_keys` has row-level security enabled with no policy for `repairdesk_app` (customer/staff requests) —
 * intentionally: it's a system secret, never a tenant-scoped one, so the ordinary request role must never be able
 * to read or write it. Every lookup here therefore always goes through `servicePool()` (BYPASSRLS), regardless of
 * which transaction the caller is otherwise working in. Passing the caller's transaction used to be accepted as an
 * optimisation, but it silently broke under the customer/staff role: the `select` came back empty (RLS-filtered)
 * and the fallback `insert` then failed outright, surfacing as "you are not allowed to do that" the moment a
 * customer chose to share a device passcode.
 */

const keyCache = new Map<string, { key: Buffer; version: number }>();

export async function tenantKey(tenantId: string): Promise<{ key: Buffer; version: number }> {
  const hit = keyCache.get(tenantId);
  if (hit) return hit;
  const sql = servicePool();
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

export async function encryptForTenant(tenantId: string, plaintext: string, aad: string) {
  const { key, version } = await tenantKey(tenantId);
  return { ciphertext: encrypt(plaintext, key, aad), version };
}

export async function decryptForTenant(tenantId: string, ciphertext: string, aad: string) {
  const { key } = await tenantKey(tenantId);
  return decrypt(ciphertext, key, aad);
}

export async function encryptJson(tenantId: string, value: unknown, aad: string) {
  return (await encryptForTenant(tenantId, JSON.stringify(value), aad)).ciphertext;
}

export async function decryptJson<T>(tenantId: string, ciphertext: string | null | undefined, aad: string): Promise<T | null> {
  if (!ciphertext) return null;
  return JSON.parse(await decryptForTenant(tenantId, ciphertext, aad)) as T;
}
