'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, Smartphone, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorText, Field } from '@/components/fields';
import { formatKes } from '@/lib/core/money';
import { startPaymentAction } from '@/app/(shop)/actions';
import type { PaymentPurpose } from '@/lib/jobs/types';

type PaymentState = { id: string; status: string; result_desc: string | null; mpesa_receipt: string | null; result_code: number | null };

/** STK push, then poll the payment until Safaricom (or the simulator) answers. Shows a receipt on success. */
export function PayPanel({
  jobId,
  purpose,
  amountCents,
  defaultPhone,
  quoteId,
  simulator,
}: {
  jobId: string;
  purpose: PaymentPurpose;
  amountCents: number;
  defaultPhone: string;
  quoteId?: string | null;
  simulator: boolean;
}) {
  const t = useTranslations('pay');
  const router = useRouter();
  const [phone, setPhone] = useState(defaultPhone);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!payment || !['initiated', 'pending'].includes(payment.status)) return;
    const iv = setInterval(async () => {
      const r = await fetch(`/api/payments/${payment.id}`, { cache: 'no-store' });
      if (r.ok) {
        const p = (await r.json()) as PaymentState;
        setPayment(p);
        if (p.status === 'success') setTimeout(() => router.refresh(), 1500);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [payment, router]);

  const send = () =>
    start(async () => {
      setError(null);
      const r = await startPaymentAction(jobId, purpose, phone, quoteId);
      if (!r.ok) return setError(r.error);
      setMessage(r.data.message);
      setPayment({ id: r.data.paymentId, status: 'pending', result_desc: null, mpesa_receipt: null, result_code: null });
    });

  const simulate = async (outcome: 'success' | 'cancelled' | 'insufficient') => {
    if (!payment) return;
    await fetch('/api/dev/mpesa/simulate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paymentId: payment.id, outcome }) });
  };

  if (payment?.status === 'success') {
    return (
      <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950" data-testid="payment-success">
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="size-5" /> {t('success')}
        </div>
        <div className="text-sm">
          {t(`purpose.${purpose}`)} · {formatKes(amountCents)}
        </div>
        <div className="text-sm">
          {t('receipt')}: <span className="font-mono font-semibold">{payment.mpesa_receipt}</span>
        </div>
      </div>
    );
  }

  const waiting = payment && ['initiated', 'pending'].includes(payment.status);
  const failed = payment && ['failed', 'timeout', 'cancelled'].includes(payment.status);

  return (
    <div className="space-y-4" data-testid="pay-panel">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">{t(`purpose.${purpose}`)}</span>
        <span className="text-2xl font-semibold tabular-nums">{formatKes(amountCents)}</span>
      </div>

      {waiting ? (
        <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
          <div className="flex items-center gap-2 font-medium">
            <Smartphone className="size-5" /> {t('sent')}
          </div>
          <p className="text-sm text-muted-foreground">{t('sentHelp')}</p>
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" /> {t('waiting')}
          </div>
          {simulator ? (
            <div className="space-y-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 p-3">
              <p className="text-xs text-amber-900">{t('simulatorNote')} {message}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => simulate('success')} data-testid="simulate-success">
                  {t('simulate')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => simulate('cancelled')}>
                  {t('simulateCancel')}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => simulate('insufficient')}>
                  {t('simulateInsufficient')}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {failed ? (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              <XCircle className="mt-0.5 size-4 shrink-0" />
              <span>
                {t('failed')}: {payment?.result_desc}
              </span>
            </div>
          ) : null}
          <Field label={t('phone')} hint={t('phoneHelp')} htmlFor="mpesa-phone">
            <Input id="mpesa-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="button" size="lg" className="w-full" onClick={send} disabled={pending} data-testid="pay-button">
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {failed ? t('tryAgain') : t('send')}
          </Button>
        </>
      )}
    </div>
  );
}
