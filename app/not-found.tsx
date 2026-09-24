import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto max-w-sm px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">The link may be wrong or the page may have moved.</p>
      <Link href="/" className="mt-4 inline-block text-sm font-medium text-primary underline">
        Go home
      </Link>
    </main>
  );
}
