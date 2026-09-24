import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { BookingWizard, type WizardInitial } from '@/components/booking-wizard';
import { requestCtx, requireCustomer } from '@/lib/auth';
import { withUser } from '@/lib/db';
import type { JobRow } from '@/lib/jobs/types';
import { DEFAULT_DEVICE_TYPES } from '@/lib/core/device-id';

export const metadata = { title: 'Book a pickup' };

export default async function BookPage({ searchParams }: { searchParams: Promise<{ job?: string; type?: string }> }) {
  const sp = await searchParams;
  const { tenant } = await requireCustomer(`/book${sp.job ? `?job=${sp.job}` : sp.type ? `?type=${sp.type}` : ''}`);
  const deviceTypes = tenant.settings.device_types?.length ? tenant.settings.device_types : DEFAULT_DEVICE_TYPES;
  const requestedType = deviceTypes.find((d) => d === sp.type);
  const t = await getTranslations('wizard');
  const ctx = await requestCtx();

  const { draft, secret, photos, addresses } = await withUser(ctx, async (tx) => {
    const [draft] = sp.job ? ((await tx`select * from jobs where id = ${sp.job}`) as JobRow[]) : [];
    const [secret] = draft ? await tx`select identifier from job_secrets where job_id = ${draft.id}` : [];
    const photos = draft ? await tx`select id, kind from job_photos where job_id = ${draft.id} and stage = 'customer_declared' and deleted_at is null` : [];
    const addresses = await tx`select * from addresses where user_id = ${ctx.userId} order by created_at desc`;
    return { draft, secret, photos, addresses };
  });
  if (draft && draft.status !== 'draft') redirect(`/jobs/${draft.id}`);

  const c = draft?.declared_condition ?? {};
  const initial: WizardInitial = {
    jobId: draft?.id ?? null,
    device_type: draft?.device_type ?? requestedType ?? deviceTypes[0],
    device_brand: draft?.device_brand ?? 'Apple',
    device_model: draft?.device_model ?? '',
    device_colour: draft?.device_colour ?? '',
    device_storage: draft?.device_storage ?? '',
    fault_description: draft?.fault_description ?? '',
    condition: { powers_on: c.powers_on ?? true, screen_cracked: !!c.screen_cracked, back_cracked: !!c.back_cracked, water_damage: !!c.water_damage, notes: c.notes ?? '' },
    accessories: draft?.accessories ?? [],
    passcode_locked: draft?.passcode_locked ?? false,
    passcode_shared: draft?.passcode_shared ?? false,
    identifier: secret?.identifier ?? '',
    declared_value_kes: draft ? String(Number(draft.declared_value_cents) / 100 || '') : '',
    photos: photos.map((p) => ({ id: p.id, kind: p.kind })),
    address: draft?.pickup_address ?? { formatted: '', lat: null, lng: null, landmark: '', building_floor: '', zone: null },
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <BookingWizard
        deviceTypes={deviceTypes}
        initial={initial}
        savedAddresses={addresses.map((a) => ({ id: a.id, label: a.label, formatted: a.formatted, lat: a.lat, lng: a.lng, landmark: a.landmark, building_floor: a.building_floor, zone: a.zone, place_id: a.place_id }))}
        zones={tenant.settings.service_zones}
        openingHours={tenant.settings.opening_hours}
        consultationCents={tenant.settings.consultation_fee_cents}
        consultationCredited={tenant.settings.consultation_fee_credited}
      />
    </div>
  );
}
