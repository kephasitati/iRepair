import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Section } from '@/components/fields';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatDate } from '@/lib/core/time';
import { listCustomers } from '@/lib/crm';
import { withUser } from '@/lib/db';
import { whatsappLink } from '@/lib/public-data';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

type Search = { q?: string; tag?: string; due?: string; page?: string };

/** The shop's customers: everyone who has booked, with history, tags and the next follow-up. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { tenant, role } = await requireStaff();
  const ctx = await requestCtx();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const due = sp.due === '1';
  const { rows, total, page, pages } = await withUser(ctx, (tx) => listCustomers(tx, tenant.id, { search: q, tag: sp.tag, due, page: Number(sp.page) || 1 }));
  const href = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const m = { q, tag: sp.tag, due: due ? '1' : '', page: String(page), ...patch };
    if (m.q) p.set('q', m.q);
    if (m.tag) p.set('tag', m.tag);
    if (m.due) p.set('due', '1');
    if (m.page && m.page !== '1') p.set('page', m.page);
    const s = p.toString();
    return `/bench/customers${s ? `?${s}` : ''}`;
  };
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Customers</h1>
          <p className="text-xs text-muted-foreground">Everyone who has booked with {tenant.branding.display_name}. Open a customer for their history, notes, tags and follow-ups.</p>
        </div>
        {role === 'shop_admin' ? (
          <a href={`/bench/customers/export${q ? `?q=${encodeURIComponent(q)}` : ''}`} className="rounded-md border px-3 py-1.5 text-sm">
            Export CSV
          </a>
        ) : null}
      </div>

      <Section title="Find">
        <form method="get" className="flex flex-wrap gap-2">
          <Input name="q" placeholder="Name, phone or email" defaultValue={q} aria-label="Search customers" className="min-w-56 flex-1" />
          {sp.tag ? <input type="hidden" name="tag" value={sp.tag} /> : null}
          {due ? <input type="hidden" name="due" value="1" /> : null}
          <button className="rounded-md border px-4 py-2 text-sm">Search</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href={href({ due: '', page: '1' })} className={`rounded-full px-3 py-1 ${!due ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            All
          </Link>
          <Link href={href({ due: '1', page: '1' })} className={`rounded-full px-3 py-1 ${due ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
            Follow-up due
          </Link>
          {sp.tag ? (
            <Link href={href({ tag: '', page: '1' })} className="rounded-full bg-muted px-3 py-1">
              Tag: {sp.tag} ×
            </Link>
          ) : null}
        </div>
      </Section>

      <Section title={`${total.toLocaleString()} customer${total === 1 ? '' : 's'}`}>
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/bench/customers/${c.id}`} className="font-medium hover:underline">
                    {c.full_name || c.phone_e164 || c.email}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {c.phone_e164 ? formatKenyanPhone(c.phone_e164) : c.email} · {c.jobs} job{c.jobs === 1 ? '' : 's'}
                    {c.open_jobs ? ` (${c.open_jobs} open)` : ''} · {formatKes(c.spend_cents)} paid · last {c.last_job_at ? formatDate(c.last_job_at) : '—'}
                  </p>
                  {c.tags.length ? (
                    <p className="mt-1 flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Link key={t} href={href({ tag: t, page: '1' })} className="rounded-full bg-muted px-2 py-0.5 text-[11px]">
                          {t}
                        </Link>
                      ))}
                    </p>
                  ) : null}
                </div>
                {c.next_followup ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${c.next_followup <= today ? 'bg-amber-100 text-amber-900' : 'bg-muted'}`}>
                    Follow up {formatDate(c.next_followup)}
                  </span>
                ) : null}
                {c.phone_e164 ? (
                  <a href={whatsappLink({ ...tenant, settings: { ...tenant.settings, whatsapp_phone: c.phone_e164 } }, `Hi ${c.full_name.split(' ')[0] || ''}, this is ${tenant.branding.display_name}.`)} target="_blank" rel="noopener" className="rounded-md border px-2 py-1 text-xs">
                    WhatsApp
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No customers match.</p>
        )}
        {pages > 1 ? (
          <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
            {page > 1 ? <Link href={href({ page: String(page - 1) })} className="underline">← Previous</Link> : <span />}
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            {page < pages ? <Link href={href({ page: String(page + 1) })} className="underline">Next →</Link> : <span />}
          </nav>
        ) : null}
      </Section>
    </div>
  );
}
