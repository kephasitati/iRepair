'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CONSENT_COOKIE, COOKIE_POLICY_VERSION, parseConsent } from '@/lib/legal';

/**
 * Cookie consent (Kenya DPA). Strictly necessary cookies (sign-in, the choice itself) are always on; optional
 * categories are off until the visitor opts in. "Essential only" is as easy as "Accept all". Reopen from the footer
 * with `window.dispatchEvent(new Event('rd:cookie-settings'))`.
 */
export function CookieBanner() {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const raw = document.cookie.split('; ').find((c) => c.startsWith(`${CONSENT_COOKIE}=`))?.slice(CONSENT_COOKIE.length + 1);
    const current = parseConsent(raw);
    if (current) {
      setAnalytics(current.analytics);
      setMarketing(current.marketing);
    } else {
      setOpen(true);
    }
    const reopen = () => (setCustom(true), setOpen(true));
    window.addEventListener('rd:cookie-settings', reopen);
    return () => window.removeEventListener('rd:cookie-settings', reopen);
  }, []);

  const save = async (choice: { analytics: boolean; marketing: boolean }) => {
    setSaving(true);
    await fetch('/api/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(choice) }).catch(() => {});
    setSaving(false);
    setOpen(false);
    window.dispatchEvent(new CustomEvent('rd:consent', { detail: { ...choice, v: COOKIE_POLICY_VERSION } }));
  };

  if (!open) return null;
  return (
    <div role="dialog" aria-label="Cookie preferences" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-xl sm:bottom-5" data-testid="cookie-banner">
      <div className="glass-card border border-black/5 p-5">
        <p className="text-[17px] font-semibold tracking-tight">Your privacy</p>
        <p className="mt-1 text-[14px] leading-snug text-ink-2">
          We use strictly necessary cookies to keep you signed in and remember this choice. With your permission we may also use analytics cookies to improve
          the service. We never sell your data. See our{' '}
          <Link href="/privacy#cookies" className="text-link hover:underline">
            cookie policy
          </Link>{' '}
          and{' '}
          <Link href="/terms" className="text-link hover:underline">
            terms
          </Link>
          .
        </p>
        {custom ? (
          <div className="mt-4 space-y-2">
            <Toggle label="Strictly necessary" description="Sign-in and security. Always on." checked disabled />
            <Toggle label="Analytics" description="Anonymous usage statistics to improve the booking flow." checked={analytics} onChange={setAnalytics} />
            <Toggle label="Marketing" description="Offers from this shop. Off unless you opt in." checked={marketing} onChange={setMarketing} />
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {custom ? (
            <Button size="sm" disabled={saving} onClick={() => save({ analytics, marketing })} data-testid="cookie-save">
              Save choices
            </Button>
          ) : (
            <>
              <Button size="sm" disabled={saving} onClick={() => save({ analytics: true, marketing: false })} data-testid="cookie-accept">
                Accept all
              </Button>
              <Button size="sm" variant="secondary" disabled={saving} onClick={() => save({ analytics: false, marketing: false })} data-testid="cookie-essential">
                Essential only
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCustom(true)}>
                Customise
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, description, checked, onChange, disabled }: { label: string; description: string; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-center justify-between gap-4 rounded-[12px] bg-white/70 px-4 py-3 ${disabled ? 'opacity-70' : 'cursor-pointer'}`}>
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        <span className="block text-[13px] text-ink-3">{description}</span>
      </span>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
        <span className="h-[31px] w-[51px] rounded-full bg-fill transition-colors peer-checked:bg-mpesa" />
        <span className="absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event('rd:cookie-settings'))}>
      Cookie settings
    </button>
  );
}
