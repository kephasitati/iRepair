import * as React from 'react';
import { cn } from '@/lib/utils';

/** Small, dependency-free form primitives. Native controls work best on low-end Android phones. */

export function Field({ label, hint, error, htmlFor, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function CheckRow({ label, description, className, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-input px-3 py-2.5 has-checked:border-primary has-checked:bg-primary/5', className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-(--primary)" {...props} />
      <span className="text-sm leading-snug">
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

export function RadioRow({ label, description, className, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-input px-3 py-2.5 has-checked:border-primary has-checked:bg-primary/5', className)}>
      <input type="radio" className="mt-0.5 size-5 shrink-0 accent-(--primary)" {...props} />
      <span className="text-sm leading-snug">
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-muted-foreground">{description}</span> : null}
      </span>
    </label>
  );
}

export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border bg-card p-4 shadow-xs', className)}>
      {title || action ? (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KV({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-sm', strong && 'text-base font-semibold')}>
      <span className={cn(!strong && 'text-muted-foreground')}>{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{children}</p>;
}
