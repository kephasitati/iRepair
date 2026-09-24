import { toMsisdn } from '@/lib/core/phone';

/**
 * Safaricom Daraja: Lipa Na M-Pesa Online (STK Push) and STK Query. See docs/MPESA.md.
 * Amounts are whole KES. Callbacks are unsigned, so each payment carries its own callback token in the URL.
 */

export type DarajaConfig = {
  env: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  /** Paybill number, or the store number for a Till. */
  shortcode: string;
  passkey: string;
  type: 'paybill' | 'till';
  /** Till number (PartyB) when type = till. */
  tillNumber?: string;
};

export type StkPushResult = {
  merchantRequestId: string;
  checkoutRequestId: string;
  responseCode: string;
  responseDescription: string;
  customerMessage: string;
};

export type StkQueryResult = { resultCode: number | null; resultDesc: string; raw: unknown };

export type StkCallback = {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  resultDesc: string;
  amountKes?: number;
  receipt?: string;
  phone?: string;
  transactionDate?: string;
};

export interface MpesaGateway {
  stkPush(input: { amountKes: number; phoneE164: string; accountReference: string; description: string; callbackUrl: string }): Promise<StkPushResult>;
  stkQuery(checkoutRequestId: string): Promise<StkQueryResult>;
}

const BASE = { sandbox: 'https://sandbox.safaricom.co.ke', production: 'https://api.safaricom.co.ke' };

export function darajaTimestamp(d = new Date()): string {
  // YYYYMMDDHHmmss in Nairobi time
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    .formatToParts(d)
    .reduce<Record<string, string>>((acc, x) => ((acc[x.type] = x.value), acc), {});
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

export function darajaPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** Parse the STK callback body Safaricom posts. Returns null if the shape is wrong. */
export function parseStkCallback(body: unknown): StkCallback | null {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb || typeof cb.CheckoutRequestID !== 'string' || typeof cb.ResultCode !== 'number') return null;
  const items = ((cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] })?.Item ?? []).reduce<Record<string, unknown>>(
    (acc, i) => ((acc[i.Name] = i.Value), acc),
    {},
  );
  return {
    merchantRequestId: String(cb.MerchantRequestID ?? ''),
    checkoutRequestId: cb.CheckoutRequestID,
    resultCode: cb.ResultCode,
    resultDesc: String(cb.ResultDesc ?? ''),
    amountKes: typeof items.Amount === 'number' ? items.Amount : undefined,
    receipt: typeof items.MpesaReceiptNumber === 'string' ? items.MpesaReceiptNumber : undefined,
    phone: items.PhoneNumber != null ? String(items.PhoneNumber) : undefined,
    transactionDate: items.TransactionDate != null ? String(items.TransactionDate) : undefined,
  };
}

export class DarajaGateway implements MpesaGateway {
  private token?: { value: string; expiresAt: number };

  constructor(private readonly cfg: DarajaConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await fetch(`${BASE[this.cfg.env]}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { authorization: 'Basic ' + Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString('base64') },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Daraja OAuth failed: ${res.status}`);
    const j = (await res.json()) as { access_token: string; expires_in: string };
    this.token = { value: j.access_token, expiresAt: Date.now() + Number(j.expires_in) * 1000 };
    return j.access_token;
  }

  async stkPush(input: { amountKes: number; phoneE164: string; accountReference: string; description: string; callbackUrl: string }): Promise<StkPushResult> {
    if (!Number.isInteger(input.amountKes) || input.amountKes < 1) throw new Error('M-Pesa amount must be a whole number of shillings');
    const timestamp = darajaTimestamp();
    const body = {
      BusinessShortCode: this.cfg.shortcode,
      Password: darajaPassword(this.cfg.shortcode, this.cfg.passkey, timestamp),
      Timestamp: timestamp,
      TransactionType: this.cfg.type === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: input.amountKes,
      PartyA: toMsisdn(input.phoneE164),
      PartyB: this.cfg.type === 'till' ? (this.cfg.tillNumber ?? this.cfg.shortcode) : this.cfg.shortcode,
      PhoneNumber: toMsisdn(input.phoneE164),
      CallBackURL: input.callbackUrl,
      AccountReference: input.accountReference.slice(0, 12),
      TransactionDesc: input.description.slice(0, 13),
    };
    const res = await fetch(`${BASE[this.cfg.env]}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, string>;
    if (!res.ok || j.ResponseCode !== '0') {
      throw new Error(`STK push rejected: ${j.errorMessage ?? j.ResponseDescription ?? res.status}`);
    }
    return {
      merchantRequestId: j.MerchantRequestID,
      checkoutRequestId: j.CheckoutRequestID,
      responseCode: j.ResponseCode,
      responseDescription: j.ResponseDescription,
      customerMessage: j.CustomerMessage,
    };
  }

  async stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
    const timestamp = darajaTimestamp();
    const res = await fetch(`${BASE[this.cfg.env]}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({
        BusinessShortCode: this.cfg.shortcode,
        Password: darajaPassword(this.cfg.shortcode, this.cfg.passkey, timestamp),
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // While the customer still has the prompt open Daraja answers with errorCode 500.001.1001 ("being processed").
    if (j.errorCode === '500.001.1001') return { resultCode: null, resultDesc: 'processing', raw: j };
    if (j.ResultCode === undefined) return { resultCode: null, resultDesc: String(j.errorMessage ?? 'unknown'), raw: j };
    return { resultCode: Number(j.ResultCode), resultDesc: String(j.ResultDesc ?? ''), raw: j };
  }
}

/**
 * Local simulator: behaves like Daraja but the "phone prompt" is a button on the payment screen
 * (POST /api/dev/mpesa/simulate) that posts a real-shaped callback to our own callback URL.
 */
export class SimulatorGateway implements MpesaGateway {
  async stkPush(input: { amountKes: number; phoneE164: string }): Promise<StkPushResult> {
    const id = `ws_CO_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      merchantRequestId: `sim-${id}`,
      checkoutRequestId: id,
      responseCode: '0',
      responseDescription: 'Success. Request accepted for processing',
      customerMessage: `Simulated prompt for KES ${input.amountKes} sent to ${input.phoneE164}`,
    };
  }
  async stkQuery(): Promise<StkQueryResult> {
    return { resultCode: null, resultDesc: 'processing', raw: {} };
  }
}

/** Human-readable text for Daraja result codes shown on the payment screen. */
export function describeResultCode(code: number | null | undefined): string {
  switch (code) {
    case 0:
      return 'Payment received';
    case 1:
      return 'Insufficient M-Pesa balance';
    case 1032:
      return 'You cancelled the request on your phone';
    case 1037:
      return 'No response from your phone (timed out)';
    case 2001:
      return 'Wrong M-Pesa PIN';
    case 1019:
      return 'Transaction expired';
    default:
      return 'Payment was not completed';
  }
}
