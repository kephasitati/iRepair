import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { BarChart3, ClipboardList, Cog, LayoutGrid, Package, QrCode, Users, Wallet, Archive, MessageSquare, ScrollText } from 'lucide-react';
import type { Tenant } from '@/lib/tenant';
import type { Session } from '@/lib/auth';
import { signOutAction } from '@/app/(auth)/actions';
import { exitSupportModeAction } from '@/app/platform/actions';

/** Staff chrome: top bar on desktop/tablet, bottom tab bar on phones. */
export async function StaffShell({ tenant, session, role, children }: { tenant: Tenant; session: Session; role: 'technician' | 'shop_admin'; children: React.ReactNode }) {
  const t = await getTranslations('nav');
  const support = session.user.is_platform_admin && session.impersonatingTenantId === tenant.id;
  const main = [
    { href: '/bench', label: t('board'), icon: LayoutGrid },
    { href: '/bench/scan', label: t('scanner'), icon: QrCode },
  ];
  const admin =
    role === 'shop_admin'
      ? [
          { href: '/admin/reports', label: t('reports'), icon: BarChart3 },
          { href: '/admin/parts', label: t('parts'), icon: Package },
          { href: '/admin/staff', label: t('staff'), icon: Users },
          { href: '/admin/refunds', label: t('refunds'), icon: Wallet },
          { href: '/admin/unclaimed', label: t('unclaimed'), icon: Archive },
          { href: '/admin/templates', label: 'Messages', icon: MessageSquare },
          { href: '/admin/audit', label: 'Audit', icon: ScrollText },
          { href: '/admin/settings', label: t('settings'), icon: Cog },
        ]
      : [];
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
          <Link href="/bench" className="flex items-center gap-2 font-semibold">
            <ClipboardList className="size-5 text-primary" />
            <span className="truncate">{tenant.branding.display_name}</span>
          </Link>
          <nav className="ml-4 hidden items-center gap-1 overflow-x-auto md:flex">
            {[...main, ...admin].map((n) => (
              <Link key={n.href} href={n.href} className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{session.user.full_name}</span>
            <form action={signOutAction}>
              <button className="rounded-md px-2 py-1 hover:bg-muted">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-3 pt-4 pb-24 md:pb-8">{children}</div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid border-t bg-background md:hidden" style={{ gridTemplateColumns: `repeat(${role === 'shop_admin' ? 4 : 2}, minmax(0, 1fr))` }}>
        {[...main, ...(role === 'shop_admin' ? [admin[0], admin[admin.length - 1]] : [])].map((n) => (
          <Link key={n.href} href={n.href} className="flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground">
            <n.icon className="size-5" />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
