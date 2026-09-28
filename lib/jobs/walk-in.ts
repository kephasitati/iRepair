import "server-only";
import { z } from "zod";
import { rateLimit } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { checkDeviceIdentifier, DEVICE_TYPES, type DeviceType } from "@/lib/core/device-id";
import { consultationFeeFor } from "@/lib/core/fees";
import { checkIdNumber, ID_KINDS, type IdKind } from "@/lib/core/identity";
import { normalizeKenyanPhone } from "@/lib/core/phone";
import { upsertCustomerId } from "@/lib/customer-ids";
import { withService, type Tx } from "@/lib/db";
import { enabledDevices } from "@/lib/public-data";
import { customerIdKey, putObject } from "@/lib/storage";
import type { Tenant } from "@/lib/tenant";
import { encryptForTenant } from "@/lib/tenant-crypto";
import { UserError } from "./types";

/**
 * Walk-ins (DECISIONS D-42). Staff open the job at the counter with the device in hand; it starts at received_at_shop
 * with the consultation fee as its only upfront charge. The customer accepts the terms from an SMS link, the fee is
 * paid (M-Pesa, or cash recorded by a shop admin), and diagnosis is gated on both in the database.
 */

const IDENTIFIER_COPY = {
  required: "Enter the IMEI or serial number.",
  imei_checksum: "That IMEI does not check out. Re-enter it.",
  imei_length: "An IMEI has 15 digits.",
  serial_format: "That does not look like a serial number.",
} as const;

const ID_COPY = { required: "Enter the ID number.", format: "That does not look like a valid number for this document." } as const;

const MAX_ID_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export const WalkInInput = z.object({
  phone: z.string().trim().min(1, "Enter the customer's phone number."),
  name: z.string().trim().max(100),
  device_type: z.enum(DEVICE_TYPES as [DeviceType, ...DeviceType[]], { error: "Choose the device type." }),
  device_brand: z.string().trim().max(60),
  device_model: z.string().trim().min(1, "Enter the device model.").max(100),
  fault: z.string().trim().min(5, "Describe the fault in a few words.").max(2000),
  identity: z.enum(["device", "id"]),
  identifier: z.string().trim().max(64),
  id_kind: z.enum(ID_KINDS as [IdKind, ...IdKind[]]).optional(),
  id_number: z.string().trim().max(32),
  passcode_locked: z.boolean(),
  passcode: z.string().max(64),
  declared_value_kes: z.number().int("Enter the device value in whole shillings.").min(0).max(10_000_000),
});
export type WalkInInput = z.infer<typeof WalkInInput>;

export type WalkInStaff = { userId: string; actor: "technician" | "shop_admin" | "platform_admin"; impersonatedBy: string | null };

/** Opens a walk-in and returns the job id. The customer is found by phone, or created; their email is never touched. */
export async function createWalkIn(tenant: Tenant, staff: WalkInStaff, raw: unknown, idPhoto: File | null): Promise<string> {
  const parsed = WalkInInput.safeParse(raw);
  if (!parsed.success) throw new UserError(parsed.error.issues[0]?.message ?? "Check the form and try again.");
  const input = parsed.data;

  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) throw new UserError("Enter a valid Kenyan phone number for the customer.");
  if (!enabledDevices(tenant).includes(input.device_type)) throw new UserError("This shop does not repair that type of device.");

  let identifier: { kind: "imei" | "serial"; normalized: string } | null = null;
  if (input.identity === "device") {
    const check = checkDeviceIdentifier(input.device_type, input.identifier);
    if (!check.ok) throw new UserError(IDENTIFIER_COPY[check.error]);
    identifier = check;
  } else {
    if (!input.id_kind) throw new UserError("Choose the type of ID.");
    const check = checkIdNumber(input.id_kind, input.id_number);
    if (!check.ok) throw new UserError(ID_COPY[check.error]);
  }
  const photo = idPhoto && idPhoto.size > 0 ? await readIdPhoto(idPhoto) : null;
  const passcodeShared = input.passcode_locked && input.passcode.length > 0;
  const fee = consultationFeeFor(tenant.settings, input.device_type);

  return withService(async (tx) => {
    const customerId = await findOrCreateCustomer(tx, phone, input.name);

    if (input.identity === "id") {
      const summary = await upsertCustomerId(tx, tenant.id, customerId, input.id_kind!, input.id_number);
      if (photo) {
        const key = customerIdKey(tenant.id, customerId, photo.ext);
        await putObject(key, photo.bytes, photo.type);
        await tx`update customer_ids set photo_path = ${key} where tenant_id = ${tenant.id} and user_id = ${customerId}`;
      } else if (!summary.hasPhoto) {
        throw new UserError("Take a photo of the customer's ID.");
      }
    }

    const [{ ref }] = await tx`select next_job_ref(${tenant.id}) as ref`;
    const [job] = await tx`insert into jobs (tenant_id, ref, customer_user_id, origin, device_type, device_brand, device_model, fault_description,
        passcode_locked, passcode_shared, declared_value_cents, consultation_fee_cents, pickup_fee_cents, identity_method, assigned_tech_id)
      values (${tenant.id}, ${ref}, ${customerId}, 'walk_in', ${input.device_type}, ${input.device_brand}, ${input.device_model}, ${input.fault},
        ${input.passcode_locked}, ${passcodeShared}, ${input.declared_value_kes * 100}, ${fee}, ${fee}, ${input.identity},
        ${staff.actor === "technician" ? staff.userId : null})
      returning id`;

    const passcode = passcodeShared ? await encryptForTenant(tenant.id, input.passcode, `passcode:${job.id}`) : null;
    await tx`insert into job_secrets (job_id, tenant_id, identifier, identifier_kind, passcode_enc, passcode_key_version)
      values (${job.id}, ${tenant.id}, ${identifier?.normalized ?? null}, ${identifier?.kind ?? null}, ${passcode?.ciphertext ?? null}, ${passcode?.version ?? null})`;

    // The transition sends the customer the consent SMS (notify_job swaps in 'walkin.received' for walk-ins).
    await tx`select transition_job(${job.id}, 'received_at_shop', ${staff.actor}::actor_kind, ${staff.userId}, '{}')`;
    await audit(tx, {
      tenantId: tenant.id,
      actorUserId: staff.userId,
      impersonatedBy: staff.impersonatedBy,
      action: "job.walk_in",
      entity: "job",
      entityId: job.id,
      diff: { identity: input.identity, consultation_fee_cents: fee },
    });
    return job.id as string;
  });
}

/** Sends the consent link again, at most three times in a quarter hour. */
export async function resendWalkInLink(tenant: Tenant, jobId: string): Promise<void> {
  if (!(await rateLimit(`walkin-sms:${jobId}`, 3, 15 * 60))) throw new UserError("The link was just sent. Wait a few minutes before sending it again.");
  await withService(async (tx) => {
    const [job] = await tx`select id from jobs where id = ${jobId} and tenant_id = ${tenant.id} and origin = 'walk_in'
      and status = 'received_at_shop' and terms_accepted_at is null`;
    if (!job) throw new UserError("Nothing to send: the customer has already accepted, or the job has moved on.");
    await tx`select notify_job(${jobId}, 'walkin.received')`;
  });
}

/** The job's short link (the same one the SMS carries), for the QR code at the counter. */
export async function walkInLink(tenant: Tenant, jobId: string): Promise<string> {
  const [row] = await withService(
    (tx) => tx`select tenant_base_url(tenant_id) || '/l/' || ensure_short_link(id) as url from jobs where id = ${jobId} and tenant_id = ${tenant.id}`,
  );
  if (!row) throw new UserError("Job not found.");
  return row.url as string;
}

async function findOrCreateCustomer(tx: Tx, phone: string, name: string): Promise<string> {
  const [existing] = await tx`select id, full_name, disabled from users where phone_e164 = ${phone} for update`;
  if (existing) {
    if (existing.disabled) throw new UserError("That customer's account is disabled.");
    if (!existing.full_name && name) await tx`update users set full_name = ${name} where id = ${existing.id}`;
    return existing.id as string;
  }
  if (!name) throw new UserError("Enter the customer's name.");
  const [created] = await tx`insert into users (phone_e164, full_name) values (${phone}, ${name}) returning id`;
  return created.id as string;
}

async function readIdPhoto(file: File): Promise<{ bytes: Buffer; type: string; ext: string }> {
  if (file.size > MAX_ID_PHOTO_BYTES) throw new UserError("That photo is too large (max 8 MB).");
  const ext = PHOTO_EXT[file.type];
  if (!ext) throw new UserError("Use a JPG, PNG or WebP photo of the ID.");
  return { bytes: Buffer.from(await file.arrayBuffer()), type: file.type, ext };
}
