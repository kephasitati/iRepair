-- Cookie consent records (Kenya Data Protection Act 2019, s.32: the controller must be able to prove consent) and
-- acceptance of the shop's Terms of Service at booking.

create table cookie_consents (
  id bigint generated always as identity primary key,
  tenant_id uuid references tenants(id) on delete cascade,
  visitor_id text not null,               -- random id kept in the rd_vid cookie, so a choice can be updated or withdrawn
  user_id uuid references users(id) on delete set null,
  necessary boolean not null default true,
  analytics boolean not null default false,
  marketing boolean not null default false,
  policy_version text not null,
  ip_hash text,                           -- sha256(ip + daily salt), never the raw IP
  user_agent text,
  created_at timestamptz not null default now()
);
create index cookie_consents_visitor_idx on cookie_consents(visitor_id, created_at desc);
create index cookie_consents_tenant_idx on cookie_consents(tenant_id, created_at desc);
alter table cookie_consents enable row level security;
create policy consents_admin on cookie_consents for select using ((tenant_id is not null and is_shop_admin(tenant_id)) or is_platform_admin());
create policy consents_own on cookie_consents for select using (user_id = current_user_id());

alter table jobs add column terms_version text;
alter table jobs add column terms_accepted_at timestamptz;

-- The customer must accept the Terms of Service before the booking is submitted.
create or replace function check_terms_accepted() returns trigger
language plpgsql as $$
begin
  if new.status = 'pickup_fee_pending' and old.status = 'draft' and new.terms_accepted_at is null then
    raise exception 'GUARD: please accept the Terms of Service to book' using errcode = 'P0002';
  end if;
  return new;
end $$;
create trigger jobs_terms_guard before update of status on jobs for each row execute function check_terms_accepted();
