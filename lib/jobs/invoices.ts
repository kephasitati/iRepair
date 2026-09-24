import 'server-only';
import { composeInvoice, type InvoiceComputation, type LineInput } from '@/lib/core/money';
import type { Tx } from '@/lib/db';
import type { Tenant } from '@/lib/tenant';
import type { JobRow } from './types';

/** Build the proforma for a job from its accepted quotes and courier legs (DECISIONS D-14/D-15). */
export async function computeJobInvoice(tx: Tx, tenant: Tenant, job: JobRow, outcome: 'repaired' | 'declined' | 'cancelled'): Promise<InvoiceComputation> {
  const lines = async (kind: 'main' | 'supplementary'): Promise<LineInput[]> => {
    const rows = await tx`select li.description, li.qty, li.unit_price_cents
      from quotes q join quote_versions v on v.id = q.accepted_version_id join quote_line_items li on li.quote_version_id = v.id
      where q.job_id = ${job.id} and q.kind = ${kind} and q.status = 'accepted' order by q.accepted_at, li.position`;
    return rows.map((r) => ({ description: r.description, qty: Number(r.qty), unitPriceCents: Number(r.unit_price_cents) }));
  };
  // Accepted total may differ from the line items after a counter-offer: the difference is the negotiated adjustment.
  const [main] = await tx`select q.accepted_total_cents, (select sum(li.line_total_cents) from quote_line_items li where li.quote_version_id = q.accepted_version_id) as line_sum
    from quotes q where q.job_id = ${job.id} and q.kind = 'main' and q.status = 'accepted'`;
  const supp = await tx`select q.accepted_total_cents, (select sum(li.line_total_cents) from quote_line_items li where li.quote_version_id = q.accepted_version_id) as line_sum
    from quotes q where q.job_id = ${job.id} and q.kind = 'supplementary' and q.status = 'accepted'`;
  const adjustment = [main, ...supp].filter(Boolean).reduce((s, r) => s + (Number(r.accepted_total_cents ?? r.line_sum ?? 0) - Number(r.line_sum ?? 0)), 0);

  const legs = await tx`select leg, fee_cost_cents, fee_charged_cents from deliveries where job_id = ${job.id} and status in ('requested','rider_assigned','rider_en_route','picked_up','in_transit','delivered','quoted') order by created_at`;
  const pickup = legs.filter((l) => l.leg === 'pickup').at(-1);
  const ret = job.dropoff_choice === 'collect_at_shop' ? null : legs.filter((l) => l.leg === 'return').at(-1);
  const [{ paid }] = await tx`select paid_cents(${job.id}) as paid`;

  return composeInvoice({
    tax: { vatRegistered: tenant.settings.vat_registered, vatRateBp: tenant.settings.vat_rate_bp, pricesIncludeVat: tenant.settings.prices_include_vat },
    outcome,
    consultationFeeCents: Number(job.consultation_fee_cents),
    consultationFeeCredited: tenant.settings.consultation_fee_credited,
    pickupDelivery: pickup ? { costCents: Number(pickup.fee_cost_cents), chargedCents: Number(pickup.fee_charged_cents) } : null,
    returnDelivery: ret ? { costCents: Number(ret.fee_cost_cents), chargedCents: Number(ret.fee_charged_cents) } : null,
    quoteLines: await lines('main'),
    supplementaryLines: await lines('supplementary'),
    negotiatedAdjustmentCents: adjustment || undefined,
    paidCents: Number(paid),
  });
}

/** Upsert the job's proforma invoice (void any earlier proforma). Issued invoices are never touched. */
export async function upsertProforma(tx: Tx, tenant: Tenant, job: JobRow, outcome: 'repaired' | 'declined' | 'cancelled') {
  const [issued] = await tx`select id from invoices where job_id = ${job.id} and status = 'issued'`;
  if (issued) return issued.id as string;
  const inv = await computeJobInvoice(tx, tenant, job, outcome);
  const [customer] = await tx`select full_name, phone_e164, email from users where id = ${job.customer_user_id}`;
  const tenantSnapshot = {
    name: tenant.branding.display_name,
    kra_pin: tenant.settings.kra_pin,
    vat_registered: tenant.settings.vat_registered,
    address: tenant.settings.address_formatted,
    phone: tenant.settings.contact_phone,
    email: tenant.settings.contact_email,
    primary_hex: tenant.branding.primary_hex,
    logo_path: tenant.branding.logo_path,
  };
  await tx`update invoices set status = 'void' where job_id = ${job.id} and status = 'proforma'`;
  const [row] = await tx`insert into invoices (tenant_id, job_id, status, lines, subtotal_cents, vat_cents, vat_rate_bp, rounding_cents, total_cents, paid_cents, balance_cents, customer_snapshot, tenant_snapshot)
    values (${tenant.id}, ${job.id}, 'proforma', ${tx.json(inv.lines as never)}, ${inv.subtotalCents}, ${inv.vatCents}, ${tenant.settings.vat_registered ? tenant.settings.vat_rate_bp : 0},
            ${inv.roundingCents}, ${inv.totalCents}, ${inv.paidCents}, ${inv.balanceCents},
            ${tx.json({ name: customer.full_name, phone: customer.phone_e164, email: customer.email, address: job.dropoff_address ?? job.pickup_address } as never)}, ${tx.json(tenantSnapshot as never)})
    returning id`;
  return row.id as string;
}
