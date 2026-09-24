import Link from 'next/link';

/** Apple ID-style sign-in: centred, generous whitespace, one frosted card over the brand backdrop. */
export function AuthCard({ title, subtitle, brand, children }: { title: string; subtitle?: string; brand: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center px-4 py-12">
      <Link href="/" className="mb-6 text-center text-[17px] font-semibold tracking-tight">
        {brand}
      </Link>
      <div className="glass-card fade-up p-7 sm:p-9">
        <h1 className="display text-center text-[28px] sm:text-[32px]">{title}</h1>
        {subtitle ? <p className="mt-2 mb-7 text-center text-[17px] text-ink-3">{subtitle}</p> : <div className="mb-7" />}
        {children}
      </div>
    </main>
  );
}
