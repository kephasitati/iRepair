import { hmacSha256, safeEqual } from '@/lib/core/crypto';
import type { Address, DeliveryProvider, DeliveryStatus, DeliveryEvent, Rider } from './types';
import { ProviderError } from './types';

/**
 * Stateless simulated courier (DECISIONS D-16). A delivery id encodes its creation time, so status is a
 * pure function of elapsed time; the rider QR and OTP are HMACs of the id. Demo it end to end with no
 * credentials: the dev page /dev/rider/<deliveryId> shows the rider's QR and OTP.
 *
 *   t+0            requested
 *   t+delay        rider_assigned (rider details available)
 *   t+2*delay      rider_en_route (rider is "at the door": scan the QR / enter OTP in the app)
 *   after a scan   picked_up -> in_transit (the app drives these; see worker/delivery.ts)
 *   delivered      by QR/OTP at the destination
 */

const RIDERS: Rider[] = [
  { name: 'Brian Otieno', phone: '+254700111222', plate: 'KMFB 123A' },
  { name: 'Faith Wambui', phone: '+254700333444', plate: 'KMDC 456B' },
  { name: 'Kevin Mwangi', phone: '+254700555666', plate: 'KMEE 789C' },
];

function haversineKm(a: Address, b: Address): number {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return 6;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export class MockProvider implements DeliveryProvider {
  readonly kind = 'mock' as const;
  readonly capabilities = { qr: true, otp: true, scheduling: true, webhooks: false, polling: true };

  constructor(
    private readonly secret: string,
    private readonly delaySeconds = 20,
    private readonly now: () => number = Date.now,
  ) {}

  private sign(data: string, len = 12) {
    return hmacSha256(this.secret, data).toString('base64url').slice(0, len);
  }

  private parseId(deliveryId: string) {
    const m = /^mock_(pickup|return)_([0-9a-z]+)_([0-9a-z]+)$/.exec(deliveryId);
    if (!m) throw new ProviderError(`Unknown mock delivery id ${deliveryId}`, false);
    return { leg: m[1], createdAt: parseInt(m[2], 36), nonce: m[3] };
  }

  rider(deliveryId: string): Rider {
    const { createdAt } = this.parseId(deliveryId);
    return RIDERS[createdAt % RIDERS.length];
  }

  qrPayload(deliveryId: string) {
    return `RDMOCK:${deliveryId}:${this.sign('qr:' + deliveryId)}`;
  }

  otp(deliveryId: string) {
    const h = hmacSha256(this.secret, 'otp:' + deliveryId);
    return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  }

  async quote(input: { pickup: Address; dropoff: Address; itemValueKes: number }) {
    const km = Math.max(1, haversineKm(input.pickup, input.dropoff));
    // KES 150 base + KES 50/km, rounded to 10 KES. Roughly Nairobi boda pricing.
    const feeKes = Math.round((150 + 50 * km) / 10) * 10;
    return { feeKes, etaMinutes: Math.round(10 + km * 4), quoteRef: `mq_${this.sign(JSON.stringify([input.pickup.formatted, input.dropoff.formatted, feeKes]), 10)}_${feeKes}` };
  }

  async create(input: { quoteRef: string; jobRef: string; idempotencyKey: string }) {
    const leg = /return/.test(input.idempotencyKey) ? 'return' : 'pickup';
    const deliveryId = `mock_${leg}_${this.now().toString(36)}_${this.sign(input.idempotencyKey, 6).toLowerCase().replace(/[^0-9a-z]/g, 'x')}`;
    return { deliveryId, trackingUrl: `/track/${deliveryId}` };
  }

  async cancel() {}

  async status(deliveryId: string): Promise<DeliveryStatus> {
    const { createdAt } = this.parseId(deliveryId);
    const elapsed = (this.now() - createdAt) / 1000;
    const rider = this.rider(deliveryId);
    if (elapsed < this.delaySeconds) return { status: 'requested', etaMinutes: 15 };
    if (elapsed < this.delaySeconds * 2) return { status: 'rider_assigned', rider, trackingUrl: `/track/${deliveryId}`, etaMinutes: 12 };
    return { status: 'rider_en_route', rider, trackingUrl: `/track/${deliveryId}`, etaMinutes: 5 };
  }

  async verifyRiderQr(deliveryId: string, qrPayload: string) {
    const expected = this.qrPayload(deliveryId);
    const valid = expected.length === qrPayload.trim().length && safeEqual(expected, qrPayload.trim());
    const r = this.rider(deliveryId);
    return valid ? { valid, riderName: r.name, riderPhone: r.phone, plate: r.plate ?? undefined } : { valid: false };
  }

  async verifyOtp(deliveryId: string, otp: string) {
    return safeEqual(this.otp(deliveryId), otp.trim());
  }

  parseWebhook(): DeliveryEvent {
    throw new ProviderError('MockProvider does not send webhooks', false);
  }
}
