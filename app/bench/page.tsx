import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { StatusBadge } from '@/components/status-badge';
import { LiveRefresh } from '@/components/live-refresh';
import { requestCtx, requireStaff } from '@/lib/auth';
import { BOARD_COLUMNS, type JobStatus } from '@/lib/core/state-machine';
import { formatDateTime, formatTime } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Board' };
export const dynamic = 'force-dynamic';

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const [{ tenant, session }, sp, t, ctx] = await Promise.all([requireStaff(), searchParams, getTranslations(), requestCtx()]);
  const mine = sp.mine === '1';
  const statuses = BOARD_COLUMNS.flatMap((c) => c.statuses);
  const jobs = await withUser(ctx, (tx) => tx`
    select j.id, j.ref, j.status, j.device_brand, j.device_model, j.assigned_tech_id, j.pickup_window_start, j.updated_at, j.intake_discrepancy,
           split_part(u.full_name, ' ', 1) as customer, split_part(tu.full_name, ' ', 1) as tech,
           (select count(*) from disputes d where d.job_id = j.id and d.status = 'open')::int as open_disputes
    from jobs j join users u on u.id = j.customer_user_id left join users tu on tu.id = j.assigned_tech_id
    where j.tenant_id = ${tenant.id} and j.status = any(${statuses}::job_status[])
      ${mine ? tx`and j.assigned_tech_id = ${session.user.id}` : tx``}
    order by j.updated_at desc`);

  return (
    <div className="space-y-3">
      <LiveRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{t('bench.board')}</h1>
        <div className="flex gap-1 rounded-lg border bg-background p-0.5 text-sm">
          <Link href="/bench" className={cn('rounded-md px-3 py-1', !mine && 'bg-primary text-primary-foreground')}>
            All
          </Link>
          <Link href="/bench?mine=1" className={cn('rounded-md px-3 py-1', mine && 'bg-primary text-primary-foreground')}>
            Mine
          </Link>
        </div>
      </div>
      <div className="-mx-3 flex snap-x gap-3 overflow-x-auto px-3 pb-2 lg:grid lg:grid-cols-5 lg:overflow-visible">
        {BOARD_COLUMNS.map((col) => {
          const items = jobs.filter((j) => col.statuses.includes(j.status as JobStatus));
          return (
            <section key={col.key} className="w-72 shrink-0 snap-start lg:w-auto" data-testid={`column-${col.key}`}>
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {t(`bench.${col.key}`)} <span className="rounded-full bg-muted px-2 text-xs">{items.length}</span>
              </h2>
              <ul className="space-y-2">
                {items.map((j) => (
                  <li key={j.id}>
                    <Link href={`/bench/jobs/${j.id}`} className="block rounded-xl border bg-card p-3 shadow-xs hover:border-primary/50">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm leading-tight font-medium">{`${j.device_brand} ${j.device_model}`.trim()}</p>
                        {j.open_disputes ? <span className="rounded bg-red-100 px-1.5 text-[10px] text-red-800">dispute</span> : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {j.ref} · {j.customer}
                      </p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <StatusBadge status={j.status as JobStatus} />
                        <span className="text-[11px] text-muted-foreground">{j.tech ?? t('bench.unassigned')}</span>
                      </div>
                      {col.key === 'incoming' && j.pickup_window_start ? (
                        <p className="mt-1 text-[11px] text-muted-foreground">Pickup {formatDateTime(j.pickup_window_start)}</p>
                      ) : (
                        <p className="mt-1 text-[11px] text-muted-foreground">Updated {formatTime(j.updated_at)}</p>
                      )}
                    </Link>
                  </li>
                ))}
                {!items.length ? <li className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">—</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
