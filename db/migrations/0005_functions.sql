-- Business functions. All are SECURITY DEFINER so they can write rows the calling role could not touch
-- directly; each one re-checks authorisation itself. See docs/STATE_MACHINE.md.

-- ---------------------------------------------------------------------------
-- References and links
-- ---------------------------------------------------------------------------
create or replace function next_job_ref(tid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  yr int := extract(year from now() at time zone 'Africa/Nairobi')::int;
  n int;
begin
  insert into job_sequences (tenant_id, year, next_value) values (tid, yr, 2)
  on conflict (tenant_id, year) do update set next_value = job_sequences.next_value + 1
  returning next_value - 1 into n;
  return format('DR-%s-%s', to_char(yr, 'FM00')::text, lpad(n::text, 5, '0'));
end $$;

create or replace function next_invoice_number(tid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  yr int := extract(year from now() at time zone 'Africa/Nairobi')::int;
  n int;
begin
  insert into invoice_sequences (tenant_id, year, next_value) values (tid, yr, 2)
  on conflict (tenant_id, year) do update set next_value = invoice_sequences.next_value + 1
  returning next_value - 1 into n;
  return format('INV-%s-%s', yr, lpad(n::text, 6, '0'));
end $$;

create or replace function ensure_short_link(jid uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  code text;
  tid uuid;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select s.code into code from short_links s where s.job_id = jid;
  if code is not null then return code; end if;
  select tenant_id into tid from jobs where id = jid;
  loop
    code := (select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') from generate_series(1, 8));
    begin
      insert into short_links (code, tenant_id, job_id) values (code, tid, jid);
      return code;
    exception when unique_violation then
      if exists (select 1 from short_links s where s.job_id = jid) then
        return (select s.code from short_links s where s.job_id = jid);
      end if;
    end;
  end loop;
end $$;

create or replace function tenant_base_url(tid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when d.hostname like '%localhost%' then 'http://' else 'https://' end || d.hostname
  from tenant_domains d where d.tenant_id = tid and d.is_primary limit 1
$$;

create or replace function format_kes(cents bigint) returns text
language sql immutable as $$
  select 'KES ' || trim(to_char(cents / 100, 'FM999,999,999,999'))
    || case when cents % 100 <> 0 then '.' || lpad((abs(cents) % 100)::text, 2, '0') else '' end
$$;

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create or replace function job_template_vars(jid uuid, extra jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  j jobs%rowtype;
  cust users%rowtype;
  b tenant_branding%rowtype;
  s tenant_settings%rowtype;
  d deliveries%rowtype;
  amount bigint;
  vars jsonb;
  expires timestamptz;
begin
  select * into j from jobs where id = jid;
  select * into cust from users where id = j.customer_user_id;
  select * into b from tenant_branding where tenant_id = j.tenant_id;
  select * into s from tenant_settings where tenant_id = j.tenant_id;
  select * into d from deliveries where job_id = jid order by created_at desc limit 1;

  amount := case j.status
    when 'pickup_fee_pending' then j.pickup_fee_cents
    when 'return_fee_pending' then j.return_fee_cents
    when 'deposit_pending' then (select v.deposit_cents from quotes q join quote_versions v on v.id = q.accepted_version_id where q.job_id = jid and q.kind = 'main')
    when 'quote_sent' then (select v.total_cents from quotes q join quote_versions v on v.id = q.current_version_id where q.job_id = jid and q.kind = 'main')
    when 'quote_negotiating' then (select v.total_cents from quotes q join quote_versions v on v.id = q.current_version_id where q.job_id = jid and q.kind = 'main')
    when 'final_payment_pending' then (select balance_cents from invoices where job_id = jid and status <> 'void')
    else null end;

  select v.expires_at into expires from quotes q join quote_versions v on v.id = q.current_version_id where q.job_id = jid and q.kind = 'main';

  vars := jsonb_build_object(
    'customer_name', coalesce(nullif(split_part(cust.full_name, ' ', 1), ''), 'there'),
    'job_ref', j.ref,
    'shop_name', b.display_name,
    'shop_phone', s.contact_phone,
    'job_link', tenant_base_url(j.tenant_id) || '/l/' || ensure_short_link(jid),
    'device', trim(j.device_brand || ' ' || j.device_model),
    'status', replace(j.status::text, '_', ' '),
    'amount', case when amount is null then '' else format_kes(amount) end,
    'tracking_url', coalesce(d.tracking_url, ''),
    'rider_name', coalesce(d.rider_snapshot ->> 'name', ''),
    'rider_phone', coalesce(d.rider_snapshot ->> 'phone', ''),
    'plate', coalesce(d.rider_snapshot ->> 'plate', ''),
    'expires_at', coalesce(to_char(expires at time zone 'Africa/Nairobi', 'DD Mon HH24:MI'), ''),
    'reason', coalesce(j.cancel_reason, ''),
    'receipt', ''
  );
  return vars || coalesce(extra, '{}');
end $$;

-- Queue every enabled template for an event: tenant override first, else platform default.
create or replace function notify_job(jid uuid, p_event_key text, extra jsonb default '{}') returns int
language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
  s tenant_settings%rowtype;
  cust users%rowtype;
  t record;
  vars jsonb;
  n int := 0;
  body text;
  title text;
  send_after timestamptz;
  staff record;
begin
  select * into j from jobs where id = jid;
  select * into s from tenant_settings where tenant_id = j.tenant_id;
  select * into cust from users where id = j.customer_user_id;
  vars := job_template_vars(jid, extra);

  for t in
    select distinct on (audience, channel) *
    from notification_templates nt
    where nt.event_key = p_event_key and nt.enabled and (nt.tenant_id = j.tenant_id or nt.tenant_id is null)
    order by audience, channel, (nt.tenant_id is not null) desc
  loop
    body := render_template(t.body, vars);
    title := case when t.title is null then null else render_template(t.title, vars) end;
    send_after := now();
    if t.channel = 'sms' and not t.critical then
      send_after := quiet_hours_release(now(), s.quiet_hours_start, s.quiet_hours_end);
    end if;

    if t.audience = 'customer' then
      if t.channel = 'sms' and cust.phone_e164 is null then continue; end if;
      if t.channel = 'email' and cust.email is null then continue; end if;
      insert into notifications (tenant_id, user_id, phone_e164, email, job_id, channel, event_key, title, body, critical, send_after, status)
      values (j.tenant_id, cust.id, case when t.channel = 'sms' then cust.phone_e164 end, case when t.channel = 'email' then cust.email end,
              jid, t.channel, p_event_key, title, body, t.critical, send_after,
              case when send_after > now() then 'held_quiet_hours'::notification_status else 'queued'::notification_status end);
      n := n + 1;
    else
      for staff in
        select u.* , m.role from tenant_memberships m join users u on u.id = m.user_id
        where m.tenant_id = j.tenant_id and m.active and not u.disabled
          and (t.channel = 'in_app' or m.role = 'shop_admin' or u.id = j.assigned_tech_id)
      loop
        if t.channel = 'sms' and staff.phone_e164 is null then continue; end if;
        if t.channel = 'email' and staff.email is null then continue; end if;
        insert into notifications (tenant_id, user_id, phone_e164, email, job_id, channel, event_key, title, body, critical, send_after, status)
        values (j.tenant_id, staff.id, case when t.channel = 'sms' then staff.phone_e164 end, case when t.channel = 'email' then staff.email end,
                jid, t.channel, p_event_key, title, body, t.critical, send_after,
                case when send_after > now() then 'held_quiet_hours'::notification_status else 'queued'::notification_status end);
        n := n + 1;
      end loop;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Timers
-- ---------------------------------------------------------------------------
create or replace function schedule_timer(jid uuid, p_kind timer_kind, p_due timestamptz, p_payload jsonb default '{}') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  tid uuid;
  v_id bigint;
begin
  select tenant_id into tid from jobs where jobs.id = jid;
  insert into timers (tenant_id, job_id, kind, due_at, payload) values (tid, jid, p_kind, p_due, p_payload) returning timers.id into v_id;
  return v_id;
end $$;

create or replace function cancel_timers(jid uuid, p_kinds timer_kind[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update timers set cancelled_at = now()
  where job_id = jid and fired_at is null and cancelled_at is null and (p_kinds is null or kind = any(p_kinds));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Guards: what must be true before entering a state
-- ---------------------------------------------------------------------------
create or replace function paid_cents(jid uuid, p_purpose payment_purpose default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(paid_amount_cents, amount_cents)), 0) from payments
  where job_id = jid and status = 'success' and (p_purpose is null or purpose = p_purpose)
$$;

create or replace function check_transition_guard(j jobs, p_to job_status, p_payload jsonb) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  q quotes%rowtype;
  inv invoices%rowtype;
  n int;
begin
  select * into q from quotes where job_id = j.id and kind = 'main';

  case p_to
    when 'pickup_fee_pending' then
      if j.status = 'draft' then
        select count(*) into n from job_photos where job_id = j.id and stage = 'customer_declared' and deleted_at is null;
        if n < 2 then raise exception 'GUARD: at least two photos (front and back) are required' using errcode = 'P0002'; end if;
        if j.pickup_address is null or j.pickup_window_start is null then raise exception 'GUARD: pickup address and time window are required' using errcode = 'P0002'; end if;
        if not exists (select 1 from job_secrets s where s.job_id = j.id and s.identifier is not null) then
          raise exception 'GUARD: IMEI or serial number is required' using errcode = 'P0002';
        end if;
        if j.pickup_fee_cents <= 0 then raise exception 'GUARD: pickup fee has not been quoted' using errcode = 'P0002'; end if;
      end if;
    when 'pickup_requested' then
      if j.status = 'pickup_fee_pending' and paid_cents(j.id, 'pickup_fee') < j.pickup_fee_cents then
        raise exception 'GUARD: pickup fee has not been paid' using errcode = 'P0002';
      end if;
    when 'diagnosing' then
      if not exists (select 1 from intake_checklists where job_id = j.id) then
        raise exception 'GUARD: intake checklist must be completed first' using errcode = 'P0002';
      end if;
      if exists (select 1 from discrepancies where job_id = j.id and acknowledged_at is null) then
        raise exception 'GUARD: customer has not acknowledged the intake discrepancies' using errcode = 'P0002';
      end if;
    when 'intake_ack_pending' then
      if not exists (select 1 from intake_checklists where job_id = j.id) then
        raise exception 'GUARD: intake checklist must be completed first' using errcode = 'P0002';
      end if;
      if not exists (select 1 from discrepancies where job_id = j.id) then
        raise exception 'GUARD: no discrepancies were recorded' using errcode = 'P0002';
      end if;
    when 'quote_sent' then
      if q.id is null or q.current_version_id is null or not exists (select 1 from quote_versions v where v.id = q.current_version_id and v.sent_at is not null and v.author_side = 'shop') then
        raise exception 'GUARD: a quote version must be sent first' using errcode = 'P0002';
      end if;
    when 'quote_negotiating' then
      if q.id is null or q.status not in ('sent', 'negotiating') then
        raise exception 'GUARD: quote is not open for negotiation' using errcode = 'P0002';
      end if;
    when 'deposit_pending' then
      if q.id is null or q.status <> 'accepted' then
        raise exception 'GUARD: quote must be accepted first' using errcode = 'P0002';
      end if;
    when 'in_repair' then
      if j.status = 'deposit_pending' then
        if q.id is null or q.status <> 'accepted' then raise exception 'GUARD: quote must be accepted' using errcode = 'P0002'; end if;
        if paid_cents(j.id, 'deposit') < coalesce((select deposit_cents from quote_versions where id = q.accepted_version_id), 0) then
          raise exception 'GUARD: deposit has not been paid' using errcode = 'P0002';
        end if;
      end if;
    when 'repair_complete' then
      if j.status = 'in_repair' then
        if not exists (select 1 from completion_checklists where job_id = j.id) then
          raise exception 'GUARD: completion checklist is required' using errcode = 'P0002';
        end if;
        if exists (select 1 from quotes where job_id = j.id and kind = 'supplementary' and status in ('sent', 'negotiating')) then
          raise exception 'GUARD: a supplementary quote is still open' using errcode = 'P0002';
        end if;
      end if;
    when 'final_payment_pending' then
      if j.dropoff_choice is null then raise exception 'GUARD: drop-off choice is required' using errcode = 'P0002'; end if;
      if not exists (select 1 from invoices where job_id = j.id and status = 'proforma') then
        raise exception 'GUARD: proforma invoice has not been prepared' using errcode = 'P0002';
      end if;
    when 'dispatch_pending' then
      select * into inv from invoices where job_id = j.id and status <> 'void';
      if inv.id is null then raise exception 'GUARD: invoice missing' using errcode = 'P0002'; end if;
      if paid_cents(j.id) < inv.total_cents then
        raise exception 'GUARD: invoice balance is not settled (% of %)', paid_cents(j.id), inv.total_cents using errcode = 'P0002';
      end if;
    when 'return_requested' then
      if j.status = 'dispatch_pending' and j.dropoff_choice = 'collect_at_shop' then
        raise exception 'GUARD: customer chose to collect at the shop' using errcode = 'P0002';
      end if;
      if j.status = 'return_fee_pending' and paid_cents(j.id, 'return_fee') < j.return_fee_cents then
        raise exception 'GUARD: return fee has not been paid' using errcode = 'P0002';
      end if;
      if j.status in ('return_fee_pending', 'dispatch_pending', 'return_failed') and j.dropoff_address is null and j.dropoff_choice <> 'pickup_address' then
        raise exception 'GUARD: drop-off address is required' using errcode = 'P0002';
      end if;
    when 'ready_for_collection' then
      if j.status = 'dispatch_pending' and j.dropoff_choice <> 'collect_at_shop' then
        raise exception 'GUARD: customer chose delivery' using errcode = 'P0002';
      end if;
    when 'closed' then
      if j.outcome is distinct from 'repaired' then raise exception 'GUARD: only repaired jobs close as closed' using errcode = 'P0002'; end if;
    when 'declined_returned' then
      if j.outcome is distinct from 'declined' then raise exception 'GUARD: only declined jobs close as declined_returned' using errcode = 'P0002'; end if;
    when 'cancelled' then
      if coalesce(p_payload ->> 'reason', j.cancel_reason) is null and j.status not in ('draft', 'pickup_fee_pending') then
        raise exception 'GUARD: a cancellation reason is required' using errcode = 'P0002';
      end if;
    else null;
  end case;
end $$;

-- Direct status writes are blocked; only transition_job may change jobs.status.
create or replace function jobs_status_guard() returns trigger
language plpgsql as $$
begin
  if new.status <> old.status and coalesce(current_setting('app.in_transition', true), '') <> 'true' then
    raise exception 'jobs.status may only be changed through transition_job()' using errcode = 'P0003';
  end if;
  return new;
end $$;
create trigger jobs_status_guard before update on jobs for each row execute function jobs_status_guard();

-- ---------------------------------------------------------------------------
-- The transition
-- ---------------------------------------------------------------------------
create or replace function transition_job(
  p_job_id uuid,
  p_to job_status,
  p_actor actor_kind,
  p_actor_user_id uuid default null,
  p_payload jsonb default '{}'
) returns jobs
language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
  s tenant_settings%rowtype;
  allowed actor_kind[];
  v_from job_status;
  depth int := coalesce(nullif(current_setting('app.transition_depth', true), ''), '0')::int;
  active_delivery deliveries%rowtype;
  v_due timestamptz;
  fee platform_fee_rules%rowtype;
  fee_cents bigint;
  inv invoices%rowtype;
begin
  select * into j from jobs where id = p_job_id for update;
  if j.id is null then raise exception 'job % not found', p_job_id using errcode = 'P0002'; end if;
  v_from := j.status;

  -- Authorisation. System/provider transitions need a trusted (service) connection unless we are nested.
  if depth = 0 then
    if p_actor in ('system', 'provider') then
      if not is_trusted_context() then raise exception 'actor % requires a trusted context', p_actor using errcode = '42501'; end if;
    elsif p_actor = 'customer' then
      if p_actor_user_id is null or p_actor_user_id <> j.customer_user_id or (not is_trusted_context() and current_user_id() <> j.customer_user_id) then
        raise exception 'not the customer of this job' using errcode = '42501';
      end if;
    elsif p_actor = 'technician' then
      if p_actor_user_id is null or not exists (select 1 from tenant_memberships m where m.tenant_id = j.tenant_id and m.user_id = p_actor_user_id and m.active) then
        raise exception 'not staff of this tenant' using errcode = '42501';
      end if;
      if not is_trusted_context() and not is_tenant_staff(j.tenant_id) then raise exception 'not staff of this tenant' using errcode = '42501'; end if;
    elsif p_actor = 'shop_admin' then
      if p_actor_user_id is null or not exists (select 1 from tenant_memberships m where m.tenant_id = j.tenant_id and m.user_id = p_actor_user_id and m.active and m.role = 'shop_admin') then
        raise exception 'not a shop admin of this tenant' using errcode = '42501';
      end if;
      if not is_trusted_context() and not is_shop_admin(j.tenant_id) then raise exception 'not a shop admin of this tenant' using errcode = '42501'; end if;
    elsif p_actor = 'platform_admin' then
      if p_actor_user_id is null or not exists (select 1 from users u where u.id = p_actor_user_id and u.is_platform_admin and not u.disabled) then
        raise exception 'not a platform admin' using errcode = '42501';
      end if;
      if not is_trusted_context() and not is_impersonating(j.tenant_id) then raise exception 'support mode required' using errcode = '42501'; end if;
    end if;
  end if;

  select t.allowed_actors into allowed from job_transitions t where t.from_status = j.status and t.to_status = p_to;
  if allowed is null or not (p_actor = any(allowed)) then
    raise exception 'Illegal job transition % -> % by %', j.status, p_to, p_actor using errcode = 'P0001';
  end if;

  perform check_transition_guard(j, p_to, p_payload);

  select * into s from tenant_settings where tenant_id = j.tenant_id;

  -- Apply the change.
  perform set_config('app.in_transition', 'true', true);
  perform set_config('app.transition_depth', (depth + 1)::text, true);

  update jobs set
    status = p_to,
    outcome = case
      when p_to = 'cancelled' then 'cancelled'::job_outcome
      when p_to = 'quote_declined' then 'declined'
      when p_to = 'return_fee_pending' and j.outcome is null then coalesce((p_payload ->> 'outcome')::job_outcome, 'declined')
      when p_to = 'in_repair' and j.outcome is null then 'repaired'
      else j.outcome end,
    cancel_reason = coalesce(p_payload ->> 'reason', cancel_reason),
    dropoff_choice = case when p_to = 'ready_for_collection' then 'collect_at_shop'::dropoff_choice else dropoff_choice end,
    intake_discrepancy = case when p_to = 'intake_ack_pending' then true else intake_discrepancy end,
    warranty_until = case when p_to in ('delivered', 'ready_for_collection') and j.outcome = 'repaired' and warranty_until is null
                          then (now() at time zone 'Africa/Nairobi')::date + s.warranty_days else warranty_until end,
    closed_at = case when p_to in ('closed', 'cancelled', 'declined_returned') then now() else closed_at end
  where id = j.id
  returning * into j;

  insert into job_events (job_id, tenant_id, from_status, to_status, event_kind, actor_kind, actor_user_id, payload)
  values (j.id, j.tenant_id, v_from, p_to, 'transition', p_actor, p_actor_user_id, coalesce(p_payload, '{}'));

  -- Timers: cancel those that do not survive the new state, then schedule the new state's timers.
  update timers t set cancelled_at = now()
  from timer_alive_in a
  where t.job_id = j.id and t.fired_at is null and t.cancelled_at is null and a.kind = t.kind and not (p_to = any(a.statuses));

  case p_to
    when 'quote_sent' then
      select v.expires_at into v_due from quotes q join quote_versions v on v.id = q.current_version_id where q.job_id = j.id and q.kind = 'main';
      perform cancel_timers(j.id, array['quote_expiry']::timer_kind[]);
      if v_due is not null then perform schedule_timer(j.id, 'quote_expiry', v_due); end if;
    when 'quote_expired' then
      perform schedule_timer(j.id, 'expired_quote_autodecline', now() + make_interval(days => s.expired_quote_autodecline_days));
    when 'deposit_pending' then
      perform schedule_timer(j.id, 'deposit_reminder', now() + interval '24 hours');
    when 'final_payment_pending' then
      perform schedule_timer(j.id, 'final_payment_reminder', now() + interval '24 hours');
    when 'repair_complete' then
      perform schedule_timer(j.id, 'dropoff_reminder', now() + interval '24 hours', '{"count":1}');
      perform schedule_timer(j.id, 'unclaimed_alert', now() + make_interval(days => s.unclaimed_after_days));
    when 'ready_for_collection', 'return_failed' then
      perform schedule_timer(j.id, 'unclaimed_alert', now() + make_interval(days => s.unclaimed_after_days));
    when 'delivered' then
      perform schedule_timer(j.id, 'auto_close', now() + make_interval(hours => s.auto_close_hours));
    else null;
  end case;

  -- Outbox: courier side effects.
  if p_to = 'pickup_requested' then
    insert into outbox (tenant_id, kind, payload, dedupe_key)
    values (j.tenant_id, 'delivery.create', jsonb_build_object('job_id', j.id, 'leg', 'pickup'),
            'delivery.create:' || j.id || ':pickup:' || (select count(*) from job_events where job_id = j.id and to_status = 'pickup_requested'));
  elsif p_to = 'return_requested' then
    insert into outbox (tenant_id, kind, payload, dedupe_key)
    values (j.tenant_id, 'delivery.create', jsonb_build_object('job_id', j.id, 'leg', 'return'),
            'delivery.create:' || j.id || ':return:' || (select count(*) from job_events where job_id = j.id and to_status = 'return_requested'));
  elsif p_to in ('cancelled', 'pickup_failed', 'return_failed') then
    select * into active_delivery from deliveries d where d.job_id = j.id
      and d.status in ('requested', 'rider_assigned', 'rider_en_route', 'picked_up', 'in_transit')
      order by created_at desc limit 1;
    if active_delivery.id is not null and p_to = 'cancelled' then
      insert into outbox (tenant_id, kind, payload, dedupe_key)
      values (j.tenant_id, 'delivery.cancel', jsonb_build_object('delivery_id', active_delivery.id), 'delivery.cancel:' || active_delivery.id)
      on conflict do nothing;
    end if;
  end if;

  -- Terminal housekeeping: purge the passcode, record the platform fee.
  if p_to in ('closed', 'cancelled', 'declined_returned') then
    update job_secrets set passcode_enc = null, passcode_key_version = null, purged_at = now() where job_id = j.id and passcode_enc is not null;
    select * into fee from platform_fee_rules where tenant_id = j.tenant_id and effective_from <= now() order by effective_from desc limit 1;
    if fee.id is not null then
      select * into inv from invoices where job_id = j.id and status = 'issued';
      fee_cents := case fee.kind when 'flat' then fee.value else coalesce(inv.total_cents, 0) * fee.value / 10000 end;
      insert into platform_fee_ledger (tenant_id, job_id, amount_cents, basis)
      values (j.tenant_id, j.id, fee_cents, jsonb_build_object('rule_id', fee.id, 'kind', fee.kind, 'value', fee.value, 'invoice_total_cents', inv.total_cents))
      on conflict (job_id) do nothing;
    end if;
  end if;

  -- Notifications for this state.
  perform notify_job(j.id, 'job.' || p_to::text, coalesce(p_payload -> 'vars', '{}'));

  perform set_config('app.transition_depth', depth::text, true);
  if depth = 0 then perform set_config('app.in_transition', '', true); end if;

  -- dispatch_pending is momentary: go straight on to the return leg or the collection shelf.
  if p_to = 'dispatch_pending' then
    if j.dropoff_choice = 'collect_at_shop' then
      j := transition_job(j.id, 'ready_for_collection', 'system', null, '{}');
    else
      j := transition_job(j.id, 'return_requested', 'system', null, '{}');
    end if;
  elsif p_to = 'quote_declined' then
    j := transition_job(j.id, 'return_fee_pending', 'system', null, '{}');
  end if;

  return j;
end $$;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
-- Called by the M-Pesa callback handler and by the reconciliation job. Idempotent: a payment that is already
-- terminal is returned unchanged. Success records the receipt and performs the job transition in this transaction.
create or replace function confirm_payment(
  p_checkout_request_id text,
  p_result_code int,
  p_result_desc text,
  p_receipt text default null,
  p_paid_amount_cents bigint default null,
  p_raw jsonb default null
) returns payments
language plpgsql security definer set search_path = public as $$
declare
  p payments%rowtype;
  j jobs%rowtype;
  new_status payment_status;
  inv invoices%rowtype;
begin
  if not is_trusted_context() then raise exception 'confirm_payment requires a trusted context' using errcode = '42501'; end if;

  select * into p from payments where checkout_request_id = p_checkout_request_id for update;
  if p.id is null then raise exception 'payment with CheckoutRequestID % not found', p_checkout_request_id using errcode = 'P0002'; end if;
  if p.status in ('success', 'failed', 'timeout', 'cancelled') then return p; end if;

  new_status := case p_result_code
    when 0 then 'success'::payment_status
    when 1032 then 'cancelled'
    when 1037 then 'timeout'
    else 'failed' end;

  if new_status = 'success' and p_paid_amount_cents is not null and p_paid_amount_cents <> p.amount_cents then
    -- Never accept a partial or mismatched amount silently.
    update payments set status = 'failed', result_code = p_result_code, result_desc = format('Amount mismatch: expected %s got %s', p.amount_cents, p_paid_amount_cents),
      mpesa_receipt = p_receipt, paid_amount_cents = p_paid_amount_cents, raw_callback = coalesce(p_raw, raw_callback) where id = p.id returning * into p;
    return p;
  end if;

  update payments set status = new_status, result_code = p_result_code, result_desc = p_result_desc,
    mpesa_receipt = case when new_status = 'success' then p_receipt else mpesa_receipt end,
    paid_amount_cents = case when new_status = 'success' then coalesce(p_paid_amount_cents, amount_cents) end,
    raw_callback = coalesce(p_raw, raw_callback), confirmed_at = case when new_status = 'success' then now() end
  where id = p.id returning * into p;

  update timers set cancelled_at = now() where payment_id = p.id and fired_at is null and cancelled_at is null;

  if new_status <> 'success' then return p; end if;

  select * into j from jobs where id = p.job_id;

  -- Keep the invoice's paid/balance current whenever one exists.
  update invoices set paid_cents = paid_cents(p.job_id), balance_cents = total_cents - paid_cents(p.job_id)
  where job_id = p.job_id and status <> 'void';

  case p.purpose
    when 'pickup_fee' then
      if j.status = 'pickup_fee_pending' then perform transition_job(j.id, 'pickup_requested', 'system'); end if;
    when 'deposit' then
      if j.status = 'deposit_pending' then perform transition_job(j.id, 'in_repair', 'system'); end if;
    when 'final_balance' then
      select * into inv from invoices where job_id = j.id and status <> 'void';
      if j.status = 'final_payment_pending' and paid_cents(j.id) >= inv.total_cents then
        update invoices set status = 'issued', number = coalesce(number, next_invoice_number(j.tenant_id)), issued_at = coalesce(issued_at, now()) where id = inv.id;
        insert into outbox (tenant_id, kind, payload, dedupe_key) values (j.tenant_id, 'invoice.pdf', jsonb_build_object('invoice_id', inv.id), 'invoice.pdf:' || inv.id) on conflict do nothing;
        perform transition_job(j.id, 'dispatch_pending', 'system');
      end if;
    when 'return_fee' then
      if j.status = 'return_fee_pending' then perform transition_job(j.id, 'return_requested', 'system'); end if;
    when 'supplementary' then
      null;
  end case;

  perform notify_job(j.id, 'payment.received', jsonb_build_object('amount', format_kes(p.amount_cents), 'receipt', coalesce(p.mpesa_receipt, '')));
  return p;
end $$;
