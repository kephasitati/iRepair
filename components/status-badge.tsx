import { useTranslations } from 'next-intl';
import type { JobStatus } from '@/lib/core/state-machine';
import { cn } from '@/lib/utils';

// Quiet, Apple-style status capsules: a coloured dot plus text on a light fill.
const TONE: Partial<Record<JobStatus, 'action' | 'info' | 'work' | 'good' | 'bad' | 'done'>> = {
  pickup_fee_pending: 'action',
  deposit_pending: 'action',
  final_payment_pending: 'action',
  return_fee_pending: 'action',
  intake_ack_pending: 'action',
  quote_sent: 'info',
  quote_negotiating: 'info',
  diagnosing: 'work',
  in_repair: 'work',
  repair_complete: 'good',
  ready_for_collection: 'good',
  delivered: 'good',
  closed: 'done',
  declined_returned: 'done',
  cancelled: 'done',
  pickup_failed: 'bad',
  return_failed: 'bad',
  quote_expired: 'bad',
};

const STYLES = {
  action: 'bg-[#fff4e5] text-[#9a5b00] before:bg-[#ff9f0a]',
  info: 'bg-[#e8f1fc] text-[#0058b0] before:bg-[#0071e3]',
  work: 'bg-[#f3ecfd] text-[#6d33b5] before:bg-[#af52de]',
  good: 'bg-[#e8f6ec] text-[#1a6b35] before:bg-[#1f7a3f]',
  bad: 'bg-[#fdecec] text-[#b00020] before:bg-[#e30000]',
  done: 'bg-fill text-ink-3 before:bg-ink-3',
  default: 'bg-[#e9f4fb] text-[#115e8a] before:bg-[#32ade6]',
};

export function StatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const t = useTranslations('status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium whitespace-nowrap before:size-1.5 before:rounded-full before:content-[""]',
        STYLES[TONE[status] ?? 'default'],
        className,
      )}
    >
      {t(status)}
    </span>
  );
}
