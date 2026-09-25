import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Toaster } from '@/components/ui/sonner';
import { brandCssVars } from '@/lib/branding';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

// Apple devices render SF Pro (system font); everyone else gets Inter, self-hosted at build time by next/font
// (no runtime request to Google, swap display for slow networks).
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

const DEFAULT_PLATFORM_NAME = 'iRepair';

/**
 * `app/offline/page.tsx` is `force-static` — it has to render with zero network, the whole point of a PWA offline
 * fallback — which means the root layout's own tenant resolution runs during `next build`'s static-generation
 * pass: no real request, no database, and (in a fresh build environment/CI) often no secrets configured yet.
 * `env()` validates its whole schema at once (`APP_MASTER_KEY`, `INTERNAL_CRON_SECRET`, ... all required), so even
 * the *fallback* platform name throws if any of those are unset. Failing the entire build over that would mean
 * every deploy needs production secrets just to compile; degrade to a hardcoded generic name for that one
 * build-time pass instead. A real runtime misconfiguration still throws loudly from every other place that calls
 * `env()` for something it actually needs (auth, payments, encryption, ...) — this only softens the root layout's
 * own static-generation fallback, it doesn't hide a genuinely broken deployment.
 */
async function getTenantForLayout() {
  try {
    return await getTenant();
  } catch {
    return null;
  }
}

function platformNameForLayout(): string {
  try {
    return env().PLATFORM_NAME;
  } catch {
    return DEFAULT_PLATFORM_NAME;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantForLayout();
  const name = tenant?.branding.display_name ?? platformNameForLayout();
  return {
    title: { default: name, template: `%s · ${name}` },
    description: tenant?.branding.tagline ?? 'Device repair with doorstep pickup and return.',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: name },
    icons: tenant?.branding.icon_path ? { icon: '/api/branding/icon', apple: '/api/branding/icon' } : undefined,
  };
}

export async function generateViewport(): Promise<Viewport> {
  await getTenantForLayout();
  return { themeColor: '#f5f5f7', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [tenant, locale, messages] = await Promise.all([getTenantForLayout(), getLocale(), getMessages()]);
  const style = tenant ? (brandCssVars(tenant.branding.primary_hex, tenant.branding.accent_hex) as React.CSSProperties) : undefined;
  return (
    <html lang={locale} style={style} className={inter.variable} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <div className="immersive-bg" aria-hidden />
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Africa/Nairobi">
          {children}
          <Toaster position="top-center" richColors />
          <PwaRegister />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
