import { ImageResponse } from 'next/og';
import { getTenant } from '@/lib/tenant';
import { env } from '@/lib/env';

export const alt = 'Device repair, picked up and returned';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Per-shop social share image: the shop's own name and colours, generated at request time (no static asset to keep in sync). */
export default async function Image() {
  const tenant = await getTenant();
  const name = tenant?.branding.display_name ?? env().PLATFORM_NAME;
  const tagline = tenant?.branding.tagline ?? 'Device repair, picked up and returned.';
  const primary = tenant?.branding.primary_hex ?? '#0071e3';
  const accent = tenant?.branding.accent_hex ?? '#a855f7';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: '#000000',
          backgroundImage: `radial-gradient(circle at 15% 0%, ${primary}55, transparent 55%), radial-gradient(circle at 100% 100%, ${accent}44, transparent 55%)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `linear-gradient(135deg, ${primary}, ${accent})`,
              fontSize: 40,
              fontWeight: 700,
              color: '#fff',
            }}
          >
            {name.slice(0, 1)}
          </div>
          <div style={{ fontSize: 40, color: 'rgba(255,255,255,0.6)', display: 'flex' }}>{name}</div>
        </div>
        <div style={{ fontSize: 76, fontWeight: 700, color: '#fff', marginTop: 40, lineHeight: 1.05, display: 'flex', maxWidth: 980 }}>{tagline}</div>
        <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.6)', marginTop: 28, display: 'flex' }}>Doorstep pickup · M-Pesa payment · Live tracking</div>
      </div>
    ),
    { ...size },
  );
}
