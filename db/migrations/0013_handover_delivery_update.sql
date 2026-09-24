-- Deliveries are system-owned: customers can read them but not write them. A verified handover (customer at the door,
-- technician at the bench) updates the delivery through this checked function, in the same transaction as the handover.

create or replace function mark_delivery_handover(p_delivery_id uuid, p_status delivery_status, p_rider jsonb default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d deliveries%rowtype;
begin
  select * into d from deliveries where id = p_delivery_id for update;
  if d.id is null then raise exception 'delivery not found' using errcode = 'P0002'; end if;
  if not (is_trusted_context() or job_visible(d.job_id)) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from handover_events h where h.delivery_id = d.id and h.verified and h.created_at > now() - interval '5 minutes') then
    raise exception 'GUARD: no verified handover for this delivery' using errcode = 'P0002';
  end if;
  update deliveries set status = p_status, rider_snapshot = coalesce(rider_snapshot, p_rider) where id = d.id;
end $$;

grant execute on function mark_delivery_handover(uuid, delivery_status, jsonb) to repairdesk_app, repairdesk_service;
