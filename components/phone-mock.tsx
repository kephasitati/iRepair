/**
 * A pure-CSS phone showing a live repair status: the "product shot" of the hero. No images, so it is sharp on every
 * screen and costs a few hundred bytes on 3G.
 */
export function PhoneMock({ shop }: { shop: string }) {
  return (
    <div className="relative mx-auto w-[240px] sm:w-[270px]" aria-hidden>
      <div className="absolute -inset-10 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(closest-side, var(--brand-accent), transparent)' }} />
      <div className="relative aspect-[9/19] rounded-[44px] border border-white/15 bg-[#1d1d1f] p-[10px] shadow-[0_40px_80px_rgba(0,0,0,.55),inset_0_0_0_2px_rgba(255,255,255,.06)]">
        <div className="relative h-full overflow-hidden rounded-[36px] bg-[#f5f5f7] text-ink">
          <div className="absolute top-2 left-1/2 h-6 w-20 -translate-x-1/2 rounded-full bg-black" />
          <div className="px-4 pt-12">
            <p className="text-[10px] font-semibold text-ink-3">{shop}</p>
            <p className="text-[17px] leading-tight font-semibold">iPhone 13</p>
            <div className="mt-3 flex gap-1">
              {[1, 1, 1, 0.35, 0.15, 0.15].map((o, i) => (
                <span key={i} className="h-1 flex-1 rounded-full bg-mpesa" style={{ opacity: o }} />
              ))}
            </div>
            <div className="mt-4 rounded-2xl bg-white p-3 shadow-sm">
              <p className="text-[9px] font-semibold tracking-wide text-ink-3 uppercase">Quote ready</p>
              <div className="mt-1.5 space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span>Screen (OLED)</span>
                  <span>14,500</span>
                </div>
                <div className="flex justify-between">
                  <span>Consultation credit</span>
                  <span>−500</span>
                </div>
                <div className="flex justify-between border-t border-fill pt-1 font-semibold">
                  <span>Total</span>
                  <span>KES 14,000</span>
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                <span className="rounded-full py-1.5 text-center text-[9px] font-medium text-white" style={{ background: 'var(--brand-primary)' }}>
                  Accept
                </span>
                <span className="rounded-full bg-fill py-1.5 text-center text-[9px] font-medium">Make an offer</span>
              </div>
            </div>
            <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-white p-2.5 shadow-sm">
              <span className="pulse-green grid size-6 place-items-center rounded-full bg-mpesa text-[10px] text-white">✓</span>
              <div className="text-[9.5px] leading-tight">
                <p className="font-semibold">Handover verified</p>
                <p className="text-ink-3">Rider QR · KMFB 123A</p>
              </div>
            </div>
            <div className="mt-2.5 rounded-2xl bg-white p-2.5 shadow-sm">
              <div className="flex items-center justify-between text-[9.5px]">
                <span className="font-semibold">M-Pesa</span>
                <span className="rounded-full bg-mpesa/10 px-2 py-0.5 text-[8.5px] font-semibold text-mpesa">Paid</span>
              </div>
              <p className="mt-0.5 font-mono text-[9px] text-ink-3">SIK4H7X2QP · KES 800</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
