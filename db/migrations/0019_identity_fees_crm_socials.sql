-- (1) A customer may identify a booking by their own ID document instead of the device's IMEI/serial. The document
--     is kept on the customer's account for this shop (encrypted number, private photo), reusable on later bookings
--     and deletable by the customer; staff views of the photo are audited.
-- (2) Consultation fee per device type, falling back to the shop-wide fee.
-- (3) Shop social profiles and hand-picked Instagram posts for the About page.
-- (4) A light CRM: staff notes, tags and follow-up reminders per customer.

alter table jobs add column identity_method text not null default 'device' check (identity_method in ('device', 'id'));

alter table tenant_settings add column consultation_fees jsonb not null default '{}';

alter table tenant_branding
  add column social_links jsonb not null default '{}',
  add column instagram_posts text[] not null default '{}';

create table customer_ids (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('national_id', 'passport', 'alien_id')),
  number_enc text not null,
  key_version int not null,
  last4 text not null,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create trigger customer_ids_updated before update on customer_ids for each row execute function set_updated_at();
alter table customer_ids enable row level security;
create policy customer_ids_select on customer_ids for select using (user_id = current_user_id() or is_tenant_staff(tenant_id) or is_platform_admin());
create policy customer_ids_write on customer_ids for all
  using (user_id = current_user_id() or is_shop_admin(tenant_id))
  with check (user_id = current_user_id() or is_shop_admin(tenant_id));

create table customer_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  author_id uuid references users(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index customer_notes_idx on customer_notes(tenant_id, user_id, created_at desc);
alter table customer_notes enable row level security;
create policy customer_notes_select on customer_notes for select using (is_tenant_staff(tenant_id) or is_platform_admin());
create policy customer_notes_insert on customer_notes for insert with check (is_tenant_staff(tenant_id));
create policy customer_notes_delete on customer_notes for delete using (author_id = current_user_id() or is_shop_admin(tenant_id));

create table customer_tags (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tag text not null check (length(tag) between 1 and 30),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, tag)
);
alter table customer_tags enable row level security;
create policy customer_tags_select on customer_tags for select using (is_tenant_staff(tenant_id) or is_platform_admin());
create policy customer_tags_write on customer_tags for all using (is_tenant_staff(tenant_id)) with check (is_tenant_staff(tenant_id));

create table customer_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  due_on date not null,
  reason text not null,
  created_by uuid references users(id),
  done_at timestamptz,
  done_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index customer_followups_due_idx on customer_followups(tenant_id, due_on) where done_at is null;
alter table customer_followups enable row level security;
create policy customer_followups_select on customer_followups for select using (is_tenant_staff(tenant_id) or is_platform_admin());
create policy customer_followups_write on customer_followups for all using (is_tenant_staff(tenant_id)) with check (is_tenant_staff(tenant_id));
