import { safeEqual } from '@/lib/core/crypto';
import { env } from '@/lib/env';
import { tick } from '@/worker/tasks';

export const dynamic = 'force-dynamic';

/** Runs one worker pass. For hosts without a resident worker; protected by INTERNAL_CRON_SECRET. */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization') ?? '';
  if (!safeEqual(auth, `Bearer ${env().INTERNAL_CRON_SECRET}`)) return new Response('unauthorized', { status: 401 });
  const did = await tick();
  return Response.json({ ok: true, did });
}
