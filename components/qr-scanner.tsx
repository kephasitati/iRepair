'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Camera QR scanner (@zxing/browser works on iOS Safari, which lacks BarcodeDetector) with a manual
 * code entry fallback that is always visible: riders' QR codes may be scratched, phones may lack a camera.
 */
export function QrScanner({
  onScan,
  onManual,
  manualLabel,
  busy,
}: {
  onScan: (payload: string) => void;
  onManual?: (code: string) => void;
  manualLabel?: string;
  busy?: boolean;
}) {
  const t = useTranslations('bench');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;
    let controls: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import('@zxing/browser');
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 200 });
        controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current!, (result) => {
          if (result && !cancelled) {
            cancelled = true;
            controls?.stop();
            setActive(false);
            if (navigator.vibrate) navigator.vibrate(80);
            onScanRef.current(result.getText());
          }
        });
      } catch {
        setError(t('noCamera'));
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [active, t]);

  return (
    <div className="space-y-3">
      {active ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
          <div className="pointer-events-none absolute inset-8 rounded-2xl border-4 border-white/80" />
          <Button type="button" variant="secondary" className="absolute right-2 bottom-2" onClick={() => setActive(false)}>
            {t('manualCode')}
          </Button>
        </div>
      ) : (
        <Button type="button" size="lg" className="w-full" onClick={() => (setError(null), setActive(true))} disabled={busy}>
          {t('scanner')}
        </Button>
      )}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {onManual ? (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onManual(manual.trim());
          }}
        >
          <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={manualLabel ?? t('manualCode')} inputMode="text" autoCapitalize="characters" />
          <Button type="submit" variant="outline" disabled={busy || !manual.trim()}>
            OK
          </Button>
        </form>
      ) : null}
    </div>
  );
}
