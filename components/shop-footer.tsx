import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CookieSettingsLink } from '@/components/cookie-banner';
import { WhatsAppLink } from '@/components/whatsapp';
import { formatKenyanPhone } from '@/lib/core/phone';
import { DEVICE_LABEL, enabledDevices, whatsappLink } from '@/lib/public-data';
import type { Tenant } from '@/lib/tenant';

/** apple.com-style footer: small grey type, link columns, legal line. Present on every customer page. */
export async function ShopFooter({ tenant }: { tenant: Tenant }) {
  const t = await getTranslations();
  const devices = enabledDevices(tenant);
  const apple = devices.some((d) => ['iphone', 'macbook', 'ipad', 'imac'].includes(d));
  return (
    <footer className="mt-10 border-t border-line bg-canvas">
      <div className="mx-auto max-w-5xl px-5 py-10 text-[12px] leading-relaxed text-ink-3">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            <p className="font-semibold text-ink">Repairs</p>
            <ul className="mt-2 space-y-1.5">
              {devices.map((d) => (
                <li key={d}>
                  <Link href={`/repairs/${d}`} className="hover:text-ink hover:underline">
                    {DEVICE_LABEL[d]} repair
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/book" className="hover:text-ink hover:underline">
                  {t('landing.cta')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">Support</p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <WhatsAppLink href={whatsappLink(tenant, `Hi ${tenant.branding.display_name}, I have a question.`)} className="hover:text-ink">
                  Chat on WhatsApp
                </WhatsAppLink>
              </li>
              <li>
                <a href={`tel:${tenant.settings.contact_phone}`} className="hover:text-ink hover:underline">
                  {formatKenyanPhone(tenant.settings.contact_phone)}
                </a>
              </li>
              <li>
                <Link href="/jobs" className="hover:text-ink hover:underline">
                  {t('landing.myJobs')}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-ink">{tenant.branding.display_name}</p>
            <p className="mt-2">{tenant.settings.address_formatted}</p>
            {tenant.settings.address_landmark ? <p>{tenant.settings.address_landmark}</p> : null}
          </div>
        </div>
        <p className="mt-8 border-t border-line pt-4">
          {t('landing.footerNote')}
          {apple ? ` iPhone, iPad, MacBook and iMac are trademarks of Apple Inc. ${tenant.branding.display_name} is an independent repair service and is not affiliated with or endorsed by Apple.` : ''}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <span>
            © {new Date().getFullYear()} {tenant.branding.display_name}
          </span>
          {tenant.settings.kra_pin ? <span>KRA PIN {tenant.settings.kra_pin}</span> : null}
          <Link href="/terms" className="hover:text-ink hover:underline">
            {t('landing.terms')}
          </Link>
          <Link href="/privacy" className="hover:text-ink hover:underline">
            {t('landing.privacy')}
          </Link>
          <CookieSettingsLink className="hover:text-ink hover:underline" />
          <Link href="/staff/login" className="hover:text-ink hover:underline">
            Staff
          </Link>
        </div>
      </div>
    </footer>
  );
}
