import 'server-only';
import type { Tx } from '@/lib/db';

export type CustomerRow = {
  id: string;
  full_name: string;
  phone_e164: string | null;
  email: string | null;
  jobs: number;
  open_jobs: number;
  last_job_at: string | null;
  spend_cents: number;
  tags: string[];
  next_followup: string | null;
};

const PAGE = 50;

/** Everyone who has booked with this shop, newest activity first. `search` matches name, phone or email. */
export async function listCustomers(tx: Tx, tenantId: string, opts: { search?: string; tag?: string; due?: boolean; page?: number }) {
  const like = `%${(opts.search ?? '').trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const page = Math.max(1, opts.page ?? 1);
  const rows = (await tx`
    with c as (
      select u.id, u.full_name, u.phone_e164, u.email,
        count(j.id)::int as jobs,
        count(j.id) filter (where j.status not in ('closed', 'cancelled', 'declined_returned'))::int as open_jobs,
        max(j.created_at) as last_job_at,
        coalesce((select sum(p.paid_amount_cents) from payments p where p.tenant_id = ${tenantId} and p.status = 'success' and p.job_id = any(array_agg(j.id))), 0)::bigint as spend_cents,
        coalesce((select array_agg(t.tag order by t.tag) from customer_tags t where t.tenant_id = ${tenantId} and t.user_id = u.id), '{}') as tags,
        (select min(f.due_on) from customer_followups f where f.tenant_id = ${tenantId} and f.user_id = u.id and f.done_at is null) as next_followup
      from users u join jobs j on j.customer_user_id = u.id and j.tenant_id = ${tenantId}
      group by u.id
    )
    select *, count(*) over ()::int as total from c
    where true
      ${opts.search ? tx`and (full_name ilike ${like} or phone_e164 ilike ${like} or email ilike ${like})` : tx``}
      ${opts.tag ? tx`and ${opts.tag} = any(tags)` : tx``}
      ${opts.due ? tx`and next_followup is not null and next_followup <= current_date` : tx``}
    order by next_followup asc nulls last, last_job_at desc
    limit ${PAGE} offset ${(page - 1) * PAGE}`) as unknown as (CustomerRow & { total: number })[];
  return { rows: rows.map((r) => ({ ...r, spend_cents: Number(r.spend_cents) })), total: rows[0]?.total ?? 0, page, pages: Math.max(1, Math.ceil((rows[0]?.total ?? 0) / PAGE)) };
}

export async function dueFollowups(tx: Tx, tenantId: string) {
  return (await tx`select f.id, f.user_id, f.due_on, f.reason, u.full_name, u.phone_e164
    from customer_followups f join users u on u.id = f.user_id
    where f.tenant_id = ${tenantId} and f.done_at is null and f.due_on <= current_date
    order by f.due_on asc limit 20`) as unknown as { id: string; user_id: string; due_on: string; reason: string; full_name: string; phone_e164: string | null }[];
}
