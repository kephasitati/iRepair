-- Account-security hardening (DECISIONS D-40).
--
-- 1. A session records how it was signed in. Staff and platform powers come only from a password sign-in; a phone
--    OTP session is always a customer session, in the app and in these RLS helpers alike.
-- 2. users.password_set_at marks a password the person chose. Invite-created accounts carry a random placeholder until
--    they accept, and accepting an invite never replaces a password someone already set.
-- 3. The app role may only update the users columns a customer can edit (name, email).
-- 4. The trusted-context flag cannot be raised by the app role itself.

-- 1 -------------------------------------------------------------------------
alter table sessions add column auth_method text not null default 'otp' check (auth_method in ('otp', 'password'));
-- Live sessions of people who have a password came from the staff or platform sign-in.
update sessions s set auth_method = 'password' from users u where u.id = s.user_id and u.password_hash is not null;

create or replace function is_password_session() returns boolean
language sql stable as $$
  -- Unset (worker, webhooks, tests) counts as a password session; only the app marks a request as OTP.
  select coalesce(current_setting('app.auth_method', true), '') <> 'otp'
$$;

create or replace function is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select is_password_session()
     and coalesce((select is_platform_admin and not disabled from users where id = current_user_id()), false)
$$;

create or replace function has_tenant_role(tid uuid, roles membership_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select is_impersonating(tid) or (is_password_session() and exists (
    select 1 from tenant_memberships m
    where m.tenant_id = tid and m.user_id = current_user_id() and m.active and m.role = any(roles)
  ))
$$;

-- 2 -------------------------------------------------------------------------
alter table users add column password_set_at timestamptz;
-- Anyone who has accepted an invite, or is a platform admin, chose their own password.
update users u set password_set_at = coalesce(u.last_login_at, u.created_at)
where u.password_hash is not null
  and (u.is_platform_admin or exists (select 1 from tenant_memberships m where m.user_id = u.id and m.invite_token_hash is null));

-- 3 -------------------------------------------------------------------------
revoke update on users from repairdesk_app;
grant update (full_name, email) on users to repairdesk_app;
-- The old check compared is_platform_admin through a subquery on users itself, which Postgres rejects as infinite
-- recursion, so no customer could save their name or email. The column grant above is the real protection now.
drop policy users_update on users;
create policy users_update on users for update using (id = current_user_id()) with check (id = current_user_id());

-- 4 -------------------------------------------------------------------------
create or replace function is_trusted_context() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.trusted', true), '') = 'true' and session_user <> 'repairdesk_app'
$$;
