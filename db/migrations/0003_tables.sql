-- Core schema. Money is bigint KES cents. Timestamps are timestamptz. Every business table carries tenant_id.

-- ---------------------------------------------------------------------------
-- Platform-level: users, sessions, OTP, rate limits
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text unique check (phone_e164 ~ '^\+254[17]\d{8}$'),
  email text unique check (email = lower(email)),
  full_name text not null default '',
  password_hash text,
  totp_secret_enc text,
  totp_enabled boolean not null default false,
  is_platform_admin boolean not null default false,
  disabled boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (phone_e164 is not null or email is not null)
);
create trigger users_updated before update on users for each row execute function set_updated_at();

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  tenant_id uuid,                                  -- host the session was created on (null on platform host)
  mfa_verified boolean not null default false,
  impersonating_tenant_id uuid,
  impersonation_reason text,
  impersonation_expires_at timestamptz,
  ip inet,
  user_agent text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index sessions_user_idx on sessions(user_id);
create index sessions_expires_idx on sessions(expires_at);

create table otp_codes (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  code_hash text not null,
  purpose text not null default 'login',
  attempts int not null default 0,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index otp_codes_phone_idx on otp_codes(phone_e164, created_at desc);

create table rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  count int not null default 0
);

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create type tenant_status as enum ('active', 'suspended');
create type delivery_provider_kind as enum ('mock', 'tumaboda');
create type membership_role as enum ('technician', 'shop_admin');

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$'),
  name text not null,
  status tenant_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger tenants_updated before update on tenants for each row execute function set_updated_at();

create table tenant_domains (
  hostname text primary key check (hostname = lower(hostname)),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('subdomain', 'custom')),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index tenant_domains_primary_idx on tenant_domains(tenant_id) where is_primary;

create table tenant_branding (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  display_name text not null,
  tagline text,
  logo_path text,
  icon_path text,
  primary_hex text not null default '#0f172a' check (primary_hex ~ '^#[0-9a-fA-F]{6}$'),
  accent_hex text not null default '#2563eb' check (accent_hex ~ '^#[0-9a-fA-F]{6}$'),
  sms_sender_id text,
  email_from_name text,
  email_from_address text,
  updated_at timestamptz not null default now()
);
create trigger tenant_branding_updated before update on tenant_branding for each row execute function set_updated_at();

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  contact_phone text not null default '',
  contact_email text,
  address_formatted text not null default '',
  address_lat double precision,
  address_lng double precision,
  address_landmark text,
  kra_pin text,
  vat_registered boolean not null default false,
  vat_rate_bp int not null default 1600 check (vat_rate_bp between 0 and 5000),
  prices_include_vat boolean not null default true,
  consultation_fee_cents bigint not null default 50000 check (consultation_fee_cents >= 0),
  consultation_fee_credited boolean not null default true,
  deposit_rule jsonb not null default '{"kind":"percent","value":5000}',
  deposit_min_quote_cents bigint not null default 0,
  max_negotiation_rounds int not null default 3 check (max_negotiation_rounds between 0 and 10),
  quote_expiry_hours int not null default 48 check (quote_expiry_hours between 1 and 720),
  expired_quote_autodecline_days int not null default 7,
  delivery_markup_bp int not null default 0 check (delivery_markup_bp between 0 and 10000),
  delivery_provider delivery_provider_kind not null default 'mock',
  retention_days int not null default 90 check (retention_days between 7 and 3650),
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '07:00',
  opening_hours jsonb not null default '{"mon":{"open":"08:00","close":"18:00"},"tue":{"open":"08:00","close":"18:00"},"wed":{"open":"08:00","close":"18:00"},"thu":{"open":"08:00","close":"18:00"},"fri":{"open":"08:00","close":"18:00"},"sat":{"open":"09:00","close":"15:00"},"sun":null}',
  service_zones text[] not null default '{}',
  publish_price_list boolean not null default false,
  auto_close_hours int not null default 48,
  warranty_days int not null default 14 check (warranty_days between 0 and 365),
  unclaimed_after_days int not null default 3,
  require_admin_mfa boolean not null default false,
  collect_supplementary_upfront boolean not null default false,
  updated_at timestamptz not null default now()
);
create trigger tenant_settings_updated before update on tenant_settings for each row execute function set_updated_at();

-- Encrypted with the tenant data key (lib/core/crypto.ts). Never selected by the app role except through
-- shop_admin settings screens; the worker/service reads them.
create table tenant_secrets (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  daraja_enc text,        -- {consumerKey, consumerSecret, shortcode, passkey, type: paybill|till, partyB?, env: sandbox|production}
  courier_enc text,       -- {apiKey, webhookSecret, baseUrl}
  sms_enc text,           -- {username, apiKey, senderId?}
  updated_at timestamptz not null default now()
);
create trigger tenant_secrets_updated before update on tenant_secrets for each row execute function set_updated_at();

create table tenant_keys (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  wrapped_data_key text not null,
  key_version int not null default 1,
  created_at timestamptz not null default now()
);

create table tenant_memberships (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role membership_role not null,
  active boolean not null default true,
  invited_by uuid references users(id),
  invite_token_hash text unique,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index tenant_memberships_user_idx on tenant_memberships(user_id);

create table platform_fee_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('flat', 'percent')),
  value bigint not null check (value >= 0),        -- cents for flat, basis points for percent
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index platform_fee_rules_tenant_idx on platform_fee_rules(tenant_id, effective_from desc);

create table platform_fee_ledger (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  job_id uuid not null,
  amount_cents bigint not null,
  basis jsonb not null,
  invoiced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id)
);

-- ---------------------------------------------------------------------------
-- Customers' own data (platform-level, snapshotted onto jobs)
-- ---------------------------------------------------------------------------
create table addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null default '',
  formatted text not null,
  place_id text,
  lat double precision,
  lng double precision,
  landmark text,
  building_floor text,
  zone text,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on addresses(user_id);

create type device_type as enum ('iphone', 'ipad', 'macbook', 'android', 'windows_laptop', 'other');

create table devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type device_type not null,
  brand text not null default '',
  model text not null,
  colour text,
  storage text,
  identifier text,             -- IMEI or serial
  identifier_kind text check (identifier_kind in ('imei', 'serial')),
  created_at timestamptz not null default now()
);
create index devices_user_idx on devices(user_id);

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
create type job_outcome as enum ('repaired', 'declined', 'cancelled');
create type dropoff_choice as enum ('pickup_address', 'other_address', 'collect_at_shop');

create table job_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  year int not null,
  next_value int not null default 1,
  primary key (tenant_id, year)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  ref text not null,
  customer_user_id uuid not null references users(id),
  assigned_tech_id uuid references users(id),
  status job_status not null default 'draft',
  outcome job_outcome,
  -- device snapshot
  device_id uuid references devices(id),
  device_type device_type not null,
  device_brand text not null default '',
  device_model text not null,
  device_colour text,
  device_storage text,
  fault_description text not null default '',
  declared_condition jsonb not null default '{}',   -- {powers_on, screen_cracked, water_damage, back_cracked, notes}
  accessories text[] not null default '{}',
  passcode_locked boolean not null default false,
  passcode_shared boolean not null default false,
  declared_value_cents bigint not null default 0,
  -- pickup
  pickup_address jsonb,                              -- snapshot of addresses row
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  consultation_fee_cents bigint not null default 0,  -- snapshot at booking
  pickup_fee_cents bigint not null default 0,        -- courier charge + consultation, what the customer paid
  -- drop-off
  dropoff_choice dropoff_choice,
  dropoff_address jsonb,
  dropoff_window_start timestamptz,
  dropoff_window_end timestamptz,
  return_fee_cents bigint not null default 0,
  -- flags
  intake_discrepancy boolean not null default false,
  not_as_expected boolean not null default false,
  cancel_reason text,
  warranty_until date,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, ref)
);
create index jobs_tenant_status_idx on jobs(tenant_id, status);
create index jobs_customer_idx on jobs(customer_user_id, created_at desc);
create index jobs_tech_idx on jobs(assigned_tech_id) where assigned_tech_id is not null;
create trigger jobs_updated before update on jobs for each row execute function set_updated_at();

-- Stricter RLS than jobs: customer, assigned technician and shop_admin only.
create table job_secrets (
  job_id uuid primary key references jobs(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  identifier text,
  identifier_kind text check (identifier_kind in ('imei', 'serial')),
  passcode_enc text,
  passcode_key_version int,
  purged_at timestamptz
);

create table job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  from_status job_status,
  to_status job_status,
  event_kind text not null,                 -- 'transition' or a domain event like 'photo.added', 'quote.sent'
  actor_kind actor_kind not null,
  actor_user_id uuid,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index job_events_job_idx on job_events(job_id, id);
create trigger job_events_append_only before update or delete on job_events for each row execute function reject_mutation();

create type photo_stage as enum ('customer_declared', 'intake', 'progress', 'completion', 'discrepancy', 'handover');

create table job_photos (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  stage photo_stage not null,
  kind text not null default 'other',     -- front | back | screen_on | other
  storage_key text not null,
  content_type text not null default 'image/jpeg',
  bytes int,
  width int,
  height int,
  taken_at timestamptz,
  uploaded_by uuid references users(id),
  client_upload_id text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, client_upload_id)
);
create index job_photos_job_idx on job_photos(job_id, stage);

create table intake_checklists (
  job_id uuid primary key references jobs(id) on delete cascade,
  tenant_id uuid not null,
  identifier_read text,
  identifier_matches boolean,
  accessories_received text[] not null default '{}',
  condition_checks jsonb not null default '{}',
  powers_on boolean,
  summary text not null default '',
  completed_by uuid references users(id),
  completed_at timestamptz not null default now()
);

create table discrepancies (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  field text not null,
  declared_value text,
  observed_value text,
  note text,
  photo_ids uuid[] not null default '{}',
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index discrepancies_job_idx on discrepancies(job_id);

create table job_progress_updates (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  template_key text,
  body text not null,
  photo_ids uuid[] not null default '{}',
  internal boolean not null default false,   -- internal notes are never shown to the customer
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index job_progress_updates_job_idx on job_progress_updates(job_id, created_at);

create table completion_checklists (
  job_id uuid primary key references jobs(id) on delete cascade,
  tenant_id uuid not null,
  tests jsonb not null default '{}',
  notes text not null default '',
  completed_by uuid references users(id),
  completed_at timestamptz not null default now()
);

create table ratings (
  job_id uuid primary key references jobs(id) on delete cascade,
  tenant_id uuid not null,
  score int not null check (score between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

create table disputes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  kind text not null check (kind in ('intake', 'warranty', 'delivery')),
  body text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  resolution text,
  opened_by uuid references users(id),
  resolved_by uuid references users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index disputes_job_idx on disputes(job_id);

-- ---------------------------------------------------------------------------
-- Quotes
-- ---------------------------------------------------------------------------
create type quote_kind as enum ('main', 'supplementary');
create type quote_status as enum ('draft', 'sent', 'negotiating', 'accepted', 'declined', 'expired');

create table parts_catalogue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text,
  name text not null,
  device_family text,                        -- 'iphone' | 'macbook' | ... free text for grouping
  kind text not null default 'part' check (kind in ('part', 'labour', 'service')),
  default_price_cents bigint not null check (default_price_cents >= 0),
  published boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index parts_catalogue_tenant_idx on parts_catalogue(tenant_id, active);
create trigger parts_catalogue_updated before update on parts_catalogue for each row execute function set_updated_at();

create table quotes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  kind quote_kind not null default 'main',
  status quote_status not null default 'draft',
  current_version_id uuid,
  rounds_used int not null default 0,
  accepted_total_cents bigint,
  accepted_version_id uuid,
  accepted_at timestamptz,
  collect_upfront boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_job_idx on quotes(job_id);
create unique index quotes_one_main_per_job on quotes(job_id) where kind = 'main';
create trigger quotes_updated before update on quotes for each row execute function set_updated_at();

create table quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  tenant_id uuid not null,
  version_no int not null,
  author_side text not null check (author_side in ('shop', 'customer')),
  subtotal_cents bigint not null default 0,
  vat_cents bigint not null default 0,
  total_cents bigint not null default 0,
  deposit_cents bigint not null default 0,
  turnaround_days int,
  expires_at timestamptz,
  message text,
  sent_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (quote_id, version_no)
);
alter table quotes add constraint quotes_current_version_fk foreign key (current_version_id) references quote_versions(id) deferrable initially deferred;
alter table quotes add constraint quotes_accepted_version_fk foreign key (accepted_version_id) references quote_versions(id) deferrable initially deferred;

-- Sent versions are immutable.
create or replace function quote_versions_immutable() returns trigger
language plpgsql as $$
begin
  if old.sent_at is not null and (tg_op = 'DELETE' or new.sent_at is distinct from old.sent_at
     or new.total_cents <> old.total_cents or new.subtotal_cents <> old.subtotal_cents
     or new.vat_cents <> old.vat_cents or new.deposit_cents <> old.deposit_cents
     or new.message is distinct from old.message or new.expires_at is distinct from old.expires_at) then
    raise exception 'quote version % has been sent and is immutable', old.id;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
create trigger quote_versions_immutable before update or delete on quote_versions for each row execute function quote_versions_immutable();

create table quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_version_id uuid not null references quote_versions(id) on delete cascade,
  tenant_id uuid not null,
  position int not null default 0,
  kind text not null default 'part' check (kind in ('part', 'labour', 'other')),
  part_id uuid references parts_catalogue(id),
  description text not null,
  qty int not null check (qty > 0),
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  line_total_cents bigint not null
);
create index quote_line_items_version_idx on quote_line_items(quote_version_id, position);

create table negotiations (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  tenant_id uuid not null,
  author_user_id uuid references users(id),
  author_side text not null check (author_side in ('shop', 'customer')),
  kind text not null check (kind in ('message', 'counter', 'accept', 'decline', 'revision', 'expired', 'reissued')),
  proposed_total_cents bigint,
  body text,
  quote_version_id uuid references quote_versions(id),
  created_at timestamptz not null default now()
);
create index negotiations_quote_idx on negotiations(quote_id, created_at);

-- ---------------------------------------------------------------------------
-- Logistics
-- ---------------------------------------------------------------------------
create type delivery_leg as enum ('pickup', 'return');
create type delivery_status as enum (
  'quoted', 'requested', 'rider_assigned', 'rider_en_route', 'picked_up', 'in_transit', 'delivered', 'failed', 'cancelled'
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  leg delivery_leg not null,
  attempt int not null default 1,
  provider delivery_provider_kind not null,
  quote_ref text,
  provider_delivery_id text,
  tracking_url text,
  fee_cost_cents bigint not null default 0,
  fee_charged_cents bigint not null default 0,
  status delivery_status not null default 'quoted',
  rider_snapshot jsonb,                     -- {name, phone, plate}
  pickup_address jsonb not null,
  dropoff_address jsonb not null,
  scheduled_for timestamptz,
  last_provider_status text,
  last_provider_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_delivery_id)
);
create index deliveries_job_idx on deliveries(job_id, leg, attempt desc);
create index deliveries_active_idx on deliveries(tenant_id) where status in ('requested', 'rider_assigned', 'rider_en_route', 'picked_up', 'in_transit');
create trigger deliveries_updated before update on deliveries for each row execute function set_updated_at();

create table handover_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  tenant_id uuid not null,
  delivery_id uuid references deliveries(id),
  point text not null check (point in ('customer_to_rider', 'rider_to_shop', 'shop_to_rider', 'rider_to_customer', 'counter_collection')),
  method text not null check (method in ('qr', 'otp', 'provider_confirmed', 'manual_override')),
  actor_user_id uuid references users(id),
  rider_snapshot jsonb,
  geo_lat double precision,
  geo_lng double precision,
  geo_accuracy_m double precision,
  photo_ids uuid[] not null default '{}',
  verified boolean not null default false,
  provider_response jsonb,
  note text,
  created_at timestamptz not null default now()
);
create index handover_events_job_idx on handover_events(job_id, created_at);

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
create type payment_purpose as enum ('pickup_fee', 'deposit', 'final_balance', 'return_fee', 'supplementary');
create type payment_status as enum ('initiated', 'pending', 'success', 'failed', 'timeout', 'cancelled');

create table payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  job_id uuid not null references jobs(id),
  quote_id uuid references quotes(id),
  purpose payment_purpose not null,
  amount_cents bigint not null check (amount_cents > 0 and amount_cents % 100 = 0),
  phone_e164 text not null,
  idempotency_key text not null unique,
  callback_token text not null unique,
  merchant_request_id text,
  checkout_request_id text unique,
  status payment_status not null default 'initiated',
  result_code int,
  result_desc text,
  mpesa_receipt text unique,
  paid_amount_cents bigint,
  raw_callback jsonb,
  reconcile_attempts int not null default 0,
  confirmed_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_job_idx on payments(job_id, created_at desc);
create index payments_pending_idx on payments(created_at) where status in ('initiated', 'pending');
create trigger payments_updated before update on payments for each row execute function set_updated_at();

create table refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  job_id uuid not null references jobs(id),
  payment_id uuid references payments(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason text not null,
  method text not null check (method in ('mpesa_manual', 'cash', 'bank', 'other')),
  reference text,
  recorded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index refunds_job_idx on refunds(job_id);

create table invoice_sequences (
  tenant_id uuid not null references tenants(id) on delete cascade,
  year int not null,
  next_value int not null default 1,
  primary key (tenant_id, year)
);

create type invoice_status as enum ('proforma', 'issued', 'void');

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  job_id uuid not null references jobs(id),
  number text,
  status invoice_status not null default 'proforma',
  lines jsonb not null,                     -- InvoiceLine[] snapshot
  subtotal_cents bigint not null,
  vat_cents bigint not null,
  vat_rate_bp int not null,
  rounding_cents bigint not null default 0,
  total_cents bigint not null,
  paid_cents bigint not null default 0,
  balance_cents bigint not null,
  customer_snapshot jsonb not null,
  tenant_snapshot jsonb not null,           -- name, KRA PIN, address, VAT status at issue time
  pdf_key text,
  issued_at timestamptz,
  etims_status text not null default 'not_applicable' check (etims_status in ('not_applicable', 'pending', 'submitted', 'failed')),
  etims_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create unique index invoices_one_live_per_job on invoices(job_id) where status <> 'void';
create trigger invoices_updated before update on invoices for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Messaging and operations
-- ---------------------------------------------------------------------------
create type notification_channel as enum ('in_app', 'sms', 'email', 'whatsapp');
create type notification_audience as enum ('customer', 'staff');
create type notification_status as enum ('queued', 'held_quiet_hours', 'sent', 'delivered', 'failed', 'read');

create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,     -- null = platform default
  event_key text not null,
  audience notification_audience not null,
  channel notification_channel not null,
  title text,
  body text not null,
  critical boolean not null default false,                     -- critical SMS ignore quiet hours
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index notification_templates_unique on notification_templates(coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), event_key, audience, channel);
create trigger notification_templates_updated before update on notification_templates for each row execute function set_updated_at();

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid references users(id),
  phone_e164 text,
  email text,
  job_id uuid references jobs(id) on delete set null,
  channel notification_channel not null,
  event_key text not null,
  title text,
  body text not null,
  status notification_status not null default 'queued',
  critical boolean not null default false,
  send_after timestamptz not null default now(),
  attempts int not null default 0,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications(user_id, created_at desc) where channel = 'in_app';
create index notifications_queue_idx on notifications(send_after) where status in ('queued', 'held_quiet_hours');

create type outbox_status as enum ('pending', 'done', 'failed', 'dead');

create table outbox (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  kind text not null,                 -- delivery.create | delivery.cancel | delivery.quote_return | invoice.pdf | alert.shop_admin | ...
  payload jsonb not null default '{}',
  dedupe_key text unique,
  status outbox_status not null default 'pending',
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index outbox_pending_idx on outbox(next_attempt_at) where status = 'pending';

create table webhook_events (
  id bigint generated always as identity primary key,
  source text not null,               -- mpesa | tumaboda | africastalking | mock
  tenant_id uuid,
  dedupe_key text unique,
  headers jsonb not null default '{}',
  raw_body text not null,
  signature_valid boolean,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table timers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  job_id uuid references jobs(id) on delete cascade,
  payment_id uuid references payments(id) on delete cascade,
  kind timer_kind not null,
  due_at timestamptz not null,
  payload jsonb not null default '{}',
  fired_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index timers_due_idx on timers(due_at) where fired_at is null and cancelled_at is null;
create index timers_job_idx on timers(job_id) where fired_at is null and cancelled_at is null;

create table audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  actor_user_id uuid,
  impersonated_by uuid,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_log_tenant_idx on audit_log(tenant_id, created_at desc);
create index audit_log_entity_idx on audit_log(entity, entity_id);
create trigger audit_log_append_only before update or delete on audit_log for each row execute function reject_mutation();

create table short_links (
  code text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  job_id uuid not null references jobs(id) on delete cascade,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id)
);
