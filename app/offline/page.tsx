export const dynamic = 'force-static';

export default function Offline() {
  return (
    <main className="mx-auto max-w-sm px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="mt-2 text-sm text-muted-foreground">Reconnect to continue. Photos you took are kept on this device and will upload automatically.</p>
    </main>
  );
}
