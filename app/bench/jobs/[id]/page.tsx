import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft } from 'lucide-react';
import { KV, Section } from '@/components/fields';
import { StatusBadge } from '@/components/status-badge';
import { LiveRefresh } from '@/components/live-refresh';
import { InvoiceSummary, PhotoGrid, QuoteBreakdown, QuoteThread, RiderCard, Timeline } from '@/components/job-parts';
import {
  AdminCancel,
  AssignControl,
  BenchHandover,
  CompleteRepairForm,
  CounterCollection,
  CounterResponse,
  DisputeResolve,
  IntakeForm,
  PasscodeReveal,
  ProgressForm,
  QuoteBuilder,
  ShopMessageBox,
  WaiveReturnFee,
  WarrantyEdit,
  type CataloguePart,
} from '@/components/bench-job';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatDate, formatDateTime } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { loadJobView, type JobView } from '@/lib/jobs/view';
import type { Tenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export default async function BenchJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { tenant, session, role } = await requireStaff();
  const ctx = await requestCtx();
  const t = await getTranslations();
  let v: JobView;
  let techs: { id: string; full_name: string }[] = [];
  let catalogue: CataloguePart[] = [];
  try {
    [v, techs, catalogue] = await withUser(ctx, async (tx) => [
      await loadJobView(tx, id),
      (await tx`select u.id, u.full_name from tenant_memberships m join users u on u.id = m.user_id where m.tenant_id = ${tenant.id} and m.active order by u.full_name`) as unknown as { id: string; full_name: string }[],
      ((await tx`select id, name, device_family, kind, default_price_cents from parts_catalogue where tenant_id = ${tenant.id} and active order by device_family, name`) as unknown as CataloguePart[]).map((p) => ({ ...p, default_price_cents: Number(p.default_price_cents) })),
    ]);
  } catch {
    notFound();
  }
  const { job } = v;
  const s = job.status;
  const isAdmin = role === 'shop_admin';
  const canSeeSecrets = !!v.secret;

  return (
    <div className="space-y-4">
      <LiveRefresh jobId={job.id} />
      <div className="flex items-center gap-2">
        <Link href="/bench" className="rounded-md p-1 hover:bg-muted" aria-label="Back">
          <ChevronLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">{job.ref}</p>
          <h1 className="truncate text-lg font-semibold">{`${job.device_brand} ${job.device_model}`.trim()}</h1>
        </div>
        <StatusBadge status={s} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <BenchAction v={v} tenant={tenant} catalogue={catalogue} isAdmin={isAdmin} t={t} />

          <Section title={t('bench.declared')}>
            <p className="text-sm whitespace-pre-line">{job.fault_description}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
              {Object.entries(job.declared_condition ?? {})
                .filter(([k, val]) => k !== 'notes' && val)
                .map(([k]) => (
                  <span key={k} className="rounded-full bg-muted px-2 py-0.5">
                    {k.replace('_', ' ')}
                  </span>
                ))}
              {job.accessories.map((a) => (
                <span key={a} className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-900">
                  + {a.replace('_', ' ')}
                </span>
              ))}
            </div>
            {job.declared_condition?.notes ? <p className="mt-2 text-xs text-muted-foreground">{job.declared_condition.notes}</p> : null}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-xs font-medium">{t('job.declaredPhotos')}</p>
                <PhotoGrid photos={v.photos.filter((p) => p.stage === 'customer_declared')} />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium">{t('job.intakePhotos')}</p>
                <PhotoGrid photos={v.photos.filter((p) => p.stage === 'intake' || p.stage === 'discrepancy')} empty="—" />
              </div>
            </div>
          </Section>

          {v.intake ? (
            <Section title={t('job.intakeTitle')}>
              <KV k={t('bench.readIdentifier')} v={`${v.intake.identifier_read ?? '—'} ${v.intake.identifier_matches ? '✓' : '✗'}`} />
              <p className="mt-1 text-sm">{v.intake.summary}</p>
              {v.discrepancies.map((d) => (
                <p key={d.id} className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {d.field}: {d.declared_value} → {d.observed_value} {d.acknowledged_at ? `· acknowledged ${formatDate(d.acknowledged_at)}` : '· awaiting customer'}
                </p>
              ))}
            </Section>
          ) : null}

          {v.progress.length ? (
            <Section title={t('job.progress')}>
              <ul className="space-y-2">
                {v.progress.map((p) => (
                  <li key={p.id} className={`rounded-lg p-2 text-sm ${p.internal ? 'border border-dashed bg-yellow-50' : 'bg-muted/50'}`}>
                    {p.internal ? <span className="mr-1 text-[10px] font-semibold uppercase">internal</span> : null}
                    {p.body}
                    <span className="block text-[11px] text-muted-foreground">
                      {p.author} · {formatDateTime(p.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {v.photos.some((p) => p.stage === 'completion' || p.stage === 'progress') ? (
            <Section title={t('common.photos')}>
              <PhotoGrid photos={v.photos.filter((p) => p.stage === 'completion' || p.stage === 'progress')} />
            </Section>
          ) : null}

          <Section title={t('job.timeline')}>
            <Timeline events={v.events} />
          </Section>
        </div>

        <aside className="space-y-4">
          <Section title={t('bench.customer')}>
            <p className="font-medium">{v.customer?.full_name || '—'}</p>
            {v.customer?.phone_e164 ? (
              <a href={`tel:${v.customer.phone_e164}`} className="text-sm text-primary">
                {formatKenyanPhone(v.customer.phone_e164)}
              </a>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">{job.pickup_address?.formatted}</p>
            {job.pickup_address?.building_floor || job.pickup_address?.landmark ? (
              <p className="text-xs text-muted-foreground">{[job.pickup_address?.building_floor, job.pickup_address?.landmark].filter(Boolean).join(' · ')}</p>
            ) : null}
          </Section>

          <Section title="Technician">
            <AssignControl jobId={job.id} techs={techs} current={job.assigned_tech_id} canReassign={isAdmin} meId={session.user.id} />
            {!isAdmin && job.assigned_tech_id ? <p className="text-sm">{v.tech?.full_name}</p> : null}
          </Section>

          <Section title="Device">
            {canSeeSecrets ? <KV k={v.secret?.identifier_kind === 'imei' ? 'IMEI' : 'Serial'} v={<span className="font-mono">{v.secret?.identifier}</span>} /> : <p className="text-xs text-muted-foreground">IMEI/serial visible to the assigned technician and shop admins.</p>}
            {job.passcode_locked ? (
              <div className="mt-2">
                <p className="mb-1 text-xs text-muted-foreground">{t('bench.passcode')}</p>
                {!job.passcode_shared ? <p className="text-sm">{t('bench.passcodeNotShared')}</p> : canSeeSecrets && v.secret?.has_passcode ? <PasscodeReveal jobId={job.id} /> : <p className="text-xs text-muted-foreground">—</p>}
              </div>
            ) : null}
            {job.declared_value_cents ? <KV k="Declared value" v={formatKes(job.declared_value_cents)} /> : null}
          </Section>

          {v.deliveries.length ? (
            <Section title="Deliveries">
              <ul className="space-y-3">
                {v.deliveries.map((d) => (
                  <li key={d.id} className="text-sm">
                    <p className="font-medium capitalize">
                      {d.leg} · {d.status.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatKes(d.fee_charged_cents)} · {d.provider}
                    </p>
                    {d.rider_snapshot ? <RiderCard delivery={d} /> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          <Section title={t('pay.title')}>
            <ul className="space-y-1 text-sm">
              {v.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span>
                    {t(`pay.purpose.${p.purpose}`)} <span className="text-xs text-muted-foreground">({p.status}{p.mpesa_receipt ? ` · ${p.mpesa_receipt}` : ''})</span>
                  </span>
                  <span className="tabular-nums">{formatKes(p.amount_cents)}</span>
                </li>
              ))}
              {v.refunds.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 text-destructive">
                  <span>Refund ({r.method})</span>
                  <span className="tabular-nums">-{formatKes(r.amount_cents)}</span>
                </li>
              ))}
            </ul>
            {v.invoice ? (
              <div className="mt-3">
                <InvoiceSummary invoice={v.invoice} vatRegistered={tenant.settings.vat_registered} />
              </div>
            ) : null}
          </Section>

          {v.disputes.length || isAdmin ? (
            <Section title="Disputes & warranty">
              {job.warranty_until ? <KV k="Warranty until" v={formatDate(job.warranty_until)} /> : null}
              {isAdmin && (job.warranty_until || ['closed', 'delivered', 'ready_for_collection'].includes(s)) ? <WarrantyEdit jobId={job.id} current={job.warranty_until} /> : null}
              <ul className="mt-2 space-y-2">
                {v.disputes.map((d) => (
                  <li key={d.id} className="rounded-lg border p-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      {d.kind} · {d.status} · {formatDate(d.created_at)}
                    </p>
                    <p>{d.body}</p>
                    {d.resolution ? <p className="text-xs">→ {d.resolution}</p> : null}
                    {isAdmin && d.status === 'open' ? <DisputeResolve disputeId={d.id} /> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {isAdmin && !['closed', 'cancelled', 'declined_returned', 'return_fee_pending', 'return_requested', 'rider_en_route_to_shop', 'collected_from_shop', 'in_transit_to_customer', 'delivered', 'dispatch_pending'].includes(s) ? (
            <AdminCancel jobId={job.id} />
          ) : null}
        </aside>
      </div>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

async function BenchAction({ v, tenant, catalogue, isAdmin, t }: { v: JobView; tenant: Tenant; catalogue: CataloguePart[]; isAdmin: boolean; t: T }) {
  const { job } = v;
  const s = job.status;
  const tax = { vatRegistered: tenant.settings.vat_registered, vatRateBp: tenant.settings.vat_rate_bp, pricesIncludeVat: tenant.settings.prices_include_vat };
  const builder = (kind: 'main' | 'supplementary', revising = false) => (
    <QuoteBuilder
      jobId={job.id}
      kind={kind}
      catalogue={catalogue.filter((p) => !p.device_family || p.device_family === 'other' || job.device_type.startsWith(p.device_family) || p.device_family === job.device_type)}
      initialLines={revising && v.mainQuote?.current ? v.mainQuote.current.lines.map((l) => ({ kind: l.kind as 'part' | 'labour' | 'other', description: l.description, qty: l.qty, unit_price_cents: l.unit_price_cents })) : undefined}
      tax={tax}
      depositRule={tenant.settings.deposit_rule}
      depositMinCents={tenant.settings.deposit_min_quote_cents}
      revising={revising}
      collectUpfrontDefault={tenant.settings.collect_supplementary_upfront}
    />
  );
  const pickupLeg = v.deliveries.filter((d) => d.leg === 'pickup').at(-1);
  const returnLeg = v.deliveries.filter((d) => d.leg === 'return').at(-1);

  switch (s) {
    case 'pickup_fee_pending':
    case 'pickup_requested':
    case 'rider_en_route_to_customer':
    case 'pickup_failed':
      return (
        <Section title={t(`status.${s}`)}>
          {pickupLeg ? <RiderCard delivery={pickupLeg} /> : <p className="text-sm text-muted-foreground">Waiting for the customer / courier.</p>}
        </Section>
      );
    case 'picked_up':
    case 'in_transit_to_shop':
      return (
        <Section title={t('bench.receive')} className="border-primary/40">
          {pickupLeg ? <RiderCard delivery={pickupLeg} /> : null}
          <div className="mt-3">
            <BenchHandover jobId={job.id} point="rider_to_shop" title={t('bench.receive')} help={t('bench.receiveHelp')} />
          </div>
        </Section>
      );
    case 'received_at_shop':
      return (
        <Section title={t('bench.intake')} className="border-primary/40">
          <IntakeForm jobId={job.id} declared={{ identifier: v.secret?.identifier ?? null, accessories: job.accessories, condition: job.declared_condition ?? {} }} />
        </Section>
      );
    case 'intake_ack_pending':
      return (
        <Section title={t('status.intake_ack_pending')}>
          <p className="text-sm text-muted-foreground">Waiting for the customer to acknowledge the intake report.</p>
        </Section>
      );
    case 'diagnosing':
      return (
        <>
          <Section title={t('bench.buildQuote')} className="border-primary/40">
            {builder('main')}
          </Section>
          <Section title={t('bench.internalNote')}>
            <ProgressForm jobId={job.id} />
          </Section>
        </>
      );
    case 'quote_sent':
    case 'quote_negotiating':
    case 'quote_expired': {
      const q = v.mainQuote!;
      const lastCounter = [...q.thread].reverse().find((m) => m.kind === 'counter');
      return (
        <Section title={`${t('job.quote')} · v${q.current?.version_no ?? 1}`} className="border-primary/40">
          {q.current ? <QuoteBreakdown version={q.current} vatRateBp={tenant.settings.vat_rate_bp} vatRegistered={tenant.settings.vat_registered} /> : null}
          <div className="mt-3 space-y-3">
            <QuoteThread quote={q} />
            {s === 'quote_negotiating' && lastCounter ? <CounterResponse jobId={job.id} kind="main" negotiationId={lastCounter.id} amountCents={lastCounter.proposed_total_cents ?? 0} /> : null}
            <ShopMessageBox jobId={job.id} kind="main" />
            <details open={s === 'quote_expired'}>
              <summary className="cursor-pointer text-sm font-medium">{s === 'quote_expired' ? 'Reissue quote' : t('bench.reviseQuote')}</summary>
              <div className="mt-3">{builder('main', true)}</div>
            </details>
          </div>
        </Section>
      );
    }
    case 'deposit_pending':
      return (
        <Section title={t('status.deposit_pending')}>
          <p className="text-sm text-muted-foreground">Quote accepted. The repair starts once the deposit is paid.</p>
        </Section>
      );
    case 'in_repair': {
      const supp = v.supplementary.find((q) => ['sent', 'negotiating'].includes(q.status));
      const lastCounter = supp ? [...supp.thread].reverse().find((m) => m.kind === 'counter') : null;
      return (
        <>
          <Section title={t('bench.progressUpdate')} className="border-primary/40">
            <ProgressForm jobId={job.id} />
          </Section>
          {supp?.current ? (
            <Section title={t('job.supplementary')}>
              <QuoteBreakdown version={supp.current} vatRateBp={tenant.settings.vat_rate_bp} vatRegistered={tenant.settings.vat_registered} />
              <div className="mt-3 space-y-3">
                <QuoteThread quote={supp} />
                {supp.status === 'negotiating' && lastCounter ? <CounterResponse jobId={job.id} kind="supplementary" negotiationId={lastCounter.id} amountCents={lastCounter.proposed_total_cents ?? 0} /> : null}
              </div>
            </Section>
          ) : (
            <details className="rounded-xl border bg-card p-4">
              <summary className="cursor-pointer text-sm font-semibold">{t('bench.supplementaryQuote')}</summary>
              <div className="mt-3">{builder('supplementary')}</div>
            </details>
          )}
          <Section title={t('bench.complete')}>{supp ? <p className="text-sm text-muted-foreground">Resolve the open supplementary quote first.</p> : <CompleteRepairForm jobId={job.id} />}</Section>
        </>
      );
    }
    case 'repair_complete':
    case 'final_payment_pending':
      return (
        <Section title={t(`status.${s}`)}>
          <p className="text-sm text-muted-foreground">{s === 'repair_complete' ? 'Waiting for the customer to choose delivery or collection.' : 'Waiting for the final payment. Dispatch starts automatically once M-Pesa confirms.'}</p>
        </Section>
      );
    case 'return_fee_pending':
      return (
        <Section title={t('status.return_fee_pending')}>
          <p className="text-sm text-muted-foreground">
            Waiting for the customer to pay the return fee{job.return_fee_cents ? ` (${formatKes(job.return_fee_cents)})` : ''} or choose collection.
          </p>
          {isAdmin ? (
            <div className="mt-3">
              <WaiveReturnFee jobId={job.id} />
            </div>
          ) : null}
        </Section>
      );
    case 'dispatch_pending':
    case 'return_requested':
    case 'rider_en_route_to_shop':
      return (
        <Section title={t('bench.dispatch')} className="border-primary/40">
          {returnLeg ? <RiderCard delivery={returnLeg} /> : <p className="text-sm text-muted-foreground">Booking the return rider…</p>}
          <div className="mt-3">
            <BenchHandover jobId={job.id} point="shop_to_rider" title={t('bench.dispatch')} help={t('bench.dispatchHelp')} />
          </div>
        </Section>
      );
    case 'ready_for_collection':
      return (
        <Section title={t('bench.collection')} className="border-primary/40">
          <CounterCollection jobId={job.id} />
        </Section>
      );
    case 'return_failed':
      return (
        <Section title={t('status.return_failed')}>
          <p className="text-sm text-muted-foreground">Device is back at the shop. The customer can rebook delivery or choose collection.</p>
        </Section>
      );
    default:
      return (
        <Section title={t(`status.${s}`)}>
          {job.cancel_reason ? <p className="text-sm text-muted-foreground">{job.cancel_reason}</p> : null}
          {v.rating ? <p className="text-sm">{'★'.repeat(v.rating.score)} {v.rating.comment}</p> : null}
          {!isAdmin ? null : null}
        </Section>
      );
  }
}
