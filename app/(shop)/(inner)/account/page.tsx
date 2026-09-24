import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Section } from '@/components/fields';
import { requestCtx, requireCustomer } from '@/lib/auth';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatDate } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { deleteAddressAction, deleteDeviceAction, updateNameAction } from '@/app/(shop)/actions';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const { session } = await requireCustomer('/account');
  const [ctx, t] = await Promise.all([requestCtx(), getTranslations()]);
  const { addresses, devices, invoices } = await withUser(ctx, async (tx) => ({
    addresses: await tx`select * from addresses where user_id = ${ctx.userId} order by created_at desc`,
    devices: await tx`select * from devices where user_id = ${ctx.userId} order by created_at desc`,
    invoices: await tx`select i.id, i.number, i.total_cents, i.issued_at, j.ref from invoices i join jobs j on j.id = i.job_id where j.customer_user_id = ${ctx.userId} and i.status = 'issued' order by i.issued_at desc`,
  }));
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('nav.account')}</h1>
      <Section title={t('common.name')}>
        <form action={updateNameAction} className="space-y-3">
          <p className="text-sm text-muted-foreground">{session.user.phone_e164 ? formatKenyanPhone(session.user.phone_e164) : null}</p>
          <Field label={t('common.name')} htmlFor="name">
            <Input id="name" name="name" defaultValue={session.user.full_name} />
          </Field>
          <Field label={t('common.email')} htmlFor="email" hint={t('common.optional')}>
            <Input id="email" name="email" type="email" defaultValue={session.user.email ?? ''} />
          </Field>
          <Button type="submit">{t('common.save')}</Button>
        </form>
      </Section>

      <Section title={t('nav.invoices')}>
        {invoices.length ? (
          <ul className="divide-y text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <a href={`/api/invoices/${i.id}/pdf`} target="_blank" className="font-medium text-primary underline">
                  {i.number}
                </a>
                <span className="text-muted-foreground">
                  {i.ref} · {formatDate(i.issued_at)}
                </span>
                <span className="tabular-nums">{formatKes(Number(i.total_cents))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
        )}
      </Section>

      <Section title={t('nav.addresses')}>
        {addresses.length ? (
          <ul className="divide-y text-sm">
            {addresses.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{a.label || a.formatted}</span>
                  <span className="block text-muted-foreground">{[a.formatted, a.building_floor, a.landmark].filter(Boolean).join(' · ')}</span>
                </span>
                <form action={deleteAddressAction.bind(null, a.id)}>
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')}>
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
        )}
      </Section>

      <Section title={t('nav.devices')}>
        {devices.length ? (
          <ul className="divide-y text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{`${d.brand} ${d.model}`.trim()}</span>
                  <span className="block text-muted-foreground">{d.identifier}</span>
                </span>
                <form action={deleteDeviceAction.bind(null, d.id)}>
                  <Button variant="ghost" size="icon" aria-label={t('common.delete')}>
                    <Trash2 className="size-4" />
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('common.noResults')}</p>
        )}
      </Section>
      <p className="text-center text-xs">
        <Link href="/privacy" className="underline">
          {t('landing.privacy')}
        </Link>
      </p>
    </div>
  );
}
