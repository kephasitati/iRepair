import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ClipboardList } from 'lucide-react';
import type { Tenant } from '@/lib/tenant';
import type { Session } from '@/lib/auth';
import { signOutAction } from '@/app/(auth)/actions';
import { exitSupportModeAction } from '@/app/platform/actions';
import { BottomNav, TopNav, type NavItem } from '@/components/staff-nav';

/** Every staff destination for a role: the daily screens first, then shop administration. */
export async function staffNavItems(role: 'technician' | 'shop_admin'): Promise<{ main: NavItem[]; admin: NavItem[] }> {
  const t = await getTranslations('nav');
  const main: NavItem[] = [
    { key: 'board', href: '/bench', label: t('board') },
    { key: 'scanner', href: '/bench/scan', label: t('scanner') },
    { key: 'customers', href: '/bench/customers', label: t('customers') },
  ];
  const admin: NavItem[] =
    role === 'shop_admin'
      ? [
          { key: 'parts', href: '/admin/parts', label: t('parts') },
          { key: 'reports', href: '/admin/reports', label: t('reports') },
          { key: 'staff', href: '/admin/staff', label: t('staff') },
          { key: 'refunds', href: '/admin/refunds', label: t('refunds') },
          { key: 'unclaimed', href: '/admin/unclaimed', label: t('unclaimed') },
          { key: 'messages', href: '/admin/templates', label: 'Messages' },
          { key: 'audit', href: '/admin/audit', label: 'Audit' },
          { key: 'settings', href: '/admin/settings', label: t('settings') },
        ]
      : [];
  return { main, admin };
}

/** Staff chrome: top bar on desktop/tablet, bottom tab bar (with a Menu page for everything else) on phones. */
export async function StaffShell({ tenant, session, role, children }: { tenant: Tenant; session: Session; role: 'technician' | 'shop_admin'; children: React.ReactNode }) {
  const support = session.user.is_platform_admin && session.impersonatingTenantId === tenant.id;
  const { main, admin } = await staffNavItems(role);
  const bottom: NavItem[] = [...main, { key: 'menu', href: '/bench/menu', label: 'Menu' }];
  return (
    <div className="min-h-dvh bg-muted/30">
      {support ? (
        <div className="flex items-center justify-between gap-2 bg-amber-500 px-4 py-1.5 text-xs font-medium text-amber-950">
          <span>Support mode: acting as shop admin of {tenant.branding.display_name}. Everything you do is audited.</span>
          <form action={exitSupportModeAction}>
            <button className="underline">Exit</button>
          </form>
        </div>
      ) : null}
      <header className="sticky top-0 z-30 border-b bg-background">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-2 px-3">
          <Link href="/bench" className="flex min-w-0 items-center gap-2 font-semibold">
            <ClipboardList className="size-5 shrink-0 text-primary" />
            <span className="truncate">{tenant.branding.display_name}</span>
          </Link>
          <TopNav items={[...main, ...admin]} />
          <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden lg:inline">{session.user.full_name}</span>
            <form action={signOutAction}>
              <button className="rounded-md px-2 py-1 hover:bg-muted">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-3 pt-4 pb-24 md:pb-8">{children}</div>
      <BottomNav items={bottom} />
    </div>
  );
}
