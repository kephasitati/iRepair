import { parsePhoneNumberFromString } from 'libphonenumber-js/min';

/**
 * Normalise Kenyan phone input (07XX..., 01XX..., 2547..., +2547...) to E.164 (+2547XXXXXXXX).
 * Returns null for anything that is not a valid Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const cleaned = input.replace(/[\s\-().]/g, '');
  if (!cleaned) return null;
  const withPlus = /^254\d{9}$/.test(cleaned) ? `+${cleaned}` : cleaned;
  const parsed = parsePhoneNumberFromString(withPlus, 'KE');
  if (!parsed || parsed.country !== 'KE' || !parsed.isValid()) return null;
  const e164 = parsed.number;
  // Kenyan mobiles are +2547XXXXXXXX or +2541XXXXXXXX.
  return /^\+254[17]\d{8}$/.test(e164) ? e164 : null;
}

/** E.164 without the plus, as Daraja and Africa's Talking expect (2547XXXXXXXX). */
export function toMsisdn(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** +254712345678 -> 0712 345 678 */
export function formatKenyanPhone(e164: string): string {
  const m = /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** +254712345678 -> 0712 *** 678 (for logs and screens that should not show the full number). */
export function maskPhone(e164: string): string {
  const m = /^\+254(\d{3})\d{3}(\d{3})$/.exec(e164);
  return m ? `0${m[1]} *** ${m[2]}` : '***';
}
