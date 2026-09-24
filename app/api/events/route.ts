import { getSession } from '@/lib/auth';
import { servicePool } from '@/lib/db';
import { bus, type RdEvent } from '@/lib/realtime';
import { getTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events: `data: {"t":"job","job_id":"..."}` whenever something the viewer can see changes.
 * Clients respond by refreshing through normal (RLS-checked) requests.
 */
export async function GET(req: Request) {
  const [session, tenant] = await Promise.all([getSession(), getTenant()]);
  if (!session || !tenant) return new Response('unauthorized', { status: 401 });
  const userId = session.user.id;
  const isStaff = !!session.role || (session.user.is_platform_admin && session.impersonatingTenantId === tenant.id);
  const own = new Set<string>();
  if (!isStaff) {
    const rows = await servicePool()`select id from jobs where customer_user_id = ${userId} and tenant_id = ${tenant.id}`;
    rows.forEach((r) => own.add(r.id));
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      const onEvent = async (e: RdEvent) => {
        if (e.tenant_id !== tenant.id) return;
        if (e.t === 'notification') {
          if (e.user_id === userId) send({ t: 'notification', job_id: e.job_id });
          return;
        }
        if (isStaff) return send({ t: 'job', job_id: e.job_id, payment_id: e.payment_id });
        if (e.job_id && !own.has(e.job_id)) {
          const [r] = await servicePool()`select 1 from jobs where id = ${e.job_id} and customer_user_id = ${userId}`;
          if (!r) return;
          own.add(e.job_id);
        }
        send({ t: 'job', job_id: e.job_id, payment_id: e.payment_id });
      };
      const b = bus();
      b.on('event', onEvent);
      const ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), 25000);
      send({ t: 'hello' });
      cleanup = () => {
        clearInterval(ping);
        b.off('event', onEvent);
      };
      req.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
}
