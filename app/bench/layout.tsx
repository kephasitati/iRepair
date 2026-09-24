import { StaffShell } from '@/components/staff-shell';
import { requireStaff } from '@/lib/auth';

export default async function BenchLayout({ children }: { children: React.ReactNode }) {
  const { tenant, session, role } = await requireStaff('technician');
  return (
    <StaffShell tenant={tenant} session={session} role={role}>
      {children}
    </StaffShell>
  );
}
