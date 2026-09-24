import 'server-only';
import postgres, { type Sql, type TransactionSql } from 'postgres';
import { env } from './env';

/**
 * Two pools (DECISIONS D-6/D-8):
 *  - app: RLS enforced. Every query runs inside withUser(), which sets the request context.
 *  - service: bypasses RLS and sets app.trusted; used for auth, tenant lookup, webhooks and the worker.
 */

export type Tx = TransactionSql;

const g = globalThis as unknown as { __rdApp?: Sql; __rdService?: Sql };

/**
 * bigint (int8) columns hold KES cents and counts. Every value we store is far below 2^53, so parse them as plain
 * numbers instead of strings; anything larger would be a bug and fails loudly.
 */
export const int8AsNumber = {
  to: 20,
  from: [20],
  serialize: (x: number | bigint | string) => String(x),
  parse: (x: string) => {
    const n = Number(x);
    if (!Number.isSafeInteger(n)) throw new Error(`int8 value ${x} exceeds the safe integer range`);
    return n;
  },
};

function make(url: string): Sql {
  return postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => {},
    transform: { undefined: null },
    types: { int8: int8AsNumber },
  }) as unknown as Sql;
}

export function appPool(): Sql {
  return (g.__rdApp ??= make(env().DATABASE_URL));
}

export function servicePool(): Sql {
  return (g.__rdService ??= make(env().DATABASE_SERVICE_URL));
}

export type RequestCtx = { userId: string | null; tenantId: string | null; impersonating?: boolean };

/** Run `fn` as the app role with RLS scoped to this user and shop. */
export async function withUser<T>(ctx: RequestCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return appPool().begin(async (tx) => {
    await tx`select set_config('app.user_id', ${ctx.userId ?? ''}, true),
                    set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                    set_config('app.impersonating', ${ctx.impersonating ? 'true' : ''}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Run `fn` as the service role (no RLS, trusted for system transitions). */
export async function withService<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return servicePool().begin(async (tx) => {
    await tx`select set_config('app.trusted', 'true', true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Postgres error helpers: guard failures and illegal transitions are user-facing. */
export function isGuardError(e: unknown): e is Error & { code: string } {
  const code = (e as { code?: string })?.code;
  return code === 'P0001' || code === 'P0002' || code === 'P0003';
}

export function friendlyDbError(e: unknown): string {
  if (isGuardError(e)) return String((e as Error).message).replace(/^GUARD: /, '');
  if ((e as { code?: string })?.code === '42501') return 'You are not allowed to do that.';
  return 'Something went wrong. Please try again.';
}
