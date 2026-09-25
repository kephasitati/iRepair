/**
 * iRepair brand — official mark (DECISIONS D-19):
 *  - Mark: a blue rounded-square tile holding a white precision screwdriver bit (hex-drive head, shaft,
 *    tapering to a point) — the tool used to open a phone.
 *  - Wordmark: "iRepair" in a bold rounded sans-serif, dark navy. The leading "i" is a normal two-tone
 *    letter (blue dot, navy stem); the "i" in "...pair" is replaced by the same screwdriver-bit glyph, in
 *    blue, in place of its dot and stem.
 * Use either the mark alone (favicon, tight spaces) or the wordmark (which carries its own small icon tile) —
 * they aren't required to appear together.
 */

const BLUE = '#0071e3';
const INK = '#16233f';
const WORDMARK_FONT = "'SF Pro Rounded', 'SF Pro Display', Poppins, Inter, -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif";

/** Hex-drive head, flat sides left/right, centred at (50, 29) in a 100×100 box. */
const HEX = '61.26,35.5 50,42 38.74,35.5 38.74,22.5 50,16 61.26,22.5';
/** Shaft tapering to a point, directly below the hex head. */
const SHAFT = 'M44,45 H56 V71 L50,85 L44,71 Z';

/** The screwdriver-bit glyph (hex head + tapering shaft), for reuse at any size/position/colour. */
function Bit({ fill }: { fill: string }) {
  return (
    <>
      <polygon points={HEX} fill={fill} />
      <path d={SHAFT} fill={fill} />
    </>
  );
}

/** The icon alone: a blue rounded-square tile with the white bit glyph. Used as the favicon / app icon. */
export function IRepairMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label="iRepair">
      <rect width="100" height="100" rx="24" fill={BLUE} />
      <Bit fill="#fff" />
    </svg>
  );
}

/**
 * Full lock-up: the icon tile, then "iRepair" — a normal two-tone leading "i" (blue dot, navy stem), "Repa"
 * in navy, the bit glyph standing in for the "i" of "pair", then a final navy "r".
 */
export function IRepairLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 254 64" className={className} role="img" aria-label="iRepair">
      <rect x="2" y="2" width="60" height="60" rx="16" fill={BLUE} />
      <g transform="translate(2 2) scale(0.6)">
        <Bit fill="#fff" />
      </g>

      {/* Leading "i": blue dot, navy stem. */}
      <circle cx="84" cy="20" r="5.5" fill={BLUE} />
      <rect x="80.5" y="26" width="7" height="21" rx="3.5" fill={INK} />

      <text x="92" y="47" fontFamily={WORDMARK_FONT} fontWeight="800" fontSize="42" letterSpacing="-0.5" fill={INK} textLength="115" lengthAdjust="spacingAndGlyphs">
        Repa
      </text>

      {/* The "i" of "pair", replaced by the bit glyph, scaled to sit between the x-height and the baseline. */}
      <g transform="translate(193.3 10) scale(0.4348)">
        <Bit fill={BLUE} />
      </g>

      <text x="223" y="47" fontFamily={WORDMARK_FONT} fontWeight="800" fontSize="42" letterSpacing="-0.5" fill={INK} textLength="20" lengthAdjust="spacingAndGlyphs">
        r
      </text>
    </svg>
  );
}
