import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * Applied to every response. The CSP is deliberately a baseline (no framing, no <base> or plugin injection) rather than
 * a script allowlist: Maps, Instagram embeds and Next's inline bootstrap would all need nonces first. HSTS is set in
 * production only, per host (not includeSubDomains: a shop's own domain may have subdomains we don't serve).
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(self), microphone=()' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
];

const nextConfig: NextConfig = {
  // Not 'standalone': the worker container runs `npx tsx worker/index.ts` against the full source tree with
  // devDependencies (tsx, typescript) installed (Dockerfile, DECISIONS D-22), so the image already carries the
  // full node_modules and repo regardless — standalone's minimal-copy pruning buys nothing here, and `next start`
  // (used by both the web container and this smoke-tested locally) explicitly doesn't work correctly against a
  // standalone build without extra manual copying of `public/` and `.next/static` that this setup doesn't do.
  reactStrictMode: true,
  serverExternalPackages: ['postgres', '@react-pdf/renderer'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
      // Private, account-gated or internal paths: keep them out of search results even if a bot ignores robots.txt.
      {
        source: '/:path(book|jobs|account|admin|bench|platform|staff|api|track|dev|l)/:rest*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      { source: '/:path(book|jobs|account|admin|bench|platform|staff|api|track|dev|l)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};

export default withNextIntl(nextConfig);
