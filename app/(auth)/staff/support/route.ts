import { completeSupportHandoff } from '@/app/platform/actions';

export const dynamic = 'force-dynamic';

/** Landing point of a platform support-mode handoff (single use, 60 s). A route handler because it sets the session cookie. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const ok = token ? await completeSupportHandoff(token) : false;
  if (ok) return Response.redirect(new URL('/bench', req.url), 303);
  return new Response('Support link expired. Start support mode again from the platform console.', { status: 410, headers: { 'content-type': 'text/plain' } });
}
