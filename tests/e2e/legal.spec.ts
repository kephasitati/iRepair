import { expect, test } from '@playwright/test';
import { sql } from './support';

test.use({ viewport: { width: 360, height: 760 } });

test('cookie banner records consent and legal pages name the courier', async ({ page, context }) => {
  await page.goto('/');
  const banner = page.getByTestId('cookie-banner');
  await expect(banner).toBeVisible();

  const before = Number((await sql`select count(*)::int as n from cookie_consents`)[0].n);
  await page.getByTestId('cookie-essential').click();
  await expect(banner).toBeHidden();
  await expect.poll(async () => Number((await sql`select count(*)::int as n from cookie_consents`)[0].n)).toBe(before + 1);
  const [row] = await sql`select analytics, marketing, ip_hash, policy_version from cookie_consents order by id desc limit 1`;
  expect(row).toMatchObject({ analytics: false, marketing: false });
  expect(row.ip_hash === null || /^[0-9a-f]{64}$/.test(row.ip_hash)).toBe(true);
  expect((await context.cookies()).some((c) => c.name === 'rd_consent')).toBe(true);

  // Choice persists; settings can be reopened from the footer.
  await page.reload();
  await expect(banner).toBeHidden();
  await page.getByRole('button', { name: 'Cookie settings' }).first().click();
  await expect(banner).toBeVisible();

  await page.goto('/terms');
  await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Pickup and return by TumaBoda/ })).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy policy' })).toBeVisible();
  await expect(page.locator('#cookies')).toContainText('rd_session');
});

test('landing shows the launch line-up: iPhone, MacBook, iPad, iMac, Android, Windows laptop', async ({ page }) => {
  await page.goto('/');
  for (const d of ['iphone', 'macbook', 'ipad', 'imac', 'android', 'windows_laptop']) await expect(page.getByTestId(`landing-device-${d}`)).toBeVisible();
  await expect(page.getByTestId('landing-device-other')).toHaveCount(0);
});

test('per-device SEO pages, robots, sitemap and llms.txt are served', async ({ page, request }) => {
  await page.goto('/repairs/android');
  await expect(page.getByRole('heading', { name: 'Android phone repair, at your door' })).toBeVisible();
  await expect(page).toHaveTitle(/Android phone repair/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(3);

  // Node (unlike the browser) doesn't resolve the *.localhost tenant subdomain, so hit localhost directly
  // and set the Host header the app actually reads for tenant resolution.
  const port = new URL(page.url()).port;
  const origin = `http://localhost:${port}`;
  const tenantGet = (path: string) => request.get(`${origin}${path}`, { headers: { host: `demo.localhost:${port}` } });

  // "other" is a valid device type but not in this shop's enabled line-up, so it 404s rather than rendering.
  const otherDevice = await tenantGet('/repairs/other');
  expect(otherDevice.status()).toBe(404);

  const robots = await tenantGet('/robots.txt');
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toContain('Sitemap:');

  const sitemap = await tenantGet('/sitemap.xml');
  expect(sitemap.ok()).toBe(true);
  const sitemapBody = await sitemap.text();
  expect(sitemapBody).toContain('/repairs/iphone');
  expect(sitemapBody).toContain('/repairs/windows_laptop');

  const llms = await tenantGet('/llms.txt');
  expect(llms.ok()).toBe(true);
  expect(await llms.text()).toContain('# iRepair');
});
