export type IdKind = 'national_id' | 'passport' | 'alien_id';

export const ID_KINDS: IdKind[] = ['national_id', 'passport', 'alien_id'];

export const ID_KIND_LABEL: Record<IdKind, string> = { national_id: 'National ID', passport: 'Passport', alien_id: 'Alien ID' };

export type IdCheck = { ok: true; normalized: string; last4: string } | { ok: false; error: 'required' | 'format' };

/**
 * Kenyan national IDs are 7–8 digits (older ones shorter), alien IDs are numeric too, passports are one or two
 * letters followed by digits (e.g. AK1234567). Deliberately loose: the number is only ever matched by eye against
 * the photographed document, never used as a key.
 */
export function checkIdNumber(kind: IdKind, raw: string): IdCheck {
  const value = raw.replace(/[\s-]+/g, '').toUpperCase();
  if (!value) return { ok: false, error: 'required' };
  const ok = kind === 'passport' ? /^[A-Z]{1,2}\d{6,8}$/.test(value) || /^[A-Z0-9]{6,10}$/.test(value) : /^\d{6,10}$/.test(value);
  return ok ? { ok: true, normalized: value, last4: value.slice(-4) } : { ok: false, error: 'format' };
}
