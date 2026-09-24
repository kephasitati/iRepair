'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Subscribes to /api/events and refreshes the current route when something relevant changes.
 * `jobId` limits refreshes to one job; omit it on list/board pages. Falls back to a 30 s poll if SSE drops.
 */
export function LiveRefresh({ jobId, onEvent }: { jobId?: string; onEvent?: (e: { t: string; job_id?: string; payment_id?: string }) => void }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onEvent);
  cb.current = onEvent;

  useEffect(() => {
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };
    const connect = () => {
      es = new EventSource('/api/events');
      es.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data);
          if (e.t === 'hello') return;
          cb.current?.(e);
          if (!jobId || e.job_id === jobId) refresh();
        } catch {}
      };
      es.onerror = () => {
        if (!poll) poll = setInterval(refresh, 30000);
      };
      es.onopen = () => {
        if (poll) clearInterval(poll);
        poll = null;
      };
    };
    connect();
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      es?.close();
      if (poll) clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [jobId, router]);
  return null;
}
