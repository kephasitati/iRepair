-- Runs once when the Postgres container is first created (docker-entrypoint-initdb.d).
-- Production: run the same statements by hand with strong passwords (docs/DEPLOY.md).
--
--   repairdesk_owner    owns the schema, runs migrations (POSTGRES_USER in docker-compose)
--   repairdesk_app      the web app. Row Level Security is enforced; identity comes from
--                       set_config('app.user_id' / 'app.tenant_id') at the start of each transaction.
--   repairdesk_service  worker, webhooks, scheduler. Bypasses RLS, may run system transitions.

create role repairdesk_app login password 'app_dev_password' nobypassrls;
create role repairdesk_service login password 'service_dev_password' bypassrls;
