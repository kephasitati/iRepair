import type { Faq } from '@/lib/faq';

/** schema.org JSON-LD. `<` is escaped so shop-entered text can never close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  const json = JSON.stringify(data, (_k, v) => (v === undefined ? undefined : v)).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

/** Visible FAQ (the same Q&As are emitted as FAQPage JSON-LD, which search engines require to be on the page). */
export function FaqList({ faqs, title = 'Questions? Answers.' }: { faqs: Faq[]; title?: string }) {
  return (
    <section aria-labelledby="faq-title">
      <h2 id="faq-title" className="display text-center text-[32px] sm:text-[48px]">
        {title}
      </h2>
      <div className="tile mt-8 divide-y divide-fill px-6">
        {faqs.map((f) => (
          <details key={f.q} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[19px] font-semibold tracking-tight [&::-webkit-details-marker]:hidden">
              {f.q}
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fill text-[18px] leading-none text-ink-2 transition-transform duration-300 group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-[17px] leading-relaxed text-ink-2">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
