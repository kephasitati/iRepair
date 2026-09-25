import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { requestCtx, requireStaff } from '@/lib/auth';
import { DEVICE_TYPES } from '@/lib/core/device-id';
import { formatKes } from '@/lib/core/money';
import { withUser } from '@/lib/db';
import { DEVICE_LABEL } from '@/lib/public-data';
import { savePartAction } from '@/app/admin/actions';

export const metadata = { title: 'Products & parts' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
type Search = { q?: string; family?: string; category?: string; show?: string; page?: string };

type Row = {
  id: string; name: string; sku: string | null; device_family: string | null; category: string | null; kind: string; default_price_cents: string | number;
  published: boolean; listed: boolean; active: boolean; description: string | null; image_path: string | null; image_url: string | null;
};

/** The shop's whole catalogue: retail products for the Shop page and the parts/labour lines used in quotes. */
export default async function PartsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const family = sp.family ?? '';
  const category = sp.category ?? '';
  const show = ['shop', 'prices', 'inactive', 'new'].includes(sp.show ?? '') ? sp.show! : 'all';

  const { rows, total, categories, counts } = await withUser(ctx, async (tx) => {
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    const where = tx`where tenant_id = ${tenant.id}
      ${q ? tx`and (name ilike ${like} or sku ilike ${like} or category ilike ${like})` : tx``}
      ${family ? tx`and device_family = ${family}` : tx``}
      ${category ? tx`and category = ${category}` : tx``}
      ${show === 'shop' ? tx`and listed and active` : show === 'prices' ? tx`and published and active` : show === 'inactive' ? tx`and not active` : show === 'new' ? tx`and active and (sku is null or sku not like 'WC-%')` : tx`and active`}`;
    const [{ total }] = await tx`select count(*)::int as total from parts_catalogue ${where}`;
    const page = Math.min(Math.max(1, Number(sp.page) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)));
    const rows = (await tx`select * from parts_catalogue ${where} order by device_family nulls last, category nulls last, name limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`) as unknown as Row[];
    const categories = (await tx`select distinct category from parts_catalogue where tenant_id = ${tenant.id} and category is not null order by category`).map((r) => r.category as string);
    const [counts] = await tx`select count(*) filter (where active)::int as active, count(*) filter (where listed and active)::int as listed, count(*) filter (where published and active)::int as published, count(*) filter (where not active)::int as inactive, count(*) filter (where active and (sku is null or sku not like 'WC-%'))::int as manual from parts_catalogue where tenant_id = ${tenant.id}`;
    return { rows, total, categories, counts: counts as { active: number; listed: number; published: number; inactive: number; manual: number } };
  });
  const page = Math.min(Math.max(1, Number(sp.page) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (patch: Partial<Search>) => {
    const p = new URLSearchParams();
    const m = { q, family, category, show, page: String(page), ...patch };
    if (m.q) p.set('q', m.q);
    if (m.family) p.set('family', m.family);
    if (m.category) p.set('category', m.category);
    if (m.show && m.show !== 'all') p.set('show', m.show);
    if (m.page && m.page !== '1') p.set('page', m.page);
    const s = p.toString();
    return `/admin/parts${s ? `?${s}` : ''}`;
  };
  const tab = (key: string, label: string, n: number) => (
    <Link key={key} href={href({ show: key, page: '1' })} className={`rounded-full px-3 py-1 text-xs ${show === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}>
      {label} <span className="opacity-70">{n}</span>
    </Link>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Products &amp; parts</h1>
          <p className="text-xs text-muted-foreground">
            Products go on the Shop page{tenant.settings.shop_page ? '' : ' (turn it on in Settings → Operations)'}; parts and labour lines are what technicians pick when quoting. One item can be both.
          </p>
        </div>
        <Link href="#add" className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
          + Add a product or part
        </Link>
      </div>

      <Section title="Find">
        <form method="get" className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
          <Input name="q" placeholder="Search name, SKU or category" defaultValue={q} aria-label="Search" />
          <NativeSelect name="family" defaultValue={family} aria-label="Device family">
            <option value="">All devices</option>
            {DEVICE_TYPES.map((f) => (
              <option key={f} value={f}>
                {f === 'other' ? 'Accessories / other' : DEVICE_LABEL[f]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect name="category" defaultValue={category} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
          {show !== 'all' ? <input type="hidden" name="show" value={show} /> : null}
          <button className="rounded-md border px-4 py-2 text-sm">Search</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2">
          {tab('all', 'Active', counts.active)}
          {tab('shop', 'On the Shop page', counts.listed)}
          {tab('prices', 'On the price list', counts.published)}
          {tab('new', 'Added by hand', counts.manual)}
          {tab('inactive', 'Inactive', counts.inactive)}
        </div>
      </Section>

      <Section title={`${total.toLocaleString()} item${total === 1 ? '' : 's'}${q || family || category ? ' match' : ''}`}>
        {rows.length ? (
          <ul className="divide-y">
            {rows.map((p) => {
              const thumb = p.image_path ? `/api/products/${p.id}/image` : p.image_url;
              return (
                <li key={p.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer items-center gap-3 text-sm">
                      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" className="h-full w-full object-contain" loading="lazy" />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">no photo</span>
                        )}
                      </span>
                      <span className={`min-w-0 flex-1 ${p.active ? '' : 'text-muted-foreground line-through'}`}>
                        <span className="block truncate">{p.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.device_family ? DEVICE_LABEL[p.device_family as keyof typeof DEVICE_LABEL] ?? p.device_family : 'Any device'}
                          {p.category ? ` · ${p.category}` : ''}
                          {p.sku ? ` · ${p.sku}` : ''}
                          {p.kind !== 'part' ? ` · ${p.kind}` : ''}
                          {p.listed ? ' · Shop' : ''}
                          {p.published ? ' · Price list' : ''}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">{formatKes(Number(p.default_price_cents))}</span>
                    </summary>
                    <div className="mt-3 sm:pl-[52px]">
                      <ActionForm action={savePartAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <PartFields
                          id={p.id}
                          part={{
                            name: p.name, sku: p.sku, device_family: p.device_family, kind: p.kind, published: p.published, price: Number(p.default_price_cents) / 100,
                            listed: p.listed, category: p.category, description: p.description, hasImage: !!(p.image_path || p.image_url),
                          }}
                        />
                        <CheckRow name="active" label="Active (untick to retire it — it stays on old quotes)" defaultChecked={p.active} />
                      </ActionForm>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nothing matches. Clear the search, or add the first item below.</p>
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

      <datalist id="part-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Section title="Add a product or part">
        <div id="add" />
        <p className="mb-3 text-xs text-muted-foreground">
          A retail product needs a name, price, photo and “List on the Shop page”. A repair part or labour line needs a name, price and device family — tick “price list” to show it publicly.
        </p>
        <ActionForm action={savePartAction} submitLabel="Add" resetOnSuccess>
          <PartFields id="new" />
        </ActionForm>
      </Section>
    </div>
  );
}

type PartForm = {
  name: string; sku: string | null; device_family: string | null; kind: string; price: number; published: boolean;
  listed?: boolean; category?: string | null; description?: string | null; hasImage?: boolean;
};

function PartFields({ id, part }: { id: string; part?: PartForm }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Name" htmlFor={`n-${id}`}>
          <Input id={`n-${id}`} name="name" defaultValue={part?.name} required />
        </Field>
        <Field label="Price (KES, incl. VAT)" htmlFor={`p-${id}`}>
          <Input id={`p-${id}`} name="price" inputMode="numeric" defaultValue={part?.price} required />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Device family" htmlFor={`f-${id}`}>
          <NativeSelect id={`f-${id}`} name="device_family" defaultValue={part?.device_family ?? ''}>
            <option value="">Any</option>
            {DEVICE_TYPES.map((f) => (
              <option key={f} value={f}>
                {f === 'other' ? 'Accessories / other' : DEVICE_LABEL[f]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Type" htmlFor={`k-${id}`}>
          <NativeSelect id={`k-${id}`} name="kind" defaultValue={part?.kind ?? 'part'}>
            <option value="part">Product / part</option>
            <option value="labour">Labour</option>
            <option value="service">Service</option>
          </NativeSelect>
        </Field>
        <Field label="SKU (optional)" htmlFor={`s-${id}`}>
          <Input id={`s-${id}`} name="sku" defaultValue={part?.sku ?? ''} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shop category" htmlFor={`c-${id}`} hint="e.g. Screen Replacement, Batteries, Accessories">
          <Input id={`c-${id}`} name="category" defaultValue={part?.category ?? ''} list="part-categories" />
        </Field>
        <Field label="Photo" htmlFor={`i-${id}`} hint={part?.hasImage ? 'Has a photo ✓ (upload to replace)' : 'JPG, PNG or WebP, under 2 MB'}>
          <Input id={`i-${id}`} name="image" type="file" accept="image/png,image/jpeg,image/webp" />
        </Field>
      </div>
      <Field label="Description (shown on the product page)" htmlFor={`d-${id}`}>
        <Textarea id={`d-${id}`} name="description" rows={3} defaultValue={part?.description ?? ''} />
      </Field>
      <CheckRow name="listed" label="List on the Shop page" defaultChecked={part?.listed ?? false} />
      <CheckRow name="published" label="Show on the public price list" defaultChecked={part?.published ?? false} />
    </div>
  );
}
