import Link from 'next/link';
import { CookieSettingsLink } from '@/components/cookie-banner';

/** Apple-legal-style long-form page: large title, calm body copy, numbered sections with an index. */
export function LegalPage({ title, updated, intro, sections }: { title: string; updated: string; intro: React.ReactNode; sections: { id: string; title: string; body: React.ReactNode }[] }) {
  return (
    <article className="tile px-6 py-10 sm:px-12 sm:py-14">
      <p className="eyebrow">Last updated {updated}</p>
      <h1 className="display mt-2 text-[34px] sm:text-[48px]">{title}</h1>
      <div className="mt-5 text-[17px] leading-relaxed text-ink-2">{intro}</div>
      <nav className="mt-8 rounded-[14px] bg-canvas p-5">
        <p className="text-[13px] font-semibold text-ink-3">Contents</p>
        <ol className="mt-2 grid gap-1 text-[15px] sm:grid-cols-2">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-link hover:underline">
                {i + 1}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mt-10 space-y-10">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="scroll-mt-20">
            <h2 className="text-[24px] font-semibold tracking-tight">
              {i + 1}. {s.title}
            </h2>
            <div className="legal-body mt-3 space-y-3 text-[17px] leading-relaxed text-ink-2 [&_li]:mt-1.5 [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5">{s.body}</div>
          </section>
        ))}
      </div>
      <p className="mt-12 border-t border-line pt-5 text-[13px] text-ink-3">
        <Link href="/terms" className="hover:underline">
          Terms of Service
        </Link>
        {' · '}
        <Link href="/privacy" className="hover:underline">
          Privacy policy
        </Link>
        {' · '}
        <CookieSettingsLink className="hover:underline" />
      </p>
    </article>
  );
}
