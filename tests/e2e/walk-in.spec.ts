import { expect, test } from "@playwright/test";
import { addPhoto, customerLogin, jobStatus, presetConsent, sql, staffLogin } from "./support";

/**
 * A walk-in, end to end (DECISIONS D-42): a technician opens the job at the counter, the customer opens the SMS link on
 * their phone and accepts the terms, a shop admin records the consultation fee in cash, and intake leads to diagnosis.
 */
test("walk-in: counter intake, SMS consent, cash fee, diagnosis", async ({ browser }) => {
  const phone = `07${String(Date.now()).slice(-8)}`;
  const baseURL = test.info().project.use.baseURL;
  const techCtx = await browser.newContext({ baseURL, viewport: { width: 768, height: 1024 } });
  const customerCtx = await browser.newContext({ baseURL, viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  const adminCtx = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  for (const ctx of [techCtx, customerCtx, adminCtx]) await presetConsent(ctx);
  const tech = await techCtx.newPage();
  const c = await customerCtx.newPage();
  const admin = await adminCtx.newPage();

  // --- The technician opens the job at the counter ------------------------------------------------------
  await staffLogin(tech, "tech1@demo.test");
  await tech.getByTestId("new-walk-in").click();
  await tech.getByLabel("Phone number").fill(phone);
  await tech.getByLabel("Name").fill("Walk In Customer");
  await tech.getByLabel("Type").selectOption("iphone");
  await tech.getByLabel("Brand").fill("Apple");
  await tech.getByLabel("Model").fill("iPhone 12");
  await tech.getByLabel("What is wrong with it?").fill("Battery drains in two hours.");
  await tech.getByLabel("IMEI / serial").fill("490154203237518");
  await tech.getByTestId("walk-in-submit").click();
  await tech.waitForURL(/\/bench\/jobs\/[0-9a-f-]+/);
  const jobId = tech.url().split("/").at(-1)!;
  const [{ ref, origin }] = await sql`select ref, origin from jobs where id = ${jobId}`;
  expect(origin).toBe("walk_in");
  expect(await jobStatus(ref)).toBe("received_at_shop");
  await expect(tech.getByTestId("walk-in-gate")).toContainText("The customer accepts the repair terms");
  await expect(tech.getByTestId("intake-form")).toHaveCount(0);

  // --- The customer opens the SMS link on their phone and accepts the terms -----------------------------
  const [sms] = await sql`select body from notifications where job_id = ${jobId} and event_key = 'walkin.received' and channel = 'sms'`;
  const link = new URL(/https?:\/\/\S+/.exec(sms.body)![0]);
  await customerLogin(c, phone, "Walk In Customer");
  await c.goto(link.pathname);
  await c.waitForURL(`**/jobs/${jobId}`);
  await c.getByTestId("walk-in-agree").check();
  await c.getByTestId("walk-in-accept").click();
  await expect(c.getByTestId("walk-in-consent")).toHaveCount(0);
  await expect(c.getByTestId("pay-button")).toBeVisible();
  const [{ terms_accepted_at }] = await sql`select terms_accepted_at from jobs where id = ${jobId}`;
  expect(terms_accepted_at).not.toBeNull();

  // --- A shop admin takes the consultation fee in cash -------------------------------------------------
  await staffLogin(admin, "admin@demo.test");
  await admin.goto(`/bench/jobs/${jobId}`);
  await admin.getByTestId("record-cash").click();
  await admin.getByTestId("confirm-cash").click();
  await expect(admin.getByTestId("intake-form")).toBeVisible({ timeout: 20_000 });
  const [cash] = await sql`select p.method, p.status, u.email from payments p join users u on u.id = p.recorded_by where p.job_id = ${jobId}`;
  expect(cash).toMatchObject({ method: "cash", status: "success", email: "admin@demo.test" });

  // --- Intake, then diagnosis --------------------------------------------------------------------------
  await tech.reload();
  await tech.getByTestId("intake-identifier").fill("490154203237518");
  await addPhoto(tech, "Front *");
  await addPhoto(tech, "Back *");
  await tech.getByTestId("intake-summary").fill("Battery health 71%. Body in good condition.");
  await expect(tech.getByTestId("complete-intake")).toBeEnabled({ timeout: 30_000 });
  await tech.getByTestId("complete-intake").click();
  await expect.poll(() => jobStatus(ref)).toBe("diagnosing");

  // The customer sees the cash payment on their job.
  await c.reload();
  await expect(c.getByText("Paid in cash at the counter")).toBeVisible();

  for (const ctx of [techCtx, customerCtx, adminCtx]) await ctx.close();
});
