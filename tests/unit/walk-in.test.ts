import { describe, expect, it } from "vitest";
import { canTransition } from "@/lib/core/state-machine";
import { paidCentsFor, walkInGate } from "@/lib/core/walk-in";
import { nextStep } from "@/lib/core/workflow";

const walkIn = { origin: "walk_in" as const, terms_accepted_at: null as string | null, pickup_fee_cents: 50_000 };
const paid = (amount_cents: number, status = "success", purpose = "pickup_fee") => ({ purpose, status, amount_cents });

describe("a walk-in is diagnosed only after consent and the consultation fee", () => {
  it("an online booking has no walk-in gate", () => {
    expect(walkInGate({ ...walkIn, origin: "online" }, [])).toBeNull();
  });

  it("waits for the terms, then for the fee", () => {
    expect(walkInGate(walkIn, [])).toEqual({ termsAccepted: false, feeDueCents: 50_000, ready: false });
    const accepted = { ...walkIn, terms_accepted_at: "2026-09-29T10:00:00Z" };
    expect(walkInGate(accepted, [paid(20_000), paid(30_000, "failed")])).toEqual({ termsAccepted: true, feeDueCents: 30_000, ready: false });
    expect(walkInGate(accepted, [paid(50_000)])).toEqual({ termsAccepted: true, feeDueCents: 0, ready: true });
  });

  it("a free consultation needs consent only", () => {
    expect(walkInGate({ ...walkIn, pickup_fee_cents: 0, terms_accepted_at: "2026-09-29T10:00:00Z" }, [])?.ready).toBe(true);
  });

  it("counts only successful payments for the purpose", () => {
    expect(paidCentsFor([paid(100), paid(200, "pending"), paid(400, "success", "deposit")], "pickup_fee")).toBe(100);
  });

  it("the bench says whose move it is", () => {
    expect(nextStep("received_at_shop", walkInGate(walkIn, [])).who).toBe("customer");
    expect(nextStep("received_at_shop", walkInGate({ ...walkIn, terms_accepted_at: "x" }, [])).who).toBe("shop");
    expect(nextStep("received_at_shop", null).text).toMatch(/intake/i);
  });
});

describe("only staff open a job at the counter", () => {
  it("draft -> received_at_shop is for technicians and above", () => {
    expect(canTransition("draft", "received_at_shop", "technician")).toBe(true);
    expect(canTransition("draft", "received_at_shop", "shop_admin")).toBe(true);
    expect(canTransition("draft", "received_at_shop", "platform_admin")).toBe(true);
    expect(canTransition("draft", "received_at_shop", "customer")).toBe(false);
    expect(canTransition("draft", "received_at_shop", "system")).toBe(false);
  });
});
