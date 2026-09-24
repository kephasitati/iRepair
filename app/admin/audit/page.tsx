import { Section } from '@/components/fields';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatDateTime } from '@/lib/core/time';
import { withUser } from '@/lib/db';

export const metadata = { title: 'Audit log' };

export default async function AuditPage() {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const rows = await withUser(ctx, (tx) => tx`
    select a.*, u.full_name as actor, iu.full_name as impersonator
    from audit_log a left join users u on u.id = a.actor_user_id left join users iu on iu.id = a.impersonated_by
    where a.tenant_id = ${tenant.id} order by a.created_at desc limit 200`);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-semibold">Audit log</h1>
      <Section>
        <ul className="divide-y text-sm">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <p>
                <span className="font-medium">{r.action}</span> <span className="text-muted-foreground">on {r.entity} {r.entity_id ? String(r.entity_id).slice(0, 8) : ''}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.actor ?? 'system'}
                {r.impersonator ? ` (platform support: ${r.impersonator})` : ''} · {formatDateTime(r.created_at)} {r.ip ? `· ${r.ip}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
