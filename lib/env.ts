import { z } from 'zod';

/** Every variable is documented in .env.example. Parsed once; a bad production config fails at boot. */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().default('postgres://repairdesk_app:app_dev_password@localhost:55432/repairdesk'),
  DATABASE_SERVICE_URL: z.string().default('postgres://repairdesk_service:service_dev_password@localhost:55432/repairdesk'),
  APP_MASTER_KEY: z.string().min(40),
  PLATFORM_NAME: z.string().default('RepairDesk'),
  PLATFORM_ROOT_DOMAIN: z.string().default('localhost:3000'),
  PUBLIC_SCHEME: z.enum(['http', 'https']).default('http'),
  INTERNAL_CRON_SECRET: z.string().min(16),
  MOCK_PROVIDER_SECRET: z.string().min(16),
  MOCK_DELAY_SECONDS: z.coerce.number().default(20),

  S3_ENDPOINT: z.string().default('http://localhost:59000'),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('repairdesk-private'),
  S3_ACCESS_KEY: z.string().default('minio_dev'),
  S3_SECRET_KEY: z.string().default('minio_dev_password'),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional(),
  MPESA_CONSUMER_SECRET: z.string().optional(),
  MPESA_SHORTCODE: z.string().default('174379'),
  MPESA_PASSKEY: z.string().optional(),
  MPESA_CALLBACK_BASE_URL: z.string().optional(),
  MPESA_DRIVER: z.enum(['daraja', 'simulator']).default('simulator'),

  SMS_DRIVER: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_API_KEY: z.string().optional(),
  AT_SENDER_ID: z.string().optional(),

  EMAIL_DRIVER: z.enum(['console', 'smtp']).default('console'),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('no-reply@localhost'),

  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().optional(),
  OTP_DEV_CODE: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error('Invalid environment: ' + JSON.stringify(parsed.error.flatten().fieldErrors));
    }
    cached = parsed.data;
  }
  return cached;
}

export function isProd() {
  return env().NODE_ENV === 'production';
}
