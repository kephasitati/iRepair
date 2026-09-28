"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckRow, ErrorText, Field, NativeSelect, RadioRow, Section } from "@/components/fields";
import { createWalkInAction } from "@/app/bench/actions";

type Option = { value: string; label: string };

/**
 * Opens a walk-in at the counter (D-42). The same proof of ownership as an online booking: the IMEI/serial, or the
 * customer's ID with a photo. On success the action redirects to the new job, where the consent QR code is shown.
 */
export function WalkInForm({ devices, idKinds, fees }: { devices: Option[]; idKinds: Option[]; fees: Record<string, string> }) {
  const [state, action, pending] = useActionState(createWalkInAction, null);
  const [deviceType, setDeviceType] = useState(devices[0]?.value ?? "");
  const [identity, setIdentity] = useState<"device" | "id">("device");
  const [locked, setLocked] = useState(false);

  return (
    <form action={action} className="space-y-4" data-testid="walk-in-form">
      <Section title="Customer">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Phone number" htmlFor="wi-phone" hint="The consent link is sent here by SMS.">
            <Input id="wi-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="07XX XXX XXX" required />
          </Field>
          <Field label="Name" htmlFor="wi-name" hint="Needed for a new customer.">
            <Input id="wi-name" name="name" autoComplete="off" maxLength={100} />
          </Field>
        </div>
      </Section>

      <Section title="Device">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Type" htmlFor="wi-type" hint={fees[deviceType] ? `Consultation fee ${fees[deviceType]}` : undefined}>
            <NativeSelect id="wi-type" name="device_type" value={deviceType} onChange={(e) => setDeviceType(e.target.value)}>
              {devices.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Brand" htmlFor="wi-brand">
            <Input id="wi-brand" name="device_brand" maxLength={60} placeholder="Apple" />
          </Field>
          <Field label="Model" htmlFor="wi-model" className="sm:col-span-2">
            <Input id="wi-model" name="device_model" maxLength={100} placeholder="iPhone 13 Pro" required />
          </Field>
          <Field label="What is wrong with it?" htmlFor="wi-fault" className="sm:col-span-2">
            <Textarea id="wi-fault" name="fault" rows={3} minLength={5} maxLength={2000} required />
          </Field>
          <Field label="Device value (KES)" htmlFor="wi-value" hint="Optional. Used to insure a return delivery.">
            <Input id="wi-value" name="declared_value_kes" inputMode="numeric" placeholder="0" />
          </Field>
        </div>
      </Section>

      <Section title="Proof of ownership">
        <div className="space-y-2">
          <RadioRow name="identity" value="device" checked={identity === "device"} onChange={() => setIdentity("device")} label="IMEI or serial number" />
          <RadioRow
            name="identity"
            value="id"
            checked={identity === "id"}
            onChange={() => setIdentity("id")}
            label="Customer's ID document"
            description="Kept on the customer's account for this shop, encrypted."
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {identity === "device" ? (
            <Field label="IMEI / serial" htmlFor="wi-identifier" hint="On a phone, dial *#06#." className="sm:col-span-2">
              <Input id="wi-identifier" name="identifier" autoComplete="off" autoCapitalize="characters" maxLength={64} required />
            </Field>
          ) : (
            <>
              <Field label="Document" htmlFor="wi-id-kind">
                <NativeSelect id="wi-id-kind" name="id_kind" defaultValue={idKinds[0]?.value}>
                  {idKinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="ID number" htmlFor="wi-id-number">
                <Input id="wi-id-number" name="id_number" autoComplete="off" maxLength={32} required />
              </Field>
              <Field
                label="Photo of the ID"
                htmlFor="wi-id-photo"
                hint="Not needed if this customer's ID is already on file with a photo."
                className="sm:col-span-2"
              >
                <Input id="wi-id-photo" name="id_photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" />
              </Field>
            </>
          )}
        </div>
      </Section>

      <Section title="Passcode">
        <CheckRow name="passcode_locked" checked={locked} onChange={(e) => setLocked(e.target.checked)} label="The device has a passcode" />
        {locked ? (
          <Field label="Passcode" htmlFor="wi-passcode" hint="Optional. Stored encrypted and deleted when the job closes." className="mt-3">
            <Input id="wi-passcode" name="passcode" type="password" autoComplete="off" maxLength={64} />
          </Field>
        ) : null}
      </Section>

      <ErrorText>{state && !state.ok ? state.error : null}</ErrorText>
      <Button type="submit" size="lg" className="w-full" disabled={pending} data-testid="walk-in-submit">
        {pending ? "Opening the job…" : "Open walk-in job"}
      </Button>
    </form>
  );
}
