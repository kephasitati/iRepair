import "server-only";
import { randomToken } from "./core/crypto";
import { hashPassword } from "./core/password";
import type { Tx } from "./db";
import { UserError } from "./jobs/types";

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type Invitee = { userId: string; releasedFromUserId: string | null };

/**
 * The account a staff invite for `email` attaches to (D-40).
 *
 * - An account with its own password, or already invited to a shop, is reused. Accepting will ask for that password
 *   when there is one, so an invite never hands someone else's account to whoever holds the link.
 * - An email a customer typed on their profile was never verified. It is released from that customer account and a
 *   fresh staff account is created, so a customer cannot pre-claim a staff identity by typing the address first.
 *
 * New accounts get a random placeholder password nobody knows; the invitee chooses theirs when accepting.
 */
export async function resolveInvitee(tx: Tx, input: { email: string; phone?: string | null; fullName?: string }): Promise<Invitee> {
  const [existing] = await tx`
    select u.id, u.phone_e164, u.password_set_at,
           exists (select 1 from tenant_memberships m where m.user_id = u.id) as has_membership
    from users u where u.email = ${input.email} for update`;
  if (existing && (existing.password_set_at || existing.has_membership || !existing.phone_e164)) {
    return { userId: existing.id, releasedFromUserId: null };
  }
  if (existing) await tx`update users set email = null where id = ${existing.id}`;
  if (input.phone) {
    const [taken] = await tx`select 1 from users where phone_e164 = ${input.phone}`;
    if (taken) throw new UserError("That phone number already belongs to another account. Invite them by that account’s email, or leave the phone blank.");
  }
  const [created] = await tx`insert into users (email, phone_e164, full_name, password_hash)
    values (${input.email}, ${input.phone ?? null}, ${input.fullName ?? ""}, ${await hashPassword(randomToken(24))}) returning id`;
  return { userId: created.id, releasedFromUserId: existing?.id ?? null };
}
