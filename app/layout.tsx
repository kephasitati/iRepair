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

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenant();
  const name = tenant?.branding.display_name ?? env().PLATFORM_NAME;
  return {
    title: { default: name, template: `%s · ${name}` },
    description: tenant?.branding.tagline ?? 'Device repair with doorstep pickup and return.',
    manifest: '/manifest.webmanifest',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: name },
    icons: tenant?.branding.icon_path ? { icon: '/api/branding/icon', apple: '/api/branding/icon' } : undefined,
  };
}

export async function generateViewport(): Promise<Viewport> {
  const tenant = await getTenant();
  return { themeColor: '#f5f5f7', width: 'device-width', initialScale: 1, viewportFit: 'cover' };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [tenant, locale, messages] = await Promise.all([getTenant(), getLocale(), getMessages()]);
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
