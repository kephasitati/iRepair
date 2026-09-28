import "server-only";
import { env } from "@/lib/env";

export type GoogleReview = { author: string; authorUrl: string | null; photo: string | null; rating: number; when: string; text: string };
export type GooglePlaceReviews = { rating: number | null; count: number; mapsUrl: string | null; reviews: GoogleReview[] };

type PlacesResponse = {
  rating?: number;
  userRatingCount?: number;
  googleMapsUri?: string;
  reviews?: {
    rating?: number;
    relativePublishTimeDescription?: string;
    text?: { text?: string };
    originalText?: { text?: string };
    authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
  }[];
};

/**
 * A shop's rating and up to five recent reviews from Google (Places API, New). Null when no key or place is set, or
 * when Google errors — the About page then falls back to a link. Refreshed at most every six hours per place.
 */
export async function getGoogleReviews(placeId: string | null | undefined): Promise<GooglePlaceReviews | null> {
  const key = env().GOOGLE_PLACES_API_KEY;
  if (!key || !placeId) return null;
  try {
    const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=en`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount,googleMapsUri,reviews" },
      next: { revalidate: 21600 },
    });
    if (!res.ok) return null;
    const p = (await res.json()) as PlacesResponse;
    return {
      rating: typeof p.rating === "number" ? p.rating : null,
      count: p.userRatingCount ?? 0,
      mapsUrl: p.googleMapsUri ?? null,
      reviews: (p.reviews ?? [])
        .map((r) => ({
          author: r.authorAttribution?.displayName ?? "Google user",
          authorUrl: r.authorAttribution?.uri ?? null,
          photo: r.authorAttribution?.photoUri ?? null,
          rating: r.rating ?? 0,
          when: r.relativePublishTimeDescription ?? "",
          text: r.text?.text ?? r.originalText?.text ?? "",
        }))
        .filter((r) => r.text),
    };
  } catch {
    return null;
  }
}

/** Google's own "read reviews" and "write a review" links for a place ID (work with no API key). */
export function googleReviewLinks(placeId: string) {
  return {
    read: `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`,
    write: `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
  };
}
