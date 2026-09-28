import "server-only";
import type { Tx } from "@/lib/db";
import { encryptForTenant } from "@/lib/tenant-crypto";
import { checkIdNumber, type IdKind } from "@/lib/core/identity";
import { UserError } from "@/lib/jobs/types";

export type CustomerIdSummary = { kind: IdKind; last4: string; hasPhoto: boolean };

export async function getCustomerIdSummary(tx: Tx, tenantId: string, userId: string): Promise<CustomerIdSummary | null> {
  const [r] = await tx`select kind, last4, photo_path is not null as has_photo from customer_ids where tenant_id = ${tenantId} and user_id = ${userId}`;
  return r ? { kind: r.kind as IdKind, last4: r.last4 as string, hasPhoto: !!r.has_photo } : null;
}

/** Stores (or replaces) the customer's ID for this shop. A changed number invalidates the old photo — it no longer shows the document on file. */
export async function upsertCustomerId(tx: Tx, tenantId: string, userId: string, kind: IdKind, rawNumber: string): Promise<CustomerIdSummary> {
  const check = checkIdNumber(kind, rawNumber);
  if (!check.ok) throw new UserError(`id:${check.error}`);
  const enc = await encryptForTenant(tenantId, check.normalized, `customer-id:${tenantId}:${userId}`);
  const [r] = await tx`insert into customer_ids (tenant_id, user_id, kind, number_enc, key_version, last4)
    values (${tenantId}, ${userId}, ${kind}, ${enc.ciphertext}, ${enc.version}, ${check.last4})
    on conflict (tenant_id, user_id) do update set kind = excluded.kind, number_enc = excluded.number_enc, key_version = excluded.key_version, last4 = excluded.last4,
      photo_path = case when customer_ids.kind = excluded.kind and customer_ids.last4 = excluded.last4 then customer_ids.photo_path else null end
    returning kind, last4, photo_path is not null as has_photo`;
  return { kind: r.kind as IdKind, last4: r.last4 as string, hasPhoto: !!r.has_photo };
}
