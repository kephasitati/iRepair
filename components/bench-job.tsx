'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, ErrorText, Field, KV, NativeSelect } from '@/components/fields';
import { QrScanner } from '@/components/qr-scanner';
import { PhotoCapture } from '@/components/photo-capture';
import { computeTotals, depositFor, formatKes, type DepositRule } from '@/lib/core/money';
import { COMPLETION_TESTS, PROGRESS_TEMPLATES, type QuoteLineInput } from '@/lib/jobs/types';
import {
  acceptCounterAction,
  assignAction,
  benchHandoverAction,
  cancelJobAction,
  completeIntakeAction,
  completeRepairAction,
  counterCollectionAction,
  declineCounterAction,
  progressAction,
  resolveDisputeAction,
  revealPasscodeAction,
  scanAtBenchAction,
  sendQuoteAction,
  setWarrantyAction,
  shopMessageAction,
  waiveReturnFeeAction,
} from '@/app/bench/actions';

type Res = { ok: boolean; error?: string };

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<Res>, success?: string, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Error');
      else {
        if (success) toast.success(success);
        after?.();
      }
    });
  return { pending, error, act };
}

// ---------------------------------------------------------------------------
export function BenchHandover({ jobId, point, title, help }: { jobId: string; point: 'rider_to_shop' | 'shop_to_rider'; title: string; help: string }) {
  const t = useTranslations('job');
  const { pending, error, act } = useAct();
  return (
    <div className="space-y-2" data-testid={`bench-handover-${point}`}>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{help}</p>
      <QrScanner
        busy={pending}
        onScan={(p) => act(() => benchHandoverAction(jobId, point, 'qr', p), t('handoverRecorded'))}
        onManual={(c) => act(() => benchHandoverAction(jobId, point, /^\d{6}$/.test(c) ? 'otp' : 'qr', c), t('handoverRecorded'))}
        manualLabel={t('enterOtp')}
      />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function BenchScanner() {
  const t = useTranslations('bench');
  const router = useRouter();
  const { pending, error, act } = useAct();
  const [last, setLast] = useState<string | null>(null);
  const scan = (payload: string) =>
    act(async () => {
      const r = await scanAtBenchAction(payload);
      if (r.ok) {
        setLast(`${r.data.ref}: ${r.data.point === 'rider_to_shop' ? t('receive') : t('dispatch')}`);
        router.push(`/bench/jobs/${r.data.jobId}`);
      }
      return r;
    }, t('scanned'));
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('scannerHelp')}</p>
      <QrScanner busy={pending} onScan={scan} onManual={scan} />
      {last ? <p className="text-sm font-medium text-emerald-700">{last}</p> : null}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AssignControl({ jobId, techs, current, canReassign, meId }: { jobId: string; techs: { id: string; full_name: string }[]; current: string | null; canReassign: boolean; meId: string }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  if (!canReassign) {
    if (current) return null;
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => assignAction(jobId, null))}>
        {t('assignToMe')}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <NativeSelect className="h-9 text-sm" value={current ?? ''} disabled={pending} onChange={(e) => e.target.value && act(() => assignAction(jobId, e.target.value))} aria-label={t('reassign')}>
        <option value="">{t('unassigned')}</option>
        {techs.map((x) => (
          <option key={x.id} value={x.id}>
            {x.full_name}
            {x.id === meId ? ' (me)' : ''}
          </option>
        ))}
      </NativeSelect>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

export function PasscodeReveal({ jobId }: { jobId: string }) {
  const t = useTranslations('bench');
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const { pending, error, act } = useAct();
  return (
    <div className="flex items-center gap-2">
      {code === undefined ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            act(async () => {
              const r = await revealPasscodeAction(jobId);
              if (r.ok) {
                setCode(r.data.passcode);
                setTimeout(() => setCode(undefined), 30000);
              }
              return r;
            })
          }
        >
          <Eye className="size-4" /> {t('revealPasscode')}
        </Button>
      ) : (
        <span className="rounded-md bg-muted px-2 py-1 font-mono text-lg tracking-widest">{code ?? t('passcodeNotShared')}</span>
      )}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
type DeclaredCondition = { powers_on?: boolean; screen_cracked?: boolean; back_cracked?: boolean; water_damage?: boolean; notes?: string };

export function IntakeForm({ jobId, declared }: { jobId: string; declared: { identifier: string | null; accessories: string[]; condition: DeclaredCondition } }) {
  const t = useTranslations('bench');
  const tw = useTranslations('wizard');
  const { pending, error, act } = useAct();
  const [identifier, setIdentifier] = useState('');
  const [accessories, setAccessories] = useState<string[]>(declared.accessories);
  const [powersOn, setPowersOn] = useState<boolean>(declared.condition.powers_on ?? true);
  const [checks, setChecks] = useState({ screen_cracked: !!declared.condition.screen_cracked, back_cracked: !!declared.condition.back_cracked, water_damage: !!declared.condition.water_damage });
  const [summary, setSummary] = useState('');
  const [photosOk, setPhotosOk] = useState(false);
  const [extra, setExtra] = useState<{ field: string; declared_value: string; observed_value: string; note: string }[]>([]);

  const autoDiscrepancies = useMemo(() => {
    const out: { field: string; declared_value: string; observed_value: string; note: string }[] = [];
    const missing = declared.accessories.filter((a) => !accessories.includes(a));
    if (missing.length) out.push({ field: 'accessories', declared_value: declared.accessories.join(', '), observed_value: accessories.join(', ') || 'none', note: `Not received: ${missing.join(', ')}` });
    if ((declared.condition.powers_on ?? true) !== powersOn) out.push({ field: 'powers_on', declared_value: String(declared.condition.powers_on ?? true), observed_value: String(powersOn), note: '' });
    for (const k of ['screen_cracked', 'back_cracked', 'water_damage'] as const) {
      if (!!declared.condition[k] !== checks[k]) out.push({ field: k, declared_value: declared.condition[k] ? 'yes' : 'no', observed_value: checks[k] ? 'yes' : 'no', note: '' });
    }
    return out;
  }, [accessories, powersOn, checks, declared]);

  const mismatch = identifier.trim() && declared.identifier && identifier.replace(/\s+/g, '').toUpperCase() !== declared.identifier.toUpperCase();
  const total = autoDiscrepancies.length + extra.length + (mismatch ? 1 : 0);

  return (
    <div className="space-y-4" data-testid="intake-form">
      <p className="text-sm text-muted-foreground">{t('intakeHelp')}</p>
      <Field label={t('readIdentifier')} htmlFor="ident" error={mismatch ? t('identifierMismatch') : null} hint={identifier && !mismatch ? t('identifierMatch') : undefined}>
        <Input id="ident" value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoCapitalize="characters" data-testid="intake-identifier" />
      </Field>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('accessoriesReceived')}</p>
        {['charger', 'case', 'sim', 'sd_card'].map((a) => (
          <CheckRow key={a} label={a.replace('_', ' ')} description={declared.accessories.includes(a) ? 'declared' : undefined} checked={accessories.includes(a)} onChange={(e) => setAccessories(e.target.checked ? [...accessories, a] : accessories.filter((x) => x !== a))} />
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('conditionChecks')}</p>
        <CheckRow label={t('powerState')} checked={powersOn} onChange={(e) => setPowersOn(e.target.checked)} />
        <CheckRow label={tw('screenCracked')} checked={checks.screen_cracked} onChange={(e) => setChecks({ ...checks, screen_cracked: e.target.checked })} />
        <CheckRow label={tw('backCracked')} checked={checks.back_cracked} onChange={(e) => setChecks({ ...checks, back_cracked: e.target.checked })} />
        <CheckRow label={tw('waterDamage')} checked={checks.water_damage} onChange={(e) => setChecks({ ...checks, water_damage: e.target.checked })} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('benchPhotos')}</p>
        <PhotoCapture
          jobId={jobId}
          stage="intake"
          slots={[
            { kind: 'front', label: tw('photoFront'), required: true },
            { kind: 'back', label: tw('photoBack'), required: true },
            ...(powersOn ? [{ kind: 'screen_on', label: tw('photoScreenOn') }] : []),
          ]}
          onChange={(u, p) => setPhotosOk(u.some((x) => x.kind === 'front') && u.some((x) => x.kind === 'back') && p === 0)}
        />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium">{t('discrepancy')}</p>
        {autoDiscrepancies.map((d, i) => (
          <p key={i} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {d.field}: {d.declared_value} → {d.observed_value} {d.note}
          </p>
        ))}
        {mismatch ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">IMEI/serial: {declared.identifier} → {identifier.toUpperCase()}</p> : null}
        {extra.map((d, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
            <Input placeholder={t('discrepancyField')} value={d.field} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)))} />
            <Input placeholder={t('discrepancyDeclared')} value={d.declared_value} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? { ...x, declared_value: e.target.value } : x)))} />
            <Input placeholder={t('discrepancyObserved')} value={d.observed_value} onChange={(e) => setExtra(extra.map((x, j) => (j === i ? { ...x, observed_value: e.target.value } : x)))} />
            <Button type="button" size="icon" variant="ghost" onClick={() => setExtra(extra.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setExtra([...extra, { field: '', declared_value: '', observed_value: '', note: '' }])}>
          <Plus className="size-4" /> {t('discrepancy')}
        </Button>
        {total ? (
          <div className="pt-1">
            <p className="mb-1 text-xs text-muted-foreground">Photograph each difference:</p>
            <PhotoCapture jobId={jobId} stage="discrepancy" slots={[{ kind: 'detail', label: 'Detail' }]} allowExtra={false} />
          </div>
        ) : null}
      </div>
      <Field label={t('summary')} htmlFor="summary">
        <Textarea id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} data-testid="intake-summary" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button
        size="lg"
        className="w-full"
        disabled={pending || !summary.trim() || !identifier.trim() || !photosOk}
        onClick={() =>
          act(
            () =>
              completeIntakeAction(jobId, {
                identifier_read: identifier,
                accessories_received: accessories,
                condition_checks: { ...checks, powers_on: powersOn },
                powers_on: powersOn,
                summary,
                discrepancies: [...autoDiscrepancies, ...extra.filter((x) => x.field.trim())],
              }),
            'Intake saved',
          )
        }
        data-testid="complete-intake"
      >
        {total ? t('intakeWithDiscrepancies') : t('confirmIntake')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export type CataloguePart = { id: string; name: string; device_family: string | null; kind: string; default_price_cents: number };

export function QuoteBuilder({
  jobId,
  kind,
  catalogue,
  initialLines,
  tax,
  depositRule,
  depositMinCents,
  revising,
  collectUpfrontDefault,
}: {
  jobId: string;
  kind: 'main' | 'supplementary';
  catalogue: CataloguePart[];
  initialLines?: QuoteLineInput[];
  tax: { vatRegistered: boolean; vatRateBp: number; pricesIncludeVat: boolean };
  depositRule: DepositRule;
  depositMinCents: number;
  revising?: boolean;
  collectUpfrontDefault?: boolean;
}) {
  const t = useTranslations('bench');
  const tj = useTranslations('job');
  const { pending, error, act } = useAct();
  const [lines, setLines] = useState<(QuoteLineInput & { priceKes: string })[]>((initialLines ?? []).map((l) => ({ ...l, priceKes: String(l.unit_price_cents / 100) })));
  const [pick, setPick] = useState('');
  const [turnaround, setTurnaround] = useState('2');
  const [message, setMessage] = useState('');
  const [upfront, setUpfront] = useState(!!collectUpfrontDefault);

  const priced = lines.map((l) => ({ ...l, unit_price_cents: Math.round(Number(l.priceKes || 0)) * 100 }));
  const totals = computeTotals(priced.map((l) => ({ description: l.description, qty: l.qty, unitPriceCents: l.unit_price_cents })), tax);
  const deposit = kind === 'main' ? depositFor(totals.totalCents, depositRule, depositMinCents) : 0;
  const update = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="space-y-3" data-testid={`quote-builder-${kind}`}>
      <div className="flex gap-2">
        <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} aria-label={t('addFromCatalogue')} data-testid="catalogue-select">
          <option value="">{t('addFromCatalogue')}…</option>
          {catalogue.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {formatKes(p.default_price_cents)}
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          disabled={!pick}
          onClick={() => {
            const p = catalogue.find((x) => x.id === pick);
            if (p) setLines([...lines, { kind: p.kind === 'labour' ? 'labour' : 'part', part_id: p.id, description: p.name, qty: 1, unit_price_cents: p.default_price_cents, priceKes: String(p.default_price_cents / 100) }]);
            setPick('');
          }}
          data-testid="catalogue-add"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={() => setLines([...lines, { kind: 'labour', part_id: null, description: '', qty: 1, unit_price_cents: 0, priceKes: '' }])}>
        <Plus className="size-4" /> {t('addCustom')}
      </Button>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_4rem_6rem_auto] items-center gap-2">
            <Input value={l.description} onChange={(e) => update(i, { description: e.target.value })} placeholder={t('description')} />
            <Input inputMode="numeric" value={String(l.qty)} onChange={(e) => update(i, { qty: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })} aria-label={t('qty')} />
            <Input inputMode="numeric" value={l.priceKes} onChange={(e) => update(i, { priceKes: e.target.value.replace(/[^\d]/g, '') })} aria-label={t('unitPrice')} />
            <Button type="button" size="icon" variant="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <div className="rounded-lg bg-muted/50 p-3">
        <KV k={tj('quoteSubtotal')} v={formatKes(totals.subtotalCents)} />
        {tax.vatRegistered ? <KV k={tj('quoteVat', { rate: tax.vatRateBp / 100 })} v={formatKes(totals.vatCents)} /> : null}
        <KV k={tj('quoteTotal')} v={formatKes(totals.totalCents)} strong />
        {kind === 'main' ? <KV k={tj('quoteDeposit')} v={formatKes(deposit)} /> : null}
      </div>
      {kind === 'main' ? (
        <Field label={t('turnaround')} htmlFor={`ta-${kind}`}>
          <Input id={`ta-${kind}`} inputMode="numeric" value={turnaround} onChange={(e) => setTurnaround(e.target.value.replace(/\D/g, ''))} />
        </Field>
      ) : (
        <CheckRow label="Collect this amount before continuing" checked={upfront} onChange={(e) => setUpfront(e.target.checked)} />
      )}
      <Field label={t('quoteMessage')} htmlFor={`msg-${kind}`}>
        <Textarea id={`msg-${kind}`} value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button
        size="lg"
        className="w-full"
        disabled={pending || !lines.length || lines.some((l) => !l.description.trim() || !l.priceKes)}
        onClick={() =>
          act(
            () =>
              sendQuoteAction(jobId, {
                kind,
                lines: priced.map(({ priceKes: _p, ...l }) => l),
                turnaroundDays: kind === 'main' ? Number(turnaround) || null : null,
                message,
                collectUpfront: upfront,
              }),
            'Quote sent',
          )
        }
        data-testid="send-quote"
      >
        {revising ? t('reviseQuote') : t('sendQuote')}
      </Button>
    </div>
  );
}

export function CounterResponse({ jobId, kind, negotiationId, amountCents }: { jobId: string; kind: 'main' | 'supplementary'; negotiationId: string; amountCents: number }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  const [msg, setMsg] = useState('');
  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <Button className="w-full" disabled={pending} onClick={() => act(() => acceptCounterAction(jobId, kind, negotiationId), 'Counter-offer accepted')} data-testid="accept-counter">
        {t('acceptCounter', { amount: formatKes(amountCents) })}
      </Button>
      <div className="flex gap-2">
        <Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Reason (optional)" />
        <Button variant="outline" disabled={pending} onClick={() => act(() => declineCounterAction(jobId, kind, msg))}>
          {t('declineCounter')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">Or send a revised quote below.</p>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function ShopMessageBox({ jobId, kind }: { jobId: string; kind: 'main' | 'supplementary' }) {
  const { pending, act } = useAct();
  const [body, setBody] = useState('');
  return (
    <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), act(() => shopMessageAction(jobId, kind, body), undefined, () => setBody('')))}>
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message the customer…" />
      <Button type="submit" variant="outline" disabled={pending || !body.trim()}>
        Send
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------------------
export function ProgressForm({ jobId }: { jobId: string }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  const [template, setTemplate] = useState('');
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {PROGRESS_TEMPLATES.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => (setTemplate(k), setBody(t(`progressTemplates.${k}`)))}
            className={`rounded-full border px-3 py-1.5 text-xs ${template === k ? 'border-primary bg-primary/10' : ''}`}
          >
            {t(`progressTemplates.${k}`)}
          </button>
        ))}
      </div>
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={t('progressUpdate')} />
      <PhotoCapture key={resetKey} jobId={jobId} stage="progress" slots={[{ kind: 'progress', label: 'Photo' }]} allowExtra={false} onChange={(u) => setPhotoIds(u.map((x) => x.photoId))} />
      <CheckRow label={t('internalNote')} description="Not shown to the customer" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
      <ErrorText>{error}</ErrorText>
      <Button
        disabled={pending || !body.trim()}
        onClick={() =>
          act(() => progressAction(jobId, { template_key: template || null, body, photo_ids: photoIds, internal }), 'Posted', () => {
            setBody('');
            setTemplate('');
            setPhotoIds([]);
            setResetKey((k) => k + 1);
          })
        }
      >
        {t('progressUpdate')}
      </Button>
    </div>
  );
}

export function CompleteRepairForm({ jobId }: { jobId: string }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  const [tests, setTests] = useState<Record<string, boolean>>(Object.fromEntries(COMPLETION_TESTS.map((k) => [k, false])));
  const [notes, setNotes] = useState('');
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  return (
    <div className="space-y-3" data-testid="complete-form">
      <p className="text-sm font-medium">{t('completionChecklist')}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {COMPLETION_TESTS.map((k) => (
          <CheckRow key={k} label={t(`tests.${k}`)} checked={tests[k]} onChange={(e) => setTests({ ...tests, [k]: e.target.checked })} data-testid={`test-${k}`} />
        ))}
      </div>
      <PhotoCapture jobId={jobId} stage="completion" slots={[{ kind: 'front', label: 'After · front', required: true }, { kind: 'back', label: 'After · back' }]} onChange={(u) => setPhotoIds(u.map((x) => x.photoId))} />
      <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (required if a test did not pass)" rows={2} />
      <ErrorText>{error}</ErrorText>
      <Button size="lg" className="w-full" disabled={pending || !photoIds.length} onClick={() => act(() => completeRepairAction(jobId, { tests, notes, photo_ids: photoIds }), 'Marked complete')} data-testid="complete-repair">
        {t('complete')}
      </Button>
    </div>
  );
}

export function CounterCollection({ jobId }: { jobId: string }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('collectionHelp')}</p>
      <QrScanner busy={pending} onScan={(p) => act(() => counterCollectionAction(jobId, p), 'Handed over')} onManual={(c) => act(() => counterCollectionAction(jobId, c), 'Handed over')} manualLabel="6-digit collection code" />
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function AdminCancel({ jobId }: { jobId: string }) {
  const t = useTranslations('bench');
  const { pending, error, act } = useAct();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open)
    return (
      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setOpen(true)}>
        {t('cancelJob')}
      </Button>
    );
  return (
    <div className="space-y-2 rounded-xl border border-destructive/30 p-3">
      <p className="text-xs text-muted-foreground">{t('cancelJobHelp')}</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (shown to the customer)" />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button variant="destructive" size="sm" disabled={pending || !reason.trim()} onClick={() => act(() => cancelJobAction(jobId, reason), 'Cancelled')}>
          {t('cancelJob')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Back
        </Button>
      </div>
    </div>
  );
}

export function WaiveReturnFee({ jobId }: { jobId: string }) {
  const { pending, error, act } = useAct();
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => waiveReturnFeeAction(jobId), 'Return fee waived')}>
        Waive return fee
      </Button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function DisputeResolve({ disputeId }: { disputeId: string }) {
  const { pending, error, act } = useAct();
  const [text, setText] = useState('');
  return (
    <div className="mt-2 space-y-2">
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Resolution" />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !text} onClick={() => act(() => resolveDisputeAction(disputeId, 'resolved', text), 'Resolved')}>
          Resolve
        </Button>
        <Button size="sm" variant="outline" disabled={pending || !text} onClick={() => act(() => resolveDisputeAction(disputeId, 'rejected', text), 'Rejected')}>
          Reject
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

export function WarrantyEdit({ jobId, current }: { jobId: string; current: string | null }) {
  const { pending, error, act } = useAct();
  const [d, setD] = useState(current ?? '');
  return (
    <div className="flex items-center gap-2">
      <Input type="date" value={d} onChange={(e) => setD(e.target.value)} className="h-9 w-auto" />
      <Button size="sm" variant="outline" disabled={pending || !d} onClick={() => act(() => setWarrantyAction(jobId, d), 'Saved')}>
        Save
      </Button>
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
