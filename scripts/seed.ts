/**
 * Demo data: npm run db:seed  (after npm run db:reset)
 *   Tenant "iRepair" at http://demo.localhost:3000
 *   Shop admin  admin@demo.test / DemoRepairs2026   Technicians tech1@demo.test, tech2@demo.test (same password)
 *   Customers   0700000001, 0700000002, 0700000003 (OTP = OTP_DEV_CODE, default 123456)
 *   Platform    root@platform.test / DemoRepairs2026 at http://localhost:3000/platform (TOTP secret printed below)
 *   Six jobs spread across the lifecycle.
 */
import './shim-server-only';
import { config } from 'node:process';
import postgres from 'postgres';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// Load .env without a dependency.
const envFile = path.join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/\s+#.*$/, '');
  }
}
void config;

async function main() {
  const { hashPassword } = await import('../lib/core/password');
  const { encrypt, generateDataKey, parseKey, wrapDataKey } = await import('../lib/core/crypto');
  const { generateTotpSecret, otpauthUrl } = await import('../lib/core/totp');
  const { putObject, ensureBucket } = await import('../lib/storage');
  await ensureBucket();
  const { MockProvider } = await import('../lib/providers/delivery/mock');

  const sql = postgres(process.env.DATABASE_SERVICE_URL ?? 'postgres://repairdesk_service:service_dev_password@localhost:55432/repairdesk', { max: 1, onnotice: () => {} });
  const master = parseKey(process.env.APP_MASTER_KEY!);
  const mock = new MockProvider(process.env.MOCK_PROVIDER_SECRET!, Number(process.env.MOCK_DELAY_SECONDS ?? 20));
  const password = await hashPassword('DemoRepairs2026');
  const root = process.env.PLATFORM_ROOT_DOMAIN ?? 'localhost:3000';

  const [existing] = await sql`select id from tenants where slug = 'demo'`;
  if (existing) {
    console.log('Demo tenant already exists. Run `npm run db:reset && npm run db:seed` to start over.');
    await sql.end();
    return;
  }

  await sql.begin(async (tx) => {
    await tx`select set_config('app.trusted', 'true', true)`;

    // ---------------------------------------------------------------- tenant
    const [t] = await tx`insert into tenants (slug, name) values ('demo', 'iRepair') returning id`;
    const tid: string = t.id;
    await tx`insert into tenant_domains (hostname, tenant_id, kind, is_primary, verified_at) values (${'demo.' + root}, ${tid}, 'subdomain', true, now())`;
    const logoKey = `t/${tid}/branding/logo.svg`;
    await putObject(logoKey, readFileSync(path.join(__dirname, '..', 'public', 'brand', 'irepair-logo.svg')), 'image/svg+xml');
    await tx`insert into tenant_branding (tenant_id, display_name, tagline, about, primary_hex, accent_hex, email_from_name, logo_path)
      values (${tid}, 'iRepair', 'Apple repairs, collected from your door.',
        'iRepair is an independent Apple device repair workshop in Nairobi CBD, trusted by other technicians with complex board-level jobs. We repair iPhone, MacBook, iPad and iMac, with doorstep pickup and return by TumaBoda and payment by M-Pesa.',
        '#0071e3', '#a855f7', 'iRepair', ${logoKey})`;
    await tx`insert into tenant_settings (tenant_id, contact_phone, contact_email, address_formatted, address_lat, address_lng, address_landmark, kra_pin, vat_registered,
        consultation_fee_cents, service_zones, publish_price_list, whatsapp_phone)
      values (${tid}, '+254700123456', 'hello@demorepairs.test', 'Kimathi House, Kimathi Street, Nairobi CBD', -1.28333, 36.82278, '3rd floor, room 305, opposite Nation Centre',
        'P051234567X', true, 50000,
        ${['CBD', 'Westlands', 'Kilimani', 'Upper Hill', 'Parklands', 'South B', 'South C', 'Lavington', 'Kileleshwa', 'Hurlingham', 'Ngara', 'Eastleigh']}, true, '+254700123456')`;
    await tx`insert into tenant_keys (tenant_id, wrapped_data_key) values (${tid}, ${wrapDataKey(generateDataKey(), master, tid)})`;
    await tx`insert into platform_fee_rules (tenant_id, kind, value) values (${tid}, 'percent', 300)`;

    // ---------------------------------------------------------------- people
    const user = async (u: { phone?: string; email?: string; name: string; pw?: boolean; pa?: boolean; totp?: string }) => {
      const [r] = await tx`insert into users (phone_e164, email, full_name, password_hash, is_platform_admin)
        values (${u.phone ?? null}, ${u.email ?? null}, ${u.name}, ${u.pw ? password : null}, ${u.pa ?? false}) returning id`;
      if (u.totp) await tx`update users set totp_secret_enc = ${encrypt(u.totp, master, `totp:${r.id}`)}, totp_enabled = true where id = ${r.id}`;
      return r.id as string;
    };
    const totpSecret = generateTotpSecret();
    const platformAdmin = await user({ email: 'root@platform.test', name: 'Platform Owner', pw: true, pa: true, totp: totpSecret });
    const admin = await user({ email: 'admin@demo.test', phone: '+254711000001', name: 'Joseph Kamau', pw: true });
    const tech1 = await user({ email: 'tech1@demo.test', phone: '+254711000002', name: 'Grace Achieng', pw: true });
    const tech2 = await user({ email: 'tech2@demo.test', phone: '+254711000003', name: 'Peter Njoroge', pw: true });
    const c1 = await user({ phone: '+254700000001', name: 'Wanjiku Mwangi' });
    const c2 = await user({ phone: '+254700000002', name: 'Brian Odhiambo' });
    const c3 = await user({ phone: '+254700000003', name: 'Amina Hassan' });
    await tx`insert into tenant_memberships (tenant_id, user_id, role) values (${tid}, ${admin}, 'shop_admin'), (${tid}, ${tech1}, 'technician'), (${tid}, ${tech2}, 'technician')`;

    const addr = (formatted: string, lat: number, lng: number, zone: string, landmark: string, building: string) => ({ formatted, lat, lng, zone, landmark, building_floor: building });
    const a1 = addr('Westlands Road, Westlands, Nairobi', -1.2655, 36.8025, 'Westlands', 'Next to Sarit Centre gate B', 'The Mirage, Tower 2, 7th floor');
    const a2 = addr('Argwings Kodhek Road, Kilimani, Nairobi', -1.2921, 36.7856, 'Kilimani', 'Opposite Yaya Centre', 'Blue Violet Apartments, B4');
    const a3 = addr('Mombasa Road, South C, Nairobi', -1.3197, 36.8269, 'South C', 'Behind Capital Centre', 'Muhoho Avenue, house 12');
    await tx`insert into addresses (user_id, label, formatted, lat, lng, zone, landmark, building_floor) values
      (${c1}, 'Office', ${a1.formatted}, ${a1.lat}, ${a1.lng}, ${a1.zone}, ${a1.landmark}, ${a1.building_floor}),
      (${c2}, 'Home', ${a2.formatted}, ${a2.lat}, ${a2.lng}, ${a2.zone}, ${a2.landmark}, ${a2.building_floor}),
      (${c3}, 'Home', ${a3.formatted}, ${a3.lat}, ${a3.lng}, ${a3.zone}, ${a3.landmark}, ${a3.building_floor})`;

    // ---------------------------------------------------------------- parts catalogue (KES, VAT inclusive)
    const parts: [string, string, string, number][] = [
      ['IP13-SCR', 'iPhone 13 screen replacement (OLED)', 'iphone', 14500],
      ['IP13P-SCR', 'iPhone 13 Pro screen replacement (OLED)', 'iphone', 21000],
      ['IP14-SCR', 'iPhone 14 screen replacement (OLED)', 'iphone', 17500],
      ['IP15P-SCR', 'iPhone 15 Pro screen replacement (OLED)', 'iphone', 32000],
      ['IP11-BAT', 'iPhone 11 battery replacement', 'iphone', 4500],
      ['IP13-BAT', 'iPhone 13 battery replacement', 'iphone', 6500],
      ['IP-BACK', 'iPhone back glass replacement (laser)', 'iphone', 6000],
      ['IP-PORT', 'iPhone charging port replacement', 'iphone', 4000],
      ['IP-FACEID', 'Face ID repair', 'iphone', 12000],
      ['MBA-M1-SCR', 'MacBook Air M1 display assembly', 'macbook', 38000],
      ['MBP-14-SCR', 'MacBook Pro 14" display assembly', 'macbook', 78000],
      ['MB-KBD', 'MacBook keyboard replacement', 'macbook', 16500],
      ['MB-BAT', 'MacBook battery replacement', 'macbook', 14000],
      ['MB-LIQ', 'MacBook liquid damage cleaning & board inspection', 'macbook', 7500],
      ['MB-BOARD', 'MacBook logic board repair (component level)', 'macbook', 25000],
      ['IPAD-GLASS', 'iPad digitiser glass replacement', 'ipad', 9500],
      ['IPAD-BAT', 'iPad battery replacement', 'ipad', 8500],
      ['IMAC24-SCR', 'iMac 24" display replacement', 'imac', 65000],
      ['IMAC-SSD', 'iMac SSD replacement / upgrade', 'imac', 18000],
      ['IMAC27-PSU', 'iMac 27" power supply repair', 'imac', 15000],
      ['AW-SCR', 'Apple Watch screen replacement', 'apple_watch', 14500],
      ['AW-BAT', 'Apple Watch battery replacement', 'apple_watch', 6500],
      ['IMAC-SVC', 'iMac cleaning and thermal service', 'imac', 6000],
      ['AND-SCR', 'Android screen replacement (mid-range)', 'android', 8500],
      ['AND-SCR-FLAG', 'Android screen replacement (flagship)', 'android', 19500],
      ['AND-BAT', 'Android battery replacement', 'android', 3500],
      ['AND-PORT', 'Android charging port replacement', 'android', 3000],
      ['WL-SCR', 'Windows laptop screen replacement', 'windows_laptop', 12000],
      ['WL-KBD', 'Windows laptop keyboard replacement', 'windows_laptop', 6500],
      ['WL-BAT', 'Windows laptop battery replacement', 'windows_laptop', 7500],
      ['WL-OS', 'Windows reinstall and data backup', 'windows_laptop', 3000],
      ['LAB-DIAG', 'Advanced diagnosis (micro-soldering bench)', 'other', 2500],
      ['LAB-HOUR', 'Technician labour (per hour)', 'other', 2000],
    ];
    const partIds: Record<string, string> = {};
    for (const [sku, name, fam, kes] of parts) {
      const [p] = await tx`insert into parts_catalogue (tenant_id, sku, name, device_family, kind, default_price_cents, published)
        values (${tid}, ${sku}, ${name}, ${fam}, ${sku.startsWith('LAB') ? 'labour' : 'part'}, ${kes * 100}, true) returning id`;
      partIds[sku] = p.id;
    }

    // ---------------------------------------------------------------- helpers for jobs
    const placeholder = (label: string, colour: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800"><rect width="600" height="800" fill="${colour}"/><rect x="150" y="120" width="300" height="560" rx="40" fill="#111" stroke="#ddd" stroke-width="6"/><text x="300" y="420" font-family="sans-serif" font-size="34" fill="#fff" text-anchor="middle">${label}</text></svg>`);

    const photo = async (jobId: string, stage: string, kind: string, label: string, colour = '#6b7280') => {
      const key = `t/${tid}/jobs/${jobId}/${stage}/${kind}-${Math.random().toString(36).slice(2, 8)}.svg`;
      await putObject(key, placeholder(label, colour), 'image/svg+xml');
      const [p] = await tx`insert into job_photos (job_id, tenant_id, stage, kind, storage_key, content_type, uploaded_by) values (${jobId}, ${tid}, ${stage}, ${kind}, ${key}, 'image/svg+xml', ${null}) returning id`;
      return p.id as string;
    };
    const go = (jobId: string, to: string, actor: string, by: string | null, payload: object = {}) =>
      tx`select transition_job(${jobId}, ${to}::job_status, ${actor}::actor_kind, ${by}, ${tx.json(payload as never)})`;
    const pay = async (jobId: string, purpose: string, cents: number, phone: string) => {
      const key = `${jobId}:${purpose}:seed`;
      const co = `ws_CO_seed_${Math.random().toString(36).slice(2, 10)}`;
      await tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, merchant_request_id, status)
        values (${tid}, ${jobId}, ${purpose}::payment_purpose, ${cents}, ${phone}, ${key}, ${key + ':t'}, ${co}, ${'m-' + co}, 'pending')`;
      await tx`select confirm_payment(${co}, 0, 'The service request is processed successfully.', ${'SEED' + Math.random().toString(36).slice(2, 8).toUpperCase()}, ${cents}, '{}'::jsonb)`;
    };
    const delivery = async (jobId: string, leg: 'pickup' | 'return', from: object, to: object, status: string, costKes: number) => {
      const { deliveryId, trackingUrl } = await mock.create({ quoteRef: 'seed', jobRef: 'seed', idempotencyKey: `${jobId}:${leg}:1` });
      const rider = mock.rider(deliveryId);
      await tx`insert into deliveries (job_id, tenant_id, leg, provider, quote_ref, provider_delivery_id, tracking_url, fee_cost_cents, fee_charged_cents, status, rider_snapshot, pickup_address, dropoff_address)
        values (${jobId}, ${tid}, ${leg}, 'mock', 'seed', ${deliveryId}, ${trackingUrl}, ${costKes * 100}, ${costKes * 100}, ${status}::delivery_status,
                ${status === 'requested' ? null : tx.json(rider as never)}, ${tx.json(from as never)}, ${tx.json(to as never)})`;
      return deliveryId;
    };
    const shop = { formatted: 'Kimathi House, Kimathi Street, Nairobi CBD', lat: -1.28333, lng: 36.82278 };

    const newJob = async (o: { customer: string; phone: string; address: typeof a1; type: string; brand: string; model: string; fault: string; identifier: string; kind: 'imei' | 'serial'; value: number; accessories: string[]; condition: object; deliveryKes: number; tech?: string; daysAgo: number }) => {
      const [{ ref }] = await tx`select next_job_ref(${tid}) as ref`;
      const created = new Date(Date.now() - o.daysAgo * 86400000);
      const start = new Date(created.getTime() + 2 * 3600000);
      const [j] = await tx`insert into jobs (tenant_id, ref, customer_user_id, assigned_tech_id, device_type, device_brand, device_model, fault_description, declared_condition, accessories,
          declared_value_cents, pickup_address, pickup_window_start, pickup_window_end, consultation_fee_cents, pickup_fee_cents, passcode_locked, passcode_shared, created_at, terms_version, terms_accepted_at)
        values (${tid}, ${ref}, ${o.customer}, ${o.tech ?? null}, ${o.type}::device_type, ${o.brand}, ${o.model}, ${o.fault}, ${tx.json(o.condition as never)}, ${o.accessories},
          ${o.value * 100}, ${tx.json(o.address as never)}, ${start}, ${new Date(start.getTime() + 7200000)}, 50000, ${50000 + o.deliveryKes * 100}, true, true, ${created}, '2026-09-25', ${created}) returning id`;
      const dk = (await tx`select wrapped_data_key from tenant_keys where tenant_id = ${tid}`)[0].wrapped_data_key;
      const { unwrapDataKey } = await import('../lib/core/crypto');
      const tkey = unwrapDataKey(dk, master, tid);
      await tx`insert into job_secrets (job_id, tenant_id, identifier, identifier_kind, passcode_enc, passcode_key_version) values (${j.id}, ${tid}, ${o.identifier}, ${o.kind}, ${encrypt('482915', tkey, `passcode:${j.id}`)}, 1)`;
      await photo(j.id, 'customer_declared', 'front', `${o.model} · front`);
      await photo(j.id, 'customer_declared', 'back', `${o.model} · back`, '#4b5563');
      await tx`insert into deliveries (job_id, tenant_id, leg, provider, quote_ref, fee_cost_cents, fee_charged_cents, status, pickup_address, dropoff_address)
        values (${j.id}, ${tid}, 'pickup', 'mock', 'seed', ${o.deliveryKes * 100}, ${o.deliveryKes * 100}, 'quoted', ${tx.json(o.address as never)}, ${tx.json(shop as never)})`;
      await go(j.id, 'pickup_fee_pending', 'customer', o.customer);
      return j.id as string;
    };

    const quote = async (jobId: string, lines: [string, number][], by: string, deposit: number) => {
      const [q] = await tx`insert into quotes (job_id, tenant_id, kind, status, created_by) values (${jobId}, ${tid}, 'main', 'sent', ${by}) returning id`;
      const total = lines.reduce((s, [, kes]) => s + kes * 100, 0);
      const vat = Math.round((total * 1600) / 11600);
      const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, subtotal_cents, vat_cents, total_cents, deposit_cents, turnaround_days, expires_at, message, sent_at, created_by)
        values (${q.id}, ${tid}, 1, 'shop', ${total - vat}, ${vat}, ${total}, ${deposit * 100}, 2, now() + interval '40 hours', 'Parts in stock. Genuine-quality OLED, 14-day warranty.', now(), ${by}) returning id`;
      for (const [i, [sku, kes]] of lines.entries()) {
        const name = parts.find((p) => p[0] === sku)?.[1] ?? sku;
        await tx`insert into quote_line_items (quote_version_id, tenant_id, position, kind, part_id, description, qty, unit_price_cents, line_total_cents)
          values (${v.id}, ${tid}, ${i}, ${sku.startsWith('LAB') ? 'labour' : 'part'}, ${partIds[sku] ?? null}, ${name}, 1, ${kes * 100}, ${kes * 100})`;
      }
      await tx`update quotes set current_version_id = ${v.id} where id = ${q.id}`;
      await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, body, quote_version_id) values (${q.id}, ${tid}, ${by}, 'shop', 'revision', ${total}, 'Parts in stock. Genuine-quality OLED, 14-day warranty.', ${v.id})`;
      await go(jobId, 'quote_sent', 'technician', by);
      return { quoteId: q.id as string, versionId: v.id as string, total };
    };
    const intake = async (jobId: string, by: string, identifier: string, discrepancy?: [string, string, string]) => {
      await photo(jobId, 'intake', 'front', 'bench · front', '#1f2937');
      await photo(jobId, 'intake', 'back', 'bench · back', '#374151');
      await tx`insert into intake_checklists (job_id, tenant_id, identifier_read, identifier_matches, accessories_received, condition_checks, powers_on, summary, completed_by)
        values (${jobId}, ${tid}, ${identifier}, true, '{}', '{"screen":"cracked","frame":"minor scuffs"}', true, 'Device received as declared. Screen cracked top-left, frame has light scuffs.', ${by})`;
      if (discrepancy) {
        await tx`insert into discrepancies (job_id, tenant_id, field, declared_value, observed_value, note) values (${jobId}, ${tid}, ${discrepancy[0]}, ${discrepancy[1]}, ${discrepancy[2]}, 'Photographed at intake')`;
        await go(jobId, 'intake_ack_pending', 'technician', by);
      } else {
        await go(jobId, 'diagnosing', 'technician', by);
      }
    };

    // Job 1: booked, pickup fee pending
    await newJob({ customer: c3, phone: '+254700000003', address: a3, type: 'macbook', brand: 'Apple', model: 'MacBook Air M1 (2020)', fault: 'Spilled tea on the keyboard, now it will not turn on.', identifier: 'C02DK0ABQ6L4', kind: 'serial', value: 90000, accessories: ['charger'], condition: { powers_on: false, water_damage: true }, deliveryKes: 350, daysAgo: 0 });

    // Job 2: paid, rider on the way to the customer
    const j2 = await newJob({ customer: c1, phone: '+254700000001', address: a1, type: 'iphone', brand: 'Apple', model: 'iPhone 13', fault: 'Dropped it, screen cracked and touch not working at the top.', identifier: '356789104523871', kind: 'imei', value: 60000, accessories: ['case'], condition: { powers_on: true, screen_cracked: true }, deliveryKes: 300, daysAgo: 0 });
    await pay(j2, 'pickup_fee', 80000, '+254700000001');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j2}`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j2} and status = 'quoted'`;
    await delivery(j2, 'pickup', a1, shop, 'rider_assigned', 300);
    await go(j2, 'rider_en_route_to_customer', 'provider', null);

    // Job 3: intake found a discrepancy, waiting for customer acknowledgement
    const j3 = await newJob({ customer: c2, phone: '+254700000002', address: a2, type: 'iphone', brand: 'Apple', model: 'iPhone 14 Pro', fault: 'Battery drains within 3 hours and the phone gets hot.', identifier: '353915116729284', kind: 'imei', value: 110000, accessories: [], condition: { powers_on: true }, deliveryKes: 250, tech: tech2, daysAgo: 1 });
    await pay(j3, 'pickup_fee', 75000, '+254700000002');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j3}`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j3} and status = 'quoted'`;
    await delivery(j3, 'pickup', a2, shop, 'delivered', 250);
    await go(j3, 'rider_en_route_to_customer', 'provider', null);
    await go(j3, 'picked_up', 'provider', null);
    await go(j3, 'in_transit_to_shop', 'provider', null);
    await go(j3, 'received_at_shop', 'technician', tech2);
    await intake(j3, tech2, '353915116729284', ['back_glass', 'Intact', 'Hairline crack bottom-right corner']);

    // Job 4: quote sent, customer countered
    const j4 = await newJob({ customer: c2, phone: '+254700000002', address: a2, type: 'macbook', brand: 'Apple', model: 'MacBook Pro 14" (2021)', fault: 'Display flickers and shows vertical lines.', identifier: 'FVFGK2XJQ05D', kind: 'serial', value: 220000, accessories: ['charger'], condition: { powers_on: true }, deliveryKes: 250, tech: tech1, daysAgo: 3 });
    await pay(j4, 'pickup_fee', 75000, '+254700000002');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j4}`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j4} and status = 'quoted'`;
    await delivery(j4, 'pickup', a2, shop, 'delivered', 250);
    for (const [to, actor, by] of [['rider_en_route_to_customer', 'provider', null], ['picked_up', 'provider', null], ['in_transit_to_shop', 'provider', null], ['received_at_shop', 'technician', tech1]] as const) await go(j4, to, actor, by);
    await intake(j4, tech1, 'FVFGK2XJQ05D');
    const q4 = await quote(j4, [['MBP-14-SCR', 78000], ['LAB-HOUR', 2000]], tech1, 40000);
    await tx`insert into negotiations (quote_id, tenant_id, author_user_id, author_side, kind, proposed_total_cents, body, quote_version_id) values (${q4.quoteId}, ${tid}, ${c2}, 'customer', 'counter', 7200000, 'Can you do 72,000? I saw a cheaper quote elsewhere.', ${q4.versionId})`;
    await tx`update quotes set status = 'negotiating', rounds_used = 1 where id = ${q4.quoteId}`;
    await go(j4, 'quote_negotiating', 'customer', c2);

    // Job 5: in repair with progress updates
    const j5 = await newJob({ customer: c1, phone: '+254700000001', address: a1, type: 'iphone', brand: 'Apple', model: 'iPhone 13 Pro', fault: 'Face ID stopped working after a fall.', identifier: '352099001761481', kind: 'imei', value: 95000, accessories: [], condition: { powers_on: true }, deliveryKes: 300, tech: tech1, daysAgo: 4 });
    await pay(j5, 'pickup_fee', 80000, '+254700000001');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j5}`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j5} and status = 'quoted'`;
    await delivery(j5, 'pickup', a1, shop, 'delivered', 300);
    for (const [to, actor, by] of [['rider_en_route_to_customer', 'provider', null], ['picked_up', 'provider', null], ['in_transit_to_shop', 'provider', null], ['received_at_shop', 'technician', tech1]] as const) await go(j5, to, actor, by);
    await intake(j5, tech1, '352099001761481');
    const q5 = await quote(j5, [['IP-FACEID', 12000], ['LAB-DIAG', 2500]], tech1, 7300);
    await tx`update quotes set status = 'accepted', accepted_version_id = ${q5.versionId}, accepted_total_cents = ${q5.total}, accepted_at = now() where id = ${q5.quoteId}`;
    await go(j5, 'deposit_pending', 'customer', c1);
    await pay(j5, 'deposit', 730000, '+254700000001');
    await tx`insert into job_progress_updates (job_id, tenant_id, template_key, body, created_by) values
      (${j5}, ${tid}, 'disassembled', 'Device opened, flood illuminator cable is torn. Replacing it.', ${tech1}),
      (${j5}, ${tid}, 'parts_ordered', 'Replacement flex ordered, arriving tomorrow morning.', ${tech1})`;

    // Job 6: full lifecycle, closed and rated
    const j6 = await newJob({ customer: c3, phone: '+254700000003', address: a3, type: 'iphone', brand: 'Apple', model: 'iPhone 11', fault: 'Battery health 71%, shuts down at 30%.', identifier: '353982101234561', kind: 'imei', value: 35000, accessories: [], condition: { powers_on: true }, deliveryKes: 350, tech: tech2, daysAgo: 9 });
    await pay(j6, 'pickup_fee', 85000, '+254700000003');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j6}`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j6} and status = 'quoted'`;
    await delivery(j6, 'pickup', a3, shop, 'delivered', 350);
    for (const [to, actor, by] of [['rider_en_route_to_customer', 'provider', null], ['picked_up', 'provider', null], ['in_transit_to_shop', 'provider', null], ['received_at_shop', 'technician', tech2]] as const) await go(j6, to, actor, by);
    await intake(j6, tech2, '353982101234561');
    const q6 = await quote(j6, [['IP11-BAT', 4500]], tech2, 2300);
    await tx`update quotes set status = 'accepted', accepted_version_id = ${q6.versionId}, accepted_total_cents = ${q6.total}, accepted_at = now() where id = ${q6.quoteId}`;
    await go(j6, 'deposit_pending', 'customer', c3);
    await pay(j6, 'deposit', 230000, '+254700000003');
    await tx`insert into completion_checklists (job_id, tenant_id, tests, completed_by) values (${j6}, ${tid}, '{"powers_on":true,"display":true,"battery":true,"cosmetic":true}', ${tech2})`;
    await photo(j6, 'completion', 'front', 'after · front', '#065f46');
    await go(j6, 'repair_complete', 'technician', tech2);
    await tx`update jobs set dropoff_choice = 'pickup_address', dropoff_address = pickup_address, return_fee_cents = 35000 where id = ${j6}`;
    await tx`insert into deliveries (job_id, tenant_id, leg, provider, quote_ref, fee_cost_cents, fee_charged_cents, status, pickup_address, dropoff_address)
      values (${j6}, ${tid}, 'return', 'mock', 'seed', 35000, 35000, 'quoted', ${tx.json(shop as never)}, ${tx.json(a3 as never)})`;
    // consultation 500 + pickup 350 + battery 4,500 - credit 500 + return 350 = 5,200
    const lines = [
      { code: 'consultation', description: 'Consultation / diagnosis fee', qty: 1, unitPriceCents: 50000, totalCents: 50000, vatable: true },
      { code: 'pickup_delivery', description: 'Pickup delivery (courier, incl. courier VAT)', qty: 1, unitPriceCents: 35000, totalCents: 35000, vatable: false },
      { code: 'quote', description: 'iPhone 11 battery replacement', qty: 1, unitPriceCents: 450000, totalCents: 450000, vatable: true },
      { code: 'consultation_credit', description: 'Consultation fee credited to repair', qty: 1, unitPriceCents: -50000, totalCents: -50000, vatable: true },
      { code: 'return_delivery', description: 'Return delivery (courier, incl. courier VAT)', qty: 1, unitPriceCents: 35000, totalCents: 35000, vatable: false },
    ];
    const vat = Math.round((450000 * 1600) / 11600);
    await tx`insert into invoices (tenant_id, job_id, status, lines, subtotal_cents, vat_cents, vat_rate_bp, total_cents, paid_cents, balance_cents, customer_snapshot, tenant_snapshot)
      values (${tid}, ${j6}, 'proforma', ${tx.json(lines as never)}, ${520000 - vat}, ${vat}, 1600, 520000, 315000, 205000,
              ${tx.json({ name: 'Amina Hassan', phone: '+254700000003', email: null, address: a3 } as never)},
              ${tx.json({ name: 'iRepair', kra_pin: 'P051234567X', vat_registered: true, address: 'Kimathi House, Kimathi Street, Nairobi CBD', phone: '+254700123456', email: 'hello@demorepairs.test', primary_hex: '#0f3d3e' } as never)})`;
    await go(j6, 'final_payment_pending', 'customer', c3);
    await pay(j6, 'final_balance', 205000, '+254700000003');
    await tx`update outbox set status = 'done', done_at = now() where payload ->> 'job_id' = ${j6} and kind = 'delivery.create'`;
    await tx`update deliveries set status = 'cancelled' where job_id = ${j6} and leg = 'return' and status = 'quoted'`;
    await delivery(j6, 'return', shop, a3, 'delivered', 350);
    await go(j6, 'rider_en_route_to_shop', 'provider', null);
    await go(j6, 'collected_from_shop', 'technician', tech2);
    await go(j6, 'in_transit_to_customer', 'provider', null);
    await go(j6, 'delivered', 'provider', null);
    await tx`insert into ratings (job_id, tenant_id, score, comment) values (${j6}, ${tid}, 5, 'Fast and professional. Did not have to leave the office!')`;
    await go(j6, 'closed', 'customer', c3);

    // Don't SMS the seed customers when the worker starts.
    await tx`update notifications set status = 'sent', sent_at = now() where channel in ('sms', 'email')`;

    console.log('\nSeeded iRepair');
    console.log(`  Customer site:   http://demo.${root}`);
    console.log(`  Staff sign-in:   http://demo.${root}/staff/login   admin@demo.test / DemoRepairs2026 (also tech1@, tech2@)`);
    console.log(`  Customers:       0700000001, 0700000002, 0700000003  (OTP ${process.env.OTP_DEV_CODE ?? '(sent to console)'})`);
    console.log(`  Platform admin:  http://${root}/platform   root@platform.test / DemoRepairs2026`);
    console.log(`  Platform TOTP:   ${totpSecret}`);
    console.log(`                   ${otpauthUrl(totpSecret, 'root@platform.test', process.env.PLATFORM_NAME ?? 'RepairDesk')}`);
    void platformAdmin;
  });
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
