import Link from 'next/link';
import { Section } from '@/components/fields';
import { requirePlatformAdmin } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatDate } from '@/lib/core/time';
import { servicePool } from '@/lib/db';

export const metadata = { title: 'Shops' };
export const dynamic = 'force-dynamic';

export default async function PlatformHome() {
  await requirePlatformAdmin();
  const sql = servicePool();
  const tenants = await sql`
    select t.id, t.slug, t.name, t.status, t.created_at, d.hostname,
      (select count(*) from jobs j where j.tenant_id = t.id and j.created_at > now() - interval '30 days' and j.status <> 'draft')::int as jobs_30d,
      (select count(*) from jobs j where j.tenant_id = t.id and j.status not in ('draft', 'closed', 'cancelled', 'declined_returned'))::int as open_jobs,
      (select coalesce(sum(amount_cents), 0) from payments p where p.tenant_id = t.id and p.status = 'success' and p.confirmed_at > now() - interval '30 days')::bigint as gmv_30d,
      (select coalesce(sum(amount_cents), 0) from platform_fee_ledger l where l.tenant_id = t.id and l.created_at > now() - interval '30 days')::bigint as fees_30d,
      (select kind || ':' || value from platform_fee_rules r where r.tenant_id = t.id order by effective_from desc limit 1) as fee_rule
    from tenants t left join tenant_domains d on d.tenant_id = t.id and d.is_primary
    order by t.created_at`;
  const [failures] = await sql`select
      (select count(*) from outbox where status = 'dead')::int as dead_outbox,
      (select count(*) from webhook_events where error is not null and error <> 'duplicate' and received_at > now() - interval '7 days')::int as webhook_errors,
      (select count(*) from payments where status in ('initiated', 'pending') and created_at < now() - interval '15 minutes')::int as stuck_payments,
      (select count(*) from notifications where status = 'failed' and created_at > now() - interval '7 days')::int as failed_sms`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ['Dead outbox jobs', failures.dead_outbox],
          ['Webhook errors (7d)', failures.webhook_errors],
          ['Stuck payments', failures.stuck_payments],
          ['Failed SMS (7d)', failures.failed_sms],
        ].map(([k, v]) => (
          <Link key={k as string} href="/platform/monitor" className={`rounded-xl border bg-card p-4 ${Number(v) > 0 ? 'border-destructive/50' : ''}`}>
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="text-2xl font-semibold">{v}</p>
          </Link>
        ))}
      </div>
      <Section title="Shops" action={<Link href="/platform/tenants/new" className="text-sm font-medium text-primary underline">New shop</Link>}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-2">Shop</th>
                <th>Status</th>
                <th className="text-right">Jobs 30d</th>
                <th className="text-right">Open</th>
                <th className="text-right">Payments 30d</th>
                <th className="text-right">Platform fees 30d</th>
                <th>Fee rule</th>
                <th>Since</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-2">
                    <Link href={`/platform/tenants/${t.id}`} className="font-medium underline">
                      {t.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{t.hostname}</span>
                  </td>
                  <td>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${t.status === 'active' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'}`}>{t.status}</span>
                  </td>
                  <td className="text-right tabular-nums">{t.jobs_30d}</td>
                  <td className="text-right tabular-nums">{t.open_jobs}</td>
                  <td className="text-right tabular-nums">{formatKes(Number(t.gmv_30d))}</td>
                  <td className="text-right tabular-nums">{formatKes(Number(t.fees_30d))}</td>
                  <td className="text-xs">{t.fee_rule ? (t.fee_rule.startsWith('percent') ? `${Number(t.fee_rule.split(':')[1]) / 100}%` : formatKes(Number(t.fee_rule.split(':')[1]))) : '—'}</td>
                  <td className="text-xs">{formatDate(t.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
