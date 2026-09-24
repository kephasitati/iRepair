'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { LocateFixed } from 'lucide-react';
import { APIProvider, AdvancedMarker, Map, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, NativeSelect } from '@/components/fields';
import type { Address } from '@/lib/providers/delivery/types';

const NAIROBI = { lat: -1.2864, lng: 36.8172 };

/**
 * Nairobi addresses need more than a street: Places autocomplete + a draggable pin + landmark + building/floor.
 * Without a Google Maps key it degrades to free text plus "use my location" for the coordinates.
 */
export function AddressPicker({ value, onChange, zones }: { value: Address; onChange: (a: Address) => void; zones: string[] }) {
  const t = useTranslations('wizard');
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const set = (patch: Partial<Address>) => onChange({ ...value, ...patch });

  const locate = () =>
    navigator.geolocation?.getCurrentPosition(
      (p) => set({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    );

  return (
    <div className="space-y-4">
      {key ? (
        <APIProvider apiKey={key} region="KE">
          <PlacesInput value={value} onChange={onChange} zones={zones} />
          <div className="h-56 overflow-hidden rounded-xl border">
            <Map
              mapId="repairdesk"
              defaultCenter={value.lat && value.lng ? { lat: value.lat, lng: value.lng } : NAIROBI}
              center={value.lat && value.lng ? { lat: value.lat, lng: value.lng } : undefined}
              defaultZoom={15}
              gestureHandling="greedy"
              disableDefaultUI
            >
              {value.lat && value.lng ? (
                <AdvancedMarker
                  position={{ lat: value.lat, lng: value.lng }}
                  draggable
                  onDragEnd={(e) => e.latLng && set({ lat: e.latLng.lat(), lng: e.latLng.lng() })}
                />
              ) : null}
            </Map>
          </div>
          <p className="text-xs text-muted-foreground">{t('pinHelp')}</p>
        </APIProvider>
      ) : (
        <Field label={t('address')} htmlFor="addr">
          <Input id="addr" value={value.formatted} onChange={(e) => set({ formatted: e.target.value })} placeholder={t('addressSearch')} autoComplete="street-address" required />
        </Field>
      )}

      {zones.length ? (
        <Field label={t('zoneLabel')} htmlFor="zone">
          <NativeSelect id="zone" value={value.zone ?? ''} onChange={(e) => set({ zone: e.target.value })} required>
            <option value="" disabled>
              —
            </option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      <Field label={t('buildingFloor')} htmlFor="bf">
        <Input id="bf" value={value.building_floor ?? ''} onChange={(e) => set({ building_floor: e.target.value })} />
      </Field>
      <Field label={t('landmark')} htmlFor="lm">
        <Input id="lm" value={value.landmark ?? ''} onChange={(e) => set({ landmark: e.target.value })} placeholder={t('landmarkPlaceholder')} />
      </Field>
      {!key ? (
        <Button type="button" variant="outline" onClick={locate} className="w-full">
          <LocateFixed className="size-4" /> {value.lat ? `${value.lat.toFixed(5)}, ${value.lng?.toFixed(5)}` : t('useLocation')}
        </Button>
      ) : null}
    </div>
  );
}

function PlacesInput({ value, onChange, zones }: { value: Address; onChange: (a: Address) => void; zones: string[] }) {
  const t = useTranslations('wizard');
  const places = useMapsLibrary('places');
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value.formatted);
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  useEffect(() => {
    if (!places || !inputRef.current) return;
    const ac = new places.Autocomplete(inputRef.current, {
      componentRestrictions: { country: 'ke' },
      fields: ['formatted_address', 'name', 'geometry', 'place_id', 'address_components'],
    });
    const l = ac.addListener('place_changed', () => {
      const p = ac.getPlace();
      const loc = p.geometry?.location;
      const areas = (p.address_components ?? []).filter((c) => c.types.some((ty) => ['sublocality', 'sublocality_level_1', 'neighborhood', 'locality'].includes(ty))).map((c) => c.long_name);
      const zone = zones.find((z) => areas.some((a) => a.toLowerCase().includes(z.toLowerCase()))) ?? latest.current.value.zone ?? null;
      const formatted = [p.name, p.formatted_address].filter(Boolean).join(', ');
      setText(formatted);
      latest.current.onChange({ ...latest.current.value, formatted, place_id: p.place_id ?? null, lat: loc?.lat() ?? null, lng: loc?.lng() ?? null, zone });
    });
    return () => l.remove();
  }, [places, zones]);

  return (
    <Field label={t('address')} htmlFor="addr">
      <Input
        id="addr"
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          latest.current.onChange({ ...latest.current.value, formatted: e.target.value });
        }}
        placeholder={t('addressSearch')}
        required
      />
    </Field>
  );
}
