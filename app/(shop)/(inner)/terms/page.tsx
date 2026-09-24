import Link from 'next/link';
import { LegalPage } from '@/components/legal-page';
import { formatKes } from '@/lib/core/money';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatDate } from '@/lib/core/time';
import { TERMS_VERSION } from '@/lib/legal';
import { requireTenant } from '@/lib/tenant';

export const metadata = { title: 'Terms of Service' };

/**
 * Per-shop Terms of Service, filled from the shop's own settings (fees, deposit, quote validity, warranty).
 * TEMPLATE: have a Kenyan advocate review before going live (docs/COMPLIANCE.md).
 */
export default async function TermsPage() {
  const tenant = await requireTenant();
  const s = tenant.settings;
  const shop = tenant.branding.display_name;
  const deposit = s.deposit_rule.kind === 'percent' ? `${s.deposit_rule.value / 100}% of the accepted quote` : `${formatKes(s.deposit_rule.value)}`;
  const courier = 'TumaBoda';

  const sections = [
    {
      id: 'about',
      title: 'About these terms',
      body: (
        <>
          <p>
            These terms are an agreement between you and <strong>{shop}</strong> ({s.address_formatted}
            {s.kra_pin ? `, KRA PIN ${s.kra_pin}` : ''}) (&ldquo;we&rdquo;, &ldquo;us&rdquo;). They apply every time you book a repair through this website or app.
            By ticking &ldquo;I agree&rdquo; when you book, you accept the version of these terms shown at that time.
          </p>
          <p>The booking system is provided to us by a technology supplier that acts only on our instructions. Your contract is with {shop}.</p>
        </>
      ),
    },
    {
      id: 'service',
      title: 'Our service',
      body: (
        <ul>
          <li>We arrange for your device to be collected from you, diagnose it, quote for the repair, repair it if you accept, and arrange for it to be returned to you, or you may collect it.</li>
          <li>We are an independent repair shop. We are not the manufacturer of your device and repairs may affect any remaining manufacturer warranty.</li>
          <li>Each quote states whether a part is genuine, original-equipment or a compatible replacement.</li>
        </ul>
      ),
    },
    {
      id: 'account',
      title: 'Your account',
      body: (
        <ul>
          <li>You sign in with your mobile number and a one-time code. Keep your phone secure: anyone with your code can act on your bookings.</li>
          <li>You must be at least 18, or have a parent or guardian book for you.</li>
          <li>Keep your contact details up to date so riders and technicians can reach you.</li>
        </ul>
      ),
    },
    {
      id: 'booking',
      title: 'Booking and your declaration',
      body: (
        <>
          <p>When you book you tell us the device, its IMEI or serial number, the fault, its condition and what accessories you are sending, and you take photos of it. You confirm that:</p>
          <ul>
            <li>the information and photos are accurate; and</li>
            <li>you own the device or are authorised by its owner to have it repaired.</li>
          </ul>
          <p>We may refuse or stop work on a device that appears to be reported lost or stolen, and we may be required by law to report it to the authorities.</p>
        </>
      ),
    },
    {
      id: 'courier',
      title: `Pickup and return by ${courier}`,
      body: (
        <>
          <p>
            Pickups and returns are carried out by <strong>{courier}</strong>, an independent courier, on our behalf. {courier}&rsquo;s own terms of carriage apply to
            the delivery itself. We share with {courier} only what it needs to deliver: your name, phone number, address and directions, a short description of
            the item and its declared value.
          </p>
          <ul>
            <li>
              <strong>Fees.</strong> The delivery fee is {courier}&rsquo;s charge for the trip, passed on to you at cost and including {courier}&rsquo;s VAT
              {s.delivery_markup_bp ? `, plus a handling charge of ${s.delivery_markup_bp / 100}%` : ''}. It is shown before you pay.
            </li>
            <li>
              <strong>Verified handovers.</strong> Every handover is confirmed by scanning the rider&rsquo;s {courier} QR code (or entering the {courier} delivery
              code). The app records the time, the rider, your location at pickup and the photos you took. This record is the agreed evidence of when the device
              changed hands and its declared condition.
            </li>
            <li>
              <strong>Declared value.</strong> The value you declare is passed to {courier} for courier cover. Declare the device&rsquo;s true replacement value.
            </li>
            <li>
              <strong>Be available.</strong> Please be at the address during the time window you chose. If a pickup or delivery fails because you were not
              available, you may need to rebook and a further delivery fee may apply.
            </li>
          </ul>
          <p>
            <strong>Who is responsible for the device, and when.</strong> Until the verified pickup handover, the device is in your care. From the verified
            pickup handover until we confirm receipt at the shop, and from the verified dispatch handover until delivery to you, it is in {courier}&rsquo;s custody
            and any loss or damage in transit is dealt with under {courier}&rsquo;s terms, up to the declared value, with our help in making the claim. From our
            verified receipt until we hand it to the return rider (or to you at the counter), it is in our care.
          </p>
        </>
      ),
    },
    {
      id: 'intake',
      title: 'Inspection when your device arrives',
      body: (
        <>
          <p>
            When your device arrives we check it against your declaration, read its IMEI or serial number and photograph it. If anything differs (for example
            damage not declared, a missing accessory or a different IMEI) we record it with photos and tell you in the app.
          </p>
          <p>
            You can accept the report and let us continue, or ask for the device to be returned without repair, in which case the return delivery fee applies.
            If you disagree with an intake finding you may raise a dispute in the app at any time until {s.warranty_days} days after your repair is completed. We
            will review it against the photographic record and respond in writing.
          </p>
        </>
      ),
    },
    {
      id: 'fees',
      title: 'Fees, quotes and payment',
      body: (
        <ul>
          <li>
            <strong>Pickup fee.</strong> Paid when you book: the delivery fee to bring your device to us plus our consultation and diagnosis fee of{' '}
            {formatKes(s.consultation_fee_cents)}. The consultation fee pays for our diagnosis and is not refundable once your device has been collected.
            {s.consultation_fee_credited ? ' If you accept our quote, it is credited against the repair.' : ''}
          </li>
          <li>
            <strong>Quotes.</strong> Itemised, in Kenya Shillings{s.vat_registered ? `, with VAT at ${s.vat_rate_bp / 100}% shown` : ''}, and valid for{' '}
            {s.quote_expiry_hours} hours. You may accept, decline, or make up to {s.max_negotiation_rounds} counter-offers. No repair work starts until you accept.
          </li>
          <li>
            <strong>Deposit.</strong> {deposit} is payable before we start
            {s.deposit_min_quote_cents ? ` (no deposit for quotes under ${formatKes(s.deposit_min_quote_cents)})` : ''}.
          </li>
          <li>
            <strong>Additional work.</strong> If we find more work is needed during the repair we send a separate quote. We only do it if you approve it; if you
            decline, we complete the original repair.
          </li>
          <li>
            <strong>Final balance.</strong> The accepted repair, any approved additional work and the return delivery fee, less what you have paid, are due before
            we dispatch your device. You receive a tax invoice{s.vat_registered ? ' showing VAT' : ''}.
          </li>
          <li>
            <strong>Payment.</strong> By M-Pesa to our own Paybill or Till. You receive an M-Pesa confirmation and an in-app receipt for every payment.
          </li>
        </ul>
      ),
    },
    {
      id: 'cancellation',
      title: 'Cancelling',
      body: (
        <ul>
          <li>You can cancel free of charge before paying the pickup fee.</li>
          <li>Once a {courier} rider has been booked, you can still cancel before collection, but the pickup fee is not refunded automatically.</li>
          <li>After collection and before you pay the deposit, you can cancel and have the device returned. The consultation fee and return delivery fee apply.</li>
          <li>After you pay the deposit, please contact us to cancel. We will refund any amount due for work not yet done, less the cost of parts already ordered for your device.</li>
          <li>We may cancel a job with a reason (for example if parts are unavailable) and will refund what is due.</li>
        </ul>
      ),
    },
    {
      id: 'data',
      title: 'Your data and passcode',
      body: (
        <ul>
          <li>Back up your device before booking. Repairs can occasionally cause data loss, and we are not responsible for data you did not back up.</li>
          <li>We only use your device&rsquo;s contents as far as needed to test the repair.</li>
          <li>
            If you share your passcode it is stored encrypted, shown only to the technician working on your device, and deleted when the job closes. You may prefer to
            remove it before sending the device.
          </li>
          <li>
            How we handle personal data is explained in our{' '}
            <Link href="/privacy" className="text-link hover:underline">
              privacy policy
            </Link>
            .
          </li>
        </ul>
      ),
    },
    {
      id: 'warranty',
      title: 'Repair warranty',
      body: (
        <p>
          Parts we fit and our workmanship are guaranteed for {s.warranty_days} days from when the repaired device is returned to you, for the fault we repaired.
          The warranty does not cover new physical or liquid damage, or repairs by anyone else after ours. Raise a warranty claim from the job in the app. Nothing in
          these terms limits your rights under the Consumer Protection Act, 2012.
        </p>
      ),
    },
    {
      id: 'uncollected',
      title: 'Devices not collected',
      body: (
        <p>
          When your device is ready we ask you to choose delivery or collection and remind you. If a device remains unclaimed for 90 days after we notify you, we may
          deal with it in accordance with the Uncollected Goods Act (Cap. 38), after giving you the notices that Act requires.
        </p>
      ),
    },
    {
      id: 'liability',
      title: 'Our responsibility to you',
      body: (
        <p>
          We will carry out repairs with reasonable care and skill. Where the law allows, our liability for loss of or damage to a device while it is in our care is
          limited to the lower of its reasonable market value and the value you declared. We are not responsible for delays caused by events outside our reasonable
          control. Nothing in these terms excludes liability that cannot be excluded under Kenyan law.
        </p>
      ),
    },
    {
      id: 'disputes',
      title: 'Complaints and governing law',
      body: (
        <p>
          Contact us first at {formatKenyanPhone(s.contact_phone)}
          {s.contact_email ? ` or ${s.contact_email}` : ''}, or through the job in the app. We aim to resolve complaints within 14 days. These terms are governed by the
          laws of Kenya and disputes are subject to the jurisdiction of the courts of Kenya.
        </p>
      ),
    },
  ];

  return (
    <LegalPage
      title="Terms of Service"
      updated={formatDate(`${TERMS_VERSION}T12:00:00+03:00`)}
      intro={
        <p>
          Plain-language terms for {shop}&rsquo;s doorstep repair service: collection and return by {courier}, fees, quotes, M-Pesa payments, cancellation and your
          warranty.
        </p>
      }
      sections={sections}
    />
  );
}
