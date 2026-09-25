import { getTranslations } from 'next-intl/server';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm } from '@/components/action-form';
import { requireStaff } from '@/lib/auth';
import { servicePool } from '@/lib/db';
import { env } from '@/lib/env';
import { saveCredentialsAction, saveSettingsAction } from '@/app/admin/actions';
import { DEFAULT_DEVICE_TYPES, DEVICE_TYPES } from '@/lib/core/device-id';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

export default async function SettingsPage() {
  const { tenant, session } = await requireStaff('shop_admin');
  const t = await getTranslations('admin');
  const tDev = await getTranslations('devices');
  const s = tenant.settings;
  const b = tenant.branding;
  const [secrets] = await servicePool()`select daraja_enc is not null as daraja, courier_enc is not null as courier, sms_enc is not null as sms from tenant_secrets where tenant_id = ${tenant.id}`;
  const configured = (k: 'daraja' | 'courier' | 'sms') => (secrets?.[k] ? t('credentialsSet') : t('credentialsNotSet'));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">{t('settings')}</h1>

      <Section title={t('branding')}>
        <ActionForm action={saveSettingsAction}>
          <input type="hidden" name="section" value="branding" />
          <Field label={t('displayName')} htmlFor="display_name">
            <Input id="display_name" name="display_name" defaultValue={b.display_name} required />
          </Field>
          <Field label={t('tagline')} htmlFor="tagline">
            <Input id="tagline" name="tagline" defaultValue={b.tagline ?? ''} />
          </Field>
          <Field label="About" htmlFor="about" hint="A short paragraph used on the landing page, in search results and in AI answers.">
            <Textarea id="about" name="about" defaultValue={b.about ?? ''} rows={3} maxLength={500} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('primary')} htmlFor="primary_hex">
              <Input id="primary_hex" name="primary_hex" type="color" defaultValue={b.primary_hex} className="h-11 p-1" />
            </Field>
            <Field label={t('accent')} htmlFor="accent_hex">
              <Input id="accent_hex" name="accent_hex" type="color" defaultValue={b.accent_hex} className="h-11 p-1" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('logo')} htmlFor="logo" hint={b.logo_path ? 'Uploaded ✓' : 'PNG/SVG, under 1 MB'}>
              <Input id="logo" name="logo" type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" />
            </Field>
            <Field label={t('icon')} htmlFor="icon" hint={b.icon_path ? 'Uploaded ✓' : '512×512 PNG'}>
              <Input id="icon" name="icon" type="file" accept="image/png" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="SMS sender ID" htmlFor="sms_sender_id" hint="Only if registered with Africa's Talking">
              <Input id="sms_sender_id" name="sms_sender_id" defaultValue={b.sms_sender_id ?? ''} maxLength={11} />
            </Field>
            <Field label="Email sender name" htmlFor="email_from_name">
              <Input id="email_from_name" name="email_from_name" defaultValue={b.email_from_name ?? ''} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Customer site: <a className="underline" href={tenant.baseUrl}>{tenant.hostname}</a>
          </p>
        </ActionForm>
      </Section>

      <Section title={t('contact')}>
        <ActionForm action={saveSettingsAction}>
          <input type="hidden" name="section" value="contact" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" htmlFor="contact_phone">
              <Input id="contact_phone" name="contact_phone" defaultValue={s.contact_phone} required />
            </Field>
            <Field label="Email" htmlFor="contact_email">
              <Input id="contact_email" name="contact_email" type="email" defaultValue={s.contact_email ?? ''} />
            </Field>
          </div>
          <Field label="WhatsApp number" htmlFor="whatsapp_phone" hint="Shown as a chat button on every page. Leave blank to use the phone number above.">
            <Input id="whatsapp_phone" name="whatsapp_phone" defaultValue={s.whatsapp_phone ?? ''} placeholder="07XX XXX XXX" />
          </Field>
          <Field label="Shop address (where riders collect and deliver)" htmlFor="address_formatted">
            <Input id="address_formatted" name="address_formatted" defaultValue={s.address_formatted} required />
          </Field>
          <Field label="Building, floor, directions" htmlFor="address_landmark">
            <Input id="address_landmark" name="address_landmark" defaultValue={s.address_landmark ?? ''} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude" htmlFor="address_lat">
              <Input id="address_lat" name="address_lat" inputMode="decimal" defaultValue={s.address_lat ?? ''} />
            </Field>
            <Field label="Longitude" htmlFor="address_lng">
              <Input id="address_lng" name="address_lng" inputMode="decimal" defaultValue={s.address_lng ?? ''} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">{t('hours')}</p>
            <div className="space-y-2">
              {DAYS.map((d) => {
                const h = s.opening_hours[d];
                return (
                  <div key={d} className="grid grid-cols-[4rem_auto_1fr_1fr] items-center gap-2">
                    <span className="text-sm capitalize">{d}</span>
                    <input type="checkbox" name={`${d}_on`} defaultChecked={!!h} className="size-5 accent-(--primary)" aria-label={`${d} open`} />
                    <Input name={`${d}_open`} type="time" defaultValue={h?.open ?? '08:00'} className="h-9" />
                    <Input name={`${d}_close`} type="time" defaultValue={h?.close ?? '18:00'} className="h-9" />
                  </div>
                );
              })}
            </div>
          </div>
          <Field label={t('zones')} htmlFor="service_zones" hint="Leave empty to accept pickups from anywhere.">
            <Textarea id="service_zones" name="service_zones" defaultValue={s.service_zones.join('\n')} rows={5} />
          </Field>
        </ActionForm>
      </Section>

      <Section title={t('fees')}>
        <ActionForm action={saveSettingsAction}>
          <input type="hidden" name="section" value="fees" />
          <Field label={t('consultationFee')} htmlFor="consultation_fee">
            <Input id="consultation_fee" name="consultation_fee" inputMode="numeric" defaultValue={s.consultation_fee_cents / 100} />
          </Field>
          <CheckRow name="consultation_fee_credited" label={t('consultationCredited')} defaultChecked={s.consultation_fee_credited} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('deposit')} htmlFor="deposit_kind">
              <NativeSelect id="deposit_kind" name="deposit_kind" defaultValue={s.deposit_rule.kind}>
                <option value="percent">{t('depositPercent')}</option>
                <option value="fixed">{t('depositFixed')}</option>
              </NativeSelect>
            </Field>
            <Field label="%" htmlFor="deposit_percent">
              <Input id="deposit_percent" name="deposit_percent" inputMode="numeric" defaultValue={s.deposit_rule.kind === 'percent' ? s.deposit_rule.value / 100 : 50} />
            </Field>
            <Field label="KES" htmlFor="deposit_fixed">
              <Input id="deposit_fixed" name="deposit_fixed" inputMode="numeric" defaultValue={s.deposit_rule.kind === 'fixed' ? s.deposit_rule.value / 100 : ''} />
            </Field>
          </div>
          <Field label={t('depositMin')} htmlFor="deposit_min">
            <Input id="deposit_min" name="deposit_min" inputMode="numeric" defaultValue={s.deposit_min_quote_cents / 100} />
          </Field>
          <CheckRow name="vat_registered" label={t('vatRegistered')} defaultChecked={s.vat_registered} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('vatRate')} htmlFor="vat_rate">
              <Input id="vat_rate" name="vat_rate" inputMode="decimal" defaultValue={s.vat_rate_bp / 100} />
            </Field>
            <Field label={t('kraPin')} htmlFor="kra_pin">
              <Input id="kra_pin" name="kra_pin" defaultValue={s.kra_pin ?? ''} autoCapitalize="characters" />
            </Field>
          </div>
          <CheckRow name="prices_include_vat" label={t('pricesIncludeVat')} defaultChecked={s.prices_include_vat} />
          <Field label={t('markup')} htmlFor="markup" hint="Courier fees are passed through at cost plus this markup. The courier fee already includes the courier's VAT.">
            <Input id="markup" name="markup" inputMode="numeric" defaultValue={s.delivery_markup_bp / 100} />
          </Field>
          <CheckRow name="collect_supplementary_upfront" label="Collect supplementary work upfront by default" defaultChecked={s.collect_supplementary_upfront} />
        </ActionForm>
      </Section>

      <Section title={t('quotes') + ' · ' + t('delivery') + ' · ' + t('security')}>
        <ActionForm action={saveSettingsAction}>
          <input type="hidden" name="section" value="operations" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('rounds')} htmlFor="max_negotiation_rounds">
              <Input id="max_negotiation_rounds" name="max_negotiation_rounds" inputMode="numeric" defaultValue={s.max_negotiation_rounds} />
            </Field>
            <Field label={t('expiry')} htmlFor="quote_expiry_hours">
              <Input id="quote_expiry_hours" name="quote_expiry_hours" inputMode="numeric" defaultValue={s.quote_expiry_hours} />
            </Field>
            <Field label={t('autodecline')} htmlFor="expired_quote_autodecline_days">
              <Input id="expired_quote_autodecline_days" name="expired_quote_autodecline_days" inputMode="numeric" defaultValue={s.expired_quote_autodecline_days} />
            </Field>
            <Field label={t('warranty')} htmlFor="warranty_days" hint="Customers can raise disputes within this window after the repair.">
              <Input id="warranty_days" name="warranty_days" inputMode="numeric" defaultValue={s.warranty_days} />
            </Field>
            <Field label={t('autoClose')} htmlFor="auto_close_hours">
              <Input id="auto_close_hours" name="auto_close_hours" inputMode="numeric" defaultValue={s.auto_close_hours} />
            </Field>
            <Field label={t('unclaimed')} htmlFor="unclaimed_after_days">
              <Input id="unclaimed_after_days" name="unclaimed_after_days" inputMode="numeric" defaultValue={s.unclaimed_after_days} />
            </Field>
            <Field label={t('retention')} htmlFor="retention_days" hint="Photos only. Invoices and payments are kept ≥ 5 years.">
              <Input id="retention_days" name="retention_days" inputMode="numeric" defaultValue={s.retention_days} />
            </Field>
            <Field label={`${t('quiet')} (from)`} htmlFor="quiet_hours_start">
              <Input id="quiet_hours_start" name="quiet_hours_start" type="time" defaultValue={s.quiet_hours_start} />
            </Field>
            <Field label="(until)" htmlFor="quiet_hours_end">
              <Input id="quiet_hours_end" name="quiet_hours_end" type="time" defaultValue={s.quiet_hours_end} />
            </Field>
          </div>
          <div>
            <p className="mb-2 text-[14px] font-medium text-ink-2">{t('deviceTypes')}</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {DEVICE_TYPES.map((d) => (
                <CheckRow key={d} name={`device_${d}`} label={tDev(d)} defaultChecked={(s.device_types ?? DEFAULT_DEVICE_TYPES).includes(d)} />
              ))}
            </div>
          </div>
          <Field label={t('provider')} htmlFor="delivery_provider">
            <NativeSelect id="delivery_provider" name="delivery_provider" defaultValue={s.delivery_provider}>
              <option value="mock">Simulated courier (demo / testing)</option>
              <option value="tumaboda">TumaBoda</option>
            </NativeSelect>
          </Field>
          <CheckRow name="publish_price_list" label={t('publishPrices')} defaultChecked={s.publish_price_list} />
          <CheckRow name="require_admin_mfa" label={t('requireMfa')} defaultChecked={s.require_admin_mfa} />
          {!session.user.totp_enabled ? (
            <p className="text-xs">
              Your own account does not use 2FA yet. <a href="/staff/mfa/setup" className="underline">Set it up</a>.
            </p>
          ) : null}
        </ActionForm>
      </Section>

      <Section title={t('credentials')}>
        <div className="space-y-6">
          <div>
            <p className="font-medium">{t('daraja')} <span className="text-xs text-muted-foreground">· {configured('daraja')}</span></p>
            <p className="mb-3 text-xs text-muted-foreground">{t('darajaHelp')}</p>
            <p className="mb-3 text-xs text-muted-foreground">Callback URL to register: <code>{env().MPESA_CALLBACK_BASE_URL ?? tenant.baseUrl}/api/webhooks/mpesa/…</code> (set per payment automatically)</p>
            <ActionForm action={saveCredentialsAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="kind" value="daraja" />
              <Field label="Environment" htmlFor="d-env">
                <NativeSelect id="d-env" name="env" defaultValue="sandbox">
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </NativeSelect>
              </Field>
              <Field label="Type" htmlFor="d-type">
                <NativeSelect id="d-type" name="type" defaultValue="paybill">
                  <option value="paybill">Paybill</option>
                  <option value="till">Till (Buy Goods)</option>
                </NativeSelect>
              </Field>
              <Field label="Shortcode (Paybill or store number)" htmlFor="d-sc">
                <Input id="d-sc" name="shortcode" inputMode="numeric" />
              </Field>
              <Field label="Till number (Till only)" htmlFor="d-till">
                <Input id="d-till" name="tillNumber" inputMode="numeric" />
              </Field>
              <Field label="Consumer key" htmlFor="d-ck">
                <Input id="d-ck" name="consumerKey" autoComplete="off" />
              </Field>
              <Field label="Consumer secret" htmlFor="d-cs">
                <Input id="d-cs" name="consumerSecret" type="password" autoComplete="off" />
              </Field>
              <Field label="Passkey" htmlFor="d-pk" className="sm:col-span-2">
                <Input id="d-pk" name="passkey" type="password" autoComplete="off" />
              </Field>
            </ActionForm>
          </div>
          <div>
            <p className="font-medium">{t('courier')} <span className="text-xs text-muted-foreground">· {configured('courier')}</span></p>
            <p className="mb-3 text-xs text-muted-foreground">Webhook URL to give TumaBoda: <code>{tenant.baseUrl}/api/webhooks/delivery/{tenant.slug}</code></p>
            <ActionForm action={saveCredentialsAction} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="kind" value="courier" />
              <Field label="API base URL" htmlFor="c-url" className="sm:col-span-2">
                <Input id="c-url" name="baseUrl" placeholder="https://" />
              </Field>
              <Field label="API key" htmlFor="c-key">
                <Input id="c-key" name="apiKey" type="password" autoComplete="off" />
              </Field>
              <Field label="Webhook secret" htmlFor="c-wh">
                <Input id="c-wh" name="webhookSecret" type="password" autoComplete="off" />
              </Field>
            </ActionForm>
          </div>
          <div>
            <p className="font-medium">{t('sms')} <span className="text-xs text-muted-foreground">· {configured('sms')}</span></p>
            <ActionForm action={saveCredentialsAction} className="mt-3 grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="kind" value="sms" />
              <Field label="Username" htmlFor="s-user">
                <Input id="s-user" name="username" />
              </Field>
              <Field label="API key" htmlFor="s-key">
                <Input id="s-key" name="apiKey" type="password" autoComplete="off" />
              </Field>
              <Field label="Sender ID" htmlFor="s-sid">
                <Input id="s-sid" name="senderId" />
              </Field>
            </ActionForm>
          </div>
        </div>
      </Section>
    </div>
  );
}
