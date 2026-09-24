import { randomUUID } from 'node:crypto';
import { getSession, requestCtx } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { recordPhoto } from '@/lib/jobs/service';
import { photoKey, putObject } from '@/lib/storage';
import { getTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

const STAGES = ['customer_declared', 'intake', 'progress', 'completion', 'discrepancy', 'handover'];
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Photo upload (multipart: file, job_id, stage, kind, client_upload_id, taken_at).
 * The job_photos insert runs under RLS, so a customer can only add declaration/handover photos to their own job
 * and staff only to their shop's jobs. Retries with the same client_upload_id are idempotent.
 */
export async function POST(req: Request) {
  const [session, tenant] = await Promise.all([getSession(), getTenant()]);
  if (!session || !tenant) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData();
  const file = form.get('file');
  const jobId = String(form.get('job_id') ?? '');
  const stage = String(form.get('stage') ?? '');
  const kind = String(form.get('kind') ?? 'other').slice(0, 20);
  const clientUploadId = String(form.get('client_upload_id') ?? '') || null;
  const takenAt = form.get('taken_at') ? new Date(String(form.get('taken_at'))) : null;
  if (!(file instanceof File) || !jobId || !STAGES.includes(stage)) return Response.json({ error: 'bad_request' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'too_large' }, { status: 413 });
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return Response.json({ error: 'unsupported_type' }, { status: 415 });

  const ctx = await requestCtx();
  const buf = Buffer.from(await file.arrayBuffer());
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = photoKey(tenant.id, jobId, stage, randomUUID(), ext);
  try {
    // Check access (and dedupe) before writing to storage.
    const existing = await withUser(ctx, async (tx) => {
      const [job] = await tx`select id from jobs where id = ${jobId}`;
      if (!job) throw Object.assign(new Error('not found'), { status: 404 });
      if (clientUploadId) {
        const [p] = await tx`select id from job_photos where job_id = ${jobId} and client_upload_id = ${clientUploadId}`;
        return p?.id as string | undefined;
      }
    });
    if (existing) return Response.json({ id: existing });
    await putObject(key, buf, file.type);
    const id = await withUser(ctx, (tx) =>
      recordPhoto(tx, tenant, jobId, { stage, kind, storage_key: key, content_type: file.type, bytes: file.size, taken_at: takenAt, client_upload_id: clientUploadId, uploaded_by: session.user.id }),
    );
    return Response.json({ id });
  } catch (e) {
    const status = (e as { status?: number }).status ?? (/row-level security/.test((e as Error).message) ? 403 : 500);
    return Response.json({ error: status === 403 ? 'forbidden' : status === 404 ? 'not_found' : 'failed' }, { status });
  }
}
