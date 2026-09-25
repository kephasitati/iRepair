import { safeEqual } from '@/lib/core/crypto';
import { env } from '@/lib/env';
import { tick } from '@/worker/tasks';

export const dynamic = 'force-dynamic';

/**
 * Runs one worker pass. For hosts without a resident worker process (DECISIONS D-17), e.g. Vercel, where a
 * Cron Job (see vercel.json) hits this on a schedule instead. Vercel Cron sends a GET request and, when the
 * project has an env var literally named `CRON_SECRET`, automatically attaches `Authorization: Bearer
 * <CRON_SECRET>` — accepted here alongside the existing `INTERNAL_CRON_SECRET` used by a manual curl/systemd
 * timer on a VPS, so the same route works either way without a secret ever appearing in vercel.json itself.
 */
function authorized(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? '';
  if (safeEqual(auth, `Bearer ${env().INTERNAL_CRON_SECRET}`)) return true;
  const vercelCronSecret = process.env.CRON_SECRET;
  return !!vercelCronSecret && safeEqual(auth, `Bearer ${vercelCronSecret}`);
}

async function run(req: Request) {
  if (!authorized(req)) return new Response('unauthorized', { status: 401 });
  const did = await tick();
  return Response.json({ ok: true, did });
}

export async function POST(req: Request) {
  return run(req);
}

/** Vercel Cron Jobs call with GET; kept identical to POST otherwise. */
export async function GET(req: Request) {
  return run(req);
}
