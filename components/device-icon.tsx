import type { DeviceType } from '@/lib/core/device-id';

/** Thin-line device glyphs in the spirit of apple.com's product navigation. */
export function DeviceIcon({ type, className }: { type: DeviceType; className?: string }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, className };
  switch (type) {
    case 'iphone':
      return (
        <svg viewBox="0 0 40 54" {...common} aria-hidden>
          <rect x="9" y="3" width="22" height="48" rx="5" />
          <rect x="16.5" y="6" width="7" height="2" rx="1" />
        </svg>
      );
    case 'ipad':
      return (
        <svg viewBox="0 0 54 54" {...common} aria-hidden>
          <rect x="8" y="5" width="38" height="46" rx="4" />
          <circle cx="27" cy="7.8" r="0.8" />
        </svg>
      );
    case 'macbook':
      return (
        <svg viewBox="0 0 64 54" {...common} aria-hidden>
          <rect x="11" y="10" width="42" height="28" rx="2.5" />
          <path d="M5 41h54l-2.5 3.5H7.5z" />
          <path d="M28 41.5h8" />
        </svg>
      );
    case 'imac':
      return (
        <svg viewBox="0 0 64 54" {...common} aria-hidden>
          <rect x="7" y="5" width="50" height="34" rx="2.5" />
          <path d="M7 32h50" />
          <path d="M27 39l-2 9h14l-2-9" />
          <path d="M22 48h20" />
        </svg>
      );
    case 'android':
      return (
        <svg viewBox="0 0 40 54" {...common} aria-hidden>
          <rect x="9" y="3" width="22" height="48" rx="4" />
          <circle cx="20" cy="7" r="1" />
        </svg>
      );
    case 'windows_laptop':
      return (
        <svg viewBox="0 0 64 54" {...common} aria-hidden>
          <rect x="11" y="10" width="42" height="28" rx="1" />
          <path d="M5 41h54l-2 4H7z" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 54 54" {...common} aria-hidden>
          <circle cx="27" cy="27" r="20" />
          <path d="M22 22a5 5 0 1 1 7 4.6c-1.3.6-2 1.6-2 3v1.4" />
          <circle cx="27" cy="36" r="0.6" />
        </svg>
      );
  }
}
