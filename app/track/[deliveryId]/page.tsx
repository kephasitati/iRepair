import { notFound } from 'next/navigation';
import { mockProvider } from '@/lib/providers';
import { servicePool } from '@/lib/db';
import { formatDateTime } from '@/lib/core/time';
import { isProd } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Tracking page for the simulated courier (real TumaBoda deliveries link to TumaBoda's own tracking page). */
export default async function MockTrackingPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params;
  const [d] = await servicePool()`select status, leg, updated_at, pickup_address, dropoff_address from deliveries where provider = 'mock' and provider_delivery_id = ${deliveryId}`;
  if (!d) notFound();
  const st = await mockProvider().status(deliveryId).catch(() => null);
  const rider = st?.rider;
  return (
    <main className="mx-auto max-w-sm space-y-3 px-4 py-8">
      <p className="text-xs text-muted-foreground">Live tracking</p>
      <h1 className="text-xl font-semibold capitalize">{String(d.status).replace(/_/g, ' ')}</h1>
      {rider ? (
        <p className="text-sm">
          {rider.name} · {rider.plate}
        </p>
      ) : null}
      {st?.etaMinutes ? <p className="text-sm text-muted-foreground">ETA about {st.etaMinutes} min</p> : null}
      <p className="text-sm">From: {d.pickup_address?.formatted}</p>
      <p className="text-sm">To: {d.dropoff_address?.formatted}</p>
      <p className="text-xs text-muted-foreground">Updated {formatDateTime(d.updated_at)}</p>
      {!isProd() ? (
        <a href={`/dev/rider/${deliveryId}`} className="text-xs text-amber-700 underline">
          Open the simulated rider&apos;s phone
        </a>
      ) : null}
    </main>
  );
}
