'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Camera, Check, CloudOff, Loader2, RotateCw, X } from 'lucide-react';
import { enqueue, remove, retry, subscribe, type QueuedPhoto } from '@/lib/upload-queue';
import { cn } from '@/lib/utils';

export type ExistingPhoto = { id: string; kind: string };

const NO_PHOTOS: ExistingPhoto[] = [];

/**
 * A grid of photo slots (front / back / screen on / other) that queue uploads offline.
 * `onChange` reports uploaded photo ids per kind so the parent can enforce the minimum set.
 */
export function PhotoCapture({
  jobId,
  stage,
  slots,
  existing = NO_PHOTOS,
  allowExtra = true,
  onChange,
}: {
  jobId: string;
  stage: string;
  slots: { kind: string; label: string; required?: boolean }[];
  existing?: ExistingPhoto[];
  allowExtra?: boolean;
  onChange?: (uploaded: { kind: string; photoId: string }[], pending: number) => void;
}) {
  const t = useTranslations('wizard');
  const [items, setItems] = useState<QueuedPhoto[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<string>('other');

  useEffect(() => {
    const unsubscribe = subscribe((all) => setItems(all.filter((i) => i.jobId === jobId && i.stage === stage)));
    return () => void unsubscribe();
  }, [jobId, stage]);

  const uploaded = useMemo(
    () => [...existing.map((e) => ({ kind: e.kind, photoId: e.id })), ...items.filter((i) => i.status === 'done' && i.photoId).map((i) => ({ kind: i.kind, photoId: i.photoId! }))],
    [existing, items],
  );
  const pending = items.filter((i) => i.status === 'queued' || i.status === 'uploading').length;
  const cb = useRef(onChange);
  cb.current = onChange;
  // Notify only when the uploaded set or pending count really changes (parents re-render on every call).
  const signature = `${uploaded.map((u) => `${u.kind}:${u.photoId}`).join(',')}|${pending}`;
  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    if (lastSig.current === signature) return;
    lastSig.current = signature;
    cb.current?.(uploaded, pending);
  }, [signature, uploaded, pending]);

  const pick = (kind: string) => {
    pendingKind.current = kind;
    inputRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    for (const f of files) await enqueue({ jobId, stage, kind: pendingKind.current, file: f });
  };

  const tiles = [...slots, ...(allowExtra ? [{ kind: 'other', label: t('photoOther') }] : [])];

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} multiple={false} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((slot, idx) => {
          const mine = items.filter((i) => i.kind === slot.kind);
          const ex = existing.filter((e) => e.kind === slot.kind);
          const latest = mine.at(-1);
          const has = ex.length > 0 || mine.some((m) => m.status === 'done');
          return (
            <div key={slot.kind + idx} className="space-y-1">
              <button
                type="button"
                onClick={() => pick(slot.kind)}
                className={cn(
                  'relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl border-2 border-dashed text-muted-foreground',
                  has ? 'border-emerald-500 border-solid' : slot.required ? 'border-primary/60' : 'border-input',
                )}
              >
                {latest ? <Thumb blob={latest.blob} /> : ex[0] ? <img src={`/api/photos/${ex[0].id}`} alt="" className="absolute inset-0 size-full object-cover" /> : null}
                <span className="relative z-10 flex flex-col items-center gap-1 rounded-lg bg-background/80 px-2 py-1 text-xs font-medium">
                  {latest?.status === 'uploading' ? (
                    <Loader2 className="size-5 animate-spin" />
                  ) : latest?.status === 'queued' ? (
                    <CloudOff className="size-5" />
                  ) : latest?.status === 'failed' ? (
                    <RotateCw className="size-5 text-destructive" />
                  ) : has ? (
                    <Check className="size-5 text-emerald-600" />
                  ) : (
                    <Camera className="size-5" />
                  )}
                  {slot.label}
                  {slot.required ? ' *' : ''}
                </span>
              </button>
              {latest && latest.status !== 'done' ? (
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{latest.status === 'uploading' ? t('photoUploading') : latest.status === 'queued' ? t('photoQueued') : t('photoFailed')}</span>
                  <span className="flex gap-2">
                    {latest.status === 'failed' ? (
                      <button type="button" onClick={() => retry(latest.id)} aria-label="retry">
                        <RotateCw className="size-3.5" />
                      </button>
                    ) : null}
                    <button type="button" onClick={() => remove(latest.id)} aria-label="remove">
                      <X className="size-3.5" />
                    </button>
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Thumb({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" className="absolute inset-0 size-full object-cover" /> : null;
}
