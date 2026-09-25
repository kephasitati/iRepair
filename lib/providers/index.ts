import 'server-only';
import { servicePool, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { decryptJson } from '@/lib/tenant-crypto';
import type { Tenant } from '@/lib/tenant';
import { MockProvider } from './delivery/mock';
import { TumaBodaProvider, type TumaBodaConfig } from './delivery/tumaboda';
import type { DeliveryProvider } from './delivery/types';
import { DarajaGateway, SimulatorGateway, type DarajaConfig, type MpesaGateway } from './mpesa';
import { AfricasTalkingSms, ConsoleSms, type SmsSender } from './sms';
import { ConsoleEmail, SmtpEmail, type EmailSender } from './email';

/** Per-tenant integrations. Each shop's own credentials come first; platform defaults are the fallback. */

export type TenantSecrets = {
  daraja: DarajaConfig | null;
  courier: TumaBodaConfig | null;
  sms: { username: string; apiKey: string; senderId?: string | null } | null;
};

export async function loadTenantSecrets(tenantId: string, tx?: Tx): Promise<TenantSecrets> {
  const sql = tx ?? servicePool();
  const [row] = await sql`select daraja_enc, courier_enc, sms_enc from tenant_secrets where tenant_id = ${tenantId}`;
  return {
    daraja: await decryptJson<DarajaConfig>(tenantId, row?.daraja_enc, `tenant-secrets:${tenantId}:daraja`),
    courier: await decryptJson<TumaBodaConfig>(tenantId, row?.courier_enc, `tenant-secrets:${tenantId}:courier`),
    sms: await decryptJson<TenantSecrets['sms']>(tenantId, row?.sms_enc, `tenant-secrets:${tenantId}:sms`),
  };
}

export function mockProvider(): MockProvider {
  return new MockProvider(env().MOCK_PROVIDER_SECRET, env().MOCK_DELAY_SECONDS);
}

export async function deliveryProviderFor(tenant: Pick<Tenant, 'id' | 'settings'>, secrets?: TenantSecrets): Promise<DeliveryProvider> {
  if (tenant.settings.delivery_provider === 'tumaboda') {
    const s = secrets ?? (await loadTenantSecrets(tenant.id));
    if (!s.courier) throw new Error('TumaBoda credentials are not configured for this shop');
    return new TumaBodaProvider(s.courier);
  }
  return mockProvider();
}

export async function mpesaFor(tenant: Pick<Tenant, 'id'>, secrets?: TenantSecrets): Promise<MpesaGateway> {
  const e = env();
  const s = secrets ?? (await loadTenantSecrets(tenant.id));
  if (s.daraja) return new DarajaGateway(s.daraja);
  if (e.MPESA_DRIVER === 'daraja' && e.MPESA_CONSUMER_KEY && e.MPESA_CONSUMER_SECRET && e.MPESA_PASSKEY) {
    return new DarajaGateway({ env: e.MPESA_ENV, consumerKey: e.MPESA_CONSUMER_KEY, consumerSecret: e.MPESA_CONSUMER_SECRET, shortcode: e.MPESA_SHORTCODE, passkey: e.MPESA_PASSKEY, type: 'paybill' });
  }
  return new SimulatorGateway();
}

export function smsSender(tenant: Pick<Tenant, 'id'> | null, secrets?: TenantSecrets): SmsSender {
  const e = env();
  if (secrets?.sms) return new AfricasTalkingSms(secrets.sms);
  if (e.SMS_DRIVER === 'africastalking' && e.AT_API_KEY) return new AfricasTalkingSms({ username: e.AT_USERNAME, apiKey: e.AT_API_KEY, senderId: e.AT_SENDER_ID });
  return new ConsoleSms();
}

export function emailSender(): EmailSender {
  const e = env();
  if (e.EMAIL_DRIVER === 'smtp' && e.SMTP_URL) return new SmtpEmail(e.SMTP_URL, e.SMTP_FROM);
  return new ConsoleEmail();
}

export function isSimulatedMpesa(gateway: MpesaGateway) {
  return gateway instanceof SimulatorGateway;
}
