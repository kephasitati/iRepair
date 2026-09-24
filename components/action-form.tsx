'use client';

import { useActionState, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/fields';

type Result = { ok: true; data: unknown } | { ok: false; error: string } | null;

/**
 * Generic form bound to a server action returning ActionResult. Inputs are passed as children
 * (server-rendered), so admin pages stay server components.
 */
export function ActionForm({
  action,
  children,
  submitLabel = 'Save',
  successMessage = 'Saved',
  resetOnSuccess = false,
  className,
  renderSuccess,
  encType,
}: {
  action: (prev: Result, fd: FormData) => Promise<Result>;
  children: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
  resetOnSuccess?: boolean;
  className?: string;
  renderSuccess?: (data: unknown) => React.ReactNode;
  encType?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      toast.success(successMessage);
      if (resetOnSuccess) ref.current?.reset();
    }
  }, [state, successMessage, resetOnSuccess]);
  return (
    <form ref={ref} action={formAction} className={className ?? 'space-y-4'} encType={encType}>
      {children}
      <ErrorText>{state && !state.ok ? state.error : null}</ErrorText>
      {state?.ok && renderSuccess ? renderSuccess(state.data) : null}
      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : submitLabel}
      </Button>
    </form>
  );
}

export function InviteResult({ data }: { data: unknown }) {
  const url = (data as { url?: string; inviteUrl?: string })?.url ?? (data as { inviteUrl?: string })?.inviteUrl;
  if (!url) return null;
  return (
    <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
      <p className="mb-1">Send this link to the new staff member (valid 48 hours):</p>
      <code className="block break-all select-all">{url}</code>
    </div>
  );
}
