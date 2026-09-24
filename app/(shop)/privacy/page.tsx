import { formatKenyanPhone } from '@/lib/core/phone';
import { requireTenant } from '@/lib/tenant';

export const metadata = { title: 'Privacy notice' };

/** Per-shop privacy notice (Kenya Data Protection Act 2019). The shop is the data controller. */
export default async function PrivacyPage() {
  const tenant = await requireTenant();
  const s = tenant.settings;
  const name = tenant.branding.display_name;
  return (
    <article className="prose prose-sm max-w-none space-y-4 text-sm leading-relaxed">
      <h1 className="text-xl font-semibold">Privacy notice</h1>
      <p>
        <strong>{name}</strong> ({s.address_formatted}
        {s.kra_pin ? `, KRA PIN ${s.kra_pin}` : ''}) is the data controller for the personal data you give us when you book a repair. Our booking system is
        provided by a technology supplier that processes data only on our instructions.
      </p>
      <h2 className="text-base font-semibold">What we collect and why</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your name and phone number: to sign you in, send updates by SMS and take M-Pesa payments.</li>
        <li>Pickup and delivery addresses and location pins: so a rider can collect and return your device.</li>
        <li>Device details, IMEI or serial number and photos: to identify your device and record its condition at every handover.</li>
        <li>Your device passcode, only if you choose to share it: to test the repair. It is encrypted, shown only to the technician working on your device, and deleted when the job closes.</li>
        <li>Payment records (M-Pesa receipt numbers and amounts): to account for payments and meet tax obligations.</li>
      </ul>
      <h2 className="text-base font-semibold">Who we share it with</h2>
      <p>
        The courier (rider) receives your name, phone number and address for each delivery. Safaricom processes your M-Pesa payments. Our SMS provider delivers text
        messages. We do not sell your data.
      </p>
      <h2 className="text-base font-semibold">How long we keep it</h2>
      <p>
        Device photos are deleted {s.retention_days} days after your job closes. Invoices and payment records are kept for at least five years as required by Kenyan tax law.
        Passcodes are deleted as soon as the job closes.
      </p>
      <h2 className="text-base font-semibold">Your rights</h2>
      <p>
        You may ask to access, correct or delete your personal data, or object to its use, by contacting us at {formatKenyanPhone(s.contact_phone)}
        {s.contact_email ? ` or ${s.contact_email}` : ''}. You can also complain to the Office of the Data Protection Commissioner (www.odpc.go.ke).
      </p>
    </article>
  );
}
