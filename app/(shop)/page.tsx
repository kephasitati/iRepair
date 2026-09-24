import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Bike, ClipboardCheck, MessageSquareText, Wallet } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Section } from '@/components/fields';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import { WEEKDAYS } from '@/lib/core/time';
import { servicePool } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { cn } from '@/lib/utils';

export default async function Landing() {
  const [tenant, session, t] = await Promise.all([requireTenant(), getSession(), getTranslations()]);
  const parts = tenant.settings.publish_price_list
    ? await servicePool()`select name, device_family, default_price_cents from parts_catalogue where tenant_id = ${tenant.id} and published and active order by device_family, default_price_cents`
    : [];
  const steps = [
    { icon: ClipboardCheck, title: t('landing.step1'), body: t('landing.step1d') },
    { icon: Bike, title: t('landing.step2'), body: t('landing.step2d') },
    { icon: MessageSquareText, title: t('landing.step3'), body: t('landing.step3d') },
    { icon: Wallet, title: t('landing.step4'), body: t('landing.step4d') },
  ];
  const families = [...new Set(parts.map((p) => p.device_family ?? 'other'))];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl px-5 py-8 text-center" style={{ background: 'var(--brand-primary)', color: 'var(--primary-foreground)' }}>
        <h1 className="text-2xl font-bold sm:text-3xl">{t('landing.hero')}</h1>
        {tenant.branding.tagline ? <p className="mt-1 text-sm opacity-90">{tenant.branding.tagline}</p> : null}
        <p className="mx-auto mt-3 max-w-md text-sm opacity-90">{t('landing.sub')}</p>
        <Link href="/book" className={cn(buttonVariants({ size: 'lg' }), 'mt-6 h-13 bg-(--brand-accent) px-8 text-base text-(--accent-foreground) hover:bg-(--brand-accent)/90')} data-testid="book-cta">
          {t('landing.cta')}
        </Link>
        {session ? (
          <div className="mt-3">
            <Link href="/jobs" className="text-sm underline opacity-90">
              {t('landing.myJobs')}
            </Link>
          </div>
        ) : null}
      </section>

      <Section title={t('landing.how')}>
        <ol className="space-y-4">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <s.icon className="size-5" />
              </span>
              <div>
                <p className="font-medium">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {parts.length ? (
        <Section title={t('landing.prices')}>
          <p className="mb-3 text-xs text-muted-foreground">{t('landing.pricesNote')}</p>
          {families.map((f) => (
            <div key={f} className="mb-3">
              <p className="mb-1 text-xs font-semibold text-muted-foreground uppercase">{f}</p>
              <ul className="divide-y text-sm">
                {parts
                  .filter((p) => (p.device_family ?? 'other') === f)
                  .map((p) => (
                    <li key={p.name} className="flex justify-between gap-3 py-2">
                      <span>{p.name}</span>
                      <span className="shrink-0 tabular-nums">{t('common.kes')} {formatKes(Number(p.default_price_cents), { withSymbol: false })}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </Section>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title={t('landing.contact')}>
          <p className="text-sm">{tenant.settings.address_formatted}</p>
          {tenant.settings.address_landmark ? <p className="text-sm text-muted-foreground">{tenant.settings.address_landmark}</p> : null}
          <a href={`tel:${tenant.settings.contact_phone}`} className="mt-2 inline-block text-sm font-medium text-primary">
            {formatKenyanPhone(tenant.settings.contact_phone)}
          </a>
          {tenant.settings.service_zones.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {t('landing.serviceArea')}: {tenant.settings.service_zones.join(', ')}
            </p>
          ) : null}
        </Section>
        <Section title={t('landing.hours')}>
          <ul className="text-sm">
            {[...WEEKDAYS.slice(1), WEEKDAYS[0]].map((d) => {
              const h = tenant.settings.opening_hours[d];
              return (
                <li key={d} className="flex justify-between py-0.5">
                  <span className="capitalize">{d}</span>
                  <span className="tabular-nums">{h ? `${h.open}–${h.close}` : t('landing.closed')}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="underline">
          {t('landing.privacy')}
        </Link>
        {' · '}
        <Link href="/staff/login" className="underline">
          Staff
        </Link>
      </p>
    </div>
  );
}
