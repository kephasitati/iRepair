/**
 * Notification templates use `{variable}` placeholders. The SQL renderer (render_template in db/migrations)
 * follows exactly the same rule: known variables are replaced, unknown ones are left untouched.
 * Passcodes and IMEIs can never be variables (COMPLIANCE.md).
 */

export const TEMPLATE_VARIABLES = [
  'customer_name',
  'job_ref',
  'amount',
  'tracking_url',
  'shop_name',
  'shop_phone',
  'job_link',
  'rider_name',
  'rider_phone',
  'plate',
  'receipt',
  'device',
  'status',
  'expires_at',
  'reason',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const FORBIDDEN = /passcode|password|pin|imei|serial/i;

export function templateVariablesUsed(body: string): string[] {
  return Array.from(body.matchAll(/\{([a-z_]+)\}/g), (m) => m[1]);
}

export function validateTemplate(body: string): { ok: true } | { ok: false; unknown: string[]; forbidden: string[] } {
  const used = templateVariablesUsed(body);
  const unknown = used.filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
  const forbidden = used.filter((v) => FORBIDDEN.test(v));
  return unknown.length || forbidden.length ? { ok: false, unknown, forbidden } : { ok: true };
}

export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string | null | undefined>>): string {
  return body.replace(/\{([a-z_]+)\}/g, (whole, name: string) => {
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(name)) return whole;
    const v = vars[name as TemplateVariable];
    return v == null ? '' : String(v);
  });
}

/** SMS segment count (GSM-7: 160/153 chars, Unicode: 70/67). */
export function smsSegments(text: string): number {
  const unicode = /[^\x20-\x7e\n\r]/.test(text);
  const single = unicode ? 70 : 160;
  const multi = unicode ? 67 : 153;
  return text.length <= single ? 1 : Math.ceil(text.length / multi);
}
