// HOW AN ADDRESS SOUNDS, AND HOW IT IS WRITTEN (2026-11-07, the owner: "it still doesn't understand the address —
// teach it what an address means, how they usually look and how they're written"). Pure.
//
// A US street address is: a house number, sometimes a direction, the street's name (often a number: "202nd"), its
// type (St, Ave, Rd…), sometimes a direction after it, then the city, the state and the ZIP —
// "12103 202nd St SE, Snohomish, WA 98296", "708 N Edgewood Ave, Seattle, WA 98101".
//
// Speech-to-text writes what it hears, not what is meant. The owner said "12103 202nd Street Southeast, Snohomish,
// Washington 98296" and it came back "12103 200 seconds. Creed Southeast, Snohomish, Washington, 98296." — and once
// "12103 200th Street Southeast", with no city at all, which the roof order then went out with. `tidySpokenAddress`
// puts back what such a sentence meant, only inside an address (from a house number on); `houseAddressAsk` says what
// a house's address is still missing before anything is measured or ordered for it.

const ORDINAL_WORD: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9 };

/** 1 → "1st", 2 → "2nd", 12 → "12th", 202 → "202nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

const STREET_TYPE: Record<string, string> = {
  street: "St", avenue: "Ave", road: "Rd", drive: "Dr", lane: "Ln", court: "Ct", place: "Pl", boulevard: "Blvd",
  highway: "Hwy", parkway: "Pkwy", circle: "Cir", terrace: "Ter", trail: "Trl",
};
const DIRECTION: Record<string, string> = {
  northeast: "NE", "north east": "NE", southeast: "SE", "south east": "SE", northwest: "NW", "north west": "NW",
  southwest: "SW", "south west": "SW", north: "N", south: "S", east: "E", west: "W",
};
const STATE_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};
const STATE_CODES = new Set(Object.values(STATE_CODE));
const STATE_NAMES = Object.keys(STATE_CODE).sort((a, b) => b.length - a.length).join("|");

/** What speech-to-text writes for "Street" right after a numbered street ("202nd Creed"). */
const STREET_HEARD = "street|streets|creed|crete|treat|streak|strait|straight|st";
const ORD_WORDS = Object.keys(ORDINAL_WORD).join("|");
/** A word in either case at its start, the rest as written ("[Ss]treet") — so a lookbehind can still ask for a
 *  capitalised street name before it. */
const ci = (p: string) => p.replace(/[a-z]/g, (c) => `[${c.toUpperCase()}${c}]`);
const DIR_WORDS = ci("north ?east|south ?east|north ?west|south ?west");
const TYPE_WORDS = Object.keys(STREET_TYPE).map(ci).join("|");
const SIDE_WORDS = ci("north|south|east|west");

/** Where the address starts in a sentence: a house number (2–6 digits) followed by a word. -1 when there is none. */
function addressStart(text: string): number {
  const m = /\b\d{2,6}[A-Za-z]?\s+(?=[A-Za-z0-9])/.exec(text);
  return m ? m.index : -1;
}

/**
 * The address inside what was said, put the way it is written. Only the part from the house number on is touched,
 * so "send it to Mike at 10" or "two hundred seconds" in other talk stay as they are.
 *   "12103 200 seconds. Creed Southeast, Snohomish, Washington, 98296." → "12103 202nd St SE, Snohomish, WA 98296."
 *   "12103 200th Street Southeast"                                       → "12103 200th St SE"
 *   "708 North Edgewood Avenue, Seattle, Washington 98101"               → "708 N Edgewood Ave, Seattle, WA 98101"
 */
export function tidySpokenAddress(text: string): string {
  const at = addressStart(text);
  if (at < 0) return text;
  const head = text.slice(0, at);
  let a = text.slice(at);
  // "200 seconds" / "200 and second" → 202nd: a round number and an ordinal word said as one street number.
  a = a.replace(new RegExp(`\\b(\\d*0)\\s+(?:and\\s+)?(${ORD_WORDS})s?\\b\\.?`, "gi"), (_m, n: string, w: string) => ordinal(Number(n) + ORDINAL_WORD[w.toLowerCase()]));
  // "202nd. Creed" → "202nd St": a numbered street, then what "Street" was heard as.
  a = a.replace(new RegExp(`\\b(\\d+(?:st|nd|rd|th))[.,]?\\s+(?:${STREET_HEARD})\\b\\.?`, "gi"), "$1 St");
  // Street types written short, right after a street's name: "Edgewood Avenue" → "Edgewood Ave", "85th Street" →
  // "85th St" (never "put it in place").
  a = a.replace(new RegExp(`(?<=\\b(?:[A-Z][a-z]+|\\d+(?:st|nd|rd|th)|[NSEW]|NE|NW|SE|SW)\\s)(${TYPE_WORDS})\\b\\.?`, "g"), (_m, w: string) => STREET_TYPE[w.toLowerCase()]);
  // Directions written short — after the street's type ("St Southeast") or before a numbered street ("Northeast 85th").
  const dir = (w: string) => DIRECTION[w.toLowerCase().replace(/\s+/g, " ")] ?? DIRECTION[w.toLowerCase().replace(/\s+/g, "")] ?? w;
  a = a.replace(new RegExp(`(?<=\\b(?:St|Ave|Rd|Dr|Ln|Ct|Pl|Blvd|Hwy|Pkwy|Cir|Ter|Trl|Way)\\s)(${DIR_WORDS})\\b`, "g"), dir);
  a = a.replace(new RegExp(`\\b(${DIR_WORDS})\\b(?=\\s+\\d)`, "g"), dir);
  a = a.replace(/^(\d{2,6}[A-Za-z]?)\s+(north|south|east|west)\b/i, (_m, n: string, d: string) => `${n} ${DIRECTION[d.toLowerCase()]}`);
  a = a.replace(new RegExp(`\\b(St|Ave|Rd|Dr|Ln|Ct|Pl|Blvd|Hwy|Pkwy|Cir|Ter|Trl|Way)\\s+(${SIDE_WORDS})\\b(?=\\s*(?:,|$|\\.|\\s+[A-Z]))`, "g"), (_m, t: string, d: string) => `${t} ${DIRECTION[d.toLowerCase()]}`);
  // The state before the ZIP as its two letters, and no comma between them: "Washington, 98296" → "WA 98296".
  a = a.replace(new RegExp(`\\b(${STATE_NAMES})\\b\\s*,?\\s*(\\d{5}(?:-\\d{4})?)\\b`, "gi"), (_m, s: string, zip: string) => `${STATE_CODE[s.toLowerCase().replace(/\s+/g, " ")]} ${zip}`);
  a = a.replace(/\b([A-Z]{2}),\s*(\d{5}(?:-\d{4})?)\b/g, (m, s: string, zip: string) => (STATE_CODES.has(s) ? `${s} ${zip}` : m));
  // A stray period inside the address ("202nd. St") goes; one at the very end stays.
  a = a.replace(/\.(?=\s+[A-Za-z0-9])/g, "");
  return head + a.replace(/\s{2,}/g, " ");
}

/** The state an address names — its two letters, or the state's name — or null. */
function stateIn(addr: string): string | null {
  const codes = addr.match(/\b[A-Z]{2}\b/g) ?? [];
  for (const c of codes.reverse()) if (STATE_CODES.has(c) && !/^(NE|NW|SE|SW)$/.test(c)) return c;
  const name = new RegExp(`\\b(${STATE_NAMES})\\b`, "i").exec(addr);
  return name ? STATE_CODE[name[1].toLowerCase().replace(/\s+/g, " ")] : null;
}

/**
 * What a house's address is still missing before it can be measured or looked up — the question to ask, or null when
 * it is whole enough: a house number, a street, and where it is (a ZIP, or a state with a city before it).
 * "12103 200th St SE" → asks for the city and state; "Snohomish, WA" → asks for the street and house number.
 */
export function houseAddressAsk(addr: string): string | null {
  const a = addr.trim();
  const number = /^\s*\d{1,6}[A-Za-z]?\b/.test(a);
  const street = /^\s*\d{1,6}[A-Za-z]?\s+\S+/.test(a);
  const zip = /\b\d{5}(?:-\d{4})?\s*$/.test(a) || /\b\d{5}(?:-\d{4})?\b/.test(a.replace(/^\s*\d{1,6}/, ""));
  const state = stateIn(a.replace(/^\s*\d{1,6}[A-Za-z]?\s+\S+/, ""));
  if (!number || !street) return `What's the house number and street? I have "${a}".`;
  if (!zip && !state) return `Which city and state is ${a} in? A ZIP works too.`;
  return null;
}

/** A house's address as said to a tool: put the way it is written, and the question to ask while it isn't whole. */
export function saidHouseAddress(raw: string | null | undefined): { address: string | null; ask: string | null } {
  const t = raw?.trim();
  if (!t) return { address: null, ask: null };
  const address = tidySpokenAddress(t);
  return { address, ask: houseAddressAsk(address) };
}
