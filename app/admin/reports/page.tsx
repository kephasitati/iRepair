import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { KV, Section } from '@/components/fields';
import { StatusBadge } from '@/components/status-badge';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import type { JobStatus } from '@/lib/core/state-machine';
import { withUser } from '@/lib/db';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const PERIODS = { '30': 30, '90': 90, '365': 365 } as const;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { tenant } = await requireStaff('shop_admin');
  const sp = await searchParams;
  const days = PERIODS[(sp.days ?? '30') as keyof typeof PERIODS] ?? 30;
  const t = await getTranslations();
  const ctx = await requestCtx();
  const since = new Date(Date.now() - days * 86400000);

  const r = await withUser(ctx, async (tx) => {
    const byState = await tx`select status, count(*)::int as n from jobs where tenant_id = ${tenant.id} and created_at >= ${since} group by status order by n desc`;
    const revenue = await tx`select to_char(date_trunc('month', confirmed_at at time zone 'Africa/Nairobi'), 'Mon YYYY') as month, purpose, sum(amount_cents)::bigint as cents
      from payments where tenant_id = ${tenant.id} and status = 'success' and confirmed_at >= ${since} group by 1, 2, date_trunc('month', confirmed_at at time zone 'Africa/Nairobi') order by date_trunc('month', confirmed_at at time zone 'Africa/Nairobi')`;
    const [totals] = await tx`select coalesce(sum(amount_cents), 0)::bigint as collected, count(distinct job_id)::int as jobs_paid from payments where tenant_id = ${tenant.id} and status = 'success' and confirmed_at >= ${since}`;
    const [refunds] = await tx`select coalesce(sum(amount_cents), 0)::bigint as refunded from refunds where tenant_id = ${tenant.id} and created_at >= ${since}`;
    const [turnaround] = await tx`
      select avg(extract(epoch from (c.created_at - r.created_at)) / 86400)::float as bench_days,
             avg(extract(epoch from (j.closed_at - j.created_at)) / 86400)::float as total_days, count(*)::int as n
      from jobs j
      join lateral (select created_at from job_events e where e.job_id = j.id and e.to_status = 'received_at_shop' order by id limit 1) r on true
      join lateral (select created_at from job_events e where e.job_id = j.id and e.to_status = 'repair_complete' order by id limit 1) c on true
      where j.tenant_id = ${tenant.id} and j.closed_at >= ${since}`;
    const [discount] = await tx`
      select avg(1 - q.accepted_total_cents::float / nullif(v1.total_cents, 0))::float as avg_discount, count(*)::int as n,
             count(*) filter (where q.accepted_total_cents < v1.total_cents)::int as negotiated
      from quotes q join quote_versions v1 on v1.quote_id = q.id and v1.version_no = 1
      where q.tenant_id = ${tenant.id} and q.kind = 'main' and q.status = 'accepted' and q.accepted_at >= ${since}`;
    const [delivery] = await tx`select coalesce(sum(fee_cost_cents), 0)::bigint as cost, coalesce(sum(fee_charged_cents), 0)::bigint as charged, count(*)::int as n
      from deliveries where tenant_id = ${tenant.id} and status not in ('quoted', 'cancelled') and created_at >= ${since}`;
    const [ratings] = await tx`select avg(score)::float as avg, count(*)::int as n from ratings where tenant_id = ${tenant.id} and created_at >= ${since}`;
    const recentRatings = await tx`select r.score, r.comment, j.ref from ratings r join jobs j on j.id = r.job_id where r.tenant_id = ${tenant.id} order by r.created_at desc limit 5`;
    const [conversion] = await tx`select count(*) filter (where status not in ('draft', 'pickup_fee_pending', 'cancelled'))::int as booked, count(*) filter (where outcome = 'repaired')::int as repaired, count(*) filter (where outcome = 'declined')::int as declined
      from jobs where tenant_id = ${tenant.id} and created_at >= ${since}`;
    return { byState, revenue, totals, refunds, turnaround, discount, delivery, ratings, recentRatings, conversion };
  });

  const months = [...new Set(r.revenue.map((x) => x.month as string))];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('admin.reports')}</h1>
        <div className="flex gap-1 rounded-lg border bg-background p-0.5 text-sm">
          {Object.keys(PERIODS).map((k) => (
            <Link key={k} href={`/admin/reports?days=${k}`} className={cn('rounded-md px-3 py-1', String(days) === k && 'bg-primary text-primary-foreground')}>
              {k}d
            </Link>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Collected (M-Pesa)" value={formatKes(Number(r.totals.collected))} sub={`${r.totals.jobs_paid} jobs · refunds ${formatKes(Number(r.refunds.refunded))}`} />
        <Stat label={t('admin.turnaround')} value={r.turnaround.n ? `${r.turnaround.bench_days.toFixed(1)} days at bench` : '—'} sub={r.turnaround.n ? `${r.turnaround.total_days.toFixed(1)} days door to door · ${r.turnaround.n} jobs` : 'No closed jobs yet'} />
        <Stat label={t('admin.discount')} value={r.discount.n ? `${(r.discount.avg_discount * 100).toFixed(1)}%` : '—'} sub={`${r.discount.negotiated} of ${r.discount.n} accepted quotes negotiated`} />
        <Stat label={t('admin.ratings')} value={r.ratings.n ? `${r.ratings.avg.toFixed(1)} ★` : '—'} sub={`${r.ratings.n} ratings`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('admin.jobsByState')}>
          <ul className="space-y-1.5">
            {r.byState.map((s) => (
              <li key={s.status} className="flex items-center justify-between">
                <StatusBadge status={s.status as JobStatus} />
                <span className="tabular-nums">{s.n}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t pt-2 text-sm">
            <KV k="Booked" v={r.conversion.booked} />
            <KV k="Repaired" v={r.conversion.repaired} />
            <KV k="Declined" v={r.conversion.declined} />
          </div>
        </Section>

        <Section title={t('admin.revenue')}>
          {months.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1">Month</th>
                  <th className="py-1 text-right">Pickup</th>
                  <th className="py-1 text-right">Deposit</th>
                  <th className="py-1 text-right">Balance</th>
                  <th className="py-1 text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const cell = (p: string) => formatKes(Number(r.revenue.find((x) => x.month === m && x.purpose === p)?.cents ?? 0), { withSymbol: false });
                  return (
                    <tr key={m} className="border-t">
                      <td className="py-1.5">{m}</td>
                      <td className="text-right tabular-nums">{cell('pickup_fee')}</td>
                      <td className="text-right tabular-nums">{cell('deposit')}</td>
                      <td className="text-right tabular-nums">{cell('final_balance')}</td>
                      <td className="text-right tabular-nums">{cell('return_fee')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No payments in this period.</p>
          )}
        </Section>

        <Section title={t('admin.deliverySpend')}>
          <KV k="Deliveries" v={r.delivery.n} />
          <KV k="Courier cost" v={formatKes(Number(r.delivery.cost))} />
          <KV k="Charged to customers" v={formatKes(Number(r.delivery.charged))} />
          <KV k="Markup earned" v={formatKes(Number(r.delivery.charged) - Number(r.delivery.cost))} strong />
        </Section>

        <Section title="Latest ratings">
          <ul className="space-y-2 text-sm">
            {r.recentRatings.map((x, i) => (
              <li key={i}>
                <span className="text-amber-500">{'★'.repeat(x.score)}</span> <span className="text-xs text-muted-foreground">{x.ref}</span>
                {x.comment ? <p className="text-muted-foreground">{x.comment}</p> : null}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
