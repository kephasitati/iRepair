import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, KV, NativeSelect, Section } from '@/components/fields';
import { requirePlatformAdmin } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatDate, formatDateTime } from '@/lib/core/time';
import { servicePool } from '@/lib/db';
import { addDomainAction, enterSupportModeAction, setFeeAction, setTenantStatusAction } from '@/app/platform/actions';

export const dynamic = 'force-dynamic';

export default async function TenantPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  await requirePlatformAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const sql = servicePool();
  const [t] = await sql`select t.*, s.contact_phone, s.vat_registered, s.kra_pin, s.delivery_provider from tenants t join tenant_settings s on s.tenant_id = t.id where t.id = ${id}`;
  if (!t) notFound();
  const [domains, fees, ledger, audit, stats] = await Promise.all([
    sql`select * from tenant_domains where tenant_id = ${id} order by is_primary desc, created_at`,
    sql`select * from platform_fee_rules where tenant_id = ${id} order by effective_from desc`,
    sql`select date_trunc('month', created_at) as m, sum(amount_cents)::bigint as cents, count(*)::int as n from platform_fee_ledger where tenant_id = ${id} group by 1 order by 1 desc limit 12`,
    sql`select a.*, u.email from audit_log a left join users u on u.id = a.actor_user_id where a.tenant_id = ${id} and (a.action like 'support.%' or a.action like 'tenant.%' or a.impersonated_by is not null) order by a.created_at desc limit 30`,
    sql`select count(*)::int as jobs, count(*) filter (where status = 'closed')::int as closed, (select avg(score)::float from ratings where tenant_id = ${id}) as rating from jobs where tenant_id = ${id}`,
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">
        {t.name} <span className="text-sm font-normal text-muted-foreground">({t.status})</span>
      </h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Overview">
          <KV k="Jobs (all time)" v={stats[0].jobs} />
          <KV k="Closed" v={stats[0].closed} />
          <KV k="Average rating" v={stats[0].rating ? stats[0].rating.toFixed(1) : '—'} />
          <KV k="Phone" v={t.contact_phone} />
          <KV k="VAT" v={t.vat_registered ? `registered · ${t.kra_pin}` : 'not registered'} />
          <KV k="Courier" v={t.delivery_provider} />
          <form action={setTenantStatusAction.bind(null, id, t.status === 'active' ? 'suspended' : 'active')} className="mt-3">
            <Button variant={t.status === 'active' ? 'destructive' : 'default'} size="sm">
              {t.status === 'active' ? 'Suspend shop' : 'Reactivate shop'}
            </Button>
          </form>
        </Section>

        <Section title="Support mode">
          <p className="mb-3 text-sm text-muted-foreground">Act as this shop&apos;s admin for up to 60 minutes. Every action is recorded with your name in the shop&apos;s audit log.</p>
          <form action={enterSupportModeAction.bind(null, id)} className="space-y-3">
            <Field label="Reason" htmlFor="reason" error={sp.error === 'reason' ? 'Give a reason (at least 5 characters).' : null}>
              <Input id="reason" name="reason" required minLength={5} placeholder="e.g. Customer DR-26-00012 cannot pay, investigating" />
            </Field>
            <Button type="submit">Enter support mode</Button>
          </form>
        </Section>

        <Section title="Platform fee">
          <ul className="mb-3 space-y-1 text-sm">
            {fees.map((f) => (
              <li key={f.id}>
                {f.kind === 'percent' ? `${Number(f.value) / 100}% of invoice` : `${formatKes(Number(f.value))} per job`} · from {formatDate(f.effective_from)}
              </li>
            ))}
            {!fees.length ? <li className="text-muted-foreground">No fee.</li> : null}
          </ul>
          <form action={setFeeAction.bind(null, id)} className="flex flex-wrap items-end gap-2">
            <NativeSelect name="kind" className="w-40" defaultValue="percent">
              <option value="percent">% of invoice</option>
              <option value="flat">KES per job</option>
            </NativeSelect>
            <Input name="value" inputMode="decimal" className="w-28" placeholder="3" />
            <Button type="submit" variant="outline">
              Set from now
            </Button>
          </form>
          <p className="mt-4 mb-1 text-sm font-medium">Fees accrued (invoicing is Phase 3)</p>
          <ul className="text-sm">
            {ledger.map((l) => (
              <li key={String(l.m)} className="flex justify-between">
                <span>{new Date(l.m).toLocaleDateString('en-KE', { month: 'short', year: 'numeric' })}</span>
                <span className="tabular-nums">
                  {formatKes(Number(l.cents))} ({l.n} jobs)
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Domains">
          <ul className="mb-3 space-y-1 text-sm">
            {domains.map((d) => (
              <li key={d.hostname}>
                {d.hostname} <span className="text-xs text-muted-foreground">({d.kind}{d.is_primary ? ', primary' : ''}{d.verified_at ? ', verified' : ', DNS pending'})</span>
              </li>
            ))}
          </ul>
          <form action={addDomainAction.bind(null, id)} className="flex gap-2">
            <Input name="hostname" placeholder="repairs.shopname.co.ke" />
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">The shop points a CNAME at the platform host; Caddy issues the certificate on first request (docs/DEPLOY.md).</p>
        </Section>
      </div>

      <Section title="Platform actions on this shop">
        <ul className="divide-y text-sm">
          {audit.map((a) => (
            <li key={a.id} className="py-1.5">
              <span className="font-medium">{a.action}</span> · {a.email ?? 'system'} · {formatDateTime(a.created_at)}
              {a.diff?.reason ? <span className="text-muted-foreground"> · {a.diff.reason}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
