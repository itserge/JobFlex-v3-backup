import "server-only";
// GOOGLE PLACES FOR SUBCONTRACTORS (2026-11-08, the subcontractors plan, part 3): one Text Search (Places API (New))
// for "<trade> contractor near <address>", biased to a circle around the project. Only the place ID is ever stored
// (Google's policy); ratings, websites and phones are shown live. The key is the one JobFlex already holds for
// geocoding (GOOGLE_MAPS_API_KEY); in development GOOGLE_PLACES_BASE points the call at the stand's fake, the same
// override the admin's outreach search uses.

import { placesErrorWords } from "@/lib/outreach/hunt";
import type { PlaceLike } from "./shared";

const FIELDS = "places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus,places.location";

function devBase(): string | null {
  return process.env.NODE_ENV !== "production" ? process.env.GOOGLE_PLACES_BASE?.trim() || null : null;
}

/** Google is asked when the key is set — or, in development, when the fake's address is. */
export function placesOn(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY) || Boolean(devBase());
}

export type PlacesSearch = {
  trade: string | null;
  /** The office's own words, else "<trade> contractor". */
  words: string | null;
  /** The address in words, for the query. */
  near: string | null;
  /** The circle the results lean to. */
  center: { lat: number; lng: number } | null;
  radiusM: number;
};

export async function searchContractorPlaces(input: PlacesSearch): Promise<PlaceLike[]> {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? "";
  const base = (devBase() || "https://places.googleapis.com").replace(/\/$/, "");
  const what = input.words?.trim() || `${input.trade ?? ""} contractor`.trim();
  const textQuery = input.near ? `${what} near ${input.near}` : what;
  const res = await fetch(`${base}/v1/places:searchText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
    body: JSON.stringify({
      textQuery,
      pageSize: 20,
      languageCode: "en",
      regionCode: "US",
      ...(input.center ? { locationBias: { circle: { center: { latitude: input.center.lat, longitude: input.center.lng }, radius: Math.max(1000, Math.min(50_000, Math.round(input.radiusM))) } } } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { places?: Array<Record<string, unknown>>; error?: { message?: string; status?: string } };
  if (!res.ok) throw new Error(placesErrorWords(res.status, j.error?.message ?? j.error?.status ?? null));
  return (j.places ?? [])
    .map((p): PlaceLike => {
      const name = p.displayName as { text?: string } | undefined;
      const loc = p.location as { latitude?: number; longitude?: number } | undefined;
      return {
        placeId: String(p.id ?? ""),
        name: String(name?.text ?? ""),
        address: typeof p.formattedAddress === "string" ? p.formattedAddress : null,
        phone: typeof p.nationalPhoneNumber === "string" ? p.nationalPhoneNumber : typeof p.internationalPhoneNumber === "string" ? p.internationalPhoneNumber : null,
        website: typeof p.websiteUri === "string" ? p.websiteUri : null,
        rating: typeof p.rating === "number" ? p.rating : null,
        ratingCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        lat: typeof loc?.latitude === "number" ? loc.latitude : null,
        lng: typeof loc?.longitude === "number" ? loc.longitude : null,
        status: typeof p.businessStatus === "string" ? p.businessStatus : null,
      };
    })
    .filter((p) => p.placeId && p.name && p.status !== "CLOSED_PERMANENTLY");
}
