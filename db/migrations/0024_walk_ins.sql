-- Walk-in customers (DECISIONS D-42). Staff open the job at the counter with the device in hand: it starts at
-- received_at_shop, the customer accepts the repair terms from an SMS link, the consultation fee is paid (M-Pesa, or
-- cash recorded by a shop admin), and only then does intake lead on to diagnosis. Everything after that is the online
-- flow unchanged.

alter table jobs add column origin text not null default 'online' check (origin in ('online', 'walk_in'));

-- Cash taken at the counter. A cash row names the admin who took it and never carries an M-Pesa receipt.
alter table payments add column method text not null default 'mpesa' check (method in ('mpesa', 'cash'));
alter table payments add column recorded_by uuid references users(id);
alter table payments add constraint payments_cash_recorded check (method <> 'cash' or (recorded_by is not null and mpesa_receipt is null));

insert into job_transitions (from_status, to_status, allowed_actors)
values ('draft', 'received_at_shop', array['technician', 'shop_admin', 'platform_admin']::actor_kind[])
on conflict do nothing;

-- A walk-in may not be diagnosed before the customer has agreed to the terms and paid for the consultation.
create or replace function check_walk_in_ready(j jobs) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if j.origin <> 'walk_in' then return; end if;
  if j.terms_accepted_at is null then
    raise exception 'GUARD: the customer has not accepted the repair terms yet' using errcode = 'P0002';
  end if;
  if paid_cents(j.id, 'pickup_fee') < j.pickup_fee_cents then
    raise exception 'GUARD: the consultation fee has not been paid' using errcode = 'P0002';
  end if;
end $$;

-- The customer's own acceptance, from the SMS link. Idempotent; only the job's customer may call it.
create or replace function accept_walk_in_terms(p_job_id uuid, p_version text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  j jobs%rowtype;
begin
  select * into j from jobs where id = p_job_id for update;
  if j.id is null or not is_job_customer(j.id) then raise exception 'not the customer of this job' using errcode = '42501'; end if;
  if j.origin <> 'walk_in' then raise exception 'GUARD: this job was booked online' using errcode = 'P0002'; end if;
  if j.terms_accepted_at is not null then return false; end if;
  if coalesce(p_version, '') = '' then raise exception 'GUARD: terms version missing' using errcode = 'P0002'; end if;
  update jobs set terms_version = p_version, terms_accepted_at = now() where id = j.id;
  insert into job_events (job_id, tenant_id, event_kind, actor_kind, actor_user_id, payload)
  values (j.id, j.tenant_id, 'terms.accepted', 'customer', j.customer_user_id, jsonb_build_object('terms_version', p_version));
  perform notify_job(j.id, 'walkin.terms_accepted');
  return true;
end $$;

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
    when 'received_at_shop' then
      if j.status = 'draft' then
        -- Only a walk-in skips the pickup, and it needs the same proof of ownership as an online booking.
        if j.origin <> 'walk_in' then raise exception 'GUARD: only a walk-in starts at the shop' using errcode = 'P0002'; end if;
        if not exists (select 1 from job_secrets s where s.job_id = j.id and s.identifier is not null)
           and not exists (select 1 from customer_ids c where c.tenant_id = j.tenant_id and c.user_id = j.customer_user_id and c.photo_path is not null) then
          raise exception 'GUARD: an IMEI/serial, or the customer''s ID with a photo, is required' using errcode = 'P0002';
        end if;
      end if;
    when 'diagnosing' then
      perform check_walk_in_ready(j);
      if not exists (select 1 from intake_checklists where job_id = j.id) then
        raise exception 'GUARD: intake checklist must be completed first' using errcode = 'P0002';
      end if;
      if exists (select 1 from discrepancies where job_id = j.id and acknowledged_at is null) then
        raise exception 'GUARD: customer has not acknowledged the intake discrepancies' using errcode = 'P0002';
      end if;
    when 'intake_ack_pending' then
      perform check_walk_in_ready(j);
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
      if j.status = 'return_fee_pending' then
        -- Declined / cancelled return (0022): only the return delivery is paid for here, there is no repair invoice.
        if j.dropoff_choice is null or j.dropoff_choice = 'collect_at_shop' then
          raise exception 'GUARD: a delivery drop-off is required' using errcode = 'P0002';
        end if;
        if paid_cents(j.id, 'return_fee') < j.return_fee_cents then
          raise exception 'GUARD: return fee has not been paid' using errcode = 'P0002';
        end if;
      else
        select * into inv from invoices where job_id = j.id and status <> 'void';
        if inv.id is null then raise exception 'GUARD: invoice missing' using errcode = 'P0002'; end if;
        if paid_cents(j.id) < inv.total_cents then
          raise exception 'GUARD: invoice balance is not settled (% of %)', paid_cents(j.id), inv.total_cents using errcode = 'P0002';
        end if;
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
      -- 0022: a paid return waits for a shop admin to request the rider, like a repaired one (0020).
      if j.status = 'return_fee_pending' then perform transition_job(j.id, 'dispatch_pending', 'system'); end if;
    when 'supplementary' then
      null;
  end case;

  perform notify_job(j.id, case when p.method = 'cash' then 'payment.received_cash' else 'payment.received' end,
    jsonb_build_object('amount', format_kes(p.amount_cents), 'receipt', coalesce(p.mpesa_receipt, '')));
  return p;
end $$;

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
  -- A walk-in reaching the shop gets the consent request instead of "we have received your device".
  if p_event_key = 'job.received_at_shop' and j.origin = 'walk_in' then p_event_key := 'walkin.received'; end if;
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

insert into notification_templates (tenant_id, event_key, audience, channel, title, body, critical) values
(null, 'walkin.received', 'customer', 'sms', null, '{shop_name}: we have your {device} ({job_ref}). Open this link to accept our repair terms and follow the repair: {job_link}', true),
(null, 'walkin.received', 'customer', 'in_app', 'Accept the repair terms', 'Your {device} is at {shop_name}. Accept the repair terms so the technician can start.', false),
(null, 'walkin.terms_accepted', 'staff', 'in_app', 'Terms accepted', 'The customer accepted the repair terms for {job_ref}.', false),
(null, 'payment.received_cash', 'customer', 'sms', null, '{shop_name}: received {amount} in cash for {job_ref}. {job_link}', true),
(null, 'payment.received_cash', 'customer', 'in_app', 'Payment received', '{amount} received in cash at the counter.', false)
on conflict do nothing;
