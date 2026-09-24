import 'server-only';
import { headers } from 'next/headers';
import type { Tx } from './db';

/** Every staff mutation on a job or setting writes one row (COMPLIANCE.md §5). Call inside the same transaction. */
export async function audit(
  tx: Tx,
  input: { tenantId: string | null; actorUserId: string | null; impersonatedBy?: string | null; action: string; entity: string; entityId?: string | null; diff?: unknown },
) {
  const h = await headers().catch(() => null);
  const ip = (h?.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const ua = h?.get('user-agent')?.slice(0, 300) ?? null;
  await tx`insert into audit_log (tenant_id, actor_user_id, impersonated_by, action, entity, entity_id, diff, ip, user_agent)
    values (${input.tenantId}, ${input.actorUserId}, ${input.impersonatedBy ?? null}, ${input.action}, ${input.entity}, ${input.entityId ?? null},
            ${input.diff === undefined ? null : tx.json(input.diff as never)}, ${ip}::inet, ${ua})`;
}
