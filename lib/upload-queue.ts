'use client';

import { openDB, type IDBPDatabase } from 'idb';

/**
 * Offline-tolerant photo uploads for flaky 3G: photos are compressed, written to IndexedDB, then uploaded
 * with retries whenever the browser is online. Each item carries a client_upload_id so a retry after a
 * dropped response never creates a duplicate row (the server dedupes on it).
 */

export type QueuedPhoto = {
  id: string; // client_upload_id
  jobId: string;
  stage: string;
  kind: string;
  blob: Blob;
  takenAt: string;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  photoId?: string;
  error?: string;
  attempts: number;
};

type Listener = (items: QueuedPhoto[]) => void;

let dbp: Promise<IDBPDatabase> | null = null;
const listeners = new Set<Listener>();
let running = false;

function db() {
  return (dbp ??= openDB('rd-uploads', 1, {
    upgrade(d) {
      d.createObjectStore('photos', { keyPath: 'id' });
    },
  }));
}

async function all(): Promise<QueuedPhoto[]> {
  return (await (await db()).getAll('photos')) as QueuedPhoto[];
}

async function emit() {
  const items = await all();
  listeners.forEach((l) => l(items));
}

export function subscribe(l: Listener) {
  listeners.add(l);
  void all().then(l);
  return () => listeners.delete(l);
}

/** Resize to max 1600 px on the long edge and re-encode as JPEG (about 150-300 KB). */
export async function compress(file: File, maxEdge = 1600, quality = 0.8): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
}

export async function enqueue(input: { jobId: string; stage: string; kind: string; file: File }): Promise<string> {
  const blob = await compress(input.file);
  const id = crypto.randomUUID();
  await (await db()).put('photos', { id, jobId: input.jobId, stage: input.stage, kind: input.kind, blob, takenAt: new Date().toISOString(), status: 'queued', attempts: 0 } satisfies QueuedPhoto);
  await emit();
  void drain();
  return id;
}

export async function remove(id: string) {
  await (await db()).delete('photos', id);
  await emit();
}

export async function retry(id: string) {
  const d = await db();
  const item = (await d.get('photos', id)) as QueuedPhoto | undefined;
  if (item) await d.put('photos', { ...item, status: 'queued', error: undefined });
  await emit();
  void drain();
}

/** Upload everything queued, one at a time. Safe to call repeatedly. */
export async function drain() {
  if (running || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
  running = true;
  try {
    for (;;) {
      const d = await db();
      const next = ((await d.getAll('photos')) as QueuedPhoto[]).find((p) => p.status === 'queued');
      if (!next) break;
      await d.put('photos', { ...next, status: 'uploading' });
      await emit();
      const fd = new FormData();
      fd.set('file', new File([next.blob], `${next.id}.jpg`, { type: next.blob.type || 'image/jpeg' }));
      fd.set('job_id', next.jobId);
      fd.set('stage', next.stage);
      fd.set('kind', next.kind);
      fd.set('client_upload_id', next.id);
      fd.set('taken_at', next.takenAt);
      try {
        const res = await fetch('/api/photos', { method: 'POST', body: fd });
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          await d.put('photos', { ...next, status: 'done', photoId: j.id, attempts: next.attempts + 1 });
        } else if (res.status >= 400 && res.status < 500) {
          await d.put('photos', { ...next, status: 'failed', error: j.error ?? `HTTP ${res.status}`, attempts: next.attempts + 1 });
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        // network or server error: back off and try again later
        await d.put('photos', { ...next, status: next.attempts >= 5 ? 'failed' : 'queued', error: (e as Error).message, attempts: next.attempts + 1 });
        await emit();
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** next.attempts, 30000)));
        if (!navigator.onLine) break;
      }
      await emit();
    }
  } finally {
    running = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void drain());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void drain());
  setTimeout(() => void drain(), 1000);
}
