/**
 * Walk-ins (DECISIONS D-42): a job staff open at the counter with the device in hand. Before diagnosis the customer
 * must accept the repair terms (from the SMS link) and pay the consultation fee. The database enforces the same rule
 * (`check_walk_in_ready`); this pure version lets the bench, the customer's page and the tests agree on it.
 */

export type JobOrigin = "online" | "walk_in";

export type WalkInGate = { termsAccepted: boolean; feeDueCents: number; ready: boolean };

type GateJob = { origin: JobOrigin; terms_accepted_at: string | Date | null; pickup_fee_cents: number };
type GatePayment = { purpose: string; status: string; amount_cents: number };

/** Sum of successful payments for one purpose. */
export function paidCentsFor(payments: GatePayment[], purpose: string): number {
  return payments.filter((p) => p.purpose === purpose && p.status === "success").reduce((sum, p) => sum + p.amount_cents, 0);
}

/** Where a walk-in stands before diagnosis; null for an online booking. The consultation fee is its `pickup_fee`. */
export function walkInGate(job: GateJob, payments: GatePayment[]): WalkInGate | null {
  if (job.origin !== "walk_in") return null;
  const termsAccepted = !!job.terms_accepted_at;
  const feeDueCents = Math.max(job.pickup_fee_cents - paidCentsFor(payments, "pickup_fee"), 0);
  return { termsAccepted, feeDueCents, ready: termsAccepted && feeDueCents === 0 };
}

/** Payments a shop admin may take in cash at the counter. Supplementary quotes stay M-Pesa only. */
export const CASH_PURPOSES = ["pickup_fee", "deposit", "final_balance", "return_fee"] as const;
export type CashPurpose = (typeof CASH_PURPOSES)[number];
