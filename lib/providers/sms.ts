import { toMsisdn } from '@/lib/core/phone';

export type SmsResult = { ok: boolean; messageId?: string; error?: string; costKes?: number };

export interface SmsSender {
  send(input: { to: string; body: string; senderId?: string | null }): Promise<SmsResult>;
}

/** Africa's Talking SMS. Delivery reports arrive at /api/webhooks/sms/dlr. */
export class AfricasTalkingSms implements SmsSender {
  constructor(
    private readonly cfg: { username: string; apiKey: string; senderId?: string | null },
  ) {}

  async send(input: { to: string; body: string; senderId?: string | null }): Promise<SmsResult> {
    const sandbox = this.cfg.username === 'sandbox';
    const url = sandbox ? 'https://api.sandbox.africastalking.com/version1/messaging' : 'https://api.africastalking.com/version1/messaging';
    const form = new URLSearchParams({ username: this.cfg.username, to: '+' + toMsisdn(input.to), message: input.body });
    const from = input.senderId ?? this.cfg.senderId;
    if (from) form.set('from', from);
    const res = await fetch(url, {
      method: 'POST',
      headers: { apiKey: this.cfg.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(15000),
    });
    const j = (await res.json().catch(() => ({}))) as { SMSMessageData?: { Recipients?: { status: string; messageId: string; statusCode: number; cost?: string }[]; Message?: string } };
    const r = j.SMSMessageData?.Recipients?.[0];
    if (!res.ok || !r) return { ok: false, error: j.SMSMessageData?.Message ?? `HTTP ${res.status}` };
    // 100 Processed, 101 Sent, 102 Queued. Anything else failed.
    const ok = [100, 101, 102].includes(r.statusCode);
    const cost = r.cost ? Number(r.cost.replace(/[^\d.]/g, '')) : undefined;
    return ok ? { ok, messageId: r.messageId, costKes: cost } : { ok: false, error: `${r.statusCode} ${r.status}` };
  }
}

/** Development driver: prints the SMS to the server console. */
export class ConsoleSms implements SmsSender {
  async send(input: { to: string; body: string }): Promise<SmsResult> {
    console.log(`\n📱 SMS -> ${input.to}\n${input.body}\n`);
    return { ok: true, messageId: `console-${Date.now()}` };
  }
}
