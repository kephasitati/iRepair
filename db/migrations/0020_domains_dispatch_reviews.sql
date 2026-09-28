-- (1) Extra domains can land on a specific page (a retail domain opens the Shop).
-- (2) Google Business profile for the About page's reviews section.
-- (3) Dispatch gate: after the final payment a repaired device waits in dispatch_pending until a shop admin requests
--     the courier (previously the rider was booked the instant M-Pesa confirmed).

alter table tenant_domains add column landing_path text not null default '/' check (landing_path in ('/', '/shop', '/about'));

alter table tenant_branding add column google_place_id text check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,300}$');

update job_transitions set allowed_actors = array['shop_admin', 'platform_admin', 'system']::actor_kind[]
  where from_status = 'dispatch_pending' and to_status = 'return_requested';

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

  -- dispatch_pending: collection goes straight to the shelf; delivery waits for a shop admin to request the rider
  -- (0020 — the admin confirms the device is packed and ready before a courier is booked).
  if p_to = 'dispatch_pending' then
    if j.dropoff_choice = 'collect_at_shop' then
      j := transition_job(j.id, 'ready_for_collection', 'system', null, '{}');
    end if;
  elsif p_to = 'quote_declined' then
    j := transition_job(j.id, 'return_fee_pending', 'system', null, '{}');
  end if;

  return j;
end $$;
