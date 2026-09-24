import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePlatformAdmin } from '@/lib/auth';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';
import { signOutAction } from '@/app/(auth)/actions';

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  if (await getTenant()) notFound(); // the console never exists on a shop's domain
  const session = await requirePlatformAdmin();
  return (
    <div className="min-h-dvh bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4">
          <Link href="/platform" className="font-semibold">
            {env().PLATFORM_NAME} console
          </Link>
          <nav className="flex gap-1 text-sm">
            <Link href="/platform" className="rounded-md px-2.5 py-1 hover:bg-muted">
              Shops
            </Link>
            <Link href="/platform/tenants/new" className="rounded-md px-2.5 py-1 hover:bg-muted">
              New shop
            </Link>
            <Link href="/platform/monitor" className="rounded-md px-2.5 py-1 hover:bg-muted">
              Failures
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            {session.user.email}
            <form action={signOutAction}>
              <button className="rounded-md px-2 py-1 hover:bg-muted">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
