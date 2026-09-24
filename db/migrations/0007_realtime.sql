-- Live updates (replaces Supabase Realtime). Triggers publish tiny payloads with pg_notify; the web app holds one
-- LISTEN connection and fans events out to browsers over server-sent events (app/api/events/route.ts).
-- Payloads carry ids only; the browser re-fetches through RLS, so nothing sensitive crosses the channel.

create or replace function notify_job_change() returns trigger
language plpgsql as $$
begin
  perform pg_notify('rd_events', json_build_object('t', 'job', 'job_id', new.job_id, 'tenant_id', new.tenant_id)::text);
  return new;
end $$;

create trigger job_events_notify after insert on job_events for each row execute function notify_job_change();

create or replace function notify_job_change_quote() returns trigger
language plpgsql as $$
declare jid uuid;
begin
  select job_id into jid from quotes where id = new.quote_id;
  perform pg_notify('rd_events', json_build_object('t', 'job', 'job_id', jid, 'tenant_id', new.tenant_id)::text);
  return new;
end $$;
create trigger negotiations_notify after insert on negotiations for each row execute function notify_job_change_quote();

create or replace function notify_notification() returns trigger
language plpgsql as $$
begin
  if new.channel = 'in_app' and new.user_id is not null then
    perform pg_notify('rd_events', json_build_object('t', 'notification', 'user_id', new.user_id, 'job_id', new.job_id, 'tenant_id', new.tenant_id)::text);
  end if;
  return new;
end $$;
create trigger notifications_notify after insert on notifications for each row execute function notify_notification();

create or replace function notify_payment() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then
    perform pg_notify('rd_events', json_build_object('t', 'job', 'job_id', new.job_id, 'tenant_id', new.tenant_id, 'payment_id', new.id)::text);
  end if;
  return new;
end $$;
create trigger payments_notify after update on payments for each row execute function notify_payment();

create or replace function notify_delivery() returns trigger
language plpgsql as $$
begin
  perform pg_notify('rd_events', json_build_object('t', 'job', 'job_id', new.job_id, 'tenant_id', new.tenant_id)::text);
  return new;
end $$;
create trigger deliveries_notify after insert or update on deliveries for each row execute function notify_delivery();
