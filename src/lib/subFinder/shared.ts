// FIND SUBCONTRACTORS — the rules (2026-11-08, the subcontractors plan, part 3). Three sources, one list: Washington's
// contractor register (L&I's open data on data.wa.gov — license number and status, specialties, bond, insurance,
// principal; free, storable), Google Places (ratings, websites; only the place ID is kept), and the JobFlex Network
// (companies on JobFlex that opted in as subs). A Places business and a register row with the same name are one
// result; a result already in the company's directory is marked saved. Pure, so the checks run it without a network.
// The clients are ./register and ./places, the database half ./server.

export const REGISTER_DATASETS = { general: "m8qx-ubtq", insurance: "ciwg-agsx", bond: "bzff-4fmt" } as const;
export const REGISTER_HOME = "https://data.wa.gov";

/** The register's specialty names (specialtycode1desc / specialtycode2desc, as the data writes them) for JobFlex's
 *  trades. [] = the register has no construction specialty for the trade: Electrical is L&I's own electrical
 *  program, not in this data — those subs show through Google and a name match. */
export const TRADE_SPECIALTIES: Record<string, readonly string[]> = {
  Electrical: [],
  Plumbing: ["PLUMBING"],
  Carpentry: ["Framing and Rough Carpentry", "Cabinets, Millwork and Finish Carpentry"],
  Framing: ["Framing and Rough Carpentry"],
  HVAC: ["Heating/Vent/Air-Conditioning and Refrig (HVAC/R) ", "HVAC/RFRG"],
  Roofing: ["ROOFING"],
  Concrete: ["CONCRETE"],
  Drywall: ["DRY WALL"],
  Painting: ["PAINTING/WALLCOVERING"],
  Tile: ["Tile, Ceramic, Mosaic, Natural and MFG Stone"],
  Flooring: ["Floor Covering and Counter Tops"],
  Countertops: ["Floor Covering and Counter Tops", "Cabinets, Millwork and Finish Carpentry"],
  Siding: ["Siding"],
  Windows: ["GLAZING/GLASS"],
  Fencing: ["FENCING"],
  Decking: ["GENERAL"],
  Landscaping: ["LANDSCAPING"],
  Demolition: ["Excavation, Grading and Land Clearing"],
  Excavation: ["Excavation, Grading and Land Clearing"],
  Insulation: ["Insulation and Acoustical"],
  Masonry: ["MASONRY"],
  Gutters: ["GUTTERS/DOWNSPOUTS"],
  General: ["GENERAL"],
  "General Contractor": ["GENERAL"],
  "Kitchen & Bath": ["Cabinets, Millwork and Finish Carpentry", "Tile, Ceramic, Mosaic, Natural and MFG Stone"],
  Other: [],
};

/** Words in a business's name that mark the trade — the register's fallback when it has no specialty for it, and the
 *  Google query's noun. */
export const TRADE_NAME_WORDS: Record<string, readonly string[]> = {
  Electrical: ["ELECTRIC"],
  Plumbing: ["PLUMB"],
  HVAC: ["HEATING", "HVAC", "AIR COND", "MECHANICAL"],
  Roofing: ["ROOF"],
  Concrete: ["CONCRETE"],
  Drywall: ["DRYWALL", "DRY WALL"],
  Painting: ["PAINT"],
  Tile: ["TILE"],
  Flooring: ["FLOOR"],
  Countertops: ["COUNTER", "CABINET"],
  Siding: ["SIDING"],
  Windows: ["WINDOW", "GLASS"],
  Fencing: ["FENCE"],
  Decking: ["DECK"],
  Landscaping: ["LANDSCAP"],
  Demolition: ["DEMO"],
  Excavation: ["EXCAVAT"],
  Insulation: ["INSULAT"],
  Masonry: ["MASON"],
  Carpentry: ["CARPENTRY", "FRAMING"],
  Framing: ["FRAMING"],
  Gutters: ["GUTTER"],
};

export const specialtiesFor = (trade: string | null | undefined): readonly string[] => (trade ? (TRADE_SPECIALTIES[trade] ?? []) : []);
export const nameWordsFor = (trade: string | null | undefined): readonly string[] => (trade ? (TRADE_NAME_WORDS[trade] ?? [trade.toUpperCase()]) : []);

export const REGISTER_NOTE_ELECTRICAL = "Electrical contractors are licensed by L&I's own electrical program, which this register does not carry — the ones shown hold a construction license too; Google and your own list fill the rest.";

// ── the register's rows ──────────────────────────────────────────────────────

export type LicenseKind = "ACTIVE" | "EXPIRED" | "SUSPENDED" | "UNKNOWN";

/** The register's status words (ACTIVE, RE-LICENSED, EXPIRED, OUT OF BUSINESS, SUSPENDED…) as the directory's kinds. */
export function licenseKindOf(status: string | null | undefined): LicenseKind {
  const s = (status ?? "").trim().toUpperCase();
  if (!s) return "UNKNOWN";
  if (/^(ACTIVE|RE-LICENSED|RESTORED)/.test(s)) return "ACTIVE";
  if (/SUSPEND|REVOK/.test(s)) return "SUSPENDED";
  if (/EXPIRED|OUT OF BUSINESS|INACTIVE|SUPERCEDED|PASSED AWAY|CANCEL/.test(s)) return "EXPIRED";
  return "UNKNOWN";
}

export const LICENSE_KIND_LABEL: Record<LicenseKind, string> = { ACTIVE: "Active license", EXPIRED: "License expired", SUSPENDED: "License suspended", UNKNOWN: "License not checked" };

export type RegisterRow = {
  license: string;
  name: string;
  typeCode: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  /** ISO days. */
  effective: string | null;
  expires: string | null;
  status: string | null;
  kind: LicenseKind;
  specialties: string[];
  ubi: string | null;
  principal: string | null;
  suspendedAt: string | null;
};

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  return Number.isFinite(n) ? n : null;
};
/** "2028-07-13T00:00:00.000" → "2028-07-13"; "Until Canceled" → null. */
export const registerDay = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** "4258149462" → "(425) 814-9462"; anything else as it is. */
export function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return formatPhone(d.slice(1));
  return raw.trim() || null;
}

/** A business name as the register writes it ("@ YOUR SERVICE HOME APPL RPR") in title case for the eye. */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Llc|Inc|Co|Corp|Ltd|Dba|Hvac|Lp|Pllc|Ii|Iii|Iv|Nw|Usa|Jl)\b/g, (w) => w.toUpperCase())
    .replace(/\bLlc\b/g, "LLC");
}

export function registerRowOf(raw: Record<string, unknown>): RegisterRow | null {
  const license = str(raw.contractorlicensenumber, 40);
  const name = str(raw.businessname, 160);
  if (!license || !name) return null;
  const specialties = [str(raw.specialtycode1desc, 80), str(raw.specialtycode2desc, 80)].filter((x): x is string => Boolean(x) && x !== "None");
  const status = str(raw.contractorlicensestatus ?? raw.licensestatusdesc, 40);
  return {
    license,
    name,
    typeCode: str(raw.contractorlicensetypecode, 10),
    address: [str(raw.address1, 120), str(raw.address2, 120)].filter(Boolean).join(", ") || null,
    city: str(raw.city, 80),
    state: str(raw.state, 10),
    zip: str(raw.zip, 12),
    phone: formatPhone(str(raw.phonenumber, 30)),
    effective: registerDay(raw.licenseeffectivedate),
    expires: registerDay(raw.licenseexpirationdate),
    status,
    kind: licenseKindOf(status),
    specialties,
    ubi: str(raw.ubi, 20),
    principal: str(raw.primaryprincipalname, 120),
    suspendedAt: registerDay(raw.contractorlicensesuspenddate),
  };
}

export type InsuranceRow = { license: string; carrier: string | null; policy: string | null; amount: number | null; effective: string | null; expires: string | null; cancelled: string | null };
export function insuranceRowOf(raw: Record<string, unknown>): InsuranceRow | null {
  const license = str(raw.contractorlicensenumber, 40);
  if (!license) return null;
  return { license, carrier: str(raw.insurancecompany, 120), policy: str(raw.insurancepolicyno, 60), amount: num(raw.insuranceamt), effective: registerDay(raw.effectivedate), expires: registerDay(raw.expirationdate), cancelled: registerDay(raw.canceldate) };
}

export type BondRow = { license: string; firm: string | null; amount: number | null; effective: string | null; expires: string | null; impaired: boolean };
export function bondRowOf(raw: Record<string, unknown>): BondRow | null {
  const license = str(raw.contractorlicensenumber, 40);
  if (!license) return null;
  return { license, firm: str(raw.bondfirmname, 120), amount: num(raw.bondamt), effective: registerDay(raw.bondeffectivedate), expires: registerDay(raw.bondexpirationdate), impaired: /^(y|yes|true|1)$/i.test(String(raw.bondimpaired ?? "")) };
}

/** The one insurance row to show for a license: the latest expiry that is not cancelled. */
export function pickInsurance(rows: readonly InsuranceRow[]): InsuranceRow | null {
  const live = rows.filter((r) => !r.cancelled);
  const pool = live.length ? live : rows;
  return pool.slice().sort((a, b) => (b.expires ?? "").localeCompare(a.expires ?? ""))[0] ?? null;
}

export function pickBond(rows: readonly BondRow[]): BondRow | null {
  return rows.slice().sort((a, b) => (b.effective ?? "").localeCompare(a.effective ?? ""))[0] ?? null;
}

// ── matching ─────────────────────────────────────────────────────────────────

const SUFFIXES = /\b(LLC|L\.L\.C\.|INC|INCORPORATED|CO|COMPANY|CORP|CORPORATION|LTD|LIMITED|LP|PLLC|DBA|THE)\b/g;

/** A business name as a key: upper case, no punctuation, no corporate suffixes, one space between words. */
export function normalizeName(s: string | null | undefined): string {
  return (s ?? "")
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PlaceLike = { placeId: string; name: string; address: string | null; phone: string | null; website: string | null; rating: number | null; ratingCount: number | null; lat: number | null; lng: number | null; status: string | null };
export type NetworkLike = { organizationId: string; company: string; trades: string[]; serviceAreas: string | null; contact: { name: string | null; phone: string | null; email: string | null }; address: string | null };
export type SavedLike = { id: string; name: string; placeId: string | null; license: string | null };

export type FinderSource = "register" | "places" | "network";

export type FinderResult = {
  /** Stable within a search: the license, else the place, else the company. */
  key: string;
  sources: FinderSource[];
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  placeId: string | null;
  rating: number | null;
  ratingCount: number | null;
  distanceMi: number | null;
  license: null | { number: string; status: string | null; kind: LicenseKind; expires: string | null; specialties: string[]; principal: string | null; ubi: string | null; insurance: InsuranceRow | null; bond: BondRow | null };
  network: null | { organizationId: string; contact: NetworkLike["contact"]; trades: string[]; serviceAreas: string | null };
  savedId: string | null;
};

export function haversineMi(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/** The three sources as one list: a Google business and a register row of the same name are one result; a JobFlex
 *  company of the same name joins it; a result already in the directory is marked saved. Active licenses first, then
 *  the unverified, then expired and suspended; the better rated first within a group. */
export function mergeResults(input: { register: readonly RegisterRow[]; insurance: ReadonlyMap<string, InsuranceRow>; bond: ReadonlyMap<string, BondRow>; places: readonly PlaceLike[]; network: readonly NetworkLike[]; saved: readonly SavedLike[]; center: { lat: number; lng: number } | null }): FinderResult[] {
  const byName = new Map<string, RegisterRow[]>();
  for (const r of input.register) {
    const k = normalizeName(r.name);
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const used = new Set<string>();
  const licenseOf = (r: RegisterRow): FinderResult["license"] => ({ number: r.license, status: r.status, kind: r.kind, expires: r.expires, specialties: r.specialties, principal: r.principal, ubi: r.ubi, insurance: input.insurance.get(r.license) ?? null, bond: input.bond.get(r.license) ?? null });
  const out: FinderResult[] = [];
  for (const p of input.places) {
    const match = byName.get(normalizeName(p.name))?.find((r) => !used.has(r.license)) ?? null;
    if (match) used.add(match.license);
    out.push({
      key: match ? `lic:${match.license}` : `place:${p.placeId}`,
      sources: match ? ["places", "register"] : ["places"],
      name: p.name,
      address: p.address ?? (match ? [match.address, match.city, match.state, match.zip].filter(Boolean).join(", ") : null),
      city: match?.city ?? cityOf(p.address),
      phone: p.phone ?? match?.phone ?? null,
      website: p.website,
      email: null,
      placeId: p.placeId,
      rating: p.rating,
      ratingCount: p.ratingCount,
      distanceMi: input.center && p.lat != null && p.lng != null ? haversineMi(input.center, { lat: p.lat, lng: p.lng }) : null,
      license: match ? licenseOf(match) : null,
      network: null,
      savedId: null,
    });
  }
  for (const r of input.register) {
    if (used.has(r.license)) continue;
    used.add(r.license);
    out.push({
      key: `lic:${r.license}`,
      sources: ["register"],
      name: titleCase(r.name),
      address: [r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || null,
      city: r.city,
      phone: r.phone,
      website: null,
      email: null,
      placeId: null,
      rating: null,
      ratingCount: null,
      distanceMi: null,
      license: licenseOf(r),
      network: null,
      savedId: null,
    });
  }
  for (const n of input.network) {
    const same = out.find((o) => normalizeName(o.name) === normalizeName(n.company));
    const net = { organizationId: n.organizationId, contact: n.contact, trades: n.trades, serviceAreas: n.serviceAreas };
    if (same) {
      same.sources.push("network");
      same.network = net;
      same.email = same.email ?? n.contact.email;
      same.phone = same.phone ?? n.contact.phone;
      continue;
    }
    out.push({ key: `org:${n.organizationId}`, sources: ["network"], name: n.company, address: n.address, city: cityOf(n.address), phone: n.contact.phone, website: null, email: n.contact.email, placeId: null, rating: null, ratingCount: null, distanceMi: null, license: null, network: net, savedId: null });
  }
  for (const r of out) {
    const hit = input.saved.find((s) => (r.placeId && s.placeId === r.placeId) || (r.license && s.license && s.license.toUpperCase() === r.license.number.toUpperCase()) || normalizeName(s.name) === normalizeName(r.name));
    r.savedId = hit?.id ?? null;
  }
  // Active licenses lead; a JobFlex company without one comes next; then the unverified; expired and suspended last.
  const rank = (r: FinderResult) => (r.license ? (r.license.kind === "ACTIVE" ? 0 : r.license.kind === "UNKNOWN" ? 2 : 4) : r.network ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || (b.rating ?? -1) - (a.rating ?? -1) || (b.ratingCount ?? 0) - (a.ratingCount ?? 0) || a.name.localeCompare(b.name));
}

// ── addresses ────────────────────────────────────────────────────────────────

/** The city, state and ZIP out of a one-line US address ("1200 Example St, Kirkland, WA 98034"). */
export function cityZipOf(address: string | null | undefined): { city: string | null; state: string | null; zip: string | null } {
  if (!address) return { city: null, state: null, zip: null };
  const s = address.replace(/\s+/g, " ").trim();
  const m = /,?\s*([A-Za-z .'-]+?)\s*,?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|United States))?$/.exec(s);
  if (m) return { city: m[1].replace(/^.*,\s*/, "").trim() || null, state: m[2], zip: m[3] };
  const parts = s.split(",").map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return { city: parts[parts.length - 2] || null, state: null, zip: /\b\d{5}\b/.exec(s)?.[0] ?? null };
  return { city: null, state: null, zip: /\b\d{5}\b/.exec(s)?.[0] ?? null };
}

export const cityOf = (address: string | null | undefined): string | null => cityZipOf(address).city;

/** The words of an address a service area could name: the city, the ZIP, the state and its name. */
export function areaWordsOf(address: string | null | undefined): string[] {
  const { city, state, zip } = cityZipOf(address);
  const out = [city, zip, state].filter((x): x is string => Boolean(x));
  if (state === "WA") out.push("Washington");
  if (state === "OR") out.push("Oregon");
  return out;
}

// ── the JobFlex Network ──────────────────────────────────────────────────────

export type NetworkSettings = { on: boolean; trades: string[]; serviceAreas: string; contact: { name: string; phone: string; email: string }; since: string | null };

export function networkSettingsOf(json: string | null | undefined): NetworkSettings {
  const empty: NetworkSettings = { on: false, trades: [], serviceAreas: "", contact: { name: "", phone: "", email: "" }, since: null };
  if (!json) return empty;
  try {
    const v = JSON.parse(json) as Partial<NetworkSettings> & { contact?: Partial<NetworkSettings["contact"]> };
    return {
      on: v.on === true,
      trades: Array.isArray(v.trades) ? v.trades.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map((t) => t.trim()).slice(0, 20) : [],
      serviceAreas: typeof v.serviceAreas === "string" ? v.serviceAreas.slice(0, 300) : "",
      contact: { name: typeof v.contact?.name === "string" ? v.contact.name.slice(0, 120) : "", phone: typeof v.contact?.phone === "string" ? v.contact.phone.slice(0, 40) : "", email: typeof v.contact?.email === "string" ? v.contact.email.slice(0, 200) : "" },
      since: typeof v.since === "string" ? v.since : null,
    };
  } catch {
    return empty;
  }
}

/** A company on the network answers a search when it is on, does the trade (or none was asked), and names one of the
 *  address's area words in its service areas (or has no areas, or none were asked). */
export function networkMatches(s: NetworkSettings, trade: string | null, areaWords: readonly string[]): boolean {
  if (!s.on) return false;
  if (trade && !s.trades.some((t) => t.toLowerCase() === trade.toLowerCase())) return false;
  if (!areaWords.length || !s.serviceAreas.trim()) return true;
  const areas = s.serviceAreas.toLowerCase();
  return areaWords.some((w) => areas.includes(w.toLowerCase()));
}

// ── words ────────────────────────────────────────────────────────────────────

const dollars = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One line under a result: the license and what the register says about it. */
export function licenseWords(l: FinderResult["license"], todayIso: string): string {
  if (!l) return "No license on record here";
  const bits: string[] = [LICENSE_KIND_LABEL[l.kind] + (l.kind === "ACTIVE" ? ` ${l.number}` : l.number ? ` (${l.number})` : "")];
  if (l.specialties.length) bits.push(l.specialties.join(", "));
  if (l.expires) bits.push(`${l.expires < todayIso ? "expired" : "expires"} ${longDay(l.expires)}`);
  if (l.insurance?.cancelled) bits.push(`insurance cancelled ${longDay(l.insurance.cancelled)}`);
  else if (l.insurance?.expires) bits.push(`${l.insurance.expires < todayIso ? "insurance lapsed" : "insured to"} ${longDay(l.insurance.expires)}${l.insurance.carrier ? ` (${l.insurance.carrier.trim()})` : ""}`);
  else bits.push("no insurance on record");
  if (l.bond?.amount) bits.push(`bond ${dollars(l.bond.amount)}${l.bond.impaired ? " · impaired" : ""}`);
  return bits.join(" · ");
}

/** The directory's fields for a found result the office saves. */
export function contractorFromResult(r: FinderResult, trade: string | null): {
  name: string;
  company: string | null;
  trade: string | null;
  trades: string[];
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  contactName: string | null;
  license: string | null;
  licenseStatus: string;
  insuranceUntil: string | null;
  insuranceCarrier: string | null;
  insurancePolicy: string | null;
  bondAmount: number | null;
  bondUntil: string | null;
  source: "SEARCH" | "NETWORK";
  serviceAreas: string | null;
} {
  const l = r.license;
  return {
    // The business name is the name; the company field stays empty rather than saying it twice.
    name: r.name.slice(0, 120),
    company: null,
    trade,
    trades: trade ? [trade] : [],
    phone: r.phone,
    email: r.email,
    website: r.website,
    address: r.address,
    contactName: r.network?.contact.name ?? l?.principal ?? null,
    license: l?.number ?? null,
    licenseStatus: l ? l.kind : "UNKNOWN",
    insuranceUntil: l?.insurance ? (l.insurance.cancelled ?? l.insurance.expires) : null,
    insuranceCarrier: l?.insurance?.carrier?.trim() ?? null,
    insurancePolicy: l?.insurance?.policy ?? null,
    bondAmount: l?.bond?.amount ?? null,
    bondUntil: l?.bond?.expires ?? null,
    source: r.network && !r.license && !r.placeId ? "NETWORK" : "SEARCH",
    serviceAreas: r.network?.serviceAreas ?? null,
  };
}

/** What the register says about a saved sub, kept on the row (registerJson). */
export type RegisterNote = { license: string; status: string | null; kind: LicenseKind; expires: string | null; specialties: string[]; principal: string | null; ubi: string | null; insurance: InsuranceRow | null; bond: BondRow | null; checkedAt: string; source: "register" };

export function registerNoteOf(row: RegisterRow, insurance: InsuranceRow | null, bond: BondRow | null, nowIso: string): RegisterNote {
  return { license: row.license, status: row.status, kind: row.kind, expires: row.expires, specialties: row.specialties, principal: row.principal, ubi: row.ubi, insurance, bond, checkedAt: nowIso, source: "register" };
}

export function parseRegisterNote(json: string | null | undefined): RegisterNote | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json) as Partial<RegisterNote>;
    return typeof v.license === "string" && typeof v.checkedAt === "string" ? { license: v.license, status: v.status ?? null, kind: licenseKindOf(v.status), expires: v.expires ?? null, specialties: Array.isArray(v.specialties) ? v.specialties.filter((x): x is string => typeof x === "string") : [], principal: v.principal ?? null, ubi: v.ubi ?? null, insurance: v.insurance ?? null, bond: v.bond ?? null, checkedAt: v.checkedAt, source: "register" } : null;
  } catch {
    return null;
  }
}

/** The office's line when a nightly check finds a saved sub's standing changed. */
export function standingChangeWords(name: string, before: LicenseKind, after: LicenseKind, insuranceLapsed: boolean): string | null {
  const parts: string[] = [];
  if (before !== after && after !== "UNKNOWN") parts.push(after === "ACTIVE" ? "license is active again" : after === "SUSPENDED" ? "license was suspended" : "license expired");
  if (insuranceLapsed) parts.push("insurance lapsed");
  return parts.length ? `${name}: ${parts.join(" and ")} (the state register).` : null;
}
