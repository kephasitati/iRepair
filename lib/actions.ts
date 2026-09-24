import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { friendlyDbError, isGuardError } from './db';
import { UserError } from './jobs/types';

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Wrap a server action body: user-facing errors become `{ ok: false, error }`, redirects pass through. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return { ok: false, error: e.message };
    if (isGuardError(e)) return { ok: false, error: friendlyDbError(e) };
    if ((e as { code?: string })?.code === '42501' || /row-level security/.test((e as Error)?.message ?? '')) {
      // Permission refusals are shown to the user politely but must never be invisible to us: a refusal on a
      // legitimate action is a bug (for example a write that should go through a checked function).
      console.warn('[action] permission refused:', (e as Error).message);
      return { ok: false, error: 'You are not allowed to do that.' };
    }
    console.error('[action]', e);
    return { ok: false, error: 'Something went wrong. Please try again.' };
  }
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function kesField(fd: FormData, key: string): number {
  const raw = str(fd, key).replace(/[,\s]/g, '');
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new UserError('Enter a valid amount in KES.');
  return Math.round(n) * 100;
}
