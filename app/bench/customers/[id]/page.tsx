import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Field, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { StatusBadge } from '@/components/status-badge';
import { requestCtx, requireStaff } from '@/lib/auth';
import { ID_KIND_LABEL } from '@/lib/core/identity';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import type { JobStatus } from '@/lib/core/state-machine';
import { formatDate, formatDateTime } from '@/lib/core/time';
import { getCustomerIdSummary } from '@/lib/customer-ids';
import { withUser } from '@/lib/db';
import { addCustomerNoteAction, addCustomerTagAction, addFollowupAction, completeFollowupAction, deleteCustomerNoteAction, removeCustomerTagAction } from '@/app/admin/actions';

export const dynamic = 'force-dynamic';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { tenant, session } = await requireStaff();
  const ctx = await requestCtx();
  const data = await withUser(ctx, async (tx) => {
    const jobs = await tx`select id, ref, status, device_brand, device_model, created_at, closed_at from jobs where tenant_id = ${tenant.id} and customer_user_id = ${id} order by created_at desc`;
    if (!jobs.length) return null;
    const [user] = await tx`select id, full_name, phone_e164, email, created_at from users where id = ${id}`;
    const [{ spend }] = await tx`select coalesce(sum(paid_amount_cents), 0)::bigint as spend from payments where tenant_id = ${tenant.id} and status = 'success' and job_id in (select id from jobs where tenant_id = ${tenant.id} and customer_user_id = ${id})`;
    const notes = await tx`select n.id, n.body, n.created_at, n.author_id, u.full_name as author from customer_notes n left join users u on u.id = n.author_id where n.tenant_id = ${tenant.id} and n.user_id = ${id} order by n.created_at desc`;
    const tags = await tx`select tag from customer_tags where tenant_id = ${tenant.id} and user_id = ${id} order by tag`;
    const followups = await tx`select f.id, f.due_on, f.reason, f.done_at, u.full_name as created_by_name from customer_followups f left join users u on u.id = f.created_by where f.tenant_id = ${tenant.id} and f.user_id = ${id} order by f.done_at nulls first, f.due_on asc`;
    const identity = await getCustomerIdSummary(tx, tenant.id, id);
    return { user, jobs, spend: Number(spend), notes, tags: tags.map((t) => t.tag as string), followups, identity };
  });
  if (!data) notFound();
  const { user, jobs, spend, notes, tags, followups, identity } = data;
  const first = (user.full_name as string).split(' ')[0];
  const today = new Date().toISOString().slice(0, 10);
  const open = followups.filter((f) => !f.done_at);
  const done = followups.filter((f) => f.done_at);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-xs text-muted-foreground">
        <Link href="/bench/customers" className="underline">
          Customers
        </Link>{' '}
        ›
      </p>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{user.full_name || user.phone_e164 || user.email}</h1>
          <p className="text-sm text-muted-foreground">
            {user.phone_e164 ? formatKenyanPhone(user.phone_e164) : null}
            {user.phone_e164 && user.email ? ' · ' : ''}
            {user.email}
            {' · '}customer since {formatDate(user.created_at)}
          </p>
          <p className="mt-1 text-sm">
            {jobs.length} job{jobs.length === 1 ? '' : 's'} · <span className="font-medium tabular-nums">{formatKes(spend)}</span> paid
          </p>
        </div>
        <div className="flex gap-2">
          {user.phone_e164 ? (
            <>
              <a href={`https://wa.me/${(user.phone_e164 as string).replace(/^\+/, '')}?text=${encodeURIComponent(`Hi ${first}, this is ${tenant.branding.display_name}.`)}`} target="_blank" rel="noopener" className="rounded-md border px-3 py-1.5 text-sm">
                WhatsApp
              </a>
              <a href={`tel:${user.phone_e164}`} className="rounded-md border px-3 py-1.5 text-sm">
                Call
              </a>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Tags">
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <form key={t} action={removeCustomerTagAction.bind(null, id, t)}>
                <button type="submit" className="rounded-full bg-muted px-3 py-1 text-xs hover:bg-muted/70" title="Remove tag">
                  {t} ×
                </button>
              </form>
            ))}
            {!tags.length ? <p className="text-xs text-muted-foreground">No tags yet.</p> : null}
          </div>
          <ActionForm action={addCustomerTagAction} submitLabel="Add tag" successMessage="Tag added" resetOnSuccess className="mt-3 flex items-end gap-2">
            <input type="hidden" name="user_id" value={id} />
            <Field label="New tag" htmlFor="tag" className="flex-1">
              <Input id="tag" name="tag" maxLength={30} placeholder="e.g. VIP, business, repeat" />
            </Field>
          </ActionForm>
        </Section>

        <Section title="Follow-ups">
          {open.length ? (
            <ul className="divide-y text-sm">
              {open.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className={`font-medium ${f.due_on <= today ? 'text-amber-800' : ''}`}>{formatDate(f.due_on)}</span> · {f.reason}
                    <span className="block text-xs text-muted-foreground">set by {f.created_by_name || 'staff'}</span>
                  </span>
                  <form action={completeFollowupAction.bind(null, f.id, id)}>
                    <Button type="submit" size="sm" variant="outline">
                      Done
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
          )}
          <ActionForm action={addFollowupAction} submitLabel="Schedule" successMessage="Follow-up scheduled" resetOnSuccess className="mt-3 space-y-2">
            <input type="hidden" name="user_id" value={id} />
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Field label="Date" htmlFor="due_on">
                <Input id="due_on" name="due_on" type="date" min={today} required />
              </Field>
              <Field label="Reason" htmlFor="reason">
                <Input id="reason" name="reason" placeholder="e.g. ask how the repair is holding up" required />
              </Field>
            </div>
          </ActionForm>
          {done.length ? <p className="mt-2 text-xs text-muted-foreground">{done.length} completed.</p> : null}
        </Section>
      </div>

      <Section title="Notes">
        <ActionForm action={addCustomerNoteAction} submitLabel="Add note" successMessage="Note added" resetOnSuccess className="space-y-2">
          <input type="hidden" name="user_id" value={id} />
          <Textarea name="body" rows={2} placeholder="Something the next person should know…" required />
        </ActionForm>
        {notes.length ? (
          <ul className="mt-4 divide-y text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start justify-between gap-3 py-2">
                <span>
                  <span className="whitespace-pre-line">{n.body}</span>
                  <span className="block text-xs text-muted-foreground">
                    {n.author || 'staff'} · {formatDateTime(n.created_at)}
                  </span>
                </span>
                {n.author_id === session.user.id ? (
                  <form action={deleteCustomerNoteAction.bind(null, n.id, id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      Delete
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      <Section title="Jobs">
        <ul className="divide-y text-sm">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/bench/jobs/${j.id}`} className="font-medium hover:underline">
                {j.ref} · {`${j.device_brand} ${j.device_model}`.trim()}
              </Link>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                {formatDate(j.created_at)}
                <StatusBadge status={j.status as JobStatus} />
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Identity document">
        {identity ? (
          <p className="text-sm">
            {ID_KIND_LABEL[identity.kind]} ending {identity.last4}
            {identity.hasPhoto ? (
              <>
                {' · '}
                <a href={`/api/customer-ids/${id}/photo`} target="_blank" className="text-primary underline">
                  View photo
                </a>
                <span className="block text-xs text-muted-foreground">Viewing the photo is recorded in the audit log.</span>
              </>
            ) : (
              ' · no photo on file'
            )}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">None on file — this customer identifies devices by IMEI/serial.</p>
        )}
      </Section>
    </div>
  );
}
