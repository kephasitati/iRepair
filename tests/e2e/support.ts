import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { COOKIE_POLICY_VERSION } from '../../lib/legal';
import { MockProvider } from '../../lib/providers/delivery/mock';

// Load .env for secrets shared with the dev server (mock courier secret, cron secret).
const envFile = path.join(__dirname, '..', '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '');
  }
}

export const sql = postgres(process.env.DATABASE_SERVICE_URL ?? 'postgres://repairdesk_service:service_dev_password@localhost:55432/repairdesk', { max: 2, idle_timeout: 2, onnotice: () => {} }); // shared by every spec in the worker; closes itself when idle
export const mock = new MockProvider(process.env.MOCK_PROVIDER_SECRET!, Number(process.env.MOCK_DELAY_SECONDS ?? 20));
export const OTP = process.env.OTP_DEV_CODE ?? '123456';

/** A tiny valid PNG (4x4, grey) used as every camera photo. */
export const PHOTO = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEklEQVR4nGNgYGD4z8DAwMDAAAAQBAEAk1XP+wAAAABJRU5ErkJggg==', 'base64'),
};

/** Drive the background worker (outbox, notifications, timers, courier polling). */
export async function tick(request: APIRequestContext, times = 1) {
  for (let i = 0; i < times; i++) {
    // Node cannot resolve *.localhost like browsers do; the tick endpoint does not depend on the host.
    const r = await request.post(`http://localhost:${process.env.E2E_PORT ?? 3100}/api/internal/tick`, { headers: { authorization: `Bearer ${process.env.INTERNAL_CRON_SECRET}` } });
    if (!r.ok()) throw new Error(`tick failed: ${r.status()}`);
  }
}

export async function jobStatus(ref: string): Promise<string> {
  const [r] = await sql`select status from jobs where ref = ${ref}`;
  return r?.status;
}

export async function activeDeliveryId(ref: string, leg: 'pickup' | 'return'): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const [d] = await sql`select d.provider_delivery_id from deliveries d join jobs j on j.id = d.job_id
      where j.ref = ${ref} and d.leg = ${leg} and d.provider_delivery_id is not null and d.status not in ('cancelled', 'quoted') order by d.created_at desc limit 1`;
    if (d?.provider_delivery_id) return d.provider_delivery_id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no ${leg} delivery for ${ref}`);
}

/** Attach a photo to a PhotoCapture slot (the slot button opens a hidden file input). */
export async function addPhoto(page: Page, slotLabel: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: slotLabel, exact: true }).first().click();
  await (await chooser).setFiles(PHOTO);
}

export async function customerLogin(page: Page, phone: string, name: string) {
  await page.goto('/login');
  await page.getByLabel('Phone number').fill(phone);
  await page.getByRole('button', { name: 'Send code' }).click();
  await page.getByLabel('6-digit code').fill(OTP);
  await page.getByLabel('What should we call you?').fill(name);
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL('**/jobs');
}

export async function staffLogin(page: Page, email: string) {
  await page.goto('/staff/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('DemoRepairs2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/bench');
}

/** Pre-accept "essential only" cookies so the consent banner does not cover the page under test. */
export async function presetConsent(ctx: BrowserContext) {
  const value = encodeURIComponent(JSON.stringify({ v: COOKIE_POLICY_VERSION, analytics: false, marketing: false, at: new Date().toISOString() }));
  await ctx.addCookies([{ name: 'rd_consent', value, domain: 'demo.localhost', path: '/' }]);
}

/** Pay through the M-Pesa simulator on the customer's job page. */
export async function payWithSimulator(page: Page) {
  await page.getByTestId('pay-button').click();
  await page.getByTestId('simulate-success').click();
  await page.getByTestId('payment-success').first().waitFor();
}
