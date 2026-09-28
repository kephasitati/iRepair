import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNotifications, claimOutbox } from "@/worker/tasks";
import { closeAll, resetDb, seedBasics, service, type Seed } from "./helpers";

/**
 * Two workers (the resident one and /api/internal/tick) run side by side. A claimed row must not be claimable again
 * while it runs: before the lease, both could book the same courier leg, and the second one hung on the first's lock.
 */
let s: Seed;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeAll);

describe("a claimed job is not handed to a second worker", () => {
  it("outbox: the second claim gets nothing, and the row comes back once the lease lapses", async () => {
    const [row] = await service`insert into outbox (tenant_id, kind, payload) values (${s.tenantA}, 'invoice.pdf', '{}') returning id`;
    const first = await claimOutbox(service, 10);
    expect(first.map((r) => r.id)).toEqual([row.id]);
    expect(await claimOutbox(service, 10)).toHaveLength(0);

    await service`update outbox set next_attempt_at = now() - interval '1 second' where id = ${row.id}`; // lease lapsed (worker died)
    const retried = await claimOutbox(service, 10);
    expect(retried.map((r) => [r.id, r.attempts])).toEqual([[row.id, 2]]);
  });

  it("notifications: one SMS is claimed once", async () => {
    await service`insert into notifications (tenant_id, user_id, channel, event_key, body, phone_e164) values (${s.tenantA}, ${s.customer1}, 'sms', 'x', 'hello', '+254722000001')`;
    expect(await claimNotifications(service, 10)).toHaveLength(1);
    expect(await claimNotifications(service, 10)).toHaveLength(0);
  });
});
