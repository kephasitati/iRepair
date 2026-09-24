import * as React from 'react';
import { cn } from '@/lib/utils';

/** Small, dependency-free form primitives in the Apple-style theme. Native controls work best on low-end Android phones. */

export function Field({ label, hint, error, htmlFor, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[14px] font-medium text-ink-2">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-[13px] text-ink-3">{hint}</p> : null}
      {error ? <p className="text-[13px] font-medium text-alert">{error}</p> : null}
    </div>
  );
}

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        "h-[52px] w-full appearance-none rounded-[12px] border border-line bg-white bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5l5 5 5-5' fill='none' stroke='%236e6e73' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")] bg-[length:12px_8px] bg-[position:right_16px_center] bg-no-repeat px-4 pr-10 text-[17px] outline-none focus-visible:border-blue focus-visible:ring-4 focus-visible:ring-blue/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function CheckRow({ label, description, className, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('opt flex min-h-12 cursor-pointer items-start gap-3 px-4 py-3', className)}>
      <input type="checkbox" className="mt-0.5 size-5 shrink-0" {...props} />
      <span className="text-[15px] leading-snug">
        <span>{label}</span>
        {description ? <span className="block text-[13px] text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}

export function RadioRow({ label, description, className, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn('opt flex min-h-12 cursor-pointer items-start gap-3 px-4 py-3', className)}>
      <input type="radio" className="mt-0.5 size-5 shrink-0" {...props} />
      <span className="text-[15px] leading-snug">
        <span className="font-medium">{label}</span>
        {description ? <span className="block text-[13px] text-ink-3">{description}</span> : null}
      </span>
    </label>
  );
}

/** White tile, the basic Apple content surface. */
export function Section({ title, action, children, className }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('tile p-5 sm:p-6', className)}>
      {title || action ? (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title ? <h2 className="text-[21px] font-semibold tracking-tight">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function KV({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-[15px]', strong && 'pt-2.5 text-[17px] font-semibold')}>
      <span className={cn(!strong && 'text-ink-3')}>{k}</span>
      <span className="text-right tabular-nums">{v}</span>
    </div>
  );
}

export function ErrorText({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return <p className="rounded-[12px] bg-alert/8 px-4 py-2.5 text-[14px] font-medium text-alert">{children}</p>;
}

/** Apple-style page title block. */
export function PageTitle({ eyebrow, title, subtitle, action }: { eyebrow?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pt-2 pb-1">
      <div>
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="display text-[32px] sm:text-[40px]">{title}</h1>
        {subtitle ? <p className="mt-1 text-[17px] text-ink-3">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
