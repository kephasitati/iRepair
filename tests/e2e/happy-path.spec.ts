import { expect, test } from '@playwright/test';
import { activeDeliveryId, addPhoto, customerLogin, jobStatus, mock, payWithSimulator, presetConsent, sql, staffLogin, tick } from './support';

/**
 * The critical customer journey, end to end, on a 360 px phone:
 * book -> pay pickup fee -> hand over at the door (QR) -> received at the bench (QR) -> intake -> quote ->
 * counter-offer -> technician accepts -> deposit -> repair -> complete -> choose drop-off -> final balance ->
 * dispatch (QR) -> delivered (QR) -> rate -> closed, with the tax invoice issued.
 */
test.use({ viewport: { width: 360, height: 760 } });

test('customer happy path from booking to closed', async ({ browser, request }) => {
  const phone = `07${String(Date.now()).slice(-8)}`;
  const customerCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
  const techCtx = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 768, height: 1024 } });
  await presetConsent(customerCtx);
  await presetConsent(techCtx);
  const c = await customerCtx.newPage();
  const tech = await techCtx.newPage();

  // --- Booking ---------------------------------------------------------------------------------------
  await customerLogin(c, phone, 'Test Customer');
  await c.goto('/');
  await c.getByTestId('book-cta').click();
  await c.getByTestId('device-iphone').click();
  await c.getByLabel('Model').fill('iPhone 13');
  await c.getByLabel('What is wrong with it?').fill('Cracked screen after a fall, touch works.');
  await c.getByRole('button', { name: 'Next', exact: true }).click();
  await c.getByLabel('IMEI or serial number').fill('490154203237518');
  await c.getByRole('button', { name: 'Next', exact: true }).click();

  await addPhoto(c, 'Front *');
  await addPhoto(c, 'Back *');
  await addPhoto(c, 'Screen on *');
  await expect(c.getByTestId('photos-next')).toBeEnabled({ timeout: 30_000 });
  await c.getByTestId('photos-next').click();

  await c.getByLabel('Pickup address').fill('Kenyatta Avenue, Nairobi CBD');
  await c.getByLabel('Area').selectOption('CBD');
  await c.getByLabel('Building, floor, apartment').fill('I&M Tower, 5th floor');
  await c.getByRole('button', { name: 'Next', exact: true }).click();

  await c.getByTestId('agree').check();
  await c.getByTestId('submit-booking').click();
  await c.waitForURL(/\/jobs\/[0-9a-f-]+/);
  const ref = (await c.locator('p', { hasText: /^DR-\d{2}-\d{5}$/ }).first().textContent())!.trim();
  expect(await jobStatus(ref)).toBe('pickup_fee_pending');

  // --- Pickup fee ------------------------------------------------------------------------------------
  await payWithSimulator(c);
  await expect.poll(() => jobStatus(ref)).toBe('pickup_requested');
  await tick(request, 2); // books the courier via the outbox
  const pickupId = await activeDeliveryId(ref, 'pickup');

  // --- Handover at the door: customer scans the rider's QR (manual entry path) ------------------------
  await c.reload();
  await c.getByPlaceholder(/enter the rider/i).fill('RDMOCK:wrong:payload');
  await c.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(c.getByText('does not belong to the rider')).toBeVisible();
  await c.getByPlaceholder(/enter the rider/i).fill(mock.qrPayload(pickupId));
  await c.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => jobStatus(ref)).toBe('in_transit_to_shop');
  const [handover] = await sql`select method, verified, array_length(photo_ids, 1) as photos from handover_events h join jobs j on j.id = h.job_id where j.ref = ${ref} and h.point = 'customer_to_rider' and h.verified`;
  expect(handover).toMatchObject({ method: 'qr', verified: true, photos: 3 });

  // --- Technician receives and does intake ----------------------------------------------------------
  await staffLogin(tech, 'tech1@demo.test');
  await tech.goto('/bench/scan');
  await tech.getByPlaceholder('Enter code manually').fill(mock.qrPayload(pickupId));
  await tech.getByRole('button', { name: 'OK', exact: true }).click();
  await tech.getByTestId('intake-form').waitFor();
  expect(await jobStatus(ref)).toBe('received_at_shop');
  await tech.getByTestId('intake-identifier').fill('490154203237518');
  await addPhoto(tech, 'Front *');
  await addPhoto(tech, 'Back *');
  await tech.getByTestId('intake-summary').fill('Screen cracked as declared. Body in good condition.');
  await expect(tech.getByTestId('complete-intake')).toBeEnabled({ timeout: 30_000 });
  await tech.getByTestId('complete-intake').click();
  await expect.poll(() => jobStatus(ref)).toBe('diagnosing');

  // --- Quote ------------------------------------------------------------------------------------------
  await tech.reload();
  const opt = tech.getByTestId('catalogue-select').locator('option', { hasText: 'iPhone 13 screen replacement' });
  await tech.getByTestId('catalogue-select').selectOption({ label: (await opt.textContent())! });
  await tech.getByTestId('catalogue-add').click();
  await tech.getByTestId('send-quote').click();
  await expect.poll(() => jobStatus(ref)).toBe('quote_sent');

  // --- Customer counters, technician accepts -----------------------------------------------------------
  await c.reload();
  await c.getByTestId('counter-quote').click();
  await c.getByLabel('Your offer (total, KES)').fill('13500');
  await c.getByTestId('send-counter').click();
  await expect.poll(() => jobStatus(ref)).toBe('quote_negotiating');
  await tech.reload();
  await tech.getByTestId('accept-counter').click();
  await expect.poll(() => jobStatus(ref)).toBe('deposit_pending');
  const [q] = await sql`select q.accepted_total_cents, v.deposit_cents from quotes q join quote_versions v on v.id = q.accepted_version_id join jobs j on j.id = q.job_id where j.ref = ${ref}`;
  expect(Number(q.accepted_total_cents)).toBe(1_350_000);
  expect(Number(q.deposit_cents)).toBe(675_000);

  // --- Deposit ------------------------------------------------------------------------------------------
  await c.reload();
  await payWithSimulator(c);
  await expect.poll(() => jobStatus(ref)).toBe('in_repair');

  // --- Repair complete ----------------------------------------------------------------------------------
  await tech.reload();
  for (const k of ['powers_on', 'display', 'cameras', 'audio', 'buttons', 'connectivity', 'battery', 'cosmetic']) await tech.getByTestId(`test-${k}`).check();
  await addPhoto(tech, 'After · front *');
  await expect(tech.getByTestId('complete-repair')).toBeEnabled({ timeout: 30_000 });
  await tech.getByTestId('complete-repair').click();
  await expect.poll(() => jobStatus(ref)).toBe('repair_complete');

  // --- Drop-off and final balance -----------------------------------------------------------------------
  await c.reload();
  await c.getByTestId('dropoff-save').click();
  await expect.poll(() => jobStatus(ref)).toBe('final_payment_pending');
  await c.reload();
  await expect(c.getByTestId('invoice-summary')).toContainText('Consultation fee credited to repair');
  const [inv] = await sql`select total_cents, paid_cents, balance_cents from invoices i join jobs j on j.id = i.job_id where j.ref = ${ref} and i.status = 'proforma'`;
  expect(Number(inv.balance_cents)).toBe(Number(inv.total_cents) - Number(inv.paid_cents));
  await payWithSimulator(c);
  await expect.poll(() => jobStatus(ref)).toBe('return_requested');
  const [issued] = await sql`select number, balance_cents from invoices i join jobs j on j.id = i.job_id where j.ref = ${ref} and i.status = 'issued'`;
  expect(issued.number).toMatch(/^INV-\d{4}-\d{6}$/);
  expect(Number(issued.balance_cents)).toBe(0);

  // --- Dispatch: technician hands to the return rider ---------------------------------------------------
  await tick(request, 2);
  const returnId = await activeDeliveryId(ref, 'return');
  await tech.reload();
  await tech.getByPlaceholder(/enter the rider/i).fill(mock.qrPayload(returnId));
  await tech.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => jobStatus(ref)).toBe('in_transit_to_customer');

  // --- Delivery: customer scans the rider's QR, confirms and rates -----------------------------------------
  await c.reload();
  await c.getByPlaceholder(/enter the rider/i).fill(String(mock.otp(returnId)));
  await c.getByRole('button', { name: 'OK', exact: true }).click();
  await expect.poll(() => jobStatus(ref)).toBe('delivered');
  await c.reload();
  await c.getByTestId('star-5').click();
  await c.getByTestId('confirm-delivered').click();
  await expect.poll(() => jobStatus(ref)).toBe('closed');

  // --- Invariants at the end -------------------------------------------------------------------------------
  const [final] = await sql`select j.warranty_until, s.passcode_enc, (select score from ratings r where r.job_id = j.id) as score,
      (select count(*) from job_events e where e.job_id = j.id and e.event_kind = 'transition')::int as transitions
    from jobs j join job_secrets s on s.job_id = j.id where j.ref = ${ref}`;
  expect(final.warranty_until).not.toBeNull();
  expect(final.passcode_enc).toBeNull();
  expect(final.score).toBe(5);
  expect(final.transitions).toBeGreaterThanOrEqual(19);
  await tick(request); // renders the invoice PDF
  const invoiceId = (await sql`select i.id from invoices i join jobs j on j.id = i.job_id where j.ref = ${ref} and i.status = 'issued'`)[0].id;
  // Fetch from inside the page: the session cookie is bound to demo.localhost, which Node itself cannot resolve.
  const contentType = await c.evaluate(async (url) => (await fetch(url)).headers.get('content-type'), `/api/invoices/${invoiceId}/pdf`);
  expect(contentType).toBe('application/pdf');

  await customerCtx.close();
  await techCtx.close();
});
