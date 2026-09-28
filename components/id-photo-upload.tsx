"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Check, Loader2 } from "lucide-react";
import { ErrorText } from "@/components/fields";
import { uploadIdPhotoAction } from "@/app/(shop)/actions";
import { cn } from "@/lib/utils";

/** One required photo of the customer's ID document, sent straight to the server (no offline queue — it is small and must be on file before pickup). */
export function IdPhotoUpload({ userId, hasPhoto, label, onUploaded }: { userId: string; hasPhoto: boolean; label: string; onUploaded?: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState(hasPhoto);
  const [stamp, setStamp] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const fd = new FormData();
    fd.set("photo", file);
    start(async () => {
      setError(null);
      const r = await uploadIdPhotoAction(fd);
      if (!r.ok) return setError(r.error);
      setDone(true);
      setStamp(Date.now());
      onUploaded?.();
    });
  };

  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className={cn(
          "relative grid aspect-[4/3] w-full max-w-xs place-items-center overflow-hidden rounded-xl border-2 border-dashed text-muted-foreground",
          done ? "border-solid border-emerald-500" : "border-primary/60",
        )}
        data-testid="id-photo"
      >
        {done ? (
          // Signed redirect; the query string only defeats caching after a re-upload.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/customer-ids/${userId}/photo${stamp ? `?v=${stamp}` : ""}`} alt="" className="absolute inset-0 size-full object-cover" />
        ) : null}
        <span className="relative z-10 flex flex-col items-center gap-1 rounded-lg bg-background/80 px-2 py-1 text-xs font-medium">
          {pending ? <Loader2 className="size-5 animate-spin" /> : done ? <Check className="size-5 text-emerald-600" /> : <Camera className="size-5" />}
          {label} *
        </span>
      </button>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
