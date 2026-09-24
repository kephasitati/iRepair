import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import QRCode from 'qrcode';
import { Section, KV } from '@/components/fields';
import { StatusBadge } from '@/components/status-badge';
import { LiveRefresh } from '@/components/live-refresh';
import { PayPanel } from '@/components/pay-panel';
import { InvoiceSummary, PaymentReceipt, PhotoGrid, QuoteBreakdown, QuoteThread, RiderCard, StepBar, Timeline } from '@/components/job-parts';
import {
  CancelBooking,
  DeliveredConfirm,
  DropoffChooser,
  HandoverScan,
  IntakeReview,
  QuoteActions,
  QuoteMessageBox,
  RateLater,
  RebookPickup,
  WarrantyClaim,
} from '@/components/customer-job';
import { requestCtx, requireCustomer } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatDate, formatDateTime } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { collectionCode } from '@/lib/jobs/logistics';
import { loadJobView, type JobView } from '@/lib/jobs/view';
import { isSimulatedMpesa, mpesaFor } from '@/lib/providers';
import type { Tenant } from '@/lib/tenant';
import type { JobStatus } from '@/lib/core/state-machine';

export const dynamic = 'force-dynamic';

export default async function CustomerJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, tenant } = await requireCustomer(`/jobs/${id}`);
  const ctx = await requestCtx();
  const t = await getTranslations();
  let v: JobView;
  try {
    v = await withUser(ctx, (tx) => loadJobView(tx, id));
  } catch {
    notFound();
  }
  const { job } = v;
  if (job.status === 'draft') redirect(`/book?job=${job.id}`);
  const simulator = isSimulatedMpesa(await mpesaFor(tenant));
  const phone = session.user.phone_e164 ?? '';
  const s = job.status;
  // The pay panel disappears once the job moves on, so the receipt for a payment in the last 15 minutes stays on top.
  const recentPayment = v.payments.filter((p) => p.status === 'success' && p.confirmed_at && Date.now() - new Date(p.confirmed_at).getTime() < 15 * 60_000).at(-1);

  return (
    <div className="space-y-4">
      <LiveRefresh jobId={job.id} />
      <div className="flex items-end justify-between gap-3 pt-2">
        <div>
          <p className="eyebrow">{job.ref}</p>
          <h1 className="display text-[32px] sm:text-[40px]">{`${job.device_model}`.trim()}</h1>
        </div>
        <StatusBadge status={s} className="mb-1.5" />
      </div>
      <StepBar status={s} />

      {recentPayment ? <PaymentReceipt payment={recentPayment} /> : null}
      <NextStep v={v} tenant={tenant} simulator={simulator} phone={phone} t={t} />

      {v.mainQuote && !['quote_sent', 'quote_negotiating', 'quote_expired'].includes(s) && v.mainQuote.current ? (
        <Section title={t('job.quote')}>
          <QuoteBreakdown version={v.mainQuote.current} vatRateBp={tenant.settings.vat_rate_bp} vatRegistered={tenant.settings.vat_registered} />
          <div className="mt-3">
            <QuoteThread quote={v.mainQuote} />
          </div>
        </Section>
      ) : null}

      {v.progress.filter((p) => !p.internal).length ? (
        <Section title={t('job.progress')}>
          <ul className="space-y-3">
            {v.progress
              .filter((p) => !p.internal)
              .map((p) => (
                <li key={p.id} className="rounded-lg bg-muted/40 p-3">
                  <p className="text-sm">{p.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(p.created_at)}</p>
                  {p.photo_ids?.length ? (
                    <div className="mt-2">
                      <PhotoGrid photos={p.photo_ids.map((pid: string) => ({ id: pid, kind: 'progress' }))} />
                    </div>
                  ) : null}
                </li>
              ))}
          </ul>
        </Section>
      ) : null}

      {v.intake && s !== 'intake_ack_pending' ? (
        <Section title={t('job.intakeTitle')}>
          <p className="text-sm">{v.intake.summary}</p>
          {v.discrepancies.length ? <Discrepancies v={v} t={t} /> : <p className="mt-2 text-sm text-emerald-700">{t('job.intakeMatches')}</p>}
          <div className="mt-3">
            <PhotoGrid photos={v.photos.filter((p) => p.stage === 'intake')} />
          </div>
        </Section>
      ) : null}

      <Section title={t('job.declaredPhotos')}>
        <PhotoGrid photos={v.photos.filter((p) => p.stage === 'customer_declared')} />
        {v.photos.some((p) => p.stage === 'completion') ? (
          <>
            <p className="mt-4 mb-2 text-sm font-medium">{t('job.afterPhotos')}</p>
            <PhotoGrid photos={v.photos.filter((p) => p.stage === 'completion')} />
          </>
        ) : null}
      </Section>

      {v.payments.some((p) => p.status === 'success') ? (
        <Section title={t('pay.title')}>
          <ul className="divide-y text-sm">
            {v.payments
              .filter((p) => p.status === 'success')
              .map((p) => (
                <li key={p.id} className="flex justify-between gap-2 py-2">
                  <span>
                    {t(`pay.purpose.${p.purpose}`)}
                    <span className="block text-xs text-muted-foreground">
                      {t('pay.receipt')} {p.mpesa_receipt} · {p.confirmed_at ? formatDateTime(p.confirmed_at) : ''}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatKes(p.amount_cents)}</span>
                </li>
              ))}
          </ul>
          {v.invoice?.status === 'issued' ? (
            <a href={`/api/invoices/${v.invoice.id}/pdf`} target="_blank" className="mt-2 inline-block text-sm font-medium text-primary underline">
              {t('job.downloadInvoice')} ({v.invoice.number})
            </a>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('job.timeline')}>
        <Timeline events={v.events} />
      </Section>
    </div>
  );
}

type T = Awaited<ReturnType<typeof getTranslations>>;

async function Discrepancies({ v, t }: { v: JobView; t: T }) {
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-medium text-amber-800">{t('job.intakeDiscrepancies')}</p>
      <ul className="space-y-2">
        {v.discrepancies.map((d) => (
          <li key={d.id} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-medium capitalize">{String(d.field).replace('_', ' ')}</p>
            <p>
              {t('bench.discrepancyDeclared')}: {d.declared_value || '—'} → {t('bench.discrepancyObserved')}: {d.observed_value || '—'}
            </p>
            {d.note ? <p className="text-xs">{d.note}</p> : null}
            {d.acknowledged_at ? <p className="mt-1 text-xs">{t('job.acknowledged', { date: formatDate(d.acknowledged_at) })}</p> : null}
            {d.photo_ids?.length ? (
              <div className="mt-2">
                <PhotoGrid photos={d.photo_ids.map((id: string) => ({ id, kind: 'discrepancy' }))} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

async function NextStep({ v, tenant, simulator, phone, t }: { v: JobView; tenant: Tenant; simulator: boolean; phone: string; t: T }) {
  const { job } = v;
  const s: JobStatus = job.status;
  const pickupLeg = v.deliveries.filter((d) => d.leg === 'pickup').at(-1);
  const returnLeg = v.deliveries.filter((d) => d.leg === 'return').at(-1);
  const pay = (purpose: 'pickup_fee' | 'deposit' | 'final_balance' | 'return_fee', amount: number, quoteId?: string) => (
    <PayPanel jobId={job.id} purpose={purpose} amountCents={amount} defaultPhone={phone} simulator={simulator} quoteId={quoteId} />
  );

  switch (s) {
    case 'pickup_fee_pending':
      return (
        <Section title={t('pay.title')}>
          <p className="mb-3 text-sm text-muted-foreground">{t('wizard.draftSaved')}</p>
          {pay('pickup_fee', job.pickup_fee_cents)}
          <div className="mt-3">
            <CancelBooking jobId={job.id} free />
          </div>
        </Section>
      );
    case 'pickup_requested':
    case 'rider_en_route_to_customer':
      return (
        <Section title={t('job.tracking')}>
          {pickupLeg ? <RiderCard delivery={pickupLeg} /> : <p className="text-sm text-muted-foreground">{t('status.pickup_requested')}…</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            {t('wizard.window')}: {job.pickup_window_start ? `${formatDateTime(job.pickup_window_start)}` : ''}
          </p>
          <div className="mt-4">
            <HandoverScan jobId={job.id} label={t('job.scanRider')} />
          </div>
          <div className="mt-3">
            <CancelBooking jobId={job.id} free={false} />
          </div>
        </Section>
      );
    case 'pickup_failed':
      return (
        <Section title={t('status.pickup_failed')}>
          <RebookPickup jobId={job.id} />
          <div className="mt-2">
            <CancelBooking jobId={job.id} free={false} />
          </div>
        </Section>
      );
    case 'picked_up':
    case 'in_transit_to_shop':
      return <Section title={t('job.tracking')}>{pickupLeg ? <RiderCard delivery={pickupLeg} /> : null}</Section>;
    case 'received_at_shop':
    case 'diagnosing':
      return (
        <Section title={t(`status.${s}`)}>
          <p className="text-sm text-muted-foreground">{s === 'diagnosing' ? t('status.diagnosing') + '…' : t('job.intakeTitle') + '…'}</p>
          {s === 'diagnosing' ? (
            <div className="mt-3">
              <CancelBooking jobId={job.id} free={false} />
            </div>
          ) : null}
        </Section>
      );
    case 'intake_ack_pending':
      return (
        <Section title={t('job.intakeTitle')} className="border-amber-300">
          <p className="text-sm">{v.intake?.summary}</p>
          <Discrepancies v={v} t={t} />
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <p className="mb-1 text-xs font-medium">{t('job.declaredPhotos')}</p>
              <PhotoGrid photos={v.photos.filter((p) => p.stage === 'customer_declared')} />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium">{t('job.intakePhotos')}</p>
              <PhotoGrid photos={v.photos.filter((p) => p.stage === 'intake')} />
            </div>
          </div>
          <div className="mt-4">
            <IntakeReview jobId={job.id} />
          </div>
        </Section>
      );
    case 'quote_sent':
    case 'quote_negotiating':
    case 'quote_expired': {
      const q = v.mainQuote!;
      const roundsLeft = Math.max(tenant.settings.max_negotiation_rounds - q.rounds_used, 0);
      return (
        <Section title={`${t('job.quote')} · ${t('job.quoteVersion', { n: q.current?.version_no ?? 1 })}`} className="border-primary/40">
          {q.current ? <QuoteBreakdown version={q.current} vatRateBp={tenant.settings.vat_rate_bp} vatRegistered={tenant.settings.vat_registered} /> : null}
          <div className="mt-4">
            <QuoteActions jobId={job.id} kind="main" canCounter={roundsLeft > 0 && s !== 'quote_negotiating'} roundsLeft={roundsLeft} currentTotalCents={q.current?.total_cents ?? 0} expired={s === 'quote_expired'} />
          </div>
          <div className="mt-4 space-y-3">
            <QuoteThread quote={q} />
            <QuoteMessageBox jobId={job.id} kind="main" />
          </div>
        </Section>
      );
    }
    case 'deposit_pending':
      return <Section title={t('job.quoteDeposit')}>{pay('deposit', v.mainQuote?.versions.find((x) => x.total_cents === v.mainQuote?.accepted_total_cents)?.deposit_cents ?? v.mainQuote?.current?.deposit_cents ?? 0)}</Section>;
    case 'in_repair': {
      const supp = v.supplementary.find((q) => ['sent', 'negotiating'].includes(q.status));
      return supp?.current ? (
        <Section title={t('job.supplementary')} className="border-primary/40">
          <p className="mb-3 text-sm text-muted-foreground">{t('job.supplementaryHelp')}</p>
          <QuoteBreakdown version={supp.current} vatRateBp={tenant.settings.vat_rate_bp} vatRegistered={tenant.settings.vat_registered} />
          <div className="mt-4">
            <QuoteActions jobId={job.id} kind="supplementary" canCounter={supp.rounds_used < tenant.settings.max_negotiation_rounds && supp.status !== 'negotiating'} roundsLeft={tenant.settings.max_negotiation_rounds - supp.rounds_used} currentTotalCents={supp.current.total_cents} expired={false} />
          </div>
          <div className="mt-3">
            <QuoteThread quote={supp} />
          </div>
        </Section>
      ) : (
        <Section title={t('status.in_repair')}>
          <p className="text-sm text-muted-foreground">{t('job.progress')}…</p>
        </Section>
      );
    }
    case 'repair_complete':
      return (
        <Section title={t('job.completion')} className="border-emerald-300">
          <DropoffChooser jobId={job.id} pickupAddress={job.pickup_address!} zones={tenant.settings.service_zones} openingHours={tenant.settings.opening_hours} current={{ choice: job.dropoff_choice, address: job.dropoff_address }} />
        </Section>
      );
    case 'final_payment_pending':
      return (
        <Section title={t('job.invoice')}>
          {v.invoice ? <InvoiceSummary invoice={v.invoice} vatRegistered={tenant.settings.vat_registered} /> : null}
          <div className="mt-4">{pay('final_balance', v.invoice?.balance_cents ?? 0)}</div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-muted-foreground">{t('job.chooseDropoff')}</summary>
            <div className="mt-3">
              <DropoffChooser jobId={job.id} pickupAddress={job.pickup_address!} zones={tenant.settings.service_zones} openingHours={tenant.settings.opening_hours} current={{ choice: job.dropoff_choice, address: job.dropoff_address }} />
            </div>
          </details>
        </Section>
      );
    case 'return_fee_pending': {
      const quoted = v.quotedLegs.find((q) => q.leg === 'return');
      return (
        <Section title={t('status.return_fee_pending')}>
          {job.dropoff_choice && job.return_fee_cents > 0 && quoted ? (
            <>
              {pay('return_fee', job.return_fee_cents)}
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted-foreground">{t('job.chooseDropoff')}</summary>
                <div className="mt-3">
                  <DropoffChooser jobId={job.id} pickupAddress={job.pickup_address!} zones={tenant.settings.service_zones} openingHours={tenant.settings.opening_hours} current={{ choice: job.dropoff_choice, address: job.dropoff_address }} />
                </div>
              </details>
            </>
          ) : (
            <DropoffChooser jobId={job.id} pickupAddress={job.pickup_address!} zones={tenant.settings.service_zones} openingHours={tenant.settings.opening_hours} current={{ choice: job.dropoff_choice, address: job.dropoff_address }} />
          )}
        </Section>
      );
    }
    case 'return_failed':
      return (
        <Section title={t('status.return_failed')}>
          <DropoffChooser jobId={job.id} pickupAddress={job.pickup_address!} zones={tenant.settings.service_zones} openingHours={tenant.settings.opening_hours} current={{ choice: job.dropoff_choice, address: job.dropoff_address }} />
        </Section>
      );
    case 'dispatch_pending':
    case 'return_requested':
    case 'rider_en_route_to_shop':
      return (
        <Section title={t('job.tracking')}>
          {returnLeg ? <RiderCard delivery={returnLeg} /> : <p className="text-sm text-muted-foreground">{t('status.return_requested')}…</p>}
        </Section>
      );
    case 'collected_from_shop':
    case 'in_transit_to_customer':
      return (
        <Section title={t('job.tracking')}>
          {returnLeg ? <RiderCard delivery={returnLeg} /> : null}
          <div className="mt-4">
            <HandoverScan jobId={job.id} label={t('job.scanRider')} />
          </div>
        </Section>
      );
    case 'ready_for_collection': {
      const code = collectionCode(job.id);
      const qr = await QRCode.toDataURL(`RDCOLLECT:${job.id}:${code}`, { margin: 1, width: 320 });
      return (
        <Section title={t('status.ready_for_collection')} className="border-emerald-300">
          <p className="text-sm text-muted-foreground">{t('job.collectionHelp')}</p>
          <div className="mt-3 flex flex-col items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" className="size-44 rounded-lg border bg-white p-2" />
            <p className="font-mono text-3xl font-bold tracking-widest" data-testid="collection-code">
              {code}
            </p>
          </div>
          <p className="mt-3 text-center text-sm">{tenant.settings.address_formatted}</p>
        </Section>
      );
    }
    case 'delivered':
      return (
        <Section title={t('status.delivered')} className="border-emerald-300">
          <DeliveredConfirm jobId={job.id} />
        </Section>
      );
    case 'closed':
    case 'declined_returned':
    case 'cancelled':
      return (
        <Section title={t(`status.${s}`)}>
          {job.warranty_until ? <KV k={t('job.warranty', { date: formatDate(job.warranty_until) })} v="" /> : null}
          {job.cancel_reason ? <p className="text-sm text-muted-foreground">{job.cancel_reason}</p> : null}
          {v.invoice?.status === 'issued' ? (
            <a href={`/api/invoices/${v.invoice.id}/pdf`} target="_blank" className="mt-2 inline-block text-sm font-medium text-primary underline">
              {t('job.downloadInvoice')} ({v.invoice.number})
            </a>
          ) : null}
          {s === 'closed' && !v.rating ? (
            <div className="mt-4">
              <RateLater jobId={job.id} />
            </div>
          ) : null}
          {v.rating ? <p className="mt-2 text-sm">{'★'.repeat(v.rating.score)}{v.rating.comment ? ` · ${v.rating.comment}` : ''}</p> : null}
          {s === 'closed' && job.warranty_until && new Date(job.warranty_until) >= new Date() ? (
            <div className="mt-4">
              <WarrantyClaim jobId={job.id} />
            </div>
          ) : null}
          {v.disputes.length ? (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {v.disputes.map((d) => (
                <li key={d.id}>
                  {formatDate(d.created_at)} · {d.kind} · {d.status}
                  {d.resolution ? ` · ${d.resolution}` : ''}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      );
    default:
      return null;
  }
}
