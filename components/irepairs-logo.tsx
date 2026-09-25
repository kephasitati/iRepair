/**
 * iRepairs brand (DECISIONS D-19).
 *  - Mark: an outline apple with a lowercase "i" inside and a screw head where the bite is taken out. It nods to the
 *    bitten apple without reproducing Apple's filled silhouette.
 * *  - Wordmark: "iRepairs": the first "i" is a normal letter, the second is a precision screwdriver turning a screw.
 * public/brand/irepairs-logo.svg is the same drawing as a standalone file (used as the shop logo image).
 */

const APPLE_BODY =
  'M32 21.5C26.5 15.5 12 16 11.5 31c-.4 13 8.5 25.5 15.5 25.5 3 0 3.4-1.4 5-1.4s2 1.4 5 1.4c5.4 0 11-7.3 13.4-14.6A9 9 0 0 1 51.2 25c-2.6-8.6-14-9.6-19.2-3.5Z';
const LEAF = 'M33.2 18.6c.2-5.8 3.8-10 9.6-10.8-.3 5.8-4 9.9-9.6 10.8Z';

/**
 * The second "i": a precision screwdriver (the phone-opening tool) turning a cross-head screw.
 * Stem = grip + collar + shaft + tip, standing on the text baseline (y = 44 at font-size 34); dot = the screw.
 */
function ScrewdriverI({ cx, fill, slot = '#ffffff' }: { cx: number; fill: string; slot?: string }) {
  return (
    <g>
      <rect x={cx - 2.8} y="33" width="5.6" height="11" rx="2" fill={fill} />
      <rect x={cx - 1.8} y="31" width="3.6" height="2.4" rx="0.6" fill={fill} />
      <rect x={cx - 0.8} y="22.5" width="1.6" height="9" fill={fill} />
      <polygon points={`${cx - 0.8},22.6 ${cx + 0.8},22.6 ${cx},20.6`} fill={fill} />
      <circle cx={cx} cy="15.8" r="3.4" fill={fill} />
      <path d={`M${cx - 1.8} 15.8h3.6M${cx} 14v3.6`} stroke={slot} strokeWidth="1.1" strokeLinecap="round" />
    </g>
  );
}

export function IRepairsMark({ className, screwColor = 'currentColor' }: { className?: string; screwColor?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} fill="none" aria-hidden>
      <path d={APPLE_BODY} stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
      <path d={LEAF} fill="currentColor" />
      <circle cx="31.5" cy="30.2" r="2.3" fill="currentColor" />
      <rect x="29.6" y="35" width="3.8" height="12.5" rx="1.9" fill="currentColor" />
      <circle cx="57" cy="33.2" r="4.2" stroke={screwColor} strokeWidth="2.4" />
      <path d="M54.6 33.2h4.8M57 30.8v4.8" stroke={screwColor} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Full lock-up: mark + wordmark with the spanner "i". Scales with font-size via the `className` height. */
export function IRepairsLogo({ className, accent = 'url(#irepairs-g)' }: { className?: string; accent?: string }) {
  const spannerX = 161;
  return (
    <svg viewBox="0 0 204 64" className={className} role="img" aria-label="iRepairs">
      <defs>
        <linearGradient id="irepairs-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0071e3" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <g fill="none">
        <path d={APPLE_BODY} stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" />
        <path d={LEAF} fill="currentColor" />
        <circle cx="31.5" cy="30.2" r="2.3" fill="currentColor" />
        <rect x="29.6" y="35" width="3.8" height="12.5" rx="1.9" fill="currentColor" />
        <circle cx="57" cy="33.2" r="4.2" stroke={accent} strokeWidth="2.4" />
        <path d="M54.6 33.2h4.8M57 30.8v4.8" stroke={accent} strokeWidth="2" strokeLinecap="round" />
      </g>
      <g fill="currentColor" fontFamily="-apple-system, BlinkMacSystemFont, 'SF Pro Display', Inter, 'Helvetica Neue', Arial, sans-serif" fontSize="34" fontWeight="600">
        <text x="70" y="44" textLength="85" lengthAdjust="spacingAndGlyphs">
          iRepa
        </text>
        <ScrewdriverI cx={spannerX} fill={accent} />
        <text x="168" y="44" textLength="30" lengthAdjust="spacingAndGlyphs">
          rs
        </text>
      </g>
    </svg>
  );
}
