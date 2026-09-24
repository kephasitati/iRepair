/** Tenant colours -> CSS variables for the shadcn theme. Pure functions, safe on the client. */

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function luminance([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string) {
  const la = luminance(hexToRgb(a));
  const lb = luminance(hexToRgb(b));
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** White or near-black text, whichever reads better on the colour. */
export function foregroundFor(hex: string): string {
  return contrastRatio(hex, '#ffffff') >= contrastRatio(hex, '#0a0a0a') ? '#ffffff' : '#0a0a0a';
}

export function isValidHex(hex: string) {
  return /^#[0-9a-fA-F]{6}$/.test(hex);
}

/**
 * Inline style for <html>: the shop's colours drive primary actions and the immersive brand wash. Neutral surfaces,
 * hovers and focus rings stay on the shared palette so every shop looks equally polished.
 */
export function brandCssVars(primary: string, accent: string): Record<string, string> {
  return {
    '--primary': primary,
    '--primary-foreground': foregroundFor(primary) === '#ffffff' ? '#ffffff' : '#1d1d1f',
    '--brand-primary': primary,
    '--brand-accent': accent,
    '--brand-accent-foreground': foregroundFor(accent) === '#ffffff' ? '#ffffff' : '#1d1d1f',
  };
}
