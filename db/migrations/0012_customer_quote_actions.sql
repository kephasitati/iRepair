-- Customers never write to quotes directly (RLS allows staff only, and a blocked UPDATE silently changes nothing).
-- Their three quote actions go through this function, which checks ownership and enforces the rules in one place.

create or replace function customer_quote_action(p_quote_id uuid, p_action text, p_version_id uuid default null)
returns quotes
language plpgsql security definer set search_path = public as $$
declare
  q quotes%rowtype;
  j jobs%rowtype;
  v quote_versions%rowtype;
  max_rounds int;
begin
  select * into q from quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'GUARD: quote not found' using errcode = 'P0002'; end if;
  select * into j from jobs where id = q.job_id;
  if not (is_trusted_context() or (j.customer_user_id = current_user_id() and j.tenant_id = current_tenant_id())) then
    raise exception 'not the customer of this job' using errcode = '42501';
  end if;

  if p_action = 'counter' then
    if q.status not in ('sent', 'negotiating') then raise exception 'GUARD: this quote is not open for negotiation' using errcode = 'P0002'; end if;
    select max_negotiation_rounds into max_rounds from tenant_settings where tenant_id = q.tenant_id;
    if q.rounds_used >= max_rounds then raise exception 'GUARD: no more counter-offers are allowed; please accept or decline' using errcode = 'P0002'; end if;
    update quotes set status = 'negotiating', rounds_used = rounds_used + 1 where id = q.id returning * into q;

  elsif p_action = 'accept' then
    if q.status not in ('sent', 'negotiating') then raise exception 'GUARD: this quote can no longer be accepted' using errcode = 'P0002'; end if;
    if p_version_id is distinct from q.current_version_id then raise exception 'GUARD: the quote has changed; please review the latest version' using errcode = 'P0002'; end if;
    select * into v from quote_versions where id = q.current_version_id;
    if v.expires_at is not null and v.expires_at < now() then raise exception 'GUARD: this quote has expired; ask the shop for a new one' using errcode = 'P0002'; end if;
    update quotes set status = 'accepted', accepted_version_id = v.id, accepted_total_cents = v.total_cents, accepted_at = now() where id = q.id returning * into q;

  elsif p_action = 'decline' then
    if q.status not in ('sent', 'negotiating', 'expired') then raise exception 'GUARD: this quote can no longer be declined' using errcode = 'P0002'; end if;
    update quotes set status = 'declined' where id = q.id returning * into q;

  else
    raise exception 'unknown quote action %', p_action;
  end if;
  return q;
end $$;

grant execute on function customer_quote_action(uuid, text, uuid) to repairdesk_app, repairdesk_service;
