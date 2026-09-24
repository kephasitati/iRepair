import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Tenant } from '@/lib/tenant';
import type { Session } from '@/lib/auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { signOutAction } from '@/app/(auth)/actions';

/** Tenant-branded header. Only the shop's brand is ever shown to customers. */
export async function ShopHeader({ tenant, session }: { tenant: Tenant; session: Session | null }) {
  const t = await getTranslations();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {tenant.branding.logo_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/branding/logo" alt="" className="h-8 w-auto max-w-28 object-contain" />
          ) : (
            <span className="grid size-8 place-items-center rounded-lg text-sm font-bold" style={{ background: 'var(--brand-primary)', color: 'var(--primary-foreground)' }}>
              {tenant.branding.display_name.slice(0, 1)}
            </span>
          )}
          <span className="truncate font-semibold">{tenant.branding.display_name}</span>
        </Link>
        <nav className="ml-auto flex items-center gap-1">
          {session ? (
            <>
              <Link href="/jobs" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                {t('nav.jobs')}
              </Link>
              <Link href="/account" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                {t('nav.account')}
              </Link>
              <form action={signOutAction}>
                <button className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-muted-foreground')}>{t('common.signOut')}</button>
              </form>
            </>
          ) : (
            <Link href="/login" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              {t('auth.signIn')}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
