import { getTranslations } from 'next-intl/server';
import { Check } from 'lucide-react';
import { CUSTOMER_STEPS, type JobStatus } from '@/lib/core/state-machine';
import { formatKes } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/time';
import { formatKenyanPhone } from '@/lib/core/phone';
import type { EventView, QuoteView } from '@/lib/jobs/view';
import type { DeliveryRow, PhotoRow } from '@/lib/jobs/types';
import { KV } from '@/components/fields';
import { cn } from '@/lib/utils';

/** Server-rendered building blocks shared by the customer and technician job screens. */

export async function StepBar({ status }: { status: JobStatus }) {
  const t = await getTranslations('steps');
  const idx = CUSTOMER_STEPS.findIndex((s) => s.statuses.includes(status));
  const steps = CUSTOMER_STEPS.slice(0, -1);
  return (
    <ol className="flex items-center gap-1" aria-label="progress">
      {steps.map((s, i) => (
        <li key={s.key} className="flex flex-1 flex-col items-center gap-1">
          <span className={cn('grid size-7 place-items-center rounded-full text-xs font-semibold', i < idx ? 'bg-primary text-primary-foreground' : i === idx ? 'bg-primary/15 text-primary ring-2 ring-primary' : 'bg-muted text-muted-foreground')}>
            {i < idx ? <Check className="size-4" /> : i + 1}
          </span>
          <span className={cn('text-[10px] leading-tight', i === idx ? 'font-semibold' : 'text-muted-foreground')}>{t(s.key)}</span>
        </li>
      ))}
    </ol>
  );
}

export function PhotoGrid({ photos, empty }: { photos: Pick<PhotoRow, 'id' | 'kind'>[]; empty?: string }) {
  if (!photos.length) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
        <a key={p.id} href={`/api/photos/${p.id}`} target="_blank" className="group relative block aspect-[3/4] overflow-hidden rounded-lg border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/photos/${p.id}`} alt={p.kind} loading="lazy" className="size-full object-cover" />
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white capitalize">{p.kind.replace('_', ' ')}</span>
        </a>
      ))}
    </div>
  );
}

export async function Timeline({ events }: { events: EventView[] }) {
  const t = await getTranslations('status');
  const items = events.filter((e) => e.event_kind === 'transition' || e.event_kind === 'progress.update').reverse();
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {items.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary" />
          <p className="text-sm font-medium">{e.event_kind === 'transition' && e.to_status ? t(e.to_status) : e.payload?.body}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(e.created_at)}</p>
        </li>
      ))}
    </ol>
  );
}

export async function RiderCard({ delivery }: { delivery: DeliveryRow }) {
  const t = await getTranslations('job');
  const r = delivery.rider_snapshot;
  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
      {r ? (
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-medium">{r.name}</p>
            <p className="text-muted-foreground">
              {r.plate} · {formatKenyanPhone(r.phone)}
            </p>
          </div>
          <a href={`tel:${r.phone}`} className="rounded-lg border bg-background px-3 py-2 text-sm font-medium">
            Call
          </a>
        </div>
      ) : (
        <p className="text-muted-foreground">Assigning a rider…</p>
      )}
      {delivery.tracking_url ? (
        <a href={delivery.tracking_url} target="_blank" className="inline-block font-medium text-primary underline">
          {t('trackingOpen')}
        </a>
      ) : null}
    </div>
  );
}

export async function QuoteBreakdown({ version, vatRateBp, vatRegistered }: { version: NonNullable<QuoteView['current']>; vatRateBp: number; vatRegistered: boolean }) {
  const t = await getTranslations('job');
  return (
    <div className="space-y-2">
      <ul className="divide-y text-sm">
        {version.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-2">
            <span>
              {l.description}
              {l.qty > 1 ? <span className="text-muted-foreground"> × {l.qty}</span> : null}
            </span>
            <span className="shrink-0 tabular-nums">{formatKes(l.line_total_cents)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-muted/50 p-3">
        <KV k={t('quoteSubtotal')} v={formatKes(version.subtotal_cents)} />
        {vatRegistered ? <KV k={t('quoteVat', { rate: vatRateBp / 100 })} v={formatKes(version.vat_cents)} /> : null}
        <KV k={t('quoteTotal')} v={formatKes(version.total_cents)} strong />
        {version.deposit_cents > 0 ? <KV k={t('quoteDeposit')} v={formatKes(version.deposit_cents)} /> : null}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {version.turnaround_days ? <span>{t('quoteTurnaround', { days: version.turnaround_days })}</span> : null}
        {version.expires_at ? <span>{t('quoteExpires', { date: formatDateTime(version.expires_at) })}</span> : null}
      </div>
      {version.message ? <p className="rounded-lg border-l-4 border-primary/40 bg-primary/5 px-3 py-2 text-sm">{version.message}</p> : null}
    </div>
  );
}

export async function QuoteThread({ quote }: { quote: QuoteView }) {
  const t = await getTranslations('job');
  const label = (k: string, side: string) =>
    ({ counter: 'Counter-offer', accept: 'Accepted', decline: 'Declined', revision: side === 'shop' ? 'Quote sent' : 'Revision', message: '', expired: 'Quote expired', reissued: 'Reissued' })[k] ?? k;
  if (!quote.thread.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('thread')}</p>
      <ul className="space-y-2">
        {quote.thread.map((m) => (
          <li key={m.id} className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm', m.author_side === 'customer' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted')}>
            {label(m.kind, m.author_side) ? (
              <p className="text-xs font-semibold opacity-80">
                {label(m.kind, m.author_side)}
                {m.version_no && m.kind === 'revision' ? ` · v${m.version_no}` : ''}
                {m.proposed_total_cents != null ? ` · ${formatKes(m.proposed_total_cents)}` : ''}
              </p>
            ) : null}
            {m.body ? <p>{m.body}</p> : null}
            <p className="mt-0.5 text-[10px] opacity-70">{formatDateTime(m.created_at)}</p>
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
    <div className="space-y-2" data-testid="invoice-summary">
      <ul className="divide-y text-sm">
        {invoice.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-3 py-1.5">
            <span>{l.description}</span>
            <span className="shrink-0 tabular-nums">{formatKes(l.totalCents)}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-muted/50 p-3">
        <KV k={t('quoteSubtotal')} v={formatKes(invoice.subtotal_cents)} />
        {vatRegistered ? <KV k={t('quoteVat', { rate: invoice.vat_rate_bp / 100 })} v={formatKes(invoice.vat_cents)} /> : null}
        <KV k={t('quoteTotal')} v={formatKes(invoice.total_cents)} strong />
        <KV k={t('paid')} v={formatKes(invoice.paid_cents)} />
        <KV k={t('balance')} v={formatKes(invoice.balance_cents)} strong />
      </div>
      <a href={`/api/invoices/${invoice.id}/pdf`} target="_blank" className="inline-block text-sm font-medium text-primary underline">
        {invoice.status === 'issued' ? `${t('downloadInvoice')} (${invoice.number})` : t('proforma')}
      </a>
    </div>
  );
}
