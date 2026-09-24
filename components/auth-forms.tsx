'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorText, Field } from '@/components/fields';
import { mfaCompleteSetupAction, mfaVerifyAction, sendOtpAction, staffLoginAction, verifyOtpAction, acceptInviteAction } from '@/app/(auth)/actions';

const CODE_TO_KEY: Record<string, string> = {
  invalid_phone: 'invalidPhone',
  rate_limited: 'rateLimited',
  send_failed: 'sendFailed',
  invalid_code: 'invalidCode',
  expired: 'expired',
  too_many_attempts: 'tooManyAttempts',
  invalid_login: 'invalidLogin',
  not_staff: 'notStaff',
  forbidden: 'forbidden',
  mfa_wrong: 'mfaWrong',
};

export function useAuthError() {
  const t = useTranslations('auth');
  return (code?: string | null) => (code ? (CODE_TO_KEY[code] ? t(CODE_TO_KEY[code]) : code) : null);
}

export function PhoneLoginForm({ next, defaultPhone }: { next?: string; defaultPhone?: string }) {
  const t = useTranslations();
  const err = useAuthError();
  const [sendState, sendAction, sending] = useActionState(sendOtpAction, null);
  const [verifyState, verifyAction, verifying] = useActionState(verifyOtpAction, null);
  const [editing, setEditing] = useState(false);
  const phone = sendState?.ok && !editing ? sendState.data.phone : null;

  if (!phone) {
    return (
      <form action={(fd) => (setEditing(false), sendAction(fd))} className="space-y-4">
        <Field label={t('common.phone')} hint={t('auth.phoneHelp')} htmlFor="phone" error={sendState && !sendState.ok ? err(sendState.error) : null}>
          <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder={t('auth.phonePlaceholder')} defaultValue={defaultPhone} required autoFocus />
        </Field>
        <Button type="submit" size="lg" className="w-full" disabled={sending}>
          {sending ? t('common.loading') : t('auth.sendCode')}
        </Button>
      </form>
    );
  }
  return (
    <form action={verifyAction} className="space-y-4">
      <input type="hidden" name="phone" value={phone} />
      <input type="hidden" name="next" value={next ?? ''} />
      <p className="text-sm">{t('auth.codeSentTo', { phone })}</p>
      <Field label={t('auth.code')} htmlFor="code" error={verifyState && !verifyState.ok ? err(verifyState.error) : null}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="text-center text-2xl tracking-[0.5em]" />
      </Field>
      <Field label={t('auth.yourName')} htmlFor="name" hint={t('common.optional')}>
        <Input id="name" name="name" autoComplete="name" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={verifying}>
        {verifying ? t('common.loading') : t('auth.verify')}
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-muted-foreground underline" onClick={() => setEditing(true)}>
          {t('auth.changeNumber')}
        </button>
        <button type="submit" formAction={(fd) => sendAction(fd)} formNoValidate className="text-primary underline">
          {t('auth.resend')}
        </button>
      </div>
    </form>
  );
}

export function StaffLoginForm({ area, next, initialError }: { area: 'shop' | 'platform'; next?: string; initialError?: string }) {
  const t = useTranslations();
  const err = useAuthError();
  const [state, action, pending] = useActionState(staffLoginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="area" value={area} />
      <input type="hidden" name="next" value={next ?? ''} />
      <ErrorText>{state && !state.ok ? err(state.error) : err(initialError)}</ErrorText>
      <Field label={t('common.email')} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <Field label={t('common.password')} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? t('common.loading') : t('auth.signIn')}
      </Button>
    </form>
  );
}

export function MfaVerifyForm({ area }: { area: 'shop' | 'platform' }) {
  const t = useTranslations();
  const err = useAuthError();
  const [state, action, pending] = useActionState(mfaVerifyAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="area" value={area} />
      <Field label={t('auth.code')} htmlFor="code" error={state && !state.ok ? err(state.error) : null}>
        <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus className="text-center text-2xl tracking-[0.5em]" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t('auth.verify')}
      </Button>
    </form>
  );
}

export function MfaSetupForm({ area, secret, qrDataUrl }: { area: 'shop' | 'platform'; secret: string; qrDataUrl: string }) {
  const t = useTranslations();
  const err = useAuthError();
  const [state, action, pending] = useActionState(mfaCompleteSetupAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="area" value={area} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrDataUrl} alt="" className="mx-auto size-48 rounded-lg border bg-white p-2" />
      <p className="text-center text-xs text-muted-foreground">
        {t('auth.mfaSecret')}: <code className="font-mono text-foreground select-all">{secret}</code>
      </p>
      <Field label={t('auth.code')} htmlFor="code" error={state && !state.ok ? err(state.error) : null}>
        <Input id="code" name="code" inputMode="numeric" maxLength={6} required className="text-center text-2xl tracking-[0.5em]" />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t('auth.verify')}
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations();
  const [state, action, pending] = useActionState(acceptInviteAction, null);
  const error = state && !state.ok ? (state.error.startsWith('password:') ? 'Use at least 12 characters with upper and lower case letters and a number.' : state.error) : null;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <p className="text-sm text-muted-foreground">{email}</p>
      <ErrorText>{error}</ErrorText>
      <Field label={t('common.name')} htmlFor="name">
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field label={t('common.password')} htmlFor="password" hint="At least 12 characters with upper and lower case letters and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
