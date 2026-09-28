import { z } from 'zod';

/** Versions of the customer-facing legal texts. Bump when the wording changes materially; consent is re-asked. */
export const TERMS_VERSION = '2026-09-25';
export const PRIVACY_VERSION = '2026-09-25';
export const COOKIE_POLICY_VERSION = '2026-09-25';

export const CONSENT_COOKIE = 'rd_consent';
export const VISITOR_COOKIE = 'rd_vid';

const ConsentChoice = z.object({ v: z.string(), analytics: z.boolean(), marketing: z.boolean(), at: z.string() });
export type ConsentChoice = z.infer<typeof ConsentChoice>;

/** The visitor's stored cookie choice, or null when it is missing, malformed or for an older policy version. */
export function parseConsent(raw: string | undefined | null): ConsentChoice | null {
  if (!raw) return null;
  try {
    const parsed = ConsentChoice.safeParse(JSON.parse(decodeURIComponent(raw)));
    return parsed.success && parsed.data.v === COOKIE_POLICY_VERSION ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Cookies this app sets. Shown in the cookie policy; keep in sync with the code. */
export const COOKIE_TABLE = [
  { name: 'rd_session', category: 'Strictly necessary', purpose: 'Keeps you signed in on this shop’s site.', lifetime: '30 days (1 hour in support mode)' },
  { name: 'rd_consent', category: 'Strictly necessary', purpose: 'Remembers your cookie choices.', lifetime: '12 months' },
  { name: 'rd_vid', category: 'Strictly necessary', purpose: 'A random identifier that links your cookie choices to our consent record, so we can prove and honour them.', lifetime: '12 months' },
] as const;
