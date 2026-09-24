import 'server-only';
import { computeTotals, depositFor, lineTotal } from '@/lib/core/money';
import type { Tx } from '@/lib/db';
import type { Tenant } from '@/lib/tenant';
import type { JobRow, QuoteLineInput } from './types';
import { UserError } from './types';

/** Quotes, versions and the negotiation thread. Every function runs in the caller's RLS-scoped transaction. */

export function priceLines(tenant: Tenant, lines: QuoteLineInput[]) {
  if (!lines.length) throw new UserError('Add at least one line item.');
  for (const l of lines) {
    if (!l.description.trim()) throw new UserError('Every line needs a description.');
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new UserError('Quantity must be at least 1.');
    if (!Number.isInteger(l.unit_price_cents) || l.unit_price_cents < 0) throw new UserError('Prices must be whole KES.');
  }
  const totals = computeTotals(
    lines.map((l) => ({ description: l.description, qty: l.qty, unitPriceCents: l.unit_price_cents })),
    { vatRegistered: tenant.settings.vat_registered, vatRateBp: tenant.settings.vat_rate_bp, pricesIncludeVat: tenant.settings.prices_include_vat },
  );
  return totals;
}

export function depositForTenant(tenant: Tenant, totalCents: number) {
  return depositFor(totalCents, tenant.settings.deposit_rule, tenant.settings.deposit_min_quote_cents);
}

/** Technician sends a (new version of the) main or supplementary quote. */
export async function sendQuoteVersion(
  tx: Tx,
  tenant: Tenant,
  job: JobRow,
  input: { kind: 'main' | 'supplementary'; lines: QuoteLineInput[]; turnaroundDays?: number | null; message?: string | null; collectUpfront?: boolean },
  actorUserId: string,
) {
  const totals = priceLines(tenant, input.lines);
  const deposit = input.kind === 'main' ? depositForTenant(tenant, totals.totalCents) : 0;
  const expiresAt = new Date(Date.now() + tenant.settings.quote_expiry_hours * 3600 * 1000);

  let [q] = await tx`select * from quotes where job_id = ${job.id} and kind = ${input.kind} and status in ('draft', 'sent', 'negotiating', 'expired') order by created_at desc limit 1`;
  if (input.kind === 'supplementary' && q && q.status !== 'draft') throw new UserError('A supplementary quote is already open.');
  if (!q) {
    [q] = await tx`insert into quotes (job_id, tenant_id, kind, status, collect_upfront, created_by) values (${job.id}, ${tenant.id}, ${input.kind}, 'draft', ${input.collectUpfront ?? false}, ${actorUserId}) returning *`;
  }
  const [{ next }] = await tx`select coalesce(max(version_no), 0) + 1 as next from quote_versions where quote_id = ${q.id}`;
  const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, subtotal_cents, vat_cents, total_cents, deposit_cents, turnaround_days, expires_at, message, sent_at, created_by)
    values (${q.id}, ${tenant.id}, ${next}, 'shop', ${totals.subtotalCents}, ${totals.vatCents}, ${totals.totalCents}, ${deposit}, ${input.turnaroundDays ?? null}, ${expiresAt}, ${input.message ?? null}, now(), ${actorUserId}) returning id`;
  for (const [i, l] of input.lines.entries()) {
    await tx`insert into quote_line_items (quote_version_id, tenant_id, position, kind, part_id, description, qty, unit_price_cents, line_total_cents)
      values (${v.id}, ${tenant.id}, ${i}, ${l.kind}, ${l.part_id ?? null}, ${l.description.trim()}, ${l.qty}, ${l.unit_price_cents}, ${lineTotal({ qty: l.qty, unitPriceCents: l.unit_price_cents })})`;
  }
  await tx`update quotes set current_version_id = ${v.id}, status = 'sent' where id = ${q.id}`;
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, body, quote_version_id)
    values (${q.id}, ${tenant.id}, ${actorUserId}, 'shop', ${Number(next) === 1 ? 'revision' : 'revision'}, ${totals.totalCents}, ${input.message ?? null}, ${v.id})`;

  if (input.kind === 'main') {
    const to = 'quote_sent';
    if (['diagnosing', 'quote_negotiating', 'quote_expired'].includes(job.status)) {
      await tx`select transition_job(${job.id}, ${to}::job_status, 'technician', ${actorUserId}, '{}')`;
    } else if (job.status !== 'quote_sent') {
      throw new UserError('A quote cannot be sent while the job is in this state.');
    } else {
      // revised quote while still in quote_sent: notify without a state change
      await tx`select notify_job(${job.id}, 'job.quote_sent', '{}')`;
    }
  } else {
    if (job.status !== 'in_repair') throw new UserError('Supplementary quotes can only be raised during the repair.');
    await tx`select notify_job(${job.id}, 'supplementary.sent', ${tx.json({ amount: formatKesText(totals.totalCents) } as never)})`;
  }
  return { quoteId: q.id as string, versionId: v.id as string, totals, deposit };
}

function formatKesText(cents: number) {
  return 'KES ' + Math.round(cents / 100).toLocaleString('en-KE');
}

export async function loadQuote(tx: Tx, jobId: string, kind: 'main' | 'supplementary') {
  const [q] = await tx`select * from quotes where job_id = ${jobId} and kind = ${kind} and status <> 'draft' order by created_at desc limit 1`;
  return q ?? null;
}

/** Customer counter-offer. Enforces the round cap. */
export async function customerCounter(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', proposedTotalCents: number, message: string | null, actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q || !['sent', 'negotiating'].includes(q.status)) throw new UserError('This quote is not open for negotiation.');
  if (Number(q.rounds_used) >= tenant.settings.max_negotiation_rounds) throw new UserError('No more counter-offers are allowed; please accept or decline.');
  if (!Number.isInteger(proposedTotalCents) || proposedTotalCents <= 0 || proposedTotalCents % 100 !== 0) throw new UserError('Enter a whole KES amount.');
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, body, quote_version_id)
    values (${q.id}, ${tenant.id}, ${actorUserId}, 'customer', 'counter', ${proposedTotalCents}, ${message}, ${q.current_version_id})`;
  await tx`update quotes set status = 'negotiating', rounds_used = rounds_used + 1 where id = ${q.id}`;
  if (kind === 'main' && job.status === 'quote_sent') {
    await tx`select transition_job(${job.id}, 'quote_negotiating', 'customer', ${actorUserId}, '{}')`;
  } else if (kind === 'main') {
    await tx`select notify_job(${job.id}, 'job.quote_negotiating', '{}')`;
  }
}

/** Customer accepts the current version. */
export async function customerAccept(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q || !['sent', 'negotiating'].includes(q.status)) throw new UserError('This quote can no longer be accepted.');
  const [v] = await tx`select * from quote_versions where id = ${q.current_version_id}`;
  if (v.expires_at && new Date(v.expires_at) < new Date()) throw new UserError('This quote has expired. Ask the shop for a new one.');
  await tx`update quotes set status = 'accepted', accepted_version_id = ${v.id}, accepted_total_cents = ${v.total_cents}, accepted_at = now() where id = ${q.id}`;
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, quote_version_id) values (${q.id}, ${tenant.id}, ${actorUserId}, 'customer', 'accept', ${v.total_cents}, ${v.id})`;
  if (kind === 'main') {
    await tx`select transition_job(${job.id}, 'deposit_pending', 'customer', ${actorUserId}, '{}')`;
    return { depositCents: Number(v.deposit_cents) };
  }
  return { depositCents: 0 };
}

/** Technician accepts a customer's counter: a new version at the agreed total is created and the quote accepted. */
export async function shopAcceptCounter(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', negotiationId: string, actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q || q.status !== 'negotiating') throw new UserError('There is no open counter-offer.');
  const [n] = await tx`select * from negotiations where id = ${negotiationId} and quote_id = ${q.id} and kind = 'counter' order by created_at desc limit 1`;
  if (!n) throw new UserError('Counter-offer not found.');
  const [cur] = await tx`select * from quote_versions where id = ${q.current_version_id}`;
  const lines = await tx`select * from quote_line_items where quote_version_id = ${cur.id} order by position`;
  const agreed = Number(n.proposed_total_cents);
  const tax = { vatRegistered: tenant.settings.vat_registered, vatRateBp: tenant.settings.vat_rate_bp, pricesIncludeVat: tenant.settings.prices_include_vat };
  const totals = computeTotals(
    [...lines.map((l) => ({ description: l.description, qty: Number(l.qty), unitPriceCents: Number(l.unit_price_cents) })), { description: 'Agreed price adjustment', qty: 1, unitPriceCents: agreed - Number(cur.total_cents) }],
    tax,
  );
  const deposit = kind === 'main' ? depositForTenant(tenant, agreed) : 0;
  const [{ next }] = await tx`select coalesce(max(version_no), 0) + 1 as next from quote_versions where quote_id = ${q.id}`;
  const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, subtotal_cents, vat_cents, total_cents, deposit_cents, turnaround_days, expires_at, message, sent_at, created_by)
    values (${q.id}, ${tenant.id}, ${next}, 'shop', ${totals.subtotalCents}, ${totals.vatCents}, ${agreed}, ${deposit}, ${cur.turnaround_days}, ${cur.expires_at}, 'Counter-offer accepted', now(), ${actorUserId}) returning id`;
  for (const l of lines) {
    await tx`insert into quote_line_items (quote_version_id, tenant_id, position, kind, part_id, description, qty, unit_price_cents, line_total_cents)
      values (${v.id}, ${tenant.id}, ${l.position}, ${l.kind}, ${l.part_id}, ${l.description}, ${l.qty}, ${l.unit_price_cents}, ${l.line_total_cents})`;
  }
  await tx`insert into quote_line_items (quote_version_id, tenant_id, position, kind, description, qty, unit_price_cents, line_total_cents)
    values (${v.id}, ${tenant.id}, ${lines.length}, 'other', 'Agreed price adjustment', 1, ${agreed - Number(cur.total_cents)}, ${agreed - Number(cur.total_cents)})`;
  await tx`update quotes set current_version_id = ${v.id}, status = 'accepted', accepted_version_id = ${v.id}, accepted_total_cents = ${agreed}, accepted_at = now() where id = ${q.id}`;
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, quote_version_id) values (${q.id}, ${tenant.id}, ${actorUserId}, 'shop', 'accept', ${agreed}, ${v.id})`;
  if (kind === 'main') await tx`select transition_job(${job.id}, 'deposit_pending', 'technician', ${actorUserId}, '{}')`;
  return { depositCents: deposit };
}

export async function shopDeclineCounter(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', message: string | null, actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q || q.status !== 'negotiating') throw new UserError('There is no open counter-offer.');
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, body, quote_version_id) values (${q.id}, ${tenant.id}, ${actorUserId}, 'shop', 'decline', ${message}, ${q.current_version_id})`;
  await tx`select notify_job(${job.id}, 'job.quote_sent', '{}')`;
}

/** Customer declines. Main quote -> job goes to quote_declined (then return_fee_pending). Supplementary -> repair continues (Q-18). */
export async function customerDecline(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q || !['sent', 'negotiating', 'expired'].includes(q.status)) throw new UserError('This quote can no longer be declined.');
  await tx`update quotes set status = 'declined' where id = ${q.id}`;
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, quote_version_id) values (${q.id}, ${tenant.id}, ${actorUserId}, 'customer', 'decline', ${q.current_version_id})`;
  if (kind === 'main') await tx`select transition_job(${job.id}, 'quote_declined', 'customer', ${actorUserId}, '{}')`;
}

export async function addQuoteMessage(tx: Tx, tenant: Tenant, job: JobRow, kind: 'main' | 'supplementary', side: 'customer' | 'shop', body: string, actorUserId: string) {
  const q = await loadQuote(tx, job.id, kind);
  if (!q) throw new UserError('No quote yet.');
  if (!body.trim()) throw new UserError('Write a message.');
  await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, body, quote_version_id) values (${q.id}, ${tenant.id}, ${actorUserId}, ${side}, 'message', ${body.trim().slice(0, 2000)}, ${q.current_version_id})`;
}
