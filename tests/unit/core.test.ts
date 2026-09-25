import { describe, expect, it } from 'vitest';
import {
  ceilShilling,
  composeInvoice,
  computeTotals,
  deliveryCharge,
  depositFor,
  formatKes,
  roundShilling,
  vatFromInclusive,
  type TaxConfig,
} from '@/lib/core/money';
import { formatKenyanPhone, maskPhone, normalizeKenyanPhone } from '@/lib/core/phone';
import { checkDeviceIdentifier, identifiersMatch, isValidImei, luhnValid } from '@/lib/core/device-id';
import { decrypt, encrypt, generateDataKey, randomCode, unwrapDataKey, wrapDataKey } from '@/lib/core/crypto';
import { renderTemplate, validateTemplate } from '@/lib/core/templates';
import { deliverySlots, inQuietHours, quietHoursRelease } from '@/lib/core/time';
import { hashPassword, passwordProblems, verifyPassword } from '@/lib/core/password';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from '@/lib/core/totp';

const VAT: TaxConfig = { vatRegistered: true, vatRateBp: 1600, pricesIncludeVat: true };
const NO_VAT: TaxConfig = { vatRegistered: false, vatRateBp: 1600, pricesIncludeVat: true };

describe('money', () => {
  it('rounds to whole shillings', () => {
    expect(roundShilling(12349)).toBe(12300);
    expect(roundShilling(12350)).toBe(12400);
    expect(ceilShilling(12301)).toBe(12400);
    expect(ceilShilling(12300)).toBe(12300);
  });

  it('formats KES', () => {
    expect(formatKes(1250000)).toBe('KES 12,500');
    expect(formatKes(1250050)).toBe('KES 12,500.50');
    expect(formatKes(-50000)).toBe('-KES 500');
  });

  it('extracts VAT from inclusive prices', () => {
    expect(vatFromInclusive(11600_00, 1600)).toBe(1600_00);
    expect(vatFromInclusive(10000, 0)).toBe(0);
  });

  it('applies delivery markup and rounds up', () => {
    expect(deliveryCharge(25000, 0)).toEqual({ charged: 25000, markup: 0 });
    expect(deliveryCharge(25000, 1000)).toEqual({ charged: 27500, markup: 2500 });
    expect(deliveryCharge(25050, 0).charged).toBe(25100);
  });

  it('computes deposits', () => {
    expect(depositFor(1_000_000, { kind: 'percent', value: 5000 })).toBe(500_000);
    expect(depositFor(1_000_050, { kind: 'percent', value: 5000 })).toBe(500_000);
    expect(depositFor(300_000, { kind: 'fixed', value: 500_000 })).toBe(300_000);
    expect(depositFor(300_000, { kind: 'percent', value: 5000 }, 500_000)).toBe(0);
    expect(depositFor(0, { kind: 'percent', value: 5000 })).toBe(0);
  });

  it('totals: inclusive VAT, non-vatable pass-through lines are outside the VAT base', () => {
    const t = computeTotals(
      [
        { description: 'Screen', qty: 1, unitPriceCents: 1_160_000 },
        { description: 'Courier', qty: 1, unitPriceCents: 30_000, vatable: false },
      ],
      VAT,
    );
    expect(t.vatCents).toBe(160_000);
    expect(t.totalCents).toBe(1_190_000);
    expect(t.subtotalCents).toBe(1_030_000);
  });

  it('totals: exclusive VAT adds VAT and rounds to the shilling', () => {
    const t = computeTotals([{ description: 'Labour', qty: 1, unitPriceCents: 1_234_500 }], { ...VAT, pricesIncludeVat: false });
    expect(t.vatCents).toBe(197_520);
    expect(t.totalCents).toBe(1_432_000);
    expect(t.roundingCents).toBe(-20);
  });

  it('totals: not VAT registered means zero VAT', () => {
    expect(computeTotals([{ description: 'x', qty: 2, unitPriceCents: 50_000 }], NO_VAT)).toMatchObject({ vatCents: 0, totalCents: 100_000 });
  });

  it('invoice: repaired job credits consultation fee and applies payments', () => {
    const inv = composeInvoice({
      tax: VAT,
      outcome: 'repaired',
      consultationFeeCents: 50_000,
      consultationFeeCredited: true,
      pickupDelivery: { costCents: 30_000, chargedCents: 30_000 },
      returnDelivery: { costCents: 35_000, chargedCents: 35_000 },
      quoteLines: [
        { description: 'iPhone 13 screen', qty: 1, unitPriceCents: 1_200_000 },
        { description: 'Labour', qty: 1, unitPriceCents: 300_000 },
      ],
      supplementaryLines: [],
      paidCents: 80_000 + 750_000,
    });
    // vatable: 50k consultation + 1.5m quote - 50k credit = 1.5m ; non-vatable delivery 65k
    expect(inv.totalCents).toBe(1_565_000);
    expect(inv.vatCents).toBe(vatFromInclusive(1_500_000, 1600));
    expect(inv.balanceCents).toBe(1_565_000 - 830_000);
    expect(inv.lines.find((l) => l.code === 'consultation_credit')?.totalCents).toBe(-50_000);
  });

  it('invoice: declined job charges consultation and both legs only', () => {
    const inv = composeInvoice({
      tax: NO_VAT,
      outcome: 'declined',
      consultationFeeCents: 50_000,
      consultationFeeCredited: true,
      pickupDelivery: { costCents: 30_000, chargedCents: 30_000 },
      returnDelivery: { costCents: 30_000, chargedCents: 33_000 },
      quoteLines: [{ description: 'ignored', qty: 1, unitPriceCents: 999_900 }],
      supplementaryLines: [],
      paidCents: 113_000,
    });
    expect(inv.totalCents).toBe(113_000);
    expect(inv.balanceCents).toBe(0);
    expect(inv.lines.some((l) => l.code === 'return_delivery_handling' && l.vatable)).toBe(true);
  });

  it('invoice: negotiated discount and supplementary work', () => {
    const inv = composeInvoice({
      tax: NO_VAT,
      outcome: 'repaired',
      consultationFeeCents: 0,
      consultationFeeCredited: true,
      quoteLines: [{ description: 'Board repair', qty: 1, unitPriceCents: 2_000_000 }],
      supplementaryLines: [{ description: 'Battery', qty: 1, unitPriceCents: 500_000 }],
      negotiatedAdjustmentCents: -200_000,
      paidCents: 0,
    });
    expect(inv.totalCents).toBe(2_300_000);
  });
});

describe('phone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['0712 345 678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254712345678', '+254712345678'],
    ['0110345678', '+254110345678'],
  ])('%s -> %s', (input, out) => expect(normalizeKenyanPhone(input)).toBe(out));

  it.each(['', '12345', '0212345678', '+14155552671', '07123'])('rejects %s', (input) => expect(normalizeKenyanPhone(input)).toBeNull());

  it('formats and masks', () => {
    expect(formatKenyanPhone('+254712345678')).toBe('0712 345 678');
    expect(maskPhone('+254712345678')).toBe('0712 *** 678');
  });
});

describe('device identifiers', () => {
  it('validates IMEI with Luhn', () => {
    expect(luhnValid('79927398713')).toBe(true);
    expect(isValidImei('490154203237518')).toBe(true);
    expect(isValidImei('490154203237517')).toBe(false);
  });

  it('checks identifiers by device type', () => {
    expect(checkDeviceIdentifier('iphone', '4901 5420 3237 518')).toEqual({ ok: true, kind: 'imei', normalized: '490154203237518' });
    expect(checkDeviceIdentifier('iphone', '490154203237517')).toEqual({ ok: false, error: 'imei_checksum' });
    expect(checkDeviceIdentifier('android', '1234567')).toEqual({ ok: false, error: 'imei_length' });
    expect(checkDeviceIdentifier('macbook', 'c02xk0abjg5j')).toEqual({ ok: true, kind: 'serial', normalized: 'C02XK0ABJG5J' });
    expect(checkDeviceIdentifier('iphone', 'F2LXK0ABJG5J')).toMatchObject({ ok: true, kind: 'serial' });
    expect(checkDeviceIdentifier('macbook', 'AB')).toEqual({ ok: false, error: 'serial_format' });
    expect(checkDeviceIdentifier('windows_laptop', '5CD-1234-XYZ')).toMatchObject({ ok: true });
    expect(checkDeviceIdentifier('apple_watch', 'GX7ZK0ABJG5J')).toMatchObject({ ok: true, kind: 'serial' });
    expect(checkDeviceIdentifier('apple_watch', '5CD-1234-XYZ')).toEqual({ ok: false, error: 'serial_format' });
    expect(checkDeviceIdentifier('other', '')).toEqual({ ok: false, error: 'required' });
  });

  it('compares identifiers loosely', () => {
    expect(identifiersMatch('c02 xk0', 'C02XK0')).toBe(true);
    expect(identifiersMatch('', '')).toBe(false);
    expect(identifiersMatch('A', 'B')).toBe(false);
  });
});

describe('crypto', () => {
  it('round-trips with AAD and rejects tampering', () => {
    const key = generateDataKey();
    const ct = encrypt('1234', key, 'job:1');
    expect(decrypt(ct, key, 'job:1')).toBe('1234');
    expect(() => decrypt(ct, key, 'job:2')).toThrow();
    const parts = ct.split('.');
    parts[2] = Buffer.from('xxxx').toString('base64url');
    expect(() => decrypt(parts.join('.'), key, 'job:1')).toThrow();
  });

  it('wraps tenant data keys', () => {
    const master = generateDataKey();
    const dk = generateDataKey();
    const wrapped = wrapDataKey(dk, master, 't1');
    expect(unwrapDataKey(wrapped, master, 't1').equals(dk)).toBe(true);
    expect(() => unwrapDataKey(wrapped, master, 't2')).toThrow();
  });

  it('makes unambiguous codes', () => {
    expect(randomCode(12)).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
});

describe('templates', () => {
  it('renders known vars and leaves unknown ones', () => {
    expect(renderTemplate('Hi {customer_name}, job {job_ref} {nope}', { customer_name: 'Wanjiku', job_ref: 'DR-1' })).toBe('Hi Wanjiku, job DR-1 {nope}');
  });
  it('validates', () => {
    expect(validateTemplate('Pay {amount} for {job_ref}')).toEqual({ ok: true });
    expect(validateTemplate('Your {passcode} {foo}')).toEqual({ ok: false, unknown: ['passcode', 'foo'], forbidden: ['passcode'] });
  });
});

describe('time', () => {
  it('quiet hours wrap midnight in Nairobi time', () => {
    expect(inQuietHours(new Date('2026-09-25T19:30:00Z'), '21:00', '07:00')).toBe(true); // 22:30 EAT
    expect(inQuietHours(new Date('2026-09-25T03:59:00Z'), '21:00', '07:00')).toBe(true); // 06:59 EAT
    expect(inQuietHours(new Date('2026-09-25T04:00:00Z'), '21:00', '07:00')).toBe(false); // 07:00 EAT
    expect(quietHoursRelease(new Date('2026-09-25T19:30:00Z'), '21:00', '07:00').toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });

  it('builds delivery slots within opening hours after the lead time', () => {
    const hours = { fri: { open: '09:00', close: '17:00' } };
    const slots = deliverySlots('2026-09-25', hours, new Date('2026-09-25T08:30:00Z')); // 11:30 EAT
    expect(slots.map((s) => s.label)).toEqual(['13:00–15:00', '15:00–17:00']);
    expect(deliverySlots('2026-09-26', hours)).toEqual([]);
  });
});

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('Correct-Horse-9');
    expect(await verifyPassword('Correct-Horse-9', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', null)).toBe(false);
  });
  it('checks strength', () => {
    expect(passwordProblems('short')).toContain('min_length');
    expect(passwordProblems('Password12345')).toContain('common');
    expect(passwordProblems('Tuma-Boda-2026x')).toEqual([]);
  });
});

describe('totp', () => {
  it('matches RFC 4226 test vectors', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect([0, 1, 2, 3].map((c) => hotp(secret, c))).toEqual(['755224', '287082', '359152', '969429']);
  });
  it('verifies within one step of drift', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90000), now)).toBe(false);
  });
});
