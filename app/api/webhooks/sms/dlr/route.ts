import { servicePool } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Africa's Talking delivery reports (form-encoded: id, status, phoneNumber, failureReason). */
export async function POST(req: Request) {
  const raw = await req.text();
  const form = new URLSearchParams(raw);
  const sql = servicePool();
  await sql`insert into webhook_events (source, headers, raw_body, signature_valid, processed_at) values ('africastalking', ${sql.json(Object.fromEntries(req.headers.entries()))}, ${raw}, null, now())`;
  const id = form.get('id');
  const status = form.get('status');
  if (id && status) {
    const mapped = status === 'Success' ? 'delivered' : ['Failed', 'Rejected', 'AbsentSubscriber', 'Expired'].includes(status) ? 'failed' : null;
    if (mapped) await sql`update notifications set status = ${mapped}, last_error = ${form.get('failureReason')} where provider_message_id = ${id}`;
  }
  return new Response('ok');
}
