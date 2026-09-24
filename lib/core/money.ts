/**
 * Money is integer KES cents everywhere. M-Pesa only accepts whole shillings, so every amount a customer
 * is asked to pay is a multiple of 100 cents. VAT rates are basis points (1600 = 16 %).
 */

export type Cents = number;

export const CENTS_PER_KES = 100;

export function kesToCents(kes: number): Cents {
  return Math.round(kes * CENTS_PER_KES);
}

export function centsToKes(cents: Cents): number {
  return cents / CENTS_PER_KES;
}

/** Round half up to the whole shilling. */
export function roundShilling(cents: Cents): Cents {
  return Math.floor((cents + 50) / 100) * 100;
}

export function ceilShilling(cents: Cents): Cents {
  return Math.ceil(cents / 100) * 100;
}

export function isWholeShilling(cents: Cents): boolean {
  return Number.isInteger(cents) && cents % 100 === 0;
}

export function formatKes(cents: Cents, opts: { withSymbol?: boolean } = {}): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = whole.toLocaleString('en-KE') + (frac ? '.' + String(frac).padStart(2, '0') : '');
  return `${negative ? '-' : ''}${opts.withSymbol === false ? '' : 'KES '}${body}`;
}

/** VAT contained in a VAT-inclusive gross amount. */
export function vatFromInclusive(grossCents: Cents, rateBp: number): Cents {
  if (rateBp <= 0) return 0;
  return Math.round((grossCents * rateBp) / (10000 + rateBp));
}

export function vatOnExclusive(netCents: Cents, rateBp: number): Cents {
  if (rateBp <= 0) return 0;
  return Math.round((netCents * rateBp) / 10000);
}

/** Courier cost plus the tenant's markup, rounded up to the shilling. */
export function deliveryCharge(costCents: Cents, markupBp: number): { charged: Cents; markup: Cents } {
  const charged = ceilShilling(Math.round(costCents * (1 + markupBp / 10000)));
  return { charged, markup: charged - costCents };
}

export type DepositRule = { kind: 'percent'; value: number } | { kind: 'fixed'; value: Cents };

/** Deposit required for a quote. `percent.value` is basis points (5000 = 50 %). Never exceeds the total. */
export function depositFor(totalCents: Cents, rule: DepositRule, minQuoteCents = 0): Cents {
  if (totalCents <= 0 || totalCents < minQuoteCents) return 0;
  const raw = rule.kind === 'percent' ? roundShilling(Math.round((totalCents * rule.value) / 10000)) : rule.value;
  return Math.min(Math.max(raw, 0), totalCents);
}

export type TaxConfig = { vatRegistered: boolean; vatRateBp: number; pricesIncludeVat: boolean };

export type LineInput = { description: string; qty: number; unitPriceCents: Cents; vatable?: boolean };

export type Totals = {
  /** Net of VAT. */
  subtotalCents: Cents;
  vatCents: Cents;
  /** Amount before shilling rounding (only differs when prices exclude VAT). */
  roundingCents: Cents;
  totalCents: Cents;
};

export function lineTotal(line: Pick<LineInput, 'qty' | 'unitPriceCents'>): Cents {
  return line.qty * line.unitPriceCents;
}

/**
 * Totals for a set of lines. Lines with `vatable: false` (courier pass-through fees, which already carry the
 * courier's VAT) are added outside the VAT base. VAT is computed once over the whole vatable base.
 */
export function computeTotals(lines: LineInput[], tax: TaxConfig): Totals {
  const vatableSum = lines.filter((l) => l.vatable !== false).reduce((s, l) => s + lineTotal(l), 0);
  const nonVatableSum = lines.filter((l) => l.vatable === false).reduce((s, l) => s + lineTotal(l), 0);
  const rate = tax.vatRegistered ? tax.vatRateBp : 0;

  if (tax.pricesIncludeVat) {
    const vat = vatFromInclusive(vatableSum, rate);
    const gross = vatableSum + nonVatableSum;
    const total = roundShilling(gross);
    return { subtotalCents: gross - vat, vatCents: vat, roundingCents: total - gross, totalCents: total };
  }
  const vat = vatOnExclusive(vatableSum, rate);
  const gross = vatableSum + nonVatableSum + vat;
  const total = roundShilling(gross);
  return { subtotalCents: vatableSum + nonVatableSum, vatCents: vat, roundingCents: total - gross, totalCents: total };
}

export type InvoiceLine = {
  code: string;
  description: string;
  qty: number;
  unitPriceCents: Cents;
  totalCents: Cents;
  vatable: boolean;
};

export type InvoiceInput = {
  tax: TaxConfig;
  outcome: 'repaired' | 'declined' | 'cancelled';
  consultationFeeCents: Cents;
  consultationFeeCredited: boolean;
  pickupDelivery?: { costCents: Cents; chargedCents: Cents } | null;
  returnDelivery?: { costCents: Cents; chargedCents: Cents } | null;
  quoteLines: LineInput[];
  supplementaryLines: LineInput[];
  /** Adjustment from accepted counter-offers (negative = discount). */
  negotiatedAdjustmentCents?: Cents;
  paidCents: Cents;
};

export type InvoiceComputation = Totals & { lines: InvoiceLine[]; paidCents: Cents; balanceCents: Cents };

function deliveryLines(code: string, label: string, d: { costCents: Cents; chargedCents: Cents }): InvoiceLine[] {
  const out: InvoiceLine[] = [
    { code, description: `${label} (courier, incl. courier VAT)`, qty: 1, unitPriceCents: d.costCents, totalCents: d.costCents, vatable: false },
  ];
  const markup = d.chargedCents - d.costCents;
  if (markup > 0) {
    out.push({ code: `${code}_handling`, description: `${label} handling`, qty: 1, unitPriceCents: markup, totalCents: markup, vatable: true });
  }
  return out;
}

/** The single tax invoice for a job (DECISIONS D-15). */
export function composeInvoice(input: InvoiceInput): InvoiceComputation {
  const lines: InvoiceLine[] = [];
  const push = (code: string, l: LineInput) =>
    lines.push({ code, description: l.description, qty: l.qty, unitPriceCents: l.unitPriceCents, totalCents: lineTotal(l), vatable: l.vatable !== false });

  if (input.consultationFeeCents > 0) {
    push('consultation', { description: 'Consultation / diagnosis fee', qty: 1, unitPriceCents: input.consultationFeeCents });
  }
  if (input.pickupDelivery) lines.push(...deliveryLines('pickup_delivery', 'Pickup delivery', input.pickupDelivery));

  if (input.outcome === 'repaired') {
    input.quoteLines.forEach((l) => push('quote', l));
    input.supplementaryLines.forEach((l) => push('supplementary', l));
    if (input.negotiatedAdjustmentCents) {
      push('negotiated', { description: 'Agreed price adjustment', qty: 1, unitPriceCents: input.negotiatedAdjustmentCents });
    }
    if (input.consultationFeeCredited && input.consultationFeeCents > 0) {
      const repairValue =
        [...input.quoteLines, ...input.supplementaryLines].reduce((s, l) => s + lineTotal(l), 0) + (input.negotiatedAdjustmentCents ?? 0);
      const credit = Math.min(input.consultationFeeCents, Math.max(repairValue, 0));
      if (credit > 0) push('consultation_credit', { description: 'Consultation fee credited to repair', qty: 1, unitPriceCents: -credit });
    }
  }
  if (input.returnDelivery) lines.push(...deliveryLines('return_delivery', 'Return delivery', input.returnDelivery));

  const totals = computeTotals(
    lines.map((l) => ({ description: l.description, qty: l.qty, unitPriceCents: l.unitPriceCents, vatable: l.vatable })),
    input.tax,
  );
  return { ...totals, lines, paidCents: input.paidCents, balanceCents: totals.totalCents - input.paidCents };
}
