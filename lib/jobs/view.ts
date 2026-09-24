import 'server-only';
import type { Tx } from '@/lib/db';
import type { InvoiceLine } from '@/lib/core/money';
import type { JobStatus } from '@/lib/core/state-machine';
import type { DeliveryRow, JobRow, PaymentPurpose, PhotoRow } from './types';
import { loadJob } from './service';

/** Everything a job screen needs, loaded in one RLS-scoped transaction (customers only ever see their own rows). */

export type QuoteView = {
  id: string;
  kind: 'main' | 'supplementary';
  status: string;
  rounds_used: number;
  collect_upfront: boolean;
  current: VersionView | null;
  accepted_total_cents: number | null;
  versions: VersionView[];
  thread: { id: string; author_side: 'shop' | 'customer'; kind: string; proposed_total_cents: number | null; body: string | null; created_at: string; version_no: number | null }[];
};

export type VersionView = {
  id: string;
  version_no: number;
  subtotal_cents: number;
  vat_cents: number;
  total_cents: number;
  deposit_cents: number;
  turnaround_days: number | null;
  expires_at: string | null;
  message: string | null;
  sent_at: string | null;
  lines: { description: string; qty: number; unit_price_cents: number; line_total_cents: number; kind: string }[];
};

export type JobView = Awaited<ReturnType<typeof loadJobView>>;

export type EventView = { id: number; from_status: JobStatus | null; to_status: JobStatus | null; event_kind: string; actor_kind: string; payload: { body?: string; reason?: string }; created_at: string };
export type PaymentView = { id: string; purpose: PaymentPurpose; amount_cents: number; status: string; result_desc: string | null; mpesa_receipt: string | null; created_at: string; confirmed_at: string | null };
export type InvoiceView = {
  id: string;
  number: string | null;
  status: 'proforma' | 'issued' | 'void';
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  vat_cents: number;
  subtotal_cents: number;
  vat_rate_bp: number;
  lines: InvoiceLine[];
  issued_at: string | null;
  created_at: string;
};
type Rec = Record<string, unknown>;

const n = (v: unknown) => (v == null ? null : Number(v));

async function loadQuotes(tx: Tx, jobId: string): Promise<QuoteView[]> {
  const quotes = await tx`select * from quotes where job_id = ${jobId} and status <> 'draft' order by created_at`;
  const out: QuoteView[] = [];
  for (const q of quotes) {
    const versions = await tx`select * from quote_versions where quote_id = ${q.id} and sent_at is not null order by version_no`;
    const lines = versions.length ? await tx`select * from quote_line_items where quote_version_id in ${tx(versions.map((v) => v.id))} order by position` : [];
    const vv: VersionView[] = versions.map((v) => ({
      id: v.id,
      version_no: v.version_no,
      subtotal_cents: Number(v.subtotal_cents),
      vat_cents: Number(v.vat_cents),
      total_cents: Number(v.total_cents),
      deposit_cents: Number(v.deposit_cents),
      turnaround_days: v.turnaround_days,
      expires_at: v.expires_at,
      message: v.message,
      sent_at: v.sent_at,
      lines: lines.filter((l) => l.quote_version_id === v.id).map((l) => ({ description: l.description, qty: Number(l.qty), unit_price_cents: Number(l.unit_price_cents), line_total_cents: Number(l.line_total_cents), kind: l.kind })),
    }));
    const thread = await tx`select n.*, v.version_no from negotiations n left join quote_versions v on v.id = n.quote_version_id where n.quote_id = ${q.id} order by n.created_at`;
    out.push({
      id: q.id,
      kind: q.kind,
      status: q.status,
      rounds_used: Number(q.rounds_used),
      collect_upfront: q.collect_upfront,
      current: vv.find((v) => v.id === q.current_version_id) ?? vv.at(-1) ?? null,
      accepted_total_cents: n(q.accepted_total_cents),
      versions: vv,
      thread: thread.map((t) => ({ id: t.id, author_side: t.author_side, kind: t.kind, proposed_total_cents: n(t.proposed_total_cents), body: t.body, created_at: t.created_at, version_no: t.version_no })),
    });
  }
  return out;
}

export async function loadJobView(tx: Tx, jobId: string) {
  const job: JobRow = await loadJob(tx, jobId);
  const [photos, events, deliveries, payments, invoices, intake, discrepancies, progress, completion, rating, handovers, disputes, quotes, secret, refunds] = await Promise.all([
    tx`select id, job_id, stage, kind, storage_key, taken_at, created_at from job_photos where job_id = ${jobId} and deleted_at is null order by created_at` as Promise<PhotoRow[]>,
    tx`select id, from_status, to_status, event_kind, actor_kind, payload, created_at from job_events where job_id = ${jobId} order by id`,
    tx`select * from deliveries where job_id = ${jobId} and status <> 'quoted' order by created_at` as Promise<DeliveryRow[]>,
    tx`select id, purpose, amount_cents, status, result_desc, mpesa_receipt, created_at, confirmed_at from payments where job_id = ${jobId} order by created_at`,
    tx`select id, number, status, total_cents, paid_cents, balance_cents, vat_cents, subtotal_cents, vat_rate_bp, lines, issued_at, created_at from invoices where job_id = ${jobId} and status <> 'void' order by created_at desc limit 1`,
    tx`select * from intake_checklists where job_id = ${jobId}`,
    tx`select * from discrepancies where job_id = ${jobId} order by created_at`,
    tx`select p.*, u.full_name as author from job_progress_updates p left join users u on u.id = p.created_by where p.job_id = ${jobId} order by p.created_at`,
    tx`select * from completion_checklists where job_id = ${jobId}`,
    tx`select * from ratings where job_id = ${jobId}`,
    tx`select * from handover_events where job_id = ${jobId} order by created_at`,
    tx`select * from disputes where job_id = ${jobId} order by created_at`,
    loadQuotes(tx, jobId),
    tx`select identifier, identifier_kind, passcode_enc is not null as has_passcode, purged_at from job_secrets where job_id = ${jobId}`,
    tx`select * from refunds where job_id = ${jobId} order by created_at`,
  ]);
  const quotedLegs = await tx`select leg, fee_charged_cents from deliveries where job_id = ${jobId} and status = 'quoted' order by created_at desc`;
  const [customer] = await tx`select id, full_name, phone_e164, email from users where id = ${job.customer_user_id}`;
  const [tech] = job.assigned_tech_id ? await tx`select id, full_name from users where id = ${job.assigned_tech_id}` : [null];
  const inv = invoices[0];
  return {
    job,
    customer: customer ?? null,
    tech: tech ?? null,
    photos,
    events: events as unknown as EventView[],
    deliveries: deliveries.map((d) => ({ ...d, fee_cost_cents: Number(d.fee_cost_cents), fee_charged_cents: Number(d.fee_charged_cents) })),
    quotedLegs: quotedLegs.map((q) => ({ leg: q.leg as 'pickup' | 'return', fee_charged_cents: Number(q.fee_charged_cents) })),
    payments: payments.map((p: Rec) => ({ ...p, amount_cents: Number(p.amount_cents) }) as PaymentView),
    invoice: inv
      ? ({
          ...(inv as Rec),
          total_cents: Number(inv.total_cents),
          paid_cents: Number(inv.paid_cents),
          balance_cents: Number(inv.balance_cents),
          vat_cents: Number(inv.vat_cents),
          subtotal_cents: Number(inv.subtotal_cents),
          vat_rate_bp: Number(inv.vat_rate_bp),
        } as InvoiceView)
      : null,
    intake: intake[0] ?? null,
    discrepancies,
    progress,
    completion: completion[0] ?? null,
    rating: rating[0] ?? null,
    handovers,
    disputes,
    quotes,
    mainQuote: quotes.find((q) => q.kind === 'main') ?? null,
    supplementary: quotes.filter((q) => q.kind === 'supplementary'),
    secret: secret[0] ?? null,
    refunds: refunds.map((r: Rec) => ({ ...r, amount_cents: Number(r.amount_cents) }) as { id: string; method: string; reason: string; amount_cents: number; created_at: string }),
  };
}
