/**
 * Set a shop's public details from the command line — the same fields as Admin → Settings (Branding / Contact /
 * Operations), for shops whose admin hasn't signed in yet. Only the flags you pass are changed.
 *
 *   npx tsx scripts/shop-settings.ts --slug primefix --phone +254703700600 --whatsapp +254703700600 \
 *     --email sales@example.com --address "Suite 8, ..., Nairobi" --landmark "Norwich Union" \
 *     --tagline "..." --about "..." --primary "#111111" --accent "#e3201b" --devices iphone,ipad,macbook,imac,android
 */
import './shim-server-only';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { withService } = await import('../lib/db');
  const { normalizeKenyanPhone } = await import('../lib/core/phone');
  const { DEVICE_TYPES } = await import('../lib/core/device-id');

  const slug = arg('slug')?.toLowerCase();
  if (!slug) {
    console.error('Usage: npx tsx scripts/shop-settings.ts --slug shop-slug [--phone] [--whatsapp] [--email] [--address] [--landmark] [--lat -1.28 --lng 36.82] [--tagline] [--about] [--primary] [--accent] [--devices a,b,c] [--shop-page on|off] [--instagram|--facebook|--tiktok|--x|--youtube|--website URL|none] [--instagram-posts url,url] [--google-place-id ID]');
    process.exit(1);
  }

  const settings: Record<string, unknown> = {};
  const branding: Record<string, unknown> = {};
  const phone = (flag: string) => {
    const raw = arg(flag);
    if (raw === undefined) return undefined;
    const n = normalizeKenyanPhone(raw);
    if (!n) throw new Error(`--${flag}: enter a valid Kenyan phone number.`);
    return n;
  };
  const hex = (flag: string) => {
    const v = arg(flag);
    if (v !== undefined && !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`--${flag}: use a 6-digit hex colour like #e3201b.`);
    return v;
  };

  const contactPhone = phone('phone');
  if (contactPhone) settings.contact_phone = contactPhone;
  const whatsapp = phone('whatsapp');
  if (whatsapp) settings.whatsapp_phone = whatsapp;
  if (arg('email') !== undefined) settings.contact_email = arg('email')!.toLowerCase();
  if (arg('address') !== undefined) settings.address_formatted = arg('address');
  if (arg('landmark') !== undefined) settings.address_landmark = arg('landmark');
  if (arg('lat') !== undefined || arg('lng') !== undefined) {
    const lat = Number(arg('lat'));
    const lng = Number(arg('lng'));
    if (!(Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180)) throw new Error('--lat and --lng must both be given as decimal degrees.');
    settings.address_lat = lat;
    settings.address_lng = lng;
  }
  if (arg('devices') !== undefined) {
    const devices = arg('devices')!.split(',').map((d) => d.trim()).filter(Boolean);
    const bad = devices.filter((d) => !(DEVICE_TYPES as readonly string[]).includes(d));
    if (bad.length || !devices.length) throw new Error(`--devices: choose from ${DEVICE_TYPES.join(', ')}.`);
    settings.device_types = devices;
  }
  if (arg('shop-page') !== undefined) settings.shop_page = arg('shop-page') === 'on';
  const socialKeys = ['instagram', 'facebook', 'tiktok', 'x', 'youtube', 'website'] as const;
  if (socialKeys.some((k) => arg(k) !== undefined)) {
    const { withService: ws } = await import('../lib/db');
    const [cur] = await ws((tx) => tx`select b.social_links from tenant_branding b join tenants t on t.id = b.tenant_id where t.slug = ${slug}`);
    const links: Record<string, string> = { ...(cur?.social_links ?? {}) };
    for (const k of socialKeys) {
      const v = arg(k);
      if (v === undefined) continue;
      if (v === '' || v === 'none') delete links[k];
      else if (!/^https:\/\/\S+$/.test(v)) throw new Error(`--${k}: must be an https:// link (or "none" to remove).`);
      else links[k] = v;
    }
    branding.social_links = links;
  }
  if (arg('instagram-posts') !== undefined) branding.instagram_posts = arg('instagram-posts')!.split(',').map((u) => u.trim()).filter(Boolean);
  if (arg('google-place-id') !== undefined) branding.google_place_id = arg('google-place-id') || null;
  if (arg('tagline') !== undefined) branding.tagline = arg('tagline');
  if (arg('about') !== undefined) branding.about = arg('about');
  const primary = hex('primary');
  if (primary) branding.primary_hex = primary;
  const accent = hex('accent');
  if (accent) branding.accent_hex = accent;

  if (!Object.keys(settings).length && !Object.keys(branding).length) throw new Error('Nothing to change — pass at least one flag.');

  await withService(async (tx) => {
    const [t] = await tx`select id from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    if (Object.keys(settings).length) await tx`update tenant_settings set ${tx(settings)} where tenant_id = ${t.id}`;
    if (branding.social_links) branding.social_links = tx.json(branding.social_links as never);
    if (Object.keys(branding).length) await tx`update tenant_branding set ${tx(branding)} where tenant_id = ${t.id}`;
  });
  console.log(`Updated "${slug}":`, { ...settings, ...branding });
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
