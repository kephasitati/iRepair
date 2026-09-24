import { Button } from '@/components/ui/button';
import { Section } from '@/components/fields';
import { requirePlatformAdmin } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/time';
import { servicePool } from '@/lib/db';
import { retryOutboxAction } from '@/app/platform/actions';

export const metadata = { title: 'Failures' };
export const dynamic = 'force-dynamic';

export default async function MonitorPage() {
  await requirePlatformAdmin();
  const sql = servicePool();
  const [outbox, webhooks, payments, sms] = await Promise.all([
    sql`select o.*, t.name from outbox o left join tenants t on t.id = o.tenant_id where o.status in ('dead', 'failed') or (o.status = 'pending' and o.attempts > 2) order by o.id desc limit 50`,
    sql`select w.id, w.source, w.received_at, w.error, w.signature_valid, t.name from webhook_events w left join tenants t on t.id = w.tenant_id where w.error is not null and w.error <> 'duplicate' order by w.id desc limit 50`,
    sql`select p.id, p.purpose, p.amount_cents, p.status, p.result_desc, p.created_at, p.reconcile_attempts, j.ref, t.name from payments p join jobs j on j.id = p.job_id join tenants t on t.id = p.tenant_id
        where (p.status in ('initiated', 'pending') and p.created_at < now() - interval '15 minutes') or (p.status = 'failed' and p.created_at > now() - interval '7 days') order by p.created_at desc limit 50`,
    sql`select n.id, n.event_key, n.last_error, n.created_at, t.name from notifications n join tenants t on t.id = n.tenant_id where n.status = 'failed' order by n.created_at desc limit 50`,
  ]);
  return (
    <div className="space-y-4">
      <Section title="Outbox (courier bookings, PDFs)">
        <ul className="divide-y text-sm">
          {outbox.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <span className="font-medium">{o.kind}</span> · {o.name} · {o.status} · {o.attempts} attempts
                <span className="block text-xs text-destructive">{o.last_error}</span>
              </span>
              {o.status !== 'pending' ? (
                <form action={retryOutboxAction.bind(null, Number(o.id))}>
                  <Button size="sm" variant="outline">
                    Retry
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
          {!outbox.length ? <li className="py-2 text-muted-foreground">All clear.</li> : null}
        </ul>
      </Section>
      <Section title="Payments needing attention">
        <ul className="divide-y text-sm">
          {payments.map((p) => (
            <li key={p.id} className="py-2">
              {p.name} · {p.ref} · {p.purpose} · {formatKes(Number(p.amount_cents))} · <span className="font-medium">{p.status}</span> · {formatDateTime(p.created_at)} · {p.reconcile_attempts} STK queries
              {p.result_desc ? <span className="block text-xs text-muted-foreground">{p.result_desc}</span> : null}
            </li>
          ))}
          {!payments.length ? <li className="py-2 text-muted-foreground">All clear.</li> : null}
        </ul>
      </Section>
      <Section title="Webhook errors">
        <ul className="divide-y text-sm">
          {webhooks.map((w) => (
            <li key={w.id} className="py-2">
              {w.source} · {w.name ?? 'unknown shop'} · {formatDateTime(w.received_at)} · signature {w.signature_valid === null ? 'n/a' : w.signature_valid ? 'ok' : 'INVALID'}
              <span className="block text-xs text-destructive">{w.error}</span>
            </li>
          ))}
          {!webhooks.length ? <li className="py-2 text-muted-foreground">All clear.</li> : null}
        </ul>
      </Section>
      <Section title="Failed SMS / email">
        <ul className="divide-y text-sm">
          {sms.map((n) => (
            <li key={n.id} className="py-2">
              {n.name} · {n.event_key} · {formatDateTime(n.created_at)}
              <span className="block text-xs text-destructive">{n.last_error}</span>
            </li>
          ))}
          {!sms.length ? <li className="py-2 text-muted-foreground">All clear.</li> : null}
        </ul>
      </Section>
    </div>
  );
}
