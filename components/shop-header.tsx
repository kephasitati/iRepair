import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { Tenant } from '@/lib/tenant';
import type { Session } from '@/lib/auth';
import { signOutAction } from '@/app/(auth)/actions';
import { cn } from '@/lib/utils';

/** Frosted, apple.com-style global nav in the shop's brand. The platform brand never appears here. */
export async function ShopHeader({ tenant, session, dark = false }: { tenant: Tenant; session: Session | null; dark?: boolean }) {
  const t = await getTranslations();
  const link = cn('rounded-full px-3 py-1.5 text-[13px] transition-colors', dark ? 'text-white/80 hover:text-white' : 'text-ink-2 hover:text-ink');
  return (
    <header className={cn('sticky top-0 z-30', dark ? 'glass-nav-dark' : 'glass-nav border-b border-black/5')}>
      <div className="mx-auto flex h-12 max-w-5xl items-center gap-2 px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          {tenant.branding.logo_path ? (
            // The shop's logo already carries its name.
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/branding/logo" alt={tenant.branding.display_name} className="h-8 w-auto max-w-40 object-contain" />
          ) : (
            <>
              <span className="grid size-7 place-items-center rounded-[8px] text-[13px] font-semibold" style={{ background: 'var(--brand-primary)', color: 'var(--primary-foreground)' }}>
                {tenant.branding.display_name.slice(0, 1)}
              </span>
              <span className="truncate text-[15px] font-semibold tracking-tight">{tenant.branding.display_name}</span>
            </>
          )}
        </Link>
        <nav className="ml-auto flex items-center">
          {session ? (
            <>
              <Link href="/jobs" className={link}>
                {t('nav.jobs')}
              </Link>
              <Link href="/account" className={link}>
                {t('nav.account')}
              </Link>
              <form action={signOutAction} className="hidden sm:block">
                <button className={link}>{t('common.signOut')}</button>
              </form>
            </>
          ) : (
            <Link href="/login" className={link}>
              {t('auth.signIn')}
            </Link>
          )}
          <Link
            href="/book"
            className="ml-1 rounded-full px-3.5 py-1.5 text-[13px] font-medium"
            style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
          >
            {t('landing.bookShort')}
          </Link>
        </nav>
      </div>
    </header>
  );
}
