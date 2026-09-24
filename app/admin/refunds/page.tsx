import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { recordRefundAction } from '@/app/admin/actions';

export const metadata = { title: 'Refunds' };

export default async function RefundsPage() {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const refunds = await withUser(ctx, (tx) => tx`select r.*, j.ref, j.id as job_id, u.full_name as by from refunds r join jobs j on j.id = r.job_id left join users u on u.id = r.recorded_by where r.tenant_id = ${tenant.id} order by r.created_at desc limit 100`);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Refunds</h1>
      <Section title="Record a refund">
        <p className="mb-3 text-sm text-muted-foreground">Record it here after you have paid the customer back by M-Pesa, cash or bank. The system does not send money.</p>
        <ActionForm action={recordRefundAction} submitLabel="Record refund" resetOnSuccess>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job reference" htmlFor="job_ref">
              <Input id="job_ref" name="job_ref" placeholder="DR-26-00012" required />
            </Field>
            <Field label="Amount (KES)" htmlFor="amount">
              <Input id="amount" name="amount" inputMode="numeric" required />
            </Field>
            <Field label="Method" htmlFor="method">
              <NativeSelect id="method" name="method" defaultValue="mpesa_manual">
                <option value="mpesa_manual">M-Pesa (sent manually)</option>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="other">Other</option>
              </NativeSelect>
            </Field>
            <Field label="Reference (M-Pesa code)" htmlFor="reference">
              <Input id="reference" name="reference" />
            </Field>
          </div>
          <Field label="Reason" htmlFor="reason">
            <Input id="reason" name="reason" required />
          </Field>
        </ActionForm>
      </Section>
      <Section title="History">
        <ul className="divide-y text-sm">
          {refunds.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                <Link href={`/bench/jobs/${r.job_id}`} className="font-medium underline">
                  {r.ref}
                </Link>{' '}
                · {r.reason}
                <span className="block text-xs text-muted-foreground">
                  {r.method} {r.reference ? `· ${r.reference}` : ''} · {r.by} · {formatDateTime(r.created_at)}
                </span>
              </span>
              <span className="tabular-nums">{formatKes(Number(r.amount_cents))}</span>
            </li>
          ))}
          {!refunds.length ? <li className="py-2 text-muted-foreground">None yet.</li> : null}
        </ul>
      </Section>
    </div>
  );
}
