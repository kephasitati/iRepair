import { StaffShell } from '@/components/staff-shell';
import { requireStaff } from '@/lib/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { tenant, session, role } = await requireStaff('shop_admin');
  return (
    <StaffShell tenant={tenant} session={session} role={role}>
      {children}
    </StaffShell>
  );
}
