import { describe, expect, it } from 'vitest';
import { checkIdNumber } from '@/lib/core/identity';
import { consultationFeeFor } from '@/lib/core/fees';

describe('ID numbers', () => {
  it('accepts Kenyan national IDs, alien IDs and passports, normalising spaces and case', () => {
    expect(checkIdNumber('national_id', '12 345 678')).toEqual({ ok: true, normalized: '12345678', last4: '5678' });
    expect(checkIdNumber('alien_id', '1234567')).toMatchObject({ ok: true, last4: '4567' });
    expect(checkIdNumber('passport', 'ak1234567')).toEqual({ ok: true, normalized: 'AK1234567', last4: '4567' });
  });
  it('rejects empty and malformed numbers', () => {
    expect(checkIdNumber('national_id', '  ')).toEqual({ ok: false, error: 'required' });
    expect(checkIdNumber('national_id', '12AB')).toEqual({ ok: false, error: 'format' });
    expect(checkIdNumber('national_id', '12345')).toEqual({ ok: false, error: 'format' });
    expect(checkIdNumber('passport', '!!')).toEqual({ ok: false, error: 'format' });
  });
});

describe('consultation fee per device type', () => {
  const settings = { consultation_fee_cents: 50000, consultation_fees: { macbook: 150000, ipad: 0 } };
  it('uses the per-type fee when set, including an explicit zero', () => {
    expect(consultationFeeFor(settings, 'macbook')).toBe(150000);
    expect(consultationFeeFor(settings, 'ipad')).toBe(0);
  });
  it('falls back to the general fee otherwise', () => {
    expect(consultationFeeFor(settings, 'iphone')).toBe(50000);
    expect(consultationFeeFor({ consultation_fee_cents: 50000 }, 'iphone')).toBe(50000);
    expect(consultationFeeFor({ consultation_fee_cents: 50000, consultation_fees: null }, 'android')).toBe(50000);
  });
});
