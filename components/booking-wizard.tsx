'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { DeviceIcon } from '@/components/device-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { CheckRow, ErrorText, Field, KV, NativeSelect, RadioRow, Section } from '@/components/fields';
import { PhotoCapture, type ExistingPhoto } from '@/components/photo-capture';
import { AddressPicker } from '@/components/address-picker';
import { APPLE_TYPES, checkDeviceIdentifier, type DeviceType } from '@/lib/core/device-id';
import { IDENTIFIER_HELP, MODEL_SUGGESTIONS } from '@/lib/core/device-models';
import { formatKes } from '@/lib/core/money';
import { addDays, deliverySlots, formatDate, nairobiToday, type OpeningHours } from '@/lib/core/time';
import type { Address } from '@/lib/providers/delivery/types';
import { saveDraftAction, setPickupAction, submitDraftAction } from '@/app/(shop)/actions';
import { cn } from '@/lib/utils';

export type WizardInitial = {
  jobId: string | null;
  device_type: DeviceType;
  device_brand: string;
  device_model: string;
  device_colour: string;
  device_storage: string;
  fault_description: string;
  condition: { powers_on: boolean; screen_cracked: boolean; back_cracked: boolean; water_damage: boolean; notes: string };
  accessories: string[];
  passcode_locked: boolean;
  passcode_shared: boolean;
  identifier: string;
  declared_value_kes: string;
  photos: ExistingPhoto[];
  address: Address;
};

const APPLE: DeviceType[] = APPLE_TYPES;

export function BookingWizard({
  initial,
  savedAddresses,
  zones,
  openingHours,
  consultationCents,
  consultationCredited,
  deviceTypes,
}: {
  deviceTypes: DeviceType[];
  initial: WizardInitial;
  savedAddresses: (Address & { id: string; label: string })[];
  zones: string[];
  openingHours: OpeningHours;
  consultationCents: number;
  consultationCredited: boolean;
}) {
  const t = useTranslations();
  const tw = useTranslations('wizard');
  const [step, setStep] = useState(initial.jobId ? 3 : 1);
  const [s, setS] = useState(initial);
  const [passcode, setPasscode] = useState('');
  const [saveDevice, setSaveDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [photoState, setPhotoState] = useState<{ kinds: string[]; pending: number }>({ kinds: initial.photos.map((p) => p.kind), pending: 0 });
  const [addressChoice, setAddressChoice] = useState<string>(savedAddresses[0]?.id ?? 'new');
  const [newAddress, setNewAddress] = useState<Address>(initial.address);
  const [saveAddress, setSaveAddress] = useState(true);
  const [addressLabel, setAddressLabel] = useState('');
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(nairobiToday(), i)), []);
  const [day, setDay] = useState(() => days.find((d) => deliverySlots(d, openingHours).length > 0) ?? days[0]);
  const slots = useMemo(() => deliverySlots(day, openingHours), [day, openingHours]);
  const [slotIdx, setSlotIdx] = useState(0);
  const [fees, setFees] = useState<{ deliveryFeeCents: number; consultationCents: number; totalCents: number } | null>(null);
  const [agree, setAgree] = useState(false);

  const TOTAL = 5;
  const set = (patch: Partial<WizardInitial>) => setS((x) => ({ ...x, ...patch }));
  const idCheck = s.identifier ? checkDeviceIdentifier(s.device_type, s.identifier) : null;
  const idError = idCheck && !idCheck.ok ? tw(`identifierErrors.${idCheck.error}`) : null;
  const needScreenOn = s.condition.powers_on;
  const photosOk = photoState.kinds.includes('front') && photoState.kinds.includes('back') && (!needScreenOn || photoState.kinds.includes('screen_on')) && photoState.pending === 0;

  const translateError = (e: string) => {
    if (e.startsWith('identifier:')) return tw(`identifierErrors.${e.slice('identifier:'.length)}`);
    if (e.startsWith('zone:')) return tw('outsideZone', { zones: e.slice(5) });
    return e;
  };

  const saveDetails = () =>
    start(async () => {
      setError(null);
      const r = await saveDraftAction(s.jobId, {
        device_type: s.device_type,
        device_brand: s.device_brand,
        device_model: s.device_model,
        device_colour: s.device_colour || null,
        device_storage: s.device_storage || null,
        fault_description: s.fault_description,
        declared_condition: s.condition,
        accessories: s.accessories,
        passcode_locked: s.passcode_locked,
        passcode_shared: s.passcode_shared,
        passcode: passcode || null,
        identifier: s.identifier,
        declared_value_cents: Math.round(Number(s.declared_value_kes || 0)) * 100,
        save_device: saveDevice,
      });
      if (!r.ok) return setError(translateError(r.error));
      set({ jobId: r.data.jobId });
      window.history.replaceState(null, '', `/book?job=${r.data.jobId}`);
      setStep(3);
    });

  const savePickup = () =>
    start(async () => {
      setError(null);
      const slot = slots[slotIdx];
      if (!slot) return setError(tw('noSlots'));
      const saved = savedAddresses.find((a) => a.id === addressChoice);
      const address: Address = saved ? { formatted: saved.formatted, lat: saved.lat, lng: saved.lng, landmark: saved.landmark, building_floor: saved.building_floor, zone: saved.zone, place_id: saved.place_id } : newAddress;
      const r = await setPickupAction(s.jobId!, { address, saveAddress: !saved && saveAddress, label: addressLabel, windowStart: slot.start.toISOString(), windowEnd: slot.end.toISOString() });
      if (!r.ok) return setError(translateError(r.error));
      setFees(r.data);
      setStep(5);
    });

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await submitDraftAction(s.jobId!);
      if (r && !r.ok) setError(r.error);
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {step > 1 ? (
          <Button type="button" variant="ghost" size="icon" onClick={() => setStep(step - 1)} aria-label={t('common.back')}>
            <ChevronLeft className="size-5" />
          </Button>
        ) : null}
        <div className="flex-1">
          <p className="text-[13px] text-ink-3">{tw('stepOf', { n: step, total: TOTAL })}</p>
          <div className="mt-1.5 flex gap-1.5">
            {Array.from({ length: TOTAL }, (_, i) => (
              <span key={i} className={cn('h-1 flex-1 rounded-full transition-colors duration-500', i < step ? 'bg-primary' : 'bg-fill')} />
            ))}
          </div>
        </div>
      </div>

      {step === 1 ? (
        <Section title={tw('device')}>
          <div className="space-y-4">
            <div>
              <p className="mb-3 text-[15px] font-medium">{tw('deviceType')}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {deviceTypes.map((d) => (
                  <button
                    type="button"
                    key={d}
                    onClick={() => set({ device_type: d, device_brand: APPLE.includes(d) ? 'Apple' : s.device_brand === 'Apple' ? '' : s.device_brand })}
                    data-on={s.device_type === d}
                    className="opt flex min-h-28 flex-col items-center justify-center gap-2 p-3 text-center text-[15px] font-medium"
                    data-testid={`device-${d}`}
                  >
                    <DeviceIcon type={d} className="h-12 w-14" />
                    {t(`devices.${d}`)}
                  </button>
                ))}
              </div>
            </div>
            {!APPLE.includes(s.device_type) ? (
              <Field label={tw('brand')} htmlFor="brand">
                <Input id="brand" value={s.device_brand} onChange={(e) => set({ device_brand: e.target.value })} placeholder={tw('brandPlaceholder')} />
              </Field>
            ) : null}
            <Field label={tw('model')} htmlFor="model">
              <Input id="model" list="model-suggestions" value={s.device_model} onChange={(e) => set({ device_model: e.target.value })} placeholder={tw('modelPlaceholder')} required autoComplete="off" />
              <datalist id="model-suggestions">
                {(MODEL_SUGGESTIONS[s.device_type] ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={tw('colour')} htmlFor="colour">
                <Input id="colour" value={s.device_colour} onChange={(e) => set({ device_colour: e.target.value })} />
              </Field>
              <Field label={tw('storage')} htmlFor="storage">
                <Input id="storage" value={s.device_storage} onChange={(e) => set({ device_storage: e.target.value })} placeholder="128 GB" />
              </Field>
            </div>
            <Field label={tw('fault')} htmlFor="fault">
              <Textarea id="fault" value={s.fault_description} onChange={(e) => set({ fault_description: e.target.value })} placeholder={tw('faultPlaceholder')} rows={4} required />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-medium">{tw('condition')}</p>
              {(['powers_on', 'screen_cracked', 'back_cracked', 'water_damage'] as const).map((k) => (
                <CheckRow
                  key={k}
                  label={tw(k === 'powers_on' ? 'powersOn' : k === 'screen_cracked' ? 'screenCracked' : k === 'back_cracked' ? 'backCracked' : 'waterDamage')}
                  checked={s.condition[k]}
                  onChange={(e) => set({ condition: { ...s.condition, [k]: e.target.checked } })}
                />
              ))}
              <Input value={s.condition.notes} onChange={(e) => set({ condition: { ...s.condition, notes: e.target.value } })} placeholder={tw('conditionNotes')} />
            </div>
            <Button type="button" size="lg" className="w-full" disabled={!s.device_model.trim() || s.fault_description.trim().length < 5} onClick={() => setStep(2)}>
              {t('common.next')}
            </Button>
          </div>
        </Section>
      ) : null}

      {step === 2 ? (
        <Section title={tw('identifier')}>
          <div className="space-y-4">
            <Field label={tw('identifier')} hint={IDENTIFIER_HELP[s.device_type] ?? tw('identifierHelp')} htmlFor="identifier" error={idError}>
              <Input
                id="identifier"
                value={s.identifier}
                onChange={(e) => set({ identifier: e.target.value })}
                autoCapitalize="characters"
                inputMode={s.device_type === 'iphone' || s.device_type === 'android' ? 'numeric' : 'text'}
                required
              />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-medium">{tw('accessories')}</p>
              <div className="grid grid-cols-2 gap-2">
                {(['charger', 'case', 'sim', 'sd_card'] as const).map((a) => (
                  <CheckRow
                    key={a}
                    label={tw(a === 'charger' ? 'accessoryCharger' : a === 'case' ? 'accessoryCase' : a === 'sim' ? 'accessorySim' : 'accessorySd')}
                    checked={s.accessories.includes(a)}
                    onChange={(e) => set({ accessories: e.target.checked ? [...s.accessories, a] : s.accessories.filter((x) => x !== a) })}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{tw('passcode')}</p>
              <CheckRow label={tw('passcodeLocked')} checked={s.passcode_locked} onChange={(e) => set({ passcode_locked: e.target.checked, passcode_shared: e.target.checked && s.passcode_shared })} />
              {s.passcode_locked ? (
                <>
                  <CheckRow label={tw('passcodeShare')} description={tw('passcodeHelp')} checked={s.passcode_shared} onChange={(e) => set({ passcode_shared: e.target.checked })} />
                  {s.passcode_shared ? (
                    <Field label={tw('passcodeValue')} htmlFor="passcode">
                      <Input id="passcode" type="password" autoComplete="off" value={passcode} onChange={(e) => setPasscode(e.target.value)} />
                    </Field>
                  ) : null}
                </>
              ) : null}
            </div>
            <Field label={tw('declaredValue')} hint={tw('declaredValueHelp')} htmlFor="value">
              <Input id="value" inputMode="numeric" value={s.declared_value_kes} onChange={(e) => set({ declared_value_kes: e.target.value.replace(/\D/g, '') })} placeholder="KES" />
            </Field>
            <CheckRow label={tw('saveDevice')} checked={saveDevice} onChange={(e) => setSaveDevice(e.target.checked)} />
            <ErrorText>{error}</ErrorText>
            <Button type="button" size="lg" className="w-full" disabled={pending || !idCheck?.ok || (s.passcode_locked && s.passcode_shared && !passcode && !initial.jobId)} onClick={saveDetails}>
              {pending ? tw('saving') : t('common.next')}
            </Button>
          </div>
        </Section>
      ) : null}

      {step === 3 && s.jobId ? (
        <Section title={tw('photos')}>
          <p className="mb-3 text-sm text-muted-foreground">{tw('photosHelp')}</p>
          <PhotoCapture
            jobId={s.jobId}
            stage="customer_declared"
            existing={initial.photos}
            slots={[
              { kind: 'front', label: tw('photoFront'), required: true },
              { kind: 'back', label: tw('photoBack'), required: true },
              ...(needScreenOn ? [{ kind: 'screen_on', label: tw('photoScreenOn'), required: true }] : []),
            ]}
            onChange={(uploaded, pendingCount) => setPhotoState({ kinds: uploaded.map((u) => u.kind), pending: pendingCount })}
          />
          <p className="mt-3 text-xs text-muted-foreground">{tw('photosMin', { screen: String(needScreenOn) })}</p>
          <Button type="button" size="lg" className="mt-4 w-full" disabled={!photosOk} onClick={() => setStep(4)} data-testid="photos-next">
            {t('common.next')}
          </Button>
        </Section>
      ) : null}

      {step === 4 ? (
        <Section title={tw('pickup')}>
          <div className="space-y-4">
            {savedAddresses.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{tw('savedAddresses')}</p>
                {savedAddresses.map((a) => (
                  <RadioRow key={a.id} name="addr" checked={addressChoice === a.id} onChange={() => setAddressChoice(a.id)} label={a.label || a.formatted} description={[a.formatted, a.building_floor, a.landmark].filter(Boolean).join(' · ')} />
                ))}
                <RadioRow name="addr" checked={addressChoice === 'new'} onChange={() => setAddressChoice('new')} label={tw('newAddress')} />
              </div>
            ) : null}
            {addressChoice === 'new' || !savedAddresses.length ? (
              <>
                <AddressPicker value={newAddress} onChange={setNewAddress} zones={zones} />
                <CheckRow label={tw('saveAddress')} checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} />
                {saveAddress ? <Input value={addressLabel} onChange={(e) => setAddressLabel(e.target.value)} placeholder={tw('addressLabel')} /> : null}
              </>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label={tw('pickDate')} htmlFor="day">
                <NativeSelect id="day" value={day} onChange={(e) => (setDay(e.target.value), setSlotIdx(0))}>
                  {days.map((d, i) => (
                    <option key={d} value={d}>
                      {i === 0 ? t('common.today') : formatDate(`${d}T12:00:00+03:00`)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={tw('pickSlot')} htmlFor="slot">
                <NativeSelect id="slot" value={slotIdx} onChange={(e) => setSlotIdx(Number(e.target.value))} disabled={!slots.length}>
                  {slots.length ? slots.map((sl, i) => <option key={sl.label} value={i}>{sl.label}</option>) : <option>{tw('noSlots')}</option>}
                </NativeSelect>
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">{tw('windowHelp')}</p>
            <ErrorText>{error}</ErrorText>
            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={pending || !slots.length || (addressChoice === 'new' && !newAddress.formatted.trim()) || (zones.length > 0 && addressChoice === 'new' && !newAddress.zone)}
              onClick={savePickup}
            >
              {pending ? tw('saving') : t('common.next')}
            </Button>
          </div>
        </Section>
      ) : null}

      {step === 5 && fees ? (
        <Section title={tw('review')}>
          <p className="mb-3 text-sm text-muted-foreground">{tw('reviewHelp')}</p>
          <div className="divide-y">
            <KV k={tw('deviceSummary')} v={`${s.device_brand} ${s.device_model}`.trim()} />
            <KV k={tw('faultSummary')} v={<span className="line-clamp-2">{s.fault_description}</span>} />
            <KV k={tw('pickupSummary')} v={`${formatDate(slots[slotIdx]?.start ?? new Date())} ${slots[slotIdx]?.label ?? ''}`} />
            <KV k={t('common.photos')} v={tw('photoCount', { n: photoState.kinds.length })} />
          </div>
          <div className="mt-4 rounded-xl bg-muted/50 p-3">
            <KV k={tw('feeDelivery')} v={formatKes(fees.deliveryFeeCents)} />
            <KV k={tw('feeConsultation')} v={formatKes(fees.consultationCents)} />
            {consultationCredited && consultationCents > 0 ? <p className="text-xs text-muted-foreground">{tw('feeConsultationCredit')}</p> : null}
            <KV k={tw('feeTotal')} v={formatKes(fees.totalCents)} strong />
          </div>
          <label className="mt-4 flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-5 accent-(--primary)" checked={agree} onChange={(e) => setAgree(e.target.checked)} data-testid="agree" />
            <span>
              {tw.rich('agree', {
                terms: (chunks) => (
                  <a href="/terms" target="_blank" className="text-link hover:underline">
                    {chunks}
                  </a>
                ),
                privacy: (chunks) => (
                  <a href="/privacy" target="_blank" className="text-link hover:underline">
                    {chunks}
                  </a>
                ),
              })}
            </span>
          </label>
          <ErrorText>{error}</ErrorText>
          <Button type="button" size="lg" className="mt-4 w-full" disabled={!agree || pending} onClick={submit} data-testid="submit-booking">
            {tw('payAndBook', { amount: formatKes(fees.totalCents) })}
          </Button>
        </Section>
      ) : null}
    </div>
  );
}
