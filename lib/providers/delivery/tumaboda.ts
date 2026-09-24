import { hmacSha256, safeEqual } from '@/lib/core/crypto';
import type { Address, DeliveryProvider, DeliveryStatus, DeliveryEvent, DeliveryStatusValue } from './types';
import { ProviderError } from './types';

/**
 * TumaBoda merchant API adapter.
 *
 * TODO(TUMABODA): every endpoint path, field name and status value below is a placeholder until the API
 * documentation arrives (docs/TUMABODA.md lists exactly what is needed). The shape of the adapter, the
 * webhook signature check, replay protection and the status mapping are final; only the wire format changes.
 */

export type TumaBodaConfig = { baseUrl: string; apiKey: string; webhookSecret: string };

const STATUS_MAP: Record<string, DeliveryStatusValue> = {
  // TODO(TUMABODA): replace keys with the real status vocabulary.
  pending: 'requested',
  assigned: 'rider_assigned',
  en_route_to_pickup: 'rider_en_route',
  arrived_at_pickup: 'rider_en_route',
  picked_up: 'picked_up',
  in_transit: 'in_transit',
  delivered: 'delivered',
  failed: 'failed',
  cancelled: 'cancelled',
};

export class TumaBodaProvider implements DeliveryProvider {
  readonly kind = 'tumaboda' as const;
  readonly capabilities = { qr: true, otp: true, scheduling: true, webhooks: true, polling: true };

  constructor(private readonly cfg: TumaBodaConfig) {}

  private async call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await fetch(new URL(path, this.cfg.baseUrl), {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.cfg.apiKey}`, // TODO(TUMABODA): confirm auth scheme
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ProviderError(`TumaBoda ${method} ${path} -> ${res.status} ${text.slice(0, 300)}`, res.status >= 500 || res.status === 429);
    }
    return (await res.json()) as T;
  }

  private static addr(a: Address) {
    return { address: a.formatted, latitude: a.lat, longitude: a.lng, landmark: a.landmark, building: a.building_floor };
  }

  async quote(input: { pickup: Address; dropoff: Address; itemValueKes: number; scheduledFor?: Date }) {
    // TODO(TUMABODA): endpoint + response fields
    const r = await this.call<{ fee: number; eta_minutes: number; quote_id: string }>('POST', '/v1/quotes', {
      pickup: TumaBodaProvider.addr(input.pickup),
      dropoff: TumaBodaProvider.addr(input.dropoff),
      declared_value: input.itemValueKes,
      scheduled_at: input.scheduledFor?.toISOString(),
    });
    return { feeKes: r.fee, etaMinutes: r.eta_minutes, quoteRef: r.quote_id };
  }

  async create(input: Parameters<DeliveryProvider['create']>[0]) {
    // TODO(TUMABODA): endpoint + fields (job reference, description, insurance value, phones, instructions)
    const r = await this.call<{ id: string; tracking_url: string }>(
      'POST',
      '/v1/deliveries',
      {
        quote_id: input.quoteRef,
        reference: input.jobRef,
        description: input.description,
        sender_phone: input.senderPhone,
        recipient_phone: input.recipientPhone,
        pickup: TumaBodaProvider.addr(input.pickup),
        dropoff: TumaBodaProvider.addr(input.dropoff),
        declared_value: input.itemValueKes,
        instructions: input.instructions,
        scheduled_at: input.scheduledFor?.toISOString(),
      },
      input.idempotencyKey,
    );
    return { deliveryId: r.id, trackingUrl: r.tracking_url };
  }

  async cancel(deliveryId: string) {
    await this.call('POST', `/v1/deliveries/${encodeURIComponent(deliveryId)}/cancel`); // TODO(TUMABODA)
  }

  async status(deliveryId: string): Promise<DeliveryStatus> {
    // TODO(TUMABODA): endpoint + fields
    const r = await this.call<{ status: string; rider?: { name: string; phone: string; plate?: string }; tracking_url?: string; eta_minutes?: number; failure_reason?: string }>(
      'GET',
      `/v1/deliveries/${encodeURIComponent(deliveryId)}`,
    );
    return {
      status: STATUS_MAP[r.status] ?? 'requested',
      rider: r.rider ? { name: r.rider.name, phone: r.rider.phone, plate: r.rider.plate } : null,
      trackingUrl: r.tracking_url ?? null,
      etaMinutes: r.eta_minutes ?? null,
      failureReason: r.failure_reason ?? null,
      raw: r,
    };
  }

  async verifyRiderQr(deliveryId: string, qrPayload: string) {
    // TODO(TUMABODA): the endpoint that confirms a scanned rider QR belongs to the rider assigned to this delivery.
    const r = await this.call<{ valid: boolean; rider?: { name: string; phone: string; plate?: string } }>(
      'POST',
      `/v1/deliveries/${encodeURIComponent(deliveryId)}/verify-rider`,
      { qr: qrPayload },
    );
    return { valid: r.valid, riderName: r.rider?.name, riderPhone: r.rider?.phone, plate: r.rider?.plate };
  }

  async verifyOtp(deliveryId: string, otp: string) {
    // TODO(TUMABODA): OTP proof-of-handover endpoint
    const r = await this.call<{ valid: boolean }>('POST', `/v1/deliveries/${encodeURIComponent(deliveryId)}/verify-otp`, { otp });
    return r.valid;
  }

  parseWebhook(rawBody: string, headers: Record<string, string>): DeliveryEvent {
    // TODO(TUMABODA): header names and signing scheme. Assumed: HMAC-SHA256 over "<timestamp>.<body>", hex.
    const signature = headers['x-tumaboda-signature'] ?? '';
    const timestamp = headers['x-tumaboda-timestamp'] ?? '';
    if (!signature || !timestamp) throw new ProviderError('Missing webhook signature headers', false);
    const skew = Math.abs(Date.now() - Number(timestamp) * 1000);
    if (!Number.isFinite(skew) || skew > 5 * 60 * 1000) throw new ProviderError('Webhook timestamp outside tolerance', false);
    const expected = hmacSha256(this.cfg.webhookSecret, `${timestamp}.${rawBody}`).toString('hex');
    if (!safeEqual(expected, signature)) throw new ProviderError('Invalid webhook signature', false);

    const body = JSON.parse(rawBody) as {
      event_id: string;
      delivery_id: string;
      status: string;
      rider?: { name: string; phone: string; plate?: string };
      tracking_url?: string;
      failure_reason?: string;
      occurred_at: string;
    };
    return {
      eventId: body.event_id,
      deliveryId: body.delivery_id,
      status: STATUS_MAP[body.status] ?? 'requested',
      rider: body.rider ? { name: body.rider.name, phone: body.rider.phone, plate: body.rider.plate } : null,
      trackingUrl: body.tracking_url ?? null,
      failureReason: body.failure_reason ?? null,
      occurredAt: new Date(body.occurred_at),
      raw: body,
    };
  }
}
