import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveInvitee } from '@/lib/invites';
import { asService, asUser, closeAll, resetDb, seedBasics, type Seed } from './helpers';

/**
 * Pins the account-security rules of migration 0023 (DECISIONS D-40): a phone sign-in carries no staff rights, the app
 * role cannot rewrite credentials, the trusted flag cannot be self-granted, and an invite never takes over an account.
 */
let s: Seed;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
  await asService((tx) => tx`insert into audit_log (tenant_id, actor_user_id, action, entity) values (${s.tenantA}, ${s.adminA}, 'x', 'y')`);
});
afterAll(closeAll);

const rolesOf = (userId: string, tenantId: string, authMethod: 'otp' | 'password') =>
  asUser({ userId, tenantId, authMethod }, async (tx) => {
    const [r] = await tx`select is_tenant_staff(${tenantId}) as staff, is_shop_admin(${tenantId}) as admin, is_platform_admin() as platform`;
    return r;
  });

describe('a phone sign-in never carries staff or platform rights', () => {
  it('the same shop admin is staff in a password session and nobody in an OTP session', async () => {
    expect(await rolesOf(s.adminA, s.tenantA, 'password')).toEqual({ staff: true, admin: true, platform: false });
    expect(await rolesOf(s.adminA, s.tenantA, 'otp')).toEqual({ staff: false, admin: false, platform: false });
  });

  it('a platform admin signed in by OTP is not a platform admin', async () => {
    expect((await rolesOf(s.platformAdmin, s.tenantA, 'password')).platform).toBe(true);
    expect((await rolesOf(s.platformAdmin, s.tenantA, 'otp')).platform).toBe(false);
  });

  it('an OTP session sees no staff-only rows', async () => {
    const count = (authMethod: 'otp' | 'password') =>
      asUser({ userId: s.adminA, tenantId: s.tenantA, authMethod }, async (tx) => {
        const [r] = await tx`select count(*)::int as n from audit_log where tenant_id = ${s.tenantA}`;
        return r.n;
      });
    expect(await count('password')).toBe(1);
    expect(await count('otp')).toBe(0);
  });
});

describe('the app role can only change what a customer may edit on users', () => {
  it('may change its own name', async () => {
    await asUser({ userId: s.customer1, tenantId: s.tenantA, authMethod: 'otp' }, (tx) => tx`update users set full_name = 'Renamed' where id = ${s.customer1}`);
  });

  for (const column of ['password_hash', 'totp_enabled', 'is_platform_admin', 'password_set_at']) {
    it(`cannot touch ${column}`, async () => {
      const value = column === 'password_hash' ? 'x' : column === 'password_set_at' ? new Date() : true;
      await expect(
        asUser({ userId: s.customer1, tenantId: s.tenantA, authMethod: 'otp' }, (tx) => tx`update users set ${tx(column)} = ${value} where id = ${s.customer1}`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  }
});

describe('the trusted flag belongs to the service role', () => {
  it('the app role setting app.trusted changes nothing', async () => {
    const trusted = await asUser({ userId: s.adminA, tenantId: s.tenantA }, async (tx) => {
      await tx`select set_config('app.trusted', 'true', true)`;
      const [r] = await tx`select is_trusted_context() as t`;
      return r.t;
    });
    expect(trusted).toBe(false);
    const [r] = await asService((tx) => tx`select is_trusted_context() as t`);
    expect(r.t).toBe(true);
  });
});

describe('an invite attaches to the right account', () => {
  it('reuses an account that already has a membership', async () => {
    const r = await asService((tx) => resolveInvitee(tx, { email: 'admin@alpha.test' }));
    expect(r).toEqual({ userId: s.adminA, releasedFromUserId: null });
  });

  it('reuses an account that chose its own password, even with no membership', async () => {
    await asService((tx) => tx`update users set password_hash = 'h', password_set_at = now() where id = ${s.customer2}`);
    await asService((tx) => tx`update users set email = 'mine@example.test' where id = ${s.customer2}`);
    const r = await asService((tx) => resolveInvitee(tx, { email: 'mine@example.test' }));
    expect(r).toEqual({ userId: s.customer2, releasedFromUserId: null });
  });

  it('releases an unverified address a customer typed and creates a fresh staff account', async () => {
    await asService((tx) => tx`update users set email = 'newstaff@alpha.test' where id = ${s.customer1}`);
    const r = await asService((tx) => resolveInvitee(tx, { email: 'newstaff@alpha.test', fullName: 'New Staff' }));
    expect(r.userId).not.toBe(s.customer1);
    expect(r.releasedFromUserId).toBe(s.customer1);
    const [c] = await asService((tx) => tx`select email from users where id = ${s.customer1}`);
    expect(c.email).toBeNull();
    const [n] = await asService((tx) => tx`select email, password_set_at from users where id = ${r.userId}`);
    expect(n).toEqual({ email: 'newstaff@alpha.test', password_set_at: null });
  });

  it('refuses a phone number that belongs to another account', async () => {
    await expect(asService((tx) => resolveInvitee(tx, { email: 'another@alpha.test', phone: '+254722000002' }))).rejects.toThrow(/already belongs/);
  });
});
