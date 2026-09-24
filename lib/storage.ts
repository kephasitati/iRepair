import 'server-only';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

/**
 * One private bucket. Keys are namespaced by tenant so a listing never crosses shops:
 *   t/<tenantId>/jobs/<jobId>/<stage>/<uuid>.jpg
 *   t/<tenantId>/invoices/<invoiceId>.pdf
 *   t/<tenantId>/branding/logo.<ext>
 * Everything is served through short-lived signed URLs; nothing is public.
 */

let client: S3Client | undefined;

export function s3(): S3Client {
  const e = env();
  return (client ??= new S3Client({
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY, secretAccessKey: e.S3_SECRET_KEY },
  }));
}

/** Dev convenience: create the bucket if it does not exist (production buckets are created in the R2/S3 console). */
export async function ensureBucket() {
  const Bucket = env().S3_BUCKET;
  try {
    await s3().send(new HeadBucketCommand({ Bucket }));
  } catch {
    await s3().send(new CreateBucketCommand({ Bucket }));
  }
}

export function photoKey(tenantId: string, jobId: string, stage: string, id: string, ext = 'jpg') {
  return `t/${tenantId}/jobs/${jobId}/${stage}/${id}.${ext}`;
}

export function invoiceKey(tenantId: string, invoiceId: string) {
  return `t/${tenantId}/invoices/${invoiceId}.pdf`;
}

export function brandingKey(tenantId: string, name: string, ext: string) {
  return `t/${tenantId}/branding/${name}.${ext}`;
}

export async function signedUploadUrl(key: string, contentType: string, maxBytes = 8 * 1024 * 1024) {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, ContentType: contentType, ContentLength: maxBytes }), { expiresIn: 300 });
}

export async function signedDownloadUrl(key: string, expiresIn = 300) {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }), { expiresIn });
}

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3().send(new PutObjectCommand({ Bucket: env().S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: env().S3_BUCKET, Key: key }));
}
