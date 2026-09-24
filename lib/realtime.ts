import 'server-only';
import { EventEmitter } from 'node:events';
import postgres from 'postgres';
import { env } from './env';

/** One LISTEN connection per server process, fanned out in-process to SSE subscribers. */

export type RdEvent = { t: 'job' | 'notification'; job_id?: string | null; tenant_id?: string | null; user_id?: string | null; payment_id?: string | null };

const g = globalThis as unknown as { __rdBus?: EventEmitter; __rdListening?: Promise<void> };

export function bus(): EventEmitter {
  if (!g.__rdBus) {
    g.__rdBus = new EventEmitter();
    g.__rdBus.setMaxListeners(0);
  }
  if (!g.__rdListening) {
    const sql = postgres(env().DATABASE_SERVICE_URL, { max: 1, onnotice: () => {} });
    g.__rdListening = sql
      .listen('rd_events', (payload) => {
        try {
          g.__rdBus!.emit('event', JSON.parse(payload) as RdEvent);
        } catch {
          /* ignore malformed */
        }
      })
      .then(() => undefined)
      .catch((e) => {
        console.error('[realtime] listen failed', e);
        g.__rdListening = undefined;
      });
  }
  return g.__rdBus;
}
