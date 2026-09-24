-- Platform admin support mode. The console (platform host) and the shop (its own host) have separate cookies,
-- so entering support mode hands over through a single-use token valid for 60 seconds.
create table support_handoffs (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  reason text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table support_handoffs enable row level security;
-- No policies: only the service role reads or writes handoffs.
