-- Declined / cancelled returns wait for the shop too (the user, after 0020): once the return fee is paid (or is zero,
-- or waived) the device goes to dispatch_pending, and a shop admin requests the rider. A failed delivery being
-- rebooked (return_failed -> return_requested) is unchanged: the device was already released once.

delete from job_transitions where from_status = 'return_fee_pending' and to_status = 'return_requested';
insert into job_transitions (from_status, to_status, allowed_actors) values ('return_fee_pending', 'dispatch_pending', array['system']::actor_kind[])
  on conflict do nothing;

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

  perform notify_job(j.id, 'payment.received', jsonb_build_object('amount', format_kes(p.amount_cents), 'receipt', coalesce(p.mpesa_receipt, '')));
  return p;
end $$;
