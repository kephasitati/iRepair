export type DeviceType = 'iphone' | 'macbook' | 'ipad' | 'imac' | 'apple_watch' | 'android' | 'windows_laptop' | 'other';

export const DEVICE_TYPES: DeviceType[] = ['iphone', 'macbook', 'ipad', 'imac', 'apple_watch', 'android', 'windows_laptop', 'other'];

/** The launch line-up (default for every new shop): the Apple family first, then Android and Windows laptops. */
export const DEFAULT_DEVICE_TYPES: DeviceType[] = ['iphone', 'macbook', 'ipad', 'imac', 'apple_watch', 'android', 'windows_laptop'];

export const APPLE_TYPES: DeviceType[] = ['iphone', 'macbook', 'ipad', 'imac', 'apple_watch'];

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidImei(value: string): boolean {
  return /^\d{15}$/.test(value) && luhnValid(value);
}

/**
 * Apple serials: legacy 11/12 character (e.g. C02XK0ABJG5J) or randomised 8-14 character from 2021.
 * Deliberately loose: uppercase letters and digits only.
 */
export function looksLikeAppleSerial(value: string): boolean {
  return /^[A-Z0-9]{8,14}$/.test(value);
}

export function looksLikeGenericSerial(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9\-/]{3,39}$/.test(value);
}

export type IdentifierCheck =
  | { ok: true; kind: 'imei' | 'serial'; normalized: string }
  | { ok: false; error: 'required' | 'imei_checksum' | 'imei_length' | 'serial_format' };

/**
 * Validate the IMEI or serial a customer declares. Phones and cellular iPads usually give an IMEI
 * (15 digits, Luhn); Apple devices may give a serial instead; laptops give a serial.
 */
export function checkDeviceIdentifier(type: DeviceType, raw: string): IdentifierCheck {
  const value = raw.replace(/\s+/g, '').toUpperCase();
  if (!value) return { ok: false, error: 'required' };
  if (/^\d+$/.test(value)) {
    if (value.length === 15) return isValidImei(value) ? { ok: true, kind: 'imei', normalized: value } : { ok: false, error: 'imei_checksum' };
    if (type === 'iphone' || type === 'android') return { ok: false, error: 'imei_length' };
  }
  const apple = APPLE_TYPES.includes(type);
  const ok = apple ? looksLikeAppleSerial(value) : looksLikeGenericSerial(value);
  return ok ? { ok: true, kind: 'serial', normalized: value } : { ok: false, error: 'serial_format' };
}

/** Compare the declared identifier to the one read at the bench (case/space insensitive). */
export function identifiersMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();
  return n(a) !== '' && n(a) === n(b);
}
