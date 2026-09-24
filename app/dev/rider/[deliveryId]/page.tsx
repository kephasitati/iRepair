import { notFound } from 'next/navigation';
import QRCode from 'qrcode';
import { isProd } from '@/lib/env';
import { mockProvider } from '@/lib/providers';

export const dynamic = 'force-dynamic';

/**
 * Demo only: the simulated rider's phone. Open it on a second device and scan the QR from the customer app
 * (or type the OTP). Never available in production.
 */
export default async function MockRiderPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  if (isProd()) notFound();
  const { deliveryId } = await params;
  const mock = mockProvider();
  let rider;
  try {
    rider = mock.rider(deliveryId);
  } catch {
    notFound();
  }
  const qr = await QRCode.toDataURL(mock.qrPayload(deliveryId), { margin: 1, width: 480 });
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-8 text-center">
      <p className="text-xs font-semibold tracking-wide text-amber-700 uppercase">Simulated courier · demo only</p>
      <h1 className="text-xl font-semibold">{rider.name}</h1>
      <p className="text-muted-foreground">
        {rider.plate} · {rider.phone}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Rider QR" className="mx-auto size-72 rounded-xl border bg-white p-3" data-testid="rider-qr" />
      <p className="text-sm">
        Handover code: <span className="font-mono text-2xl font-bold tracking-widest" data-testid="rider-otp">{mock.otp(deliveryId)}</span>
      </p>
      <p className="font-mono text-[10px] break-all text-muted-foreground" data-testid="rider-qr-payload">
        {mock.qrPayload(deliveryId)}
      </p>
    </main>
  );
}
