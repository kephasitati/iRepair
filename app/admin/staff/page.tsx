import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Field, NativeSelect, Section } from '@/components/fields';
import { ActionForm, InviteResult } from '@/components/action-form';
import { requestCtx, requireStaff } from '@/lib/auth';
import { formatDate } from '@/lib/core/time';
import { withUser } from '@/lib/db';
import { inviteStaffAction, updateMemberAction } from '@/app/admin/actions';

export const metadata = { title: 'Staff' };

export default async function StaffPage() {
  const { tenant, session } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const members = await withUser(ctx, (tx) => tx`
    select u.id, u.full_name, u.email, u.phone_e164, u.totp_enabled, u.last_login_at, m.role, m.active, m.invite_expires_at,
      (select count(*) from jobs j where j.assigned_tech_id = u.id and j.tenant_id = ${tenant.id} and j.status not in ('closed', 'cancelled', 'declined_returned'))::int as open_jobs
    from tenant_memberships m join users u on u.id = m.user_id where m.tenant_id = ${tenant.id} order by m.active desc, u.full_name`);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Staff</h1>
      <Section>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {m.full_name || m.email} {m.id === session.user.id ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.email} · {m.open_jobs} open jobs · {m.totp_enabled ? '2FA on' : '2FA off'} · {m.last_login_at ? `last seen ${formatDate(m.last_login_at)}` : m.invite_expires_at ? 'invited' : 'never signed in'}
                </p>
              </div>
              <form action={updateMemberAction.bind(null, m.id, { role: m.role === 'shop_admin' ? 'technician' : 'shop_admin' })}>
                <Button size="sm" variant="outline" disabled={m.id === session.user.id}>
                  {m.role === 'shop_admin' ? 'Admin → Technician' : 'Technician → Admin'}
                </Button>
              </form>
              <form action={updateMemberAction.bind(null, m.id, { active: !m.active })}>
                <Button size="sm" variant={m.active ? 'ghost' : 'default'} disabled={m.id === session.user.id}>
                  {m.active ? 'Deactivate' : 'Reactivate'}
                </Button>
              </form>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Invite staff member">
        <ActionForm action={inviteStaffAction} submitLabel="Create invite link" successMessage="Invite created" renderSuccess={(d) => <InviteResult data={d} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" required />
            </Field>
            <Field label="Phone (optional)" htmlFor="phone">
              <Input id="phone" name="phone" type="tel" />
            </Field>
            <Field label="Role" htmlFor="role">
              <NativeSelect id="role" name="role" defaultValue="technician">
                <option value="technician">Technician</option>
                <option value="shop_admin">Shop admin</option>
              </NativeSelect>
            </Field>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
