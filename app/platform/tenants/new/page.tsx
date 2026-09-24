import { Input } from '@/components/ui/input';
import { Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm, InviteResult } from '@/components/action-form';
import { env } from '@/lib/env';
import { createTenantAction } from '@/app/platform/actions';

export const metadata = { title: 'New shop' };

export default function NewTenantPage() {
  return (
    <div className="mx-auto max-w-xl">
      <Section title="New shop">
        <p className="mb-4 text-sm text-muted-foreground">Creates the shop with sensible defaults and an invite link for its admin. The admin then sets branding, fees, M-Pesa and courier credentials themselves (docs/WHITELABEL.md).</p>
        <ActionForm action={createTenantAction} submitLabel="Create shop" successMessage="Shop created" renderSuccess={(d) => <InviteResult data={d} />}>
          <Field label="Shop name" htmlFor="name">
            <Input id="name" name="name" required />
          </Field>
          <Field label="Subdomain" htmlFor="slug" hint={`https://<subdomain>.${env().PLATFORM_ROOT_DOMAIN}`}>
            <Input id="slug" name="slug" pattern="[a-z0-9-]{3,40}" required />
          </Field>
          <Field label="Shop phone" htmlFor="contact_phone">
            <Input id="contact_phone" name="contact_phone" type="tel" required />
          </Field>
          <Field label="Shop admin email" htmlFor="admin_email">
            <Input id="admin_email" name="admin_email" type="email" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Platform fee" htmlFor="fee_kind">
              <NativeSelect id="fee_kind" name="fee_kind" defaultValue="percent">
                <option value="percent">% of invoice</option>
                <option value="flat">KES per job</option>
              </NativeSelect>
            </Field>
            <Field label="Value" htmlFor="fee_value">
              <Input id="fee_value" name="fee_value" inputMode="decimal" defaultValue="0" />
            </Field>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
