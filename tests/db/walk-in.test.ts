import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asService, asUser, closeAll, resetDb, seedBasics, seedDraftJob, status, transition, type Seed } from "./helpers";

/** Pins the database side of walk-ins (migration 0024, DECISIONS D-42). */
let s: Seed;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeAll);

/** A walk-in as the counter form leaves it: a draft with no pickup, the consultation fee as its only charge. */
async function walkInDraft(opts: { identifier?: string | null; feeCents?: number } = {}) {
  const fee = opts.feeCents ?? 50_000;
  return asService(async (tx) => {
    const [{ ref }] = await tx`select next_job_ref(${s.tenantA}) as ref`;
    const [j] = await tx`insert into jobs (tenant_id, ref, customer_user_id, origin, device_type, device_brand, device_model, fault_description,
        consultation_fee_cents, pickup_fee_cents)
      values (${s.tenantA}, ${ref}, ${s.customer1}, 'walk_in', 'iphone', 'Apple', 'iPhone 12', 'Screen flickers', ${fee}, ${fee}) returning id`;
    await tx`insert into job_secrets (job_id, tenant_id, identifier, identifier_kind)
      values (${j.id}, ${s.tenantA}, ${opts.identifier === undefined ? "490154203237518" : opts.identifier}, 'imei')`;
    return j.id as string;
  });
}

async function completeIntakeRow(jobId: string) {
  await asService(
    (tx) =>
      tx`insert into intake_checklists (job_id, tenant_id, summary, completed_by) values (${jobId}, ${s.tenantA}, 'Screen flickers as described', ${s.techA})`,
  );
}

async function payCash(jobId: string, purpose: string, amountCents: number) {
  return asService(async (tx) => {
    const ref = `cash:${jobId}:${purpose}:${Math.random()}`;
    await tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, status, method, recorded_by)
      values (${s.tenantA}, ${jobId}, ${purpose}::payment_purpose, ${amountCents}, '+254722000001', ${ref}, ${ref + ":cb"}, ${ref}, 'pending', 'cash', ${s.adminA})`;
    const [p] = await tx`select * from confirm_payment(${ref}, 0, 'Cash received at the counter', null, ${amountCents}, null)`;
    return p;
  });
}

const notificationsFor = (jobId: string) =>
  asService((tx) => tx`select event_key, channel from notifications where job_id = ${jobId} and user_id = ${s.customer1} order by id`);

describe("only a walk-in starts at the shop", () => {
  it("an online draft cannot skip the pickup", async () => {
    const online = await seedDraftJob(s.tenantA, s.customer1);
    await expect(transition(online, "received_at_shop", "technician", s.techA)).rejects.toThrow(/only a walk-in starts at the shop/);
  });

  it("a walk-in needs an IMEI/serial or the customer's ID with a photo", async () => {
    const job = await walkInDraft({ identifier: null });
    await expect(transition(job, "received_at_shop", "technician", s.techA)).rejects.toThrow(/IMEI\/serial, or the customer's ID/);
    await asService(
      (tx) => tx`insert into customer_ids (tenant_id, user_id, kind, number_enc, key_version, last4, photo_path)
      values (${s.tenantA}, ${s.customer1}, 'national_id', 'enc', 1, '5678', 'k/id.jpg')`,
    );
    await transition(job, "received_at_shop", "technician", s.techA);
    expect(await status(job)).toBe("received_at_shop");
    await asService((tx) => tx`delete from customer_ids where tenant_id = ${s.tenantA} and user_id = ${s.customer1}`);
  });

  it("the customer gets the consent SMS, not the usual 'we received your device'", async () => {
    const job = await walkInDraft();
    await transition(job, "received_at_shop", "technician", s.techA);
    const sent = (await notificationsFor(job)).map((n) => `${n.event_key}/${n.channel}`);
    expect(sent).toContain("walkin.received/sms");
    expect(sent.some((k) => k.startsWith("job.received_at_shop"))).toBe(false);
  });
});

describe("diagnosis waits for consent, then for the consultation fee", () => {
  it("walks the gate in order", async () => {
    const job = await walkInDraft();
    await transition(job, "received_at_shop", "shop_admin", s.adminA);
    await completeIntakeRow(job);

    await expect(transition(job, "diagnosing", "technician", s.techA)).rejects.toThrow(/not accepted the repair terms/);

    const accept = (userId: string) =>
      asUser({ userId, tenantId: s.tenantA, authMethod: "otp" }, async (tx) => (await tx`select accept_walk_in_terms(${job}, 'v1') as fresh`)[0].fresh);
    await expect(accept(s.customer2)).rejects.toMatchObject({ code: "42501" });
    expect(await accept(s.customer1)).toBe(true);
    expect(await accept(s.customer1)).toBe(false); // idempotent

    await expect(transition(job, "diagnosing", "technician", s.techA)).rejects.toThrow(/consultation fee has not been paid/);

    const payment = await payCash(job, "pickup_fee", 50_000);
    expect(payment).toMatchObject({ status: "success", method: "cash" });
    expect((await notificationsFor(job)).map((n) => n.event_key)).toContain("payment.received_cash");

    await transition(job, "diagnosing", "technician", s.techA);
    expect(await status(job)).toBe("diagnosing");
  });

  it("an online job's diagnosis is not affected", async () => {
    const online = await seedDraftJob(s.tenantA, s.customer1, { status: "received_at_shop" });
    await completeIntakeRow(online);
    await transition(online, "diagnosing", "technician", s.techA);
    expect(await status(online)).toBe("diagnosing");
  });
});

describe("cash is always attributed", () => {
  it("a cash row must name who recorded it and carries no M-Pesa receipt", async () => {
    const job = await walkInDraft();
    const insert = (recordedBy: string | null, receipt: string | null) =>
      asService(
        (
          tx,
        ) => tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, method, recorded_by, mpesa_receipt)
          values (${s.tenantA}, ${job}, 'pickup_fee', 50000, '+254722000001', ${String(Math.random())}, ${String(Math.random())}, 'cash', ${recordedBy}, ${receipt})`,
      );
    await expect(insert(null, null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert(s.adminA, "QAB123")).rejects.toMatchObject({ code: "23514" });
    await insert(s.adminA, null);
  });
});
