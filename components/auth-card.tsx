import Link from 'next/link';

export function AuthCard({ title, subtitle, brand, children }: { title: string; subtitle?: string; brand: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <Link href="/" className="mb-8 text-center text-lg font-semibold">
        {brand}
      </Link>
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 mb-4 text-sm text-muted-foreground">{subtitle}</p> : <div className="mb-4" />}
        {children}
      </div>
    </main>
  );
}
