'use client';

import { useEffect } from 'react';

/** Registers public/sw.js (app shell cache + offline page). Photo uploads are queued separately in lib/upload-queue.ts. */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }, []);
  return null;
}
