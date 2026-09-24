import Link from 'next/link';
import { Section } from '@/components/fields';
import { StatusBadge } from '@/components/status-badge';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKenyanPhone } from '@/lib/core/phone';
import type { JobStatus } from '@/lib/core/state-machine';
import { withUser } from '@/lib/db';

export const metadata = { title: 'Unclaimed devices' };

/** Devices ready at the shop whose owners have not chosen delivery, paid, or collected. */
export default async function UnclaimedPage() {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const rows = await withUser(ctx, (tx) => tx`
    select j.id, j.ref, j.status, j.device_brand, j.device_model, u.full_name, u.phone_e164,
      floor(extract(epoch from now() - (select max(e.created_at) from job_events e where e.job_id = j.id and e.event_kind = 'transition')) / 86400)::int as days
    from jobs j join users u on u.id = j.customer_user_id
    where j.tenant_id = ${tenant.id} and j.status in ('repair_complete', 'final_payment_pending', 'ready_for_collection', 'return_failed', 'return_fee_pending', 'quote_expired')
    order by days desc`);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Unclaimed devices</h1>
      <Section>
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <Link href={`/bench/jobs/${r.id}`} className="font-medium underline">
                  {r.ref} · {`${r.device_brand} ${r.device_model}`.trim()}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {r.full_name} · {r.phone_e164 ? <a href={`tel:${r.phone_e164}`}>{formatKenyanPhone(r.phone_e164)}</a> : null}
                </p>
              </div>
              <StatusBadge status={r.status as JobStatus} />
              <span className={`w-20 text-right tabular-nums ${r.days >= tenant.settings.unclaimed_after_days ? 'font-semibold text-destructive' : ''}`}>{r.days} days</span>
            </li>
          ))}
          {!rows.length ? <li className="py-2 text-sm text-muted-foreground">Nothing waiting.</li> : null}
        </ul>
      </Section>
    </div>
  );
}
