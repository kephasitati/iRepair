import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { withUser } from '@/lib/db';
import { savePartAction } from '@/app/admin/actions';

export const metadata = { title: 'Parts catalogue' };

export default async function PartsPage() {
  const { tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const parts = await withUser(ctx, (tx) => tx`select * from parts_catalogue where tenant_id = ${tenant.id} order by active desc, device_family, name`);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Parts catalogue</h1>
      <Section title="Add part or service">
        <ActionForm action={savePartAction} submitLabel="Add" resetOnSuccess>
          <PartFields />
        </ActionForm>
      </Section>
      <Section>
        <ul className="divide-y">
          {parts.map((p) => (
            <li key={p.id} className="py-2">
              <details>
                <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                  <span className={p.active ? '' : 'text-muted-foreground line-through'}>
                    {p.name}{' '}
                    <span className="text-xs text-muted-foreground">
                      {p.device_family} {p.sku ? `· ${p.sku}` : ''} {p.category ? `· ${p.category}` : ''} {p.published ? '· price list' : ''} {p.listed ? '· shop' : ''}
                    </span>
                  </span>
                  <span className="tabular-nums">{formatKes(Number(p.default_price_cents))}</span>
                </summary>
                <div className="mt-3">
                  <ActionForm action={savePartAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <PartFields
                      part={{
                        name: p.name, sku: p.sku, device_family: p.device_family, kind: p.kind, published: p.published, price: Number(p.default_price_cents) / 100,
                        listed: p.listed, category: p.category, description: p.description, hasImage: !!(p.image_path || p.image_url),
                      }}
                    />
                    <CheckRow name="active" label="Active" defaultChecked={p.active} />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

type PartForm = {
  name: string; sku: string | null; device_family: string | null; kind: string; price: number; published: boolean;
  listed?: boolean; category?: string | null; description?: string | null; hasImage?: boolean;
};

function PartFields({ part }: { part?: PartForm }) {
  const k = part?.sku ?? 'new';
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Name" htmlFor={`n-${part?.sku ?? 'new'}`}>
          <Input id={`n-${part?.sku ?? 'new'}`} name="name" defaultValue={part?.name} required />
        </Field>
        <Field label="Price (KES, incl. VAT)" htmlFor={`p-${part?.sku ?? 'new'}`}>
          <Input id={`p-${part?.sku ?? 'new'}`} name="price" inputMode="numeric" defaultValue={part?.price} required />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Device family" htmlFor={`f-${part?.sku ?? 'new'}`}>
          <NativeSelect id={`f-${part?.sku ?? 'new'}`} name="device_family" defaultValue={part?.device_family ?? ''}>
            <option value="">Any</option>
            {['iphone', 'macbook', 'ipad', 'imac', 'apple_watch', 'android', 'windows_laptop', 'other'].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Type" htmlFor={`k-${part?.sku ?? 'new'}`}>
          <NativeSelect id={`k-${part?.sku ?? 'new'}`} name="kind" defaultValue={part?.kind ?? 'part'}>
            <option value="part">Part</option>
            <option value="labour">Labour</option>
            <option value="service">Service</option>
          </NativeSelect>
        </Field>
        <Field label="SKU" htmlFor={`s-${part?.sku ?? 'new'}`}>
          <Input id={`s-${part?.sku ?? 'new'}`} name="sku" defaultValue={part?.sku ?? ''} />
        </Field>
      </div>
      <CheckRow name="published" label="Show on the public price list" defaultChecked={part?.published ?? false} />
      <CheckRow name="listed" label="List on the Shop page (with photo and description)" defaultChecked={part?.listed ?? false} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Shop category" htmlFor={`c-${k}`} hint="e.g. Screen Replacement, Batteries, Accessories">
          <Input id={`c-${k}`} name="category" defaultValue={part?.category ?? ''} />
        </Field>
        <Field label="Photo" htmlFor={`i-${k}`} hint={part?.hasImage ? 'Has a photo ✓ (upload to replace)' : 'JPG, PNG or WebP, under 2 MB'}>
          <Input id={`i-${k}`} name="image" type="file" accept="image/png,image/jpeg,image/webp" />
        </Field>
      </div>
      <Field label="Description (shown on the product page)" htmlFor={`d-${k}`}>
        <Textarea id={`d-${k}`} name="description" rows={3} defaultValue={part?.description ?? ''} />
      </Field>
    </div>
  );
}
