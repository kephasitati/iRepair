-- A shop can list catalogue items as browsable products (photo, description, category) on a public /shop page,
-- and replace the generated FAQ with its own. Both off/empty by default; the first real shop (Primefix) had both
-- on its existing website.
alter table parts_catalogue
  add column category text,
  add column description text,
  add column image_path text,   -- our own copy in private storage (served via /api/products/<id>/image)
  add column image_url text,    -- the source image on the shop's previous website, used until image_path exists
  add column listed boolean not null default false;
create index parts_catalogue_listed_idx on parts_catalogue(tenant_id, listed) where listed and active;

alter table tenant_settings add column shop_page boolean not null default false;

create table tenant_faqs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  position int not null default 0,
  question text not null,
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tenant_faqs_tenant_idx on tenant_faqs(tenant_id, position);
create trigger tenant_faqs_updated before update on tenant_faqs for each row execute function set_updated_at();

alter table tenant_faqs enable row level security;
create policy faqs_select on tenant_faqs for select using (
  is_tenant_staff(tenant_id) or is_platform_admin() or tenant_id = current_tenant_id()
);
create policy faqs_write on tenant_faqs for all using (is_shop_admin(tenant_id)) with check (is_shop_admin(tenant_id));
grant select, insert, update, delete on tenant_faqs to repairdesk_app;
