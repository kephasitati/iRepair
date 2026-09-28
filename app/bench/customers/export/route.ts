import { requestCtx, requireStaff } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { listCustomers } from '@/lib/crm';
import { withUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Quoted, and a leading formula character is neutralised: spreadsheets evaluate `=`, `+`, `-`, `@` cells even inside quotes. */
const cell = (v: unknown) => {
  const s = String(v ?? '');
  return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** Customer list as CSV (shop admins only; the export is audited — it is personal data leaving the system). */
export async function GET(req: Request) {
  const { tenant, session } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const q = new URL(req.url).searchParams.get('q') ?? '';
  const rows: string[] = ['name,phone,email,jobs,open_jobs,paid_kes,last_job,tags,next_followup'];
  await withUser(ctx, async (tx) => {
    for (let page = 1; page <= 200; page++) {
      const { rows: batch, pages } = await listCustomers(tx, tenant.id, { search: q, page });
      for (const c of batch) rows.push([c.full_name, c.phone_e164, c.email, c.jobs, c.open_jobs, (c.spend_cents / 100).toFixed(0), c.last_job_at?.toString().slice(0, 10), c.tags.join(' '), c.next_followup].map(cell).join(','));
      if (page >= pages) break;
    }
    await audit(tx, { tenantId: tenant.id, actorUserId: session.user.id, action: 'customers.export', entity: 'tenant', entityId: tenant.id, diff: { rows: rows.length - 1, q } });
  });
  return new Response(rows.join('\n'), {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="customers-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
