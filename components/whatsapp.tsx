/** WhatsApp click-to-chat (wa.me link: no API, no paid service). */

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden fill="currentColor">
      <path d="M16.02 3C8.84 3 3 8.8 3 15.95c0 2.29.6 4.52 1.75 6.49L3 29l6.73-1.76a13.1 13.1 0 0 0 6.29 1.6h.01C23.2 28.84 29 23.04 29 15.9 29 8.8 23.2 3 16.02 3Zm0 23.62h-.01a10.9 10.9 0 0 1-5.55-1.52l-.4-.24-4 1.04 1.07-3.89-.26-.4a10.7 10.7 0 0 1-1.66-5.66c0-5.93 4.84-10.76 10.8-10.76 2.88 0 5.59 1.12 7.63 3.16a10.7 10.7 0 0 1 3.16 7.6c0 5.94-4.84 10.77-10.78 10.77Zm5.92-8.06c-.32-.16-1.91-.94-2.2-1.05-.3-.1-.51-.16-.73.16-.21.32-.83 1.04-1.02 1.26-.19.21-.37.24-.7.08-.32-.16-1.36-.5-2.59-1.6a9.8 9.8 0 0 1-1.79-2.22c-.19-.32-.02-.5.14-.66.15-.14.33-.37.49-.56.16-.18.21-.32.32-.53.1-.21.05-.4-.03-.56-.08-.16-.72-1.74-1-2.38-.26-.62-.52-.54-.72-.55h-.62c-.21 0-.56.08-.85.4-.3.32-1.12 1.09-1.12 2.66 0 1.57 1.15 3.09 1.31 3.3.16.21 2.26 3.44 5.48 4.83.77.33 1.37.53 1.83.67.77.25 1.47.21 2.02.13.62-.09 1.91-.78 2.18-1.53.27-.75.27-1.4.19-1.53-.08-.13-.29-.21-.61-.37Z" />
    </svg>
  );
}

export function WhatsAppFloat({ href, label = 'Chat with us on WhatsApp' }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={label}
      className="fixed right-4 bottom-4 z-40 grid size-14 place-items-center rounded-full bg-[#25d366] text-white shadow-[0_8px_30px_rgba(0,0,0,.2)] transition-transform hover:scale-105 active:scale-95 sm:right-6 sm:bottom-6"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      data-testid="whatsapp-float"
    >
      <WhatsAppGlyph className="size-7" />
    </a>
  );
}

export function WhatsAppLink({ href, children, className, style }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <a href={href} target="_blank" rel="noopener" className={`inline-flex items-center gap-2 ${className ?? ''}`} style={style}>
      <WhatsAppGlyph className="size-5 text-[#25d366]" />
      {children}
    </a>
  );
}
