'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ErrorText, Field, NativeSelect, RadioRow } from '@/components/fields';
import { QrScanner } from '@/components/qr-scanner';
import { AddressPicker } from '@/components/address-picker';
import { formatKes } from '@/lib/core/money';
import { addDays, deliverySlots, formatDate, nairobiToday, type OpeningHours } from '@/lib/core/time';
import type { Address } from '@/lib/providers/delivery/types';
import {
  acceptQuoteAction,
  acknowledgeIntakeAction,
  cancelBookingAction,
  chooseDropoffAction,
  confirmDeliveredAction,
  counterQuoteAction,
  customerHandoverAction,
  declineQuoteAction,
  disputeAction,
  quoteMessageAction,
  rateJobAction,
  rebookPickupAction,
  rejectIntakeAction,
} from '@/app/(shop)/actions';
import { cn } from '@/lib/utils';

type R = { ok: true } | { ok: false; error: string };

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<R | { ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError((r as { error: string }).error);
      else if (success) toast.success(success);
    });
  return { pending, error, act, setError };
}

// ---------------------------------------------------------------------------
export function HandoverScan({ jobId, label }: { jobId: string; label: string }) {
  const t = useTranslations('job');
  const { pending, error, act } = useAct();
  const geo = () =>
    new Promise<{ lat: number; lng: number; accuracy: number } | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 6000 },
      );
    });
  const submit = (method: 'qr' | 'otp', payload: string) =>
    act(async () => customerHandoverAction(jobId, { method, payload, geo: await geo() }), t('handoverRecorded'));
  return (
    <div className="space-y-2" data-testid="handover-scan">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{t('scanRiderHelp')}</p>
      <QrScanner busy={pending} onScan={(p) => submit('qr', p)} onManual={(c) => submit(/^\d{6}$/.test(c) ? 'otp' : 'qr', c)} manualLabel={t('enterOtp')} />
      <p className="text-xs text-muted-foreground">{t('otpHelp')}</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function IntakeReview({ jobId }: { jobId: string }) {
  const t = useTranslations();
  const { pending, error, act } = useAct();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-3">
      <ErrorText>{error}</ErrorText>
      {!rejecting ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="lg" disabled={pending} onClick={() => act(() => acknowledgeIntakeAction(jobId))} data-testid="ack-intake">
            {t('job.acknowledge')}
          </Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
            {t('job.rejectIntake')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('job.rejectIntakeHelp')}</p>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('job.cancelReason')} />
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => act(() => rejectIntakeAction(jobId, reason))}>
              {t('common.confirm')}
            </Button>
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function QuoteActions({
  jobId,
  kind,
  canCounter,
  roundsLeft,
  currentTotalCents,
  expired,
}: {
  jobId: string;
  kind: 'main' | 'supplementary';
  canCounter: boolean;
  roundsLeft: number;
  currentTotalCents: number;
  expired: boolean;
}) {
  const t = useTranslations('job');
  const tc = useTranslations('common');
  const { pending, error, act } = useAct();
  const [mode, setMode] = useState<'idle' | 'counter' | 'decline'>('idle');
  const [amount, setAmount] = useState(String(Math.round((currentTotalCents * 0.9) / 100)));
  const [message, setMessage] = useState('');

  return (
    <div className="space-y-3" data-testid={`quote-actions-${kind}`}>
      <ErrorText>{error}</ErrorText>
      {mode === 'idle' ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            {!expired ? (
              <Button size="lg" disabled={pending} onClick={() => act(() => acceptQuoteAction(jobId, kind))} data-testid="accept-quote">
                {t('accept')}
              </Button>
            ) : null}
            {canCounter && !expired ? (
              <Button size="lg" variant="outline" disabled={pending} onClick={() => setMode('counter')} data-testid="counter-quote">
                {t('counter')}
              </Button>
            ) : null}
            <Button size="lg" variant="ghost" className="text-destructive" disabled={pending} onClick={() => setMode('decline')}>
              {t('decline')}
            </Button>
          </div>
          {!expired ? <p className="text-xs text-muted-foreground">{canCounter ? t('roundsLeft', { n: roundsLeft }) : t('roundsNone')}</p> : null}
        </>
      ) : null}
      {mode === 'counter' ? (
        <div className="space-y-3 rounded-xl border p-3">
          <Field label={t('counterAmount')} htmlFor="counter-amount">
            <Input id="counter-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
          </Field>
          <Field label={t('counterMessage')} htmlFor="counter-msg">
            <Textarea id="counter-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          </Field>
          <div className="flex gap-2">
            <Button disabled={pending || !amount} onClick={() => act(async () => { const r = await counterQuoteAction(jobId, kind, Number(amount), message); if (r.ok) setMode('idle'); return r; })} data-testid="send-counter">
              {tc('send')}
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              {tc('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
      {mode === 'decline' ? (
        <div className="space-y-3 rounded-xl border border-destructive/30 p-3">
          {kind === 'main' ? <p className="text-sm">{t('declineConfirm')}</p> : null}
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending} onClick={() => act(() => declineQuoteAction(jobId, kind))}>
              {t('decline')}
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              {tc('cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function QuoteMessageBox({ jobId, kind }: { jobId: string; kind: 'main' | 'supplementary' }) {
  const tc = useTranslations('common');
  const { pending, error, act } = useAct();
  const [body, setBody] = useState('');
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        act(async () => {
          const r = await quoteMessageAction(jobId, kind, body);
          if (r.ok) setBody('');
          return r;
        });
      }}
    >
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="…" />
      <Button type="submit" variant="outline" disabled={pending || !body.trim()}>
        {tc('send')}
      </Button>
      {error ? <span className="sr-only">{error}</span> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
export function DropoffChooser({
  jobId,
  pickupAddress,
  zones,
  openingHours,
  current,
  allowCollect = true,
}: {
  jobId: string;
  pickupAddress: Address;
  zones: string[];
  openingHours: OpeningHours;
  current: { choice: 'pickup_address' | 'other_address' | 'collect_at_shop' | null; address: Address | null };
  allowCollect?: boolean;
}) {
  const t = useTranslations();
  const { pending, error, act } = useAct();
  const [choice, setChoice] = useState(current.choice ?? 'pickup_address');
  const [address, setAddress] = useState<Address>(current.address ?? { formatted: '', lat: null, lng: null, zone: null });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(nairobiToday(), i)), []);
  const [day, setDay] = useState(() => days.find((d) => deliverySlots(d, openingHours).length > 0) ?? days[0]);
  const slots = useMemo(() => deliverySlots(day, openingHours), [day, openingHours]);
  const [slotIdx, setSlotIdx] = useState(0);

  const submit = () =>
    act(() => {
      const slot = choice === 'collect_at_shop' ? null : slots[slotIdx];
      return chooseDropoffAction(jobId, { choice, address: choice === 'other_address' ? address : null, windowStart: slot?.start.toISOString() ?? null, windowEnd: slot?.end.toISOString() ?? null });
    });

  return (
    <div className="space-y-3" data-testid="dropoff-chooser">
      <p className="text-sm font-medium">{t('job.chooseDropoff')}</p>
      <RadioRow name="dropoff" checked={choice === 'pickup_address'} onChange={() => setChoice('pickup_address')} label={t('job.dropoffPickup')} description={pickupAddress.formatted} />
      <RadioRow name="dropoff" checked={choice === 'other_address'} onChange={() => setChoice('other_address')} label={t('job.dropoffOther')} />
      {choice === 'other_address' ? <AddressPicker value={address} onChange={setAddress} zones={zones} /> : null}
      {allowCollect ? <RadioRow name="dropoff" checked={choice === 'collect_at_shop'} onChange={() => setChoice('collect_at_shop')} label={t('job.dropoffCollect')} data-testid="dropoff-collect" /> : null}
      {choice !== 'collect_at_shop' ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('wizard.pickDate')} htmlFor="d-day">
            <NativeSelect id="d-day" value={day} onChange={(e) => (setDay(e.target.value), setSlotIdx(0))}>
              {days.map((d, i) => (
                <option key={d} value={d}>
                  {i === 0 ? t('common.today') : formatDate(`${d}T12:00:00+03:00`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t('job.dropoffWindow')} htmlFor="d-slot">
            <NativeSelect id="d-slot" value={slotIdx} onChange={(e) => setSlotIdx(Number(e.target.value))} disabled={!slots.length}>
              {slots.length ? slots.map((s, i) => <option key={s.label} value={i}>{s.label}</option>) : <option>{t('wizard.noSlots')}</option>}
            </NativeSelect>
          </Field>
        </div>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="w-full" disabled={pending || (choice !== 'collect_at_shop' && !slots.length) || (choice === 'other_address' && !address.formatted)} onClick={submit} data-testid="dropoff-save">
        {t('common.continue')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function Stars({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" onClick={() => onChange(n)} aria-label={`${n}`} className="p-1" data-testid={`star-${n}`}>
          <Star className={cn('size-8', n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} />
        </button>
      ))}
    </div>
  );
}

export function DeliveredConfirm({ jobId }: { jobId: string }) {
  const t = useTranslations('job');
  const { pending, error, act } = useAct();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  const [issue, setIssue] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-testid="delivered-confirm">
      <p className="text-sm font-medium">{t('rate')}</p>
      <Stars value={score} onChange={setScore} />
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('rateComment')} rows={2} />
      {issue !== null ? (
        <Field label={t('notAsExpectedHelp')} htmlFor="issue">
          <Textarea id="issue" value={issue} onChange={(e) => setIssue(e.target.value)} rows={3} />
        </Field>
      ) : null}
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="w-full" disabled={pending} onClick={() => act(() => confirmDeliveredAction(jobId, { score: score || null, comment, notAsExpected: issue !== null, issue: issue ?? '' }))} data-testid="confirm-delivered">
        {t('confirmDelivered')}
      </Button>
      {issue === null ? (
        <Button variant="ghost" className="w-full text-destructive" onClick={() => setIssue('')}>
          {t('notAsExpected')}
        </Button>
      ) : null}
    </div>
  );
}

export function RateLater({ jobId }: { jobId: string }) {
  const t = useTranslations('job');
  const tc = useTranslations('common');
  const { pending, error, act } = useAct();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState('');
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{t('rate')}</p>
      <Stars value={score} onChange={setScore} />
      <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('rateComment')} rows={2} />
      <ErrorText>{error}</ErrorText>
      <Button disabled={pending || !score} onClick={() => act(() => rateJobAction(jobId, score, comment))}>
        {tc('send')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function CancelBooking({ jobId, free }: { jobId: string; free: boolean }) {
  const t = useTranslations();
  const { pending, error, act } = useAct();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setOpen(true)}>
        {t('job.cancel')}
      </Button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-destructive/30 p-3">
      <p className="text-sm">{free ? t('job.cancelFree') : t('job.cancelFee')}</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('job.cancelReason')} />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={pending} onClick={() => act(() => cancelBookingAction(jobId, reason))}>
          {t('common.confirm')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('common.back')}
        </Button>
      </div>
    </div>
  );
}

export function RebookPickup({ jobId }: { jobId: string }) {
  const t = useTranslations('job');
  const { pending, error, act } = useAct();
  return (
    <div className="space-y-2">
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="w-full" disabled={pending} onClick={() => act(() => rebookPickupAction(jobId))}>
        {t('rebook')}
      </Button>
    </div>
  );
}

export function WarrantyClaim({ jobId }: { jobId: string }) {
  const t = useTranslations();
  const { pending, error, act } = useAct();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  if (!open)
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('job.raiseDispute')}
      </Button>
    );
  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('job.notAsExpectedHelp')} rows={3} />
      <ErrorText>{error}</ErrorText>
      <Button disabled={pending || !body.trim()} onClick={() => act(async () => { const r = await disputeAction(jobId, body); if (r.ok) setOpen(false); return r; }, t('common.saved'))}>
        {t('common.send')}
      </Button>
    </div>
  );
}

export function Money({ cents }: { cents: number }) {
  return <span className="tabular-nums">{formatKes(cents)}</span>;
}
