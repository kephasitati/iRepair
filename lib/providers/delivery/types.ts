/** Courier abstraction (PLAN §7). Code against this, never against a vendor. */

export type Address = {
  formatted: string;
  lat?: number | null;
  lng?: number | null;
  landmark?: string | null;
  building_floor?: string | null;
  place_id?: string | null;
  zone?: string | null;
};

export type DeliveryStatusValue =
  | 'requested'
  | 'rider_assigned'
  | 'rider_en_route'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'failed'
  | 'cancelled';

export type Rider = { name: string; phone: string; plate?: string | null };

export type DeliveryStatus = {
  status: DeliveryStatusValue;
  rider?: Rider | null;
  trackingUrl?: string | null;
  etaMinutes?: number | null;
  failureReason?: string | null;
  raw?: unknown;
};

export type DeliveryEvent = {
  /** Provider's own event id, used as the webhook dedupe key. */
  eventId: string;
  deliveryId: string;
  status: DeliveryStatusValue;
  rider?: Rider | null;
  trackingUrl?: string | null;
  failureReason?: string | null;
  occurredAt: Date;
  raw: unknown;
};

export type ProviderCapabilities = { qr: boolean; otp: boolean; scheduling: boolean; webhooks: boolean; polling: boolean };

export interface DeliveryProvider {
  readonly kind: 'mock' | 'tumaboda';
  readonly capabilities: ProviderCapabilities;

  quote(input: { pickup: Address; dropoff: Address; itemValueKes: number; scheduledFor?: Date }): Promise<{ feeKes: number; etaMinutes: number; quoteRef: string }>;

  create(input: {
    quoteRef: string;
    jobRef: string;
    description: string;
    senderPhone: string;
    recipientPhone: string;
    pickup: Address;
    dropoff: Address;
    itemValueKes: number;
    instructions?: string;
    scheduledFor?: Date;
    idempotencyKey: string;
  }): Promise<{ deliveryId: string; trackingUrl: string }>;

  cancel(deliveryId: string): Promise<void>;

  status(deliveryId: string): Promise<DeliveryStatus>;

  verifyRiderQr(deliveryId: string, qrPayload: string): Promise<{ valid: boolean; riderName?: string; riderPhone?: string; plate?: string }>;

  verifyOtp(deliveryId: string, otp: string): Promise<boolean>;

  parseWebhook(rawBody: string, headers: Record<string, string>): DeliveryEvent;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
