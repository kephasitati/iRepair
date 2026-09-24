-- Extensions and request-context helpers. Every app transaction starts with
--   select set_config('app.user_id', '<uuid>', true), set_config('app.tenant_id', '<uuid>', true);
-- The service role additionally sets app.trusted = 'true', which unlocks system/provider transitions.

create extension if not exists pgcrypto;

create or replace function current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function current_tenant_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function is_trusted_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.trusted', true), '') = 'true'
$$;

-- Generic updated_at maintenance.
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Append-only guard for event and audit tables.
create or replace function reject_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'table % is append-only', tg_table_name using errcode = 'P0001';
end $$;

-- {var} template rendering with exactly the same semantics as lib/core/templates.ts:
-- known variables (keys present in the vars object) are replaced, unknown ones are left as-is.
create or replace function render_template(body text, vars jsonb) returns text
language plpgsql immutable as $$
declare
  k text;
  out text := body;
begin
  for k in select jsonb_object_keys(vars) loop
    out := replace(out, '{' || k || '}', coalesce(vars ->> k, ''));
  end loop;
  return out;
end $$;

-- Nairobi is UTC+3 with no DST.
create or replace function nairobi_minute_of_day(ts timestamptz) returns int
language sql immutable as $$
  select (extract(hour from (ts at time zone 'Africa/Nairobi'))::int * 60
        + extract(minute from (ts at time zone 'Africa/Nairobi'))::int)
$$;

create or replace function in_quiet_hours(ts timestamptz, q_start time, q_end time) returns boolean
language sql immutable as $$
  select case
    when q_start = q_end then false
    when q_start < q_end then (ts at time zone 'Africa/Nairobi')::time >= q_start and (ts at time zone 'Africa/Nairobi')::time < q_end
    else (ts at time zone 'Africa/Nairobi')::time >= q_start or (ts at time zone 'Africa/Nairobi')::time < q_end
  end
$$;

-- When quiet hours end, or ts itself if not inside them.
create or replace function quiet_hours_release(ts timestamptz, q_start time, q_end time) returns timestamptz
language plpgsql immutable as $$
declare
  local_date date := (ts at time zone 'Africa/Nairobi')::date;
  candidate timestamptz;
begin
  if not in_quiet_hours(ts, q_start, q_end) then
    return ts;
  end if;
  candidate := (local_date + q_end) at time zone 'Africa/Nairobi';
  if candidate <= ts then
    candidate := candidate + interval '1 day';
  end if;
  return candidate;
end $$;
