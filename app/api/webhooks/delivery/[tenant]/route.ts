import { servicePool, withService } from '@/lib/db';
import { applyDeliveryStatus } from '@/lib/jobs/logistics';
import type { DeliveryRow } from '@/lib/jobs/types';
import { deliveryProviderFor } from '@/lib/providers';
import { loadTenantById } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Courier status webhooks, one URL per shop: /api/webhooks/delivery/<tenant slug>.
 * Logged raw first, signature-verified by the provider adapter, deduplicated by the provider's event id.
 */
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const raw = await req.text();
  const headers = Object.fromEntries([...req.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const sql = servicePool();
  const [t] = await sql`select id from tenants where slug = ${slug}`;
  const [evt] = await sql`insert into webhook_events (source, tenant_id, headers, raw_body) values ('tumaboda', ${t?.id ?? null}, ${sql.json(headers)}, ${raw}) returning id`;
  if (!t) return new Response('unknown tenant', { status: 404 });

  const tenant = await loadTenantById(t.id);
  if (!tenant) return new Response('unknown tenant', { status: 404 });
  try {
    const provider = await deliveryProviderFor(tenant);
    const event = provider.parseWebhook(raw, headers);
    const dedupe = `${provider.kind}:${event.eventId}`;
    const [fresh] = await sql`update webhook_events set signature_valid = true, dedupe_key = ${dedupe} where id = ${evt.id} and not exists (select 1 from webhook_events where dedupe_key = ${dedupe}) returning id`;
    if (!fresh) {
      await sql`update webhook_events set signature_valid = true, processed_at = now(), error = 'duplicate' where id = ${evt.id}`;
      return Response.json({ ok: true, duplicate: true });
    }
    await withService(async (tx) => {
      const [d] = (await tx`select * from deliveries where provider = ${provider.kind} and provider_delivery_id = ${event.deliveryId} and tenant_id = ${tenant.id} for update`) as DeliveryRow[];
      if (!d) throw new Error(`delivery ${event.deliveryId} not found`);
      await applyDeliveryStatus(tx, d, { status: event.status, rider: event.rider, trackingUrl: event.trackingUrl, failureReason: event.failureReason, raw: event.raw });
    });
    await sql`update webhook_events set processed_at = now() where id = ${evt.id}`;
    return Response.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    await sql`update webhook_events set error = ${msg}, processed_at = now(), signature_valid = coalesce(signature_valid, ${!/signature|timestamp/i.test(msg)}) where id = ${evt.id}`;
    const status = /signature|timestamp/i.test(msg) ? 401 : 400;
    return Response.json({ ok: false, error: status === 401 ? 'invalid signature' : 'rejected' }, { status });
  }
}
