-- Row Level Security. repairdesk_app is subject to every policy below; repairdesk_service bypasses RLS.
-- Tables with RLS enabled and no policy are unreachable by the app role (sessions, otp_codes, outbox, ...).

grant usage on schema public to repairdesk_app, repairdesk_service;
grant select, insert, update, delete on all tables in schema public to repairdesk_app, repairdesk_service;
grant usage, select on all sequences in schema public to repairdesk_app, repairdesk_service;
grant execute on all functions in schema public to repairdesk_app, repairdesk_service;
alter default privileges in schema public grant select, insert, update, delete on tables to repairdesk_app, repairdesk_service;
alter default privileges in schema public grant usage, select on sequences to repairdesk_app, repairdesk_service;
alter default privileges in schema public grant execute on functions to repairdesk_app, repairdesk_service;

-- ---------------------------------------------------------------------------
-- Access helpers (security definer so they can read tables the caller may not)
-- ---------------------------------------------------------------------------
create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_platform_admin and not disabled from users where id = current_user_id()), false)
$$;

-- Platform admin support mode: the app sets app.impersonating = 'true' together with app.tenant_id.
create or replace function is_impersonating(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(current_setting('app.impersonating', true), '') = 'true'
     and tid = current_tenant_id()
     and is_platform_admin()
$$;

create or replace function has_tenant_role(tid uuid, roles membership_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_impersonating(tid) or exists (
    select 1 from tenant_memberships m
    where m.tenant_id = tid and m.user_id = current_user_id() and m.active and m.role = any(roles)
  )
$$;

create or replace function is_tenant_staff(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_tenant_role(tid, array['technician', 'shop_admin']::membership_role[])
$$;

create or replace function is_shop_admin(tid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select has_tenant_role(tid, array['shop_admin']::membership_role[])
$$;

create or replace function is_job_customer(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs j where j.id = jid and j.customer_user_id = current_user_id() and j.tenant_id = current_tenant_id())
$$;

create or replace function is_assigned_tech(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs j where j.id = jid and j.assigned_tech_id = current_user_id() and is_tenant_staff(j.tenant_id))
$$;

create or replace function job_visible(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jobs j where j.id = jid and (
      (j.customer_user_id = current_user_id() and j.tenant_id = current_tenant_id())
      or is_tenant_staff(j.tenant_id)
      or is_platform_admin()
    )
  )
$$;

create or replace function job_staff(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs j where j.id = jid and is_tenant_staff(j.tenant_id))
$$;

-- IMEI/serial and passcode: customer, assigned technician, shop_admin (COMPLIANCE.md §2).
create or replace function can_see_job_secrets(jid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jobs j where j.id = jid and (
      (j.customer_user_id = current_user_id() and j.tenant_id = current_tenant_id())
      or (j.assigned_tech_id = current_user_id() and is_tenant_staff(j.tenant_id))
      or is_shop_admin(j.tenant_id)
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Reference tables readable by everyone.
create policy read_all on job_transitions for select using (true);
create policy read_all on timer_alive_in for select using (true);

-- users
create policy users_select on users for select using (
  id = current_user_id()
  or is_platform_admin()
  or exists (select 1 from jobs j where j.customer_user_id = users.id and is_tenant_staff(j.tenant_id))
  or exists (select 1 from tenant_memberships m where m.user_id = users.id and is_tenant_staff(m.tenant_id))
);
create policy users_update on users for update using (id = current_user_id()) with check (id = current_user_id() and is_platform_admin() = (select u.is_platform_admin from users u where u.id = current_user_id()));

-- tenants and config
create policy tenants_select on tenants for select using (id = current_tenant_id() or is_tenant_staff(id) or is_platform_admin());
create policy tenants_admin on tenants for all using (is_platform_admin()) with check (is_platform_admin());

create policy tenant_domains_select on tenant_domains for select using (tenant_id = current_tenant_id() or is_tenant_staff(tenant_id) or is_platform_admin());
create policy tenant_domains_admin on tenant_domains for all using (is_platform_admin()) with check (is_platform_admin());

create policy tenant_branding_select on tenant_branding for select using (tenant_id = current_tenant_id() or is_tenant_staff(tenant_id) or is_platform_admin());
create policy tenant_branding_write on tenant_branding for all using (is_shop_admin(tenant_id) or is_platform_admin()) with check (is_shop_admin(tenant_id) or is_platform_admin());

create policy tenant_settings_select on tenant_settings for select using (tenant_id = current_tenant_id() or is_tenant_staff(tenant_id) or is_platform_admin());
create policy tenant_settings_write on tenant_settings for all using (is_shop_admin(tenant_id) or is_platform_admin()) with check (is_shop_admin(tenant_id) or is_platform_admin());

create policy tenant_secrets_admin on tenant_secrets for all using (is_shop_admin(tenant_id)) with check (is_shop_admin(tenant_id));

create policy memberships_select on tenant_memberships for select using (user_id = current_user_id() or is_tenant_staff(tenant_id) or is_platform_admin());
create policy memberships_write on tenant_memberships for all using (is_shop_admin(tenant_id) or is_platform_admin()) with check (is_shop_admin(tenant_id) or is_platform_admin());

create policy fee_rules_select on platform_fee_rules for select using (is_shop_admin(tenant_id) or is_platform_admin());
create policy fee_rules_admin on platform_fee_rules for all using (is_platform_admin()) with check (is_platform_admin());
create policy fee_ledger_select on platform_fee_ledger for select using (is_shop_admin(tenant_id) or is_platform_admin());

-- customer-owned
create policy addresses_own on addresses for all using (user_id = current_user_id()) with check (user_id = current_user_id());
create policy devices_own on devices for all using (user_id = current_user_id()) with check (user_id = current_user_id());

-- jobs
create policy jobs_select on jobs for select using (
  (customer_user_id = current_user_id() and tenant_id = current_tenant_id()) or is_tenant_staff(tenant_id) or is_platform_admin()
);
create policy jobs_insert on jobs for insert with check (
  customer_user_id = current_user_id() and tenant_id = current_tenant_id() and status = 'draft'
);
create policy jobs_update on jobs for update using (
  (customer_user_id = current_user_id() and tenant_id = current_tenant_id()) or is_tenant_staff(tenant_id)
) with check (
  (customer_user_id = current_user_id() and tenant_id = current_tenant_id()) or is_tenant_staff(tenant_id)
);

create policy job_secrets_select on job_secrets for select using (can_see_job_secrets(job_id));
create policy job_secrets_insert on job_secrets for insert with check (is_job_customer(job_id));
create policy job_secrets_update on job_secrets for update using (can_see_job_secrets(job_id)) with check (can_see_job_secrets(job_id));

create policy job_events_select on job_events for select using (job_visible(job_id));
create policy job_events_insert on job_events for insert with check (
  job_visible(job_id) and event_kind <> 'transition' and actor_kind not in ('system', 'provider')
  and (actor_user_id = current_user_id())
);

create policy job_photos_select on job_photos for select using (job_visible(job_id));
create policy job_photos_insert on job_photos for insert with check (
  (is_job_customer(job_id) and stage in ('customer_declared', 'handover')) or job_staff(job_id)
);
create policy job_photos_update on job_photos for update using (job_staff(job_id)) with check (job_staff(job_id));

create policy intake_select on intake_checklists for select using (job_visible(job_id));
create policy intake_write on intake_checklists for all using (job_staff(job_id)) with check (job_staff(job_id));

create policy discrepancies_select on discrepancies for select using (job_visible(job_id));
create policy discrepancies_staff on discrepancies for insert with check (job_staff(job_id));
create policy discrepancies_update on discrepancies for update using (job_visible(job_id)) with check (job_visible(job_id));

create policy progress_select on job_progress_updates for select using (job_visible(job_id) and (not internal or job_staff(job_id)));
create policy progress_write on job_progress_updates for all using (job_staff(job_id)) with check (job_staff(job_id));

create policy completion_select on completion_checklists for select using (job_visible(job_id));
create policy completion_write on completion_checklists for all using (job_staff(job_id)) with check (job_staff(job_id));

create policy ratings_select on ratings for select using (job_visible(job_id));
create policy ratings_insert on ratings for insert with check (is_job_customer(job_id));

create policy disputes_select on disputes for select using (job_visible(job_id));
create policy disputes_insert on disputes for insert with check (job_visible(job_id) and opened_by = current_user_id());
create policy disputes_update on disputes for update using (job_staff(job_id)) with check (job_staff(job_id));

-- quotes
create policy parts_select on parts_catalogue for select using (
  is_tenant_staff(tenant_id) or is_platform_admin() or (published and active and tenant_id = current_tenant_id())
);
create policy parts_write on parts_catalogue for all using (is_shop_admin(tenant_id)) with check (is_shop_admin(tenant_id));

create policy quotes_select on quotes for select using (job_visible(job_id) and (status <> 'draft' or job_staff(job_id)));
create policy quotes_write on quotes for all using (job_staff(job_id)) with check (job_staff(job_id));

create policy quote_versions_select on quote_versions for select using (
  exists (select 1 from quotes q where q.id = quote_id and job_visible(q.job_id) and (sent_at is not null or job_staff(q.job_id)))
);
create policy quote_versions_write on quote_versions for all using (
  exists (select 1 from quotes q where q.id = quote_id and job_staff(q.job_id))
) with check (exists (select 1 from quotes q where q.id = quote_id and job_staff(q.job_id)));

create policy quote_lines_select on quote_line_items for select using (
  exists (select 1 from quote_versions v join quotes q on q.id = v.quote_id where v.id = quote_version_id and job_visible(q.job_id) and (v.sent_at is not null or job_staff(q.job_id)))
);
create policy quote_lines_write on quote_line_items for all using (
  exists (select 1 from quote_versions v join quotes q on q.id = v.quote_id where v.id = quote_version_id and job_staff(q.job_id))
) with check (exists (select 1 from quote_versions v join quotes q on q.id = v.quote_id where v.id = quote_version_id and job_staff(q.job_id)));

create policy negotiations_select on negotiations for select using (exists (select 1 from quotes q where q.id = quote_id and job_visible(q.job_id)));
create policy negotiations_insert on negotiations for insert with check (
  author_user_id = current_user_id() and exists (
    select 1 from quotes q where q.id = quote_id and (
      (author_side = 'customer' and is_job_customer(q.job_id)) or (author_side = 'shop' and job_staff(q.job_id))
    )
  )
);

-- logistics
create policy deliveries_select on deliveries for select using (job_visible(job_id));
create policy deliveries_write on deliveries for all using (job_staff(job_id)) with check (job_staff(job_id));

create policy handovers_select on handover_events for select using (job_visible(job_id));
create policy handovers_insert on handover_events for insert with check (job_visible(job_id) and actor_user_id = current_user_id());

-- money
create policy payments_select on payments for select using (job_visible(job_id));
create policy refunds_select on refunds for select using (job_visible(job_id));
create policy refunds_insert on refunds for insert with check (is_shop_admin(tenant_id) and recorded_by = current_user_id());
create policy invoices_select on invoices for select using (job_visible(job_id));

-- messaging
create policy templates_select on notification_templates for select using (tenant_id is null or is_tenant_staff(tenant_id) or is_platform_admin());
create policy templates_write on notification_templates for all using (
  (tenant_id is not null and is_shop_admin(tenant_id)) or is_platform_admin()
) with check ((tenant_id is not null and is_shop_admin(tenant_id)) or is_platform_admin());

create policy notifications_own on notifications for select using (user_id = current_user_id() and channel = 'in_app');
create policy notifications_read on notifications for update using (user_id = current_user_id()) with check (user_id = current_user_id());
create policy notifications_admin on notifications for select using (is_shop_admin(tenant_id) or is_platform_admin());

create policy outbox_monitor on outbox for select using (is_platform_admin());
create policy webhook_monitor on webhook_events for select using (is_platform_admin());
create policy timers_staff on timers for select using (is_tenant_staff(tenant_id) or is_platform_admin());

create policy audit_select on audit_log for select using ((tenant_id is not null and is_shop_admin(tenant_id)) or is_platform_admin());
create policy audit_insert on audit_log for insert with check (actor_user_id = current_user_id());

create policy short_links_select on short_links for select using (job_visible(job_id));
