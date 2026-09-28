import { safeEqual } from '@/lib/core/crypto';
import { servicePool } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * Africa's Talking delivery reports (form-encoded: id, status, phoneNumber, failureReason). Their reports are not
 * signed, so the URL carries a secret: POST /api/webhooks/sms/dlr?token=<SMS_DLR_TOKEN>. Without a configured token the
 * route does not exist; nothing from an unverified caller is stored.
 */
export async function POST(req: Request) {
  const expected = env().SMS_DLR_TOKEN;
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!expected || !safeEqual(token, expected)) return new Response('not found', { status: 404 });
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return new Response('too large', { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new Response('too large', { status: 413 });
  const form = new URLSearchParams(raw);
  const sql = servicePool();
  await sql`insert into webhook_events (source, headers, raw_body, signature_valid, processed_at) values ('africastalking', ${sql.json(Object.fromEntries(req.headers.entries()))}, ${raw}, true, now())`;
  const id = form.get('id');
  const status = form.get('status');
  if (id && status) {
    const mapped = status === 'Success' ? 'delivered' : ['Failed', 'Rejected', 'AbsentSubscriber', 'Expired'].includes(status) ? 'failed' : null;
    if (mapped) await sql`update notifications set status = ${mapped}, last_error = ${form.get('failureReason')} where provider_message_id = ${id}`;
  }
  return new Response('ok');
}
