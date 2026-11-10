// WHAT IS KNOWN ABOUT A CLIENT'S HOUSE (Smart CRM part 6, 2026-11-10) — the year it was built and its size, so a
// list can say "homes built before 1995". FREE SOURCES ONLY, in this order:
//   1. a parcel JobFlex already has on file for that street address (ParcelCache — paid for once, by an estimator);
//   2. the Census Bureau's geocoder (free) for the point, then the parcel on file under that point;
//   3. the county assessor's public record under that point (lib/hvac/assessors — six WA counties today);
//   +  the roof's size, when the company measured that roof.
// It never buys a parcel record (ReportAll, Regrid): a lookup nobody asked a price for must cost nothing. What
// isn't found is written down as "not found" and tried again after HOUSE_RETRY_DAYS; a person can always type it in.
import "server-only";
import { db } from "@/lib/db";
import { assessorRecordAt } from "@/lib/hvac/assessors";
import { censusGeocode } from "@/lib/hvac/publicGeo";
import { parseWkt, type RingPoint } from "@/lib/parcels";
import { addressKeyOf } from "@/lib/reportall";
import { HOUSE_BATCH, HOUSE_RETRY_DAYS, houseFacts, oneLineAddress, streetLineOf, zipIn, type HouseSource } from "./shared";

const DAY = 86_400_000;
const BOX_DEG = 0.01;

interface Found {
  yearBuilt: number | null;
  livingSqft: number | null;
  storeys: number | null;
  lotAcres: number | null;
  source: HouseSource;
  sourceNote: string | null;
}

const sane = (yearBuilt: number | null | undefined, sqft: number | null | undefined) => {
  const y = yearBuilt && yearBuilt >= 1700 && yearBuilt <= new Date().getFullYear() + 1 ? Math.round(yearBuilt) : null;
  const s = sqft && sqft >= 100 && sqft <= 100_000 ? Math.round(sqft) : null;
  return { yearBuilt: y, livingSqft: s };
};

function inRing(lat: number, lng: number, ring: RingPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type ParcelRow = { address: string | null; city: string | null; zip: string | null; acreage: number | null; bldgSqft: number | null; yearBuilt: number | null; storeys: number | null; countyName: string | null };
const PARCEL = { address: true, city: true, zip: true, acreage: true, bldgSqft: true, yearBuilt: true, storeys: true, countyName: true } as const;

function fromParcel(row: ParcelRow, how: string): Found | null {
  const f = sane(row.yearBuilt, row.bldgSqft);
  if (f.yearBuilt === null && f.livingSqft === null) return null;
  return { ...f, storeys: row.storeys ?? null, lotAcres: row.acreage ?? null, source: "parcel", sourceNote: `${how}${row.countyName ? ` · ${row.countyName} County` : ""}` };
}

interface Addressed {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** One house, from the free sources. Null = nothing found. Never throws. */
export async function findHouse(c: Addressed): Promise<Found | null> {
  const street = streetLineOf(c.address ?? "");
  const key = addressKeyOf(street);
  if (!key || !/\d/.test(street)) return null; // no house number: nothing to look up
  const zip = (c.zip ?? "").trim().slice(0, 5) || zipIn(c.address);
  const city = (c.city ?? "").trim().toUpperCase();

  // 1 — the same street address on file. A street address alone isn't a house ("12 Main St" is in every town), so
  //     the ZIP or the city must agree too.
  try {
    const rows = await db.parcelCache.findMany({ where: { addressKey: key }, select: PARCEL, take: 8 });
    const same = rows.find((r) => (zip && r.zip?.trim().slice(0, 5) === zip) || (city && r.city?.trim().toUpperCase() === city));
    const hit = same ? fromParcel(same, "property record on file") : null;
    if (hit) return hit;
  } catch (err) {
    console.warn("[winback/house] parcel-by-address read failed:", err instanceof Error ? err.message : err);
  }

  // 2 — where is it? (Census Bureau, free.) A bare street line can't be placed.
  const line = oneLineAddress(c);
  if (!line || (!zip && !city && !/,/.test(c.address ?? ""))) return null;
  const geo = await censusGeocode(line);
  if (!geo) return null;
  try {
    const near = await db.parcelCache.findMany({
      where: { lat: { gte: geo.lat - BOX_DEG, lte: geo.lat + BOX_DEG }, lon: { gte: geo.lng - BOX_DEG, lte: geo.lng + BOX_DEG } },
      select: { ...PARCEL, wkt: true },
      take: 50,
    });
    for (const row of near) {
      if (!parseWkt(row.wkt).some((ring) => inRing(geo.lat, geo.lng, ring))) continue;
      const hit = fromParcel(row, "property record on file");
      if (hit) return hit;
    }
  } catch (err) {
    console.warn("[winback/house] parcel-by-point read failed:", err instanceof Error ? err.message : err);
  }

  // 3 — the county's own public record.
  if (!geo.state) return null;
  const rec = await assessorRecordAt(geo.state, geo.county, geo.lat, geo.lng);
  if (!rec) return null;
  const f = sane(rec.yearBuilt, rec.livingSqft);
  if (f.yearBuilt === null && f.livingSqft === null) return null;
  return { ...f, storeys: rec.storeys ?? null, lotAcres: null, source: "county", sourceNote: rec.source };
}

export interface HouseRun {
  checked: number;
  found: number;
  /** Clients with an address still not looked up. */
  left: number;
}

/** Look up the next few houses: clients with an address and no answer yet (or a "not found" old enough to try
 *  again, or an address that changed since). Bounded by count and by time, so a button press always comes back. */
export async function lookUpHouses(organizationId: string, opts: { max?: number; budgetMs?: number; now?: Date } = {}): Promise<HouseRun> {
  const now = opts.now ?? new Date();
  const max = Math.min(opts.max ?? HOUSE_BATCH, 60);
  const until = Date.now() + (opts.budgetMs ?? 25_000);
  const [clients, houses, roofs] = await Promise.all([
    db.client.findMany({ where: { organizationId, deletedAt: null, address: { not: null } }, select: { id: true, address: true, city: true, state: true, zip: true }, orderBy: { createdAt: "desc" }, take: 5000 }),
    db.clientHouse.findMany({ where: { organizationId }, select: { clientId: true, source: true, addressKey: true, checkedAt: true } }),
    db.roofMeasurement.findMany({ where: { organizationId, address: { not: null }, areaSqft: { not: null } }, select: { address: true, areaSqft: true }, orderBy: { createdAt: "desc" }, take: 500 }),
  ]);
  const have = new Map(houses.map((h) => [h.clientId, h]));
  const roofOf = new Map<string, number>();
  for (const r of roofs) {
    const k = addressKeyOf(streetLineOf(r.address ?? ""));
    if (k && r.areaSqft && !roofOf.has(k)) roofOf.set(k, Math.round(r.areaSqft));
  }
  const due = clients.filter((c) => {
    const key = addressKeyOf(streetLineOf(c.address ?? ""));
    if (!key || (c.address ?? "").trim().length < 5) return false;
    const h = have.get(c.id);
    if (!h) return true;
    if (h.source === "hand") return false; // what a person typed is never replaced by a lookup
    if (h.addressKey !== key) return true; // they moved, or the address was corrected
    return h.source === "none" && now.getTime() - h.checkedAt.getTime() > HOUSE_RETRY_DAYS * DAY;
  });

  let checked = 0;
  let found = 0;
  for (const c of due.slice(0, max)) {
    if (Date.now() > until) break;
    const key = addressKeyOf(streetLineOf(c.address ?? ""));
    const hit = await findHouse(c).catch(() => null);
    const data = {
      organizationId,
      addressKey: key,
      yearBuilt: hit?.yearBuilt ?? null,
      livingSqft: hit?.livingSqft ?? null,
      storeys: hit?.storeys ?? null,
      lotAcres: hit?.lotAcres ?? null,
      roofSqft: (key && roofOf.get(key)) || null,
      source: hit?.source ?? "none",
      sourceNote: hit?.sourceNote ?? null,
      checkedAt: now,
    };
    await db.clientHouse.upsert({ where: { clientId: c.id }, create: { clientId: c.id, ...data }, update: data });
    checked += 1;
    if (hit) found += 1;
  }
  return { checked, found, left: Math.max(0, due.length - checked) };
}

/** A person typed it in. Both blank = forget what was typed (the lookup may try again). */
export async function setHouseByHand(organizationId: string, clientId: string, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const facts = houseFacts.safeParse(raw);
  if (!facts.success) return { ok: false, error: "Check the year (like 1987) and the size in square feet." };
  const client = await db.client.findFirst({ where: { id: clientId, organizationId, deletedAt: null }, select: { id: true, address: true } });
  if (!client) return { ok: false, error: "No such client." };
  if (facts.data.yearBuilt === null && facts.data.livingSqft === null) {
    await db.clientHouse.deleteMany({ where: { clientId, organizationId } });
    return { ok: true };
  }
  const data = { organizationId, addressKey: addressKeyOf(streetLineOf(client.address ?? "")), yearBuilt: facts.data.yearBuilt, livingSqft: facts.data.livingSqft, source: "hand", sourceNote: null, checkedAt: new Date() };
  await db.clientHouse.upsert({ where: { clientId }, create: { clientId, ...data }, update: data });
  return { ok: true };
}

export interface HouseRow {
  clientId: string;
  name: string;
  address: string;
  yearBuilt: number | null;
  livingSqft: number | null;
  source: HouseSource | null;
}

/** The houses the lookup couldn't answer (and the ones never tried), for the "type it in" rows. */
export async function housesToFill(organizationId: string, take = 12): Promise<HouseRow[]> {
  const [clients, houses] = await Promise.all([
    db.client.findMany({ where: { organizationId, deletedAt: null, address: { not: null } }, select: { id: true, name: true, address: true, city: true }, orderBy: { createdAt: "desc" }, take: 2000 }),
    db.clientHouse.findMany({ where: { organizationId }, select: { clientId: true, yearBuilt: true, livingSqft: true, source: true } }),
  ]);
  const have = new Map(houses.map((h) => [h.clientId, h]));
  const rows: HouseRow[] = [];
  for (const c of clients) {
    if ((c.address ?? "").trim().length < 5) continue;
    const h = have.get(c.id);
    if (h && (h.yearBuilt !== null || h.livingSqft !== null)) continue;
    if (!h) continue; // never looked up: the button does those first
    rows.push({ clientId: c.id, name: c.name, address: [streetLineOf(c.address ?? ""), c.city].filter(Boolean).join(", "), yearBuilt: null, livingSqft: null, source: (h.source as HouseSource) ?? null });
    if (rows.length >= take) break;
  }
  return rows;
}
