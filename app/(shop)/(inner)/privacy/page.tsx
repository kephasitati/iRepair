import { LegalPage } from '@/components/legal-page';
import { CookieSettingsLink } from '@/components/cookie-banner';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatDate } from '@/lib/core/time';
import { COOKIE_TABLE, PRIVACY_VERSION } from '@/lib/legal';
import { requireTenant } from '@/lib/tenant';

export const metadata = { title: 'Privacy policy' };

/**
 * Per-shop privacy and cookie policy (Kenya Data Protection Act, 2019). The shop is the data controller; the platform,
 * courier, M-Pesa and SMS providers are processors or independent controllers as described.
 * TEMPLATE: have a Kenyan advocate / DPO review before going live (docs/COMPLIANCE.md).
 */
export default async function PrivacyPage() {
  const tenant = await requireTenant();
  const s = tenant.settings;
  const shop = tenant.branding.display_name;
  const contact = (
    <>
      {formatKenyanPhone(s.contact_phone)}
      {s.contact_email ? ` or ${s.contact_email}` : ''}
    </>
  );

  const sections = [
    {
      id: 'who',
      title: 'Who we are',
      body: (
        <p>
          <strong>{shop}</strong> ({s.address_formatted}
          {s.kra_pin ? `, KRA PIN ${s.kra_pin}` : ''}) is the data controller for personal data collected through this service. Contact us about privacy at {contact}.
        </p>
      ),
    },
    {
      id: 'collect',
      title: 'What we collect and why',
      body: (
        <ul>
          <li>
            <strong>Name and phone number</strong>: to create your account, sign you in by SMS code, send updates and take M-Pesa payments. Basis: performing our
            contract with you.
          </li>
          <li>
            <strong>Addresses, directions and location pins</strong>: so the courier can collect and return your device. Your phone&rsquo;s location is recorded only
            at the moment you confirm a handover, as evidence of where it happened. Basis: contract.
          </li>
          <li>
            <strong>Device details, IMEI or serial number and photos</strong>: to identify your device and record its condition at every handover. Basis: contract and
            our legitimate interest in preventing disputes and fraud.
          </li>
          <li>
            <strong>Device passcode</strong>, only if you choose to share it: to test the repair. Encrypted, shown only to the technician working on your device and
            deleted when the job closes. Basis: your consent, which you can withdraw by not sharing it.
          </li>
          <li>
            <strong>Payment records</strong> (amounts, M-Pesa receipt numbers, invoices): to account for payments and meet tax obligations. Basis: legal obligation.
          </li>
          <li>
            <strong>Messages, quotes, ratings and disputes</strong> you send in the app. Basis: contract.
          </li>
          <li>
            <strong>Cookie choices and basic technical data</strong> (browser type, a hashed IP address): to keep the service secure and prove your consent choices.
            Basis: legal obligation and legitimate interest.
          </li>
        </ul>
      ),
    },
    {
      id: 'share',
      title: 'Who we share it with',
      body: (
        <ul>
          <li>
            <strong>TumaBoda</strong>, our courier: your name, phone number, pickup or delivery address and directions, a short description of the item and its
            declared value, for each delivery. TumaBoda handles this under its own privacy policy.
          </li>
          <li>
            <strong>Safaricom (M-Pesa)</strong>: your phone number and the amount, to process payments.
          </li>
          <li>
            <strong>Our SMS provider (Africa&rsquo;s Talking)</strong>: your phone number and message text, to send codes and updates.
          </li>
          <li>
            <strong>Our booking-platform supplier and its hosting and storage providers</strong>, which process data on our behalf under a written data processing
            agreement.
          </li>
          <li>Authorities, where the law requires us to.</li>
        </ul>
      ),
    },
    {
      id: 'transfers',
      title: 'Where your data is stored',
      body: (
        <p>
          Our database is hosted in a secure data centre. Photos and invoices are kept in private cloud storage that may be located outside Kenya. Where data is
          transferred outside Kenya we rely on the safeguards required by section 48 of the Data Protection Act, including contractual protections with our
          providers. Photos are never public: they are shown through links that expire after a few minutes.
        </p>
      ),
    },
    {
      id: 'retention',
      title: 'How long we keep it',
      body: (
        <ul>
          <li>Device photos: deleted {s.retention_days} days after your job closes.</li>
          <li>Passcodes: deleted as soon as the job closes.</li>
          <li>Invoices, payment records and job history: at least five years, as Kenyan tax law requires.</li>
          <li>Cookie consent records: for as long as needed to prove consent, and at most five years.</li>
          <li>Your account: until you ask us to delete it, subject to the records we must keep.</li>
        </ul>
      ),
    },
    {
      id: 'rights',
      title: 'Your rights',
      body: (
        <>
          <p>
            Under the Data Protection Act you may ask to be informed about, access, correct or delete your personal data, object to or restrict its use, receive a
            copy in a portable format, and withdraw consent at any time. Contact us at {contact}. We respond within the time the law allows.
          </p>
          <p>If you are not satisfied, you can complain to the Office of the Data Protection Commissioner (www.odpc.go.ke).</p>
        </>
      ),
    },
    {
      id: 'security',
      title: 'Security',
      body: (
        <p>
          Access to your data is limited to the staff who need it; every staff action on a job is logged; passcodes and integration credentials are encrypted; and
          each shop&rsquo;s data is kept separate from every other shop&rsquo;s at the database level.
        </p>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookies',
      body: (
        <>
          <p>
            We use only the cookies listed below. Strictly necessary cookies are required for the service to work and do not need consent. Optional analytics or
            marketing cookies are used only if you allow them, and you can change your choice at any time.
          </p>
          <div className="overflow-x-auto rounded-[12px] border border-line">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-canvas text-ink-3">
                <tr>
                  <th className="px-3 py-2 font-medium">Cookie</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Purpose</th>
                  <th className="px-3 py-2 font-medium">Kept for</th>
                </tr>
              </thead>
              <tbody>
                {COOKIE_TABLE.map((c) => (
                  <tr key={c.name} className="border-t border-line align-top">
                    <td className="px-3 py-2 font-mono text-[13px]">{c.name}</td>
                    <td className="px-3 py-2">{c.category}</td>
                    <td className="px-3 py-2">{c.purpose}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.lifetime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            We do not currently set any analytics or marketing cookies. If we add them, they will only run after you opt in. We keep a record of each choice you make
            (the time, the choice and a hashed IP address) to demonstrate consent, as the Act requires.
          </p>
          <p>
            <CookieSettingsLink className="text-link hover:underline" />
          </p>
        </>
      ),
    },
    {
      id: 'children',
      title: 'Children',
      body: <p>The service is intended for adults. If a child&rsquo;s device needs repair, a parent or guardian should make the booking.</p>,
    },
    {
      id: 'changes',
      title: 'Changes to this policy',
      body: <p>We will post any changes here with a new date, and ask for your consent again where the law requires.</p>,
    },
  ];

  return (
    <LegalPage
      title="Privacy policy"
      updated={formatDate(`${PRIVACY_VERSION}T12:00:00+03:00`)}
      intro={<p>How {shop} collects, uses and protects your personal data when you book a doorstep repair, and the choices you have.</p>}
      sections={sections}
    />
  );
}
