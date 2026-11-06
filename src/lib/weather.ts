import "server-only";
// THE WEATHER ON A DAY ON SITE (the crew build, 2026-11-05): "48–61°F, light rain", noted on the WorkDay when the
// crew opens it, from the job's address. Open-Meteo, no key, no account; everything here is best effort — a slow
// or missing answer is null and the day opens all the same. Never throws.

const TIMEOUT_MS = 4000;

async function getJson(url: string): Promise<unknown | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** A place's coordinates from its city and state (the ZIP when there is no city). Open-Meteo's search takes a place
 *  name alone — "Kirkland", never "Kirkland WA" — so the state picks among the hits instead. */
export async function geocode(input: { city?: string | null; state?: string | null; zip?: string | null }): Promise<{ lat: number; lng: number } | null> {
  const name = (input.city?.trim() || input.zip?.trim() || "").trim();
  if (!name) return null;
  const raw = (await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json&countryCode=US`)) as { results?: Array<{ latitude: number; longitude: number; admin1?: string; admin1_id?: number }> } | null;
  const hits = raw?.results ?? [];
  const state = (input.state ?? "").trim().toUpperCase();
  const stateName = state ? US_STATES[state] : null;
  const r = (stateName ? hits.find((h) => (h.admin1 ?? "").toLowerCase() === stateName.toLowerCase()) : null) ?? hits[0];
  return r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude) ? { lat: r.latitude, lng: r.longitude } : null;
}

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};

const CODE_WORDS: Array<[number[], string]> = [
  [[0], "clear"],
  [[1, 2], "partly cloudy"],
  [[3], "overcast"],
  [[45, 48], "fog"],
  [[51, 53, 55, 56, 57], "drizzle"],
  [[61, 63, 80, 81], "rain"],
  [[65, 82], "heavy rain"],
  [[66, 67], "freezing rain"],
  [[71, 73, 75, 77, 85, 86], "snow"],
  [[95, 96, 99], "thunderstorm"],
];

/** "48–61°F, rain" for a day (YYYY-MM-DD) at a place, in the company's time zone. */
export async function weatherLine(lat: number, lng: number, day: string, tz: string): Promise<string | null> {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: tz,
    start_date: day,
    end_date: day,
  });
  const raw = (await getJson(`https://api.open-meteo.com/v1/forecast?${q}`)) as { daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_sum?: number[]; weathercode?: number[] } } | null;
  const d = raw?.daily;
  const hi = d?.temperature_2m_max?.[0];
  const lo = d?.temperature_2m_min?.[0];
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  const code = d?.weathercode?.[0];
  const words = CODE_WORDS.find(([codes]) => typeof code === "number" && codes.includes(code))?.[1] ?? null;
  const rain = d?.precipitation_sum?.[0];
  const parts = [`${Math.round(lo!)}–${Math.round(hi!)}°F`, words, typeof rain === "number" && rain >= 0.05 ? `${rain.toFixed(rain >= 1 ? 1 : 2)} in` : null].filter(Boolean);
  return parts.join(", ");
}
