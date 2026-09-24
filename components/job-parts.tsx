import { getTranslations } from 'next-intl/server';
import { Phone } from 'lucide-react';
import { CUSTOMER_STEPS, type JobStatus } from '@/lib/core/state-machine';
import { formatKes } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/time';
import { formatKenyanPhone } from '@/lib/core/phone';
import type { EventView, QuoteView } from '@/lib/jobs/view';
import type { DeliveryRow, PhotoRow } from '@/lib/jobs/types';
import { KV } from '@/components/fields';
import { cn } from '@/lib/utils';

/** Server-rendered building blocks shared by the customer and technician job screens. */

/** Segmented progress bar (Apple-style) with step labels. */
export async function StepBar({ status }: { status: JobStatus }) {
  const t = await getTranslations('steps');
  const idx = CUSTOMER_STEPS.findIndex((s) => s.statuses.includes(status));
  const steps = CUSTOMER_STEPS.slice(0, -1);
  const finished = idx >= steps.length;
  return (
    <div aria-label="progress">
      <div className="flex gap-1.5">
        {steps.map((s, i) => (
          <span
            key={s.key}
            className={cn('h-1.5 flex-1 rounded-full', finished || i < idx ? 'bg-mpesa' : i === idx ? 'pulse-green bg-mpesa/60' : 'bg-fill')}
          />
        ))}
      </div>
      <div className="mt-2 flex">
        {steps.map((s, i) => (
          <span key={s.key} className={cn('flex-1 text-center text-[11px]', i === idx ? 'font-semibold text-ink' : 'text-ink-3')}>
            {t(s.key)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PhotoGrid({ photos, empty }: { photos: Pick<PhotoRow, 'id' | 'kind'>[]; empty?: string }) {
  if (!photos.length) return empty ? <p className="text-[15px] text-ink-3">{empty}</p> : null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
        <a key={p.id} href={`/api/photos/${p.id}`} target="_blank" className="group relative block aspect-[3/4] overflow-hidden rounded-[14px] bg-fill">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/photos/${p.id}`} alt={p.kind} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
          <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white capitalize backdrop-blur-md">{p.kind.replace('_', ' ')}</span>
        </a>
      ))}
    </div>
  );
}

/** Tracking timeline: completed steps in M-Pesa green, the current one pulsing (mnofu tracking). */
export async function Timeline({ events }: { events: EventView[] }) {
  const t = await getTranslations('status');
  const items = events.filter((e) => e.event_kind === 'transition' || e.event_kind === 'progress.update').reverse();
  return (
    <ol className="rd-timeline">
      {items.map((e, i) => (
        <li key={e.id} className={i === 0 ? 'now' : 'done'}>
          <span className="dot" />
          <div>
            <p className="text-[15px] font-medium">{e.event_kind === 'transition' && e.to_status ? t(e.to_status) : e.payload?.body}</p>
            <p className="text-[13px] text-ink-3">{formatDateTime(e.created_at)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export async function RiderCard({ delivery }: { delivery: DeliveryRow }) {
  const t = await getTranslations('job');
  const r = delivery.rider_snapshot;
  const initials = r?.name
    .split(' ')
    .map((x) => x[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="space-y-3 rounded-[16px] bg-canvas p-4">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold tracking-tight">
          Tuma<span className="text-mpesa">Boda</span>
        </span>
        <span className="text-[12px] text-ink-3 capitalize">{delivery.status.replace(/_/g, ' ')}</span>
      </div>
      {r ? (
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-ink text-[14px] font-semibold text-white">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold tracking-tight">{r.name}</p>
            <p className="text-[13px] text-ink-3">
              {r.plate} · {formatKenyanPhone(r.phone)}
            </p>
          </div>
          <a href={`tel:${r.phone}`} className="grid size-11 place-items-center rounded-full bg-mpesa text-white" aria-label="Call rider">
            <Phone className="size-5" />
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-[15px] text-ink-3">
          <span className="pulse-green size-3 rounded-full bg-mpesa" /> Assigning a rider…
        </div>
      )}
      {delivery.tracking_url ? (
        <a href={delivery.tracking_url} target="_blank" className="link-more inline-block text-[15px]">
          {t('trackingOpen')}
        </a>
      ) : null}
    </div>
  );
}

export async function QuoteBreakdown({ version, vatRateBp, vatRegistered }: { version: NonNullable<QuoteView['current']>; vatRateBp: number; vatRegistered: boolean }) {
  const t = await getTranslations('job');
  return (
    <div className="space-y-3">
      <ul className="incl text-[15px]">
        {version.lines.map((l, i) => (
          <li key={i}>
            <span>
              {l.description}
              {l.qty > 1 ? <span className="text-ink-3"> × {l.qty}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{formatKes(l.line_total_cents)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-[14px] bg-canvas px-4 py-3">
        <KV k={t('quoteSubtotal')} v={formatKes(version.subtotal_cents)} />
        {vatRegistered ? <KV k={t('quoteVat', { rate: vatRateBp / 100 })} v={formatKes(version.vat_cents)} /> : null}
        <KV k={t('quoteTotal')} v={formatKes(version.total_cents)} strong />
        {version.deposit_cents > 0 ? <KV k={t('quoteDeposit')} v={formatKes(version.deposit_cents)} /> : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-3">
        {version.turnaround_days ? <span>{t('quoteTurnaround', { days: version.turnaround_days })}</span> : null}
        {version.expires_at ? <span>{t('quoteExpires', { date: formatDateTime(version.expires_at) })}</span> : null}
      </div>
      {version.message ? <p className="rounded-[14px] bg-canvas px-4 py-3 text-[15px] text-ink-2">&ldquo;{version.message}&rdquo;</p> : null}
    </div>
  );
}

/** iMessage-style negotiation thread. */
export async function QuoteThread({ quote }: { quote: QuoteView }) {
  const t = await getTranslations('job');
  const label = (k: string, side: string) =>
    ({ counter: 'Counter-offer', accept: 'Accepted', decline: 'Declined', revision: side === 'shop' ? 'Quote sent' : 'Revision', message: '', expired: 'Quote expired', reissued: 'Reissued' })[k] ?? k;
  if (!quote.thread.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[13px] font-semibold text-ink-3">{t('thread')}</p>
      <ul className="space-y-1.5">
        {quote.thread.map((m) => (
          <li key={m.id} className={cn('flex', m.author_side === 'customer' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[80%] rounded-[20px] px-3.5 py-2 text-[15px]', m.author_side === 'customer' ? 'bg-blue text-white' : 'bg-fill text-ink')}>
              {label(m.kind, m.author_side) ? (
                <p className="text-[12px] font-semibold opacity-80">
                  {label(m.kind, m.author_side)}
                  {m.version_no && m.kind === 'revision' ? ` · v${m.version_no}` : ''}
                  {m.proposed_total_cents != null ? ` · ${formatKes(m.proposed_total_cents)}` : ''}
                </p>
              ) : null}
              {m.body ? <p>{m.body}</p> : null}
              <p className="mt-0.5 text-[10px] opacity-60">{formatDateTime(m.created_at)}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function InvoiceSummary({
  invoice,
  vatRegistered,
}: {
  invoice: { id: string; number: string | null; status: string; lines: { description: string; totalCents: number }[]; subtotal_cents: number; vat_cents: number; vat_rate_bp: number; total_cents: number; paid_cents: number; balance_cents: number };
  vatRegistered: boolean;
}) {
  const t = await getTranslations('job');
  return (
    <div className="space-y-3" data-testid="invoice-summary">
      <ul className="incl text-[15px]">
        {invoice.lines.map((l, i) => (
          <li key={i}>
            <span>{l.description}</span>
            <span className="shrink-0 tabular-nums">{formatKes(l.totalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-[14px] bg-canvas px-4 py-3">
        <KV k={t('quoteSubtotal')} v={formatKes(invoice.subtotal_cents)} />
        {vatRegistered ? <KV k={t('quoteVat', { rate: invoice.vat_rate_bp / 100 })} v={formatKes(invoice.vat_cents)} /> : null}
        <KV k={t('quoteTotal')} v={formatKes(invoice.total_cents)} strong />
        <KV k={t('paid')} v={formatKes(invoice.paid_cents)} />
        <KV k={t('balance')} v={formatKes(invoice.balance_cents)} strong />
      </div>
      <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="link-more inline-block text-[15px]">
        {invoice.status === 'issued' ? `${t('downloadInvoice')} (${invoice.number})` : t('proforma')}
      </a>
    </div>
  );
}

/** Receipt shown after a payment clears (the pay panel itself disappears once the job moves on). */
export async function PaymentReceipt({ payment }: { payment: { purpose: string; amount_cents: number; mpesa_receipt: string | null; confirmed_at: string | null } }) {
  const t = await getTranslations('pay');
  return (
    <div className="tile fade-up flex items-center gap-4 p-5" data-testid="payment-success">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-mpesa text-[22px] text-white">✓</span>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-semibold tracking-tight">{t('success')}</p>
        <p className="text-[14px] text-ink-3">
          {t(`purpose.${payment.purpose}`)} · {formatKes(payment.amount_cents)}
        </p>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {t('receipt')} <span className="font-mono font-semibold text-ink">{payment.mpesa_receipt}</span>
        </p>
      </div>
    </div>
  );
}
