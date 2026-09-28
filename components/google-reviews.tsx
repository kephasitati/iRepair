import { Star } from 'lucide-react';
import { getGoogleReviews, googleReviewLinks } from '@/lib/google-reviews';

function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`size-4 ${i <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-ink-3/40'}`} />
      ))}
    </span>
  );
}

/** "Reviews on Google": rating, recent reviews with Google's attribution, and read/write links. */
export async function GoogleReviews({ placeId, shopName }: { placeId: string; shopName: string }) {
  const data = await getGoogleReviews(placeId);
  const links = googleReviewLinks(placeId);
  return (
    <div className="space-y-4" data-testid="google-reviews">
      <div className="tile flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <p className="text-[13px] text-ink-3">Reviews on Google</p>
          {data?.rating != null ? (
            <p className="mt-1 flex items-center gap-2">
              <span className="text-[32px] leading-none font-semibold tabular-nums">{data.rating.toFixed(1)}</span>
              <Stars value={data.rating} />
              <span className="text-[14px] text-ink-3">({data.count.toLocaleString()})</span>
            </p>
          ) : (
            <p className="mt-1 text-[17px]">See what customers say about {shopName}.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={data?.mapsUrl ?? links.read} target="_blank" rel="noopener" className="rounded-full bg-canvas px-4 py-2 text-[14px] hover:bg-fill">
            Read all reviews
          </a>
          <a href={links.write} target="_blank" rel="noopener" className="rounded-full px-4 py-2 text-[14px]" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            Write a review
          </a>
        </div>
      </div>
      {data?.reviews.length ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.reviews.map((r, i) => (
            <li key={i} className="tile p-5">
              <div className="flex items-center gap-3">
                {r.photo ? (
                  // Google-hosted author photo, shown as Google requires for attribution.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={r.photo} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" loading="lazy" />
                ) : (
                  <span className="grid size-9 place-items-center rounded-full bg-fill text-[13px] font-semibold">{r.author.slice(0, 1)}</span>
                )}
                <div className="min-w-0 flex-1">
                  {r.authorUrl ? (
                    <a href={r.authorUrl} target="_blank" rel="noopener" className="block truncate text-[15px] font-semibold hover:underline">
                      {r.author}
                    </a>
                  ) : (
                    <p className="truncate text-[15px] font-semibold">{r.author}</p>
                  )}
                  <p className="flex items-center gap-2 text-[12px] text-ink-3">
                    <Stars value={r.rating} /> {r.when}
                  </p>
                </div>
              </div>
              <p className="mt-3 line-clamp-6 text-[15px] leading-relaxed text-ink-2">{r.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
      {data ? <p className="text-right text-[11px] text-ink-3">Reviews and rating from Google</p> : null}
    </div>
  );
}
