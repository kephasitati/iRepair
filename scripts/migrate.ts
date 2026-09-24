/**
 * Applies db/migrations/*.sql in filename order, once each, tracked in schema_migrations.
 *   npm run db:migrate            apply pending migrations
 *   npm run db:reset              drop and recreate the public schema, then migrate (dev/test only)
 * Uses DATABASE_OWNER_URL (falls back to the docker-compose default).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

export const OWNER_URL = process.env.DATABASE_OWNER_URL ?? 'postgres://repairdesk_owner:owner_dev_password@localhost:55432/repairdesk';

export async function migrate(opts: { reset?: boolean; quiet?: boolean } = {}) {
  const sql = postgres(OWNER_URL, { max: 1, onnotice: () => {} });
  const log = (m: string) => !opts.quiet && console.log(m);
  try {
    if (opts.reset) {
      await sql.unsafe('drop schema public cascade; create schema public; grant all on schema public to public;');
      log('schema reset');
    }
    await sql.unsafe('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const applied = new Set((await sql`select name from schema_migrations`).map((r) => r.name as string));
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const body = readFileSync(path.join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      log(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && /migrate\.ts$/.test(process.argv[1])) {
  migrate({ reset: process.argv.includes('--reset') }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
