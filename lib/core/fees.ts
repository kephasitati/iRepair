import type { DeviceType } from "./device-id";

/** The diagnosis/consultation fee for a device type: the per-type amount when the shop set one, otherwise the general fee. */
export function consultationFeeFor(
  settings: { consultation_fee_cents: number; consultation_fees?: Partial<Record<DeviceType, number>> | null },
  type: DeviceType,
): number {
  const specific = settings.consultation_fees?.[type];
  return typeof specific === "number" && Number.isFinite(specific) && specific >= 0 ? specific : settings.consultation_fee_cents;
}
