import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronRight } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { LiveRefresh } from '@/components/live-refresh';
import { requestCtx, requireCustomer } from '@/lib/auth';
import { formatDate } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import type { JobStatus } from '@/lib/core/state-machine';
import { cn } from '@/lib/utils';

export const metadata = { title: 'My repairs' };

export default async function JobsPage() {
  await requireCustomer('/jobs');
  const [ctx, t] = await Promise.all([requestCtx(), getTranslations()]);
  const jobs = await withUser(ctx, (tx) => tx`select id, ref, status, device_brand, device_model, created_at from jobs where customer_user_id = ${ctx.userId} order by created_at desc`);
  return (
    <div className="space-y-4">
      <LiveRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('landing.myJobs')}</h1>
        <Link href="/book" className={cn(buttonVariants({ size: 'sm' }))}>
          {t('landing.cta')}
        </Link>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-muted-foreground">{t('job.empty')}</p>
          <Link href="/book" className={cn(buttonVariants(), 'mt-4')}>
            {t('job.bookFirst')}
          </Link>
        </div>
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link href={j.status === 'draft' ? `/book?job=${j.id}` : `/jobs/${j.id}`} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{`${j.device_brand} ${j.device_model}`.trim()}</p>
                  <p className="text-xs text-muted-foreground">
                    {j.ref} · {formatDate(j.created_at)}
                  </p>
                </div>
                <StatusBadge status={j.status as JobStatus} />
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
