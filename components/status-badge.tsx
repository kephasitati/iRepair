import { useTranslations } from 'next-intl';
import type { JobStatus } from '@/lib/core/state-machine';
import { cn } from '@/lib/utils';

const TONE: Partial<Record<JobStatus, string>> = {
  pickup_fee_pending: 'bg-amber-100 text-amber-900',
  deposit_pending: 'bg-amber-100 text-amber-900',
  final_payment_pending: 'bg-amber-100 text-amber-900',
  return_fee_pending: 'bg-amber-100 text-amber-900',
  intake_ack_pending: 'bg-amber-100 text-amber-900',
  quote_sent: 'bg-blue-100 text-blue-900',
  quote_negotiating: 'bg-blue-100 text-blue-900',
  repair_complete: 'bg-emerald-100 text-emerald-900',
  ready_for_collection: 'bg-emerald-100 text-emerald-900',
  delivered: 'bg-emerald-100 text-emerald-900',
  closed: 'bg-slate-200 text-slate-700',
  declined_returned: 'bg-slate-200 text-slate-700',
  cancelled: 'bg-slate-200 text-slate-700',
  pickup_failed: 'bg-red-100 text-red-900',
  return_failed: 'bg-red-100 text-red-900',
  quote_expired: 'bg-red-100 text-red-900',
  in_repair: 'bg-violet-100 text-violet-900',
  diagnosing: 'bg-violet-100 text-violet-900',
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const t = useTranslations('status');
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', TONE[status] ?? 'bg-sky-100 text-sky-900', className)}>{t(status)}</span>;
}
