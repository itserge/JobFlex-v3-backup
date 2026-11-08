import "server-only";
// FIND SUBCONTRACTORS — the database half (2026-11-08, the subcontractors plan, part 3). The rules are ./shared, the
// sources ./register (Washington's L&I open data) and ./places (Google), the third source is the JobFlex Network —
// companies on JobFlex that opted in as subs (Organization.networkJson).
//
//   · findSubs             — one search near a project: the register by city and specialty, Google by a circle around
//                            the address, the network by trade and area; merged, the saved ones marked.
//   · saveFound            — a result into the company's directory (source SEARCH or NETWORK), with what the register
//                            says kept on the row.
//   · verifyContractor     — the register's word on one saved sub, by license number or by name; the row updated.
//   · refreshRegister      — the nightly pass over every saved sub with a license number: a lapse rings the office.
//   · networkSettings / saveNetworkSettings — the company's own opt-in.

import { db } from "@/lib/db";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { localDayKey } from "@/lib/jobProgressShared";
import { geocode, isMapsEnabled } from "@/lib/maps";
import { parseLot } from "@/lib/projectPhases/server";
import { SUB_EVENT_KIND, addContractor, updateContractor, type ContractorRow } from "@/lib/projectSubs/server";
import { textOffice } from "@/lib/sms/send";
import { placesOn, searchContractorPlaces } from "./places";
import { bondFor, insuranceFor, registerByLicenses, registerByName, searchRegister } from "./register";
import {
  REGISTER_NOTE_ELECTRICAL,
  areaWordsOf,
  cityOf,
  cityZipOf,
  contractorFromResult,
  licenseKindOf,
  mergeResults,
  nameWordsFor,
  networkMatches,
  networkSettingsOf,
  registerNoteOf,
  specialtiesFor,
  standingChangeWords,
  type BondRow,
  type FinderResult,
  type InsuranceRow,
  type NetworkLike,
  type NetworkSettings,
  type PlaceLike,
  type RegisterRow,
} from "./shared";

export type FindInput = { trade: string | null; address: string | null; radiusMi: number; words: string | null; includeLapsed?: boolean };
export type FindRead = { results: FinderResult[]; address: string | null; center: { lat: number; lng: number } | null; notes: string[]; counts: { register: number; places: number; network: number } };

const words = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 200);

/** The project's site address: the Lot card's parcel, else the client's address, else the company's. */
export async function projectSiteAddress(organizationId: string, projectId: string): Promise<string | null> {
  const p = await db.project.findFirst({ where: { id: projectId, organizationId }, select: { lotJson: true, client: { select: { address: true, city: true, state: true, zip: true } }, organization: { select: { address: true } } } });
  if (!p) return null;
  const lot = parseLot(p.lotJson).parcel?.address?.trim();
  if (lot) return lot;
  const c = p.client;
  if (c?.address?.trim()) {
    const lines = c.address.split("\n").map((x) => x.trim()).filter(Boolean);
    const tail = [c.city, c.state, c.zip].filter(Boolean).join(" ");
    const joined = lines.join(", ");
    return tail && !joined.toLowerCase().includes((c.city ?? "").toLowerCase()) ? `${joined}, ${tail}` : joined;
  }
  return p.organization.address?.trim() || null;
}

/** One search: the three sources, merged, the saved ones marked. A source that does not answer leaves a note, never
 *  an empty page. */
export async function findSubs(organizationId: string, projectId: string | null, input: FindInput): Promise<FindRead> {
  const address = input.address?.trim() || (projectId ? await projectSiteAddress(organizationId, projectId) : null);
  const { city, zip } = cityZipOf(address);
  const notes: string[] = [];
  const center = address && isMapsEnabled() ? await geocode(address).catch(() => null) : null;

  let register: RegisterRow[] = [];
  if (city || zip || input.words?.trim()) {
    try {
      register = await searchRegister({ specialties: specialtiesFor(input.trade), nameWords: nameWordsFor(input.trade), city, zip, words: input.words, includeLapsed: input.includeLapsed, limit: 60 });
    } catch (err) {
      notes.push(`The state register did not answer: ${words(err)}`);
    }
  } else {
    notes.push("Give the project an address (the Lot card, or the client's) or type a name — the register is searched by city.");
  }
  if (input.trade === "Electrical") notes.push(REGISTER_NOTE_ELECTRICAL);
  const licenses = register.map((r) => r.license);
  const [insurance, bond] = await Promise.all([insuranceFor(licenses).catch((): Map<string, InsuranceRow> => new Map()), bondFor(licenses).catch((): Map<string, BondRow> => new Map())]);

  let places: PlaceLike[] = [];
  if (placesOn()) {
    try {
      places = await searchContractorPlaces({ trade: input.trade, words: input.words, near: address, center, radiusM: Math.round(input.radiusMi * 1609.34) });
    } catch (err) {
      notes.push(`Google did not answer: ${words(err)}`);
    }
  } else {
    notes.push("Google ratings and websites need the Places API on JobFlex's Google key.");
  }

  const orgs = await db.organization.findMany({ where: { networkJson: { not: null }, id: { not: organizationId }, deletedAt: null }, select: { id: true, name: true, address: true, networkJson: true }, take: 500 });
  const area = areaWordsOf(address);
  const network: NetworkLike[] = orgs
    .map((o) => ({ o, s: networkSettingsOf(o.networkJson) }))
    .filter(({ s }) => networkMatches(s, input.trade, area))
    .map(({ o, s }) => ({ organizationId: o.id, company: o.name?.trim() || "A JobFlex company", trades: s.trades, serviceAreas: s.serviceAreas || null, contact: { name: s.contact.name || null, phone: s.contact.phone || null, email: s.contact.email || null }, address: o.address }));

  const saved = await db.contractor.findMany({ where: { organizationId }, select: { id: true, name: true, placeId: true, license: true } });
  const results = mergeResults({ register, insurance, bond, places, network, saved, center });
  return { results, address, center, notes, counts: { register: register.length, places: places.length, network: network.length } };
}

/** The register's word on a license, kept on the row and mirrored into the directory's fields. */
async function keepRegister(organizationId: string, contractorId: string, row: RegisterRow, insurance: InsuranceRow | null, bond: BondRow | null): Promise<ContractorRow> {
  const now = new Date();
  // The note first, then the directory's fields — updateContractor reads the row back, so the row it returns carries
  // the note (the profile shows it at once, without a reload).
  await db.contractor.update({ where: { id: contractorId }, data: { registerJson: JSON.stringify(registerNoteOf(row, insurance, bond, now.toISOString())), registerCheckedAt: now, licenseVerifiedAt: now, licenseSource: "WA L&I register" } });
  return updateContractor(organizationId, contractorId, {
    license: row.license,
    licenseStatus: row.kind,
    // A cancelled policy ends on its cancel day, whatever its paper expiry says.
    insuranceUntil: insurance ? (insurance.cancelled ?? insurance.expires ?? undefined) : undefined,
    insuranceCarrier: insurance?.carrier?.trim() ?? undefined,
    insurancePolicy: insurance?.policy ?? undefined,
    bondAmount: bond?.amount ?? undefined,
    bondUntil: bond?.expires ?? undefined,
  });
}

/** A found result into the directory. One already there (the same place, license or name) is returned as it is. */
export async function saveFound(organizationId: string, actorId: string | null, result: FinderResult, trade: string | null): Promise<{ row: ContractorRow; existed: boolean }> {
  const existing = await db.contractor.findFirst({
    where: { organizationId, OR: [...(result.placeId ? [{ placeId: result.placeId }] : []), ...(result.license ? [{ license: { equals: result.license.number } }] : []), ...(result.savedId ? [{ id: result.savedId }] : [])] },
    select: { id: true },
  });
  if (existing) return { row: await updateContractor(organizationId, existing.id, {}), existed: true };
  const input = contractorFromResult(result, trade);
  const row = await addContractor(organizationId, actorId, input);
  if (result.placeId) await db.contractor.update({ where: { id: row.id }, data: { placeId: result.placeId } });
  if (result.license) {
    const [ins, bond] = await Promise.all([insuranceFor([result.license.number]).catch((): Map<string, InsuranceRow> => new Map()), bondFor([result.license.number]).catch((): Map<string, BondRow> => new Map())]);
    const reg = (await registerByLicenses([result.license.number]).catch((): RegisterRow[] => []))[0] ?? null;
    if (reg) return { row: await keepRegister(organizationId, row.id, reg, ins.get(result.license.number.toUpperCase()) ?? result.license.insurance, bond.get(result.license.number.toUpperCase()) ?? result.license.bond), existed: false };
  }
  return { row: result.placeId ? await updateContractor(organizationId, row.id, {}) : row, existed: false };
}

/** The register's word on one saved sub — by license number when the row has one, else by name and city. */
export async function verifyContractor(organizationId: string, contractorId: string, actorId: string | null): Promise<{ row: ContractorRow; words: string }> {
  const c = await db.contractor.findFirst({ where: { id: contractorId, organizationId }, select: { id: true, name: true, company: true, address: true, license: true } });
  if (!c) throw new Error("Contractor not found");
  const rows = c.license?.trim() ? await registerByLicenses([c.license]) : [...(await registerByName(c.company ?? c.name, cityOf(c.address))), ...(c.company ? await registerByName(c.name, cityOf(c.address)) : [])];
  const r = rows[0] ?? null;
  if (!r) {
    await db.contractor.update({ where: { id: c.id }, data: { registerCheckedAt: new Date(), licenseSource: "WA L&I register" } });
    const row = await updateContractor(organizationId, c.id, {});
    return { row, words: c.license ? `${c.license} is not in the state register.` : `${c.name} is not in the state register by name — add the license number to check it.` };
  }
  const key = r.license.toUpperCase();
  const [ins, bond] = await Promise.all([insuranceFor([r.license]).catch((): Map<string, InsuranceRow> => new Map()), bondFor([r.license]).catch((): Map<string, BondRow> => new Map())]);
  const row = await keepRegister(organizationId, c.id, r, ins.get(key) ?? null, bond.get(key) ?? null);
  const today = new Date().toISOString().slice(0, 10);
  const insurance = ins.get(key);
  const words = [`${r.kind === "ACTIVE" ? "Active" : r.kind === "SUSPENDED" ? "Suspended" : r.kind === "EXPIRED" ? "Expired" : "Unknown"} license ${r.license}`, r.specialties.length ? r.specialties.join(", ") : null, r.expires ? `${r.expires < today ? "expired" : "expires"} ${r.expires}` : null, insurance?.expires ? `insured to ${insurance.expires}` : "no insurance on record", bond.get(key)?.amount ? `bond $${Math.round(bond.get(key)!.amount!).toLocaleString("en-US")}` : null].filter(Boolean).join(" · ");
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: `Checked ${c.name} against the state register: ${words}`, meta: { contractorId: c.id } });
  return { row, words };
}

const REGISTER_DAY_KEY = "subs:register:day";

/** The nightly pass (from the sweep, once a UTC day): every saved sub with a license number is read again; a license
 *  that lapsed or was suspended, or insurance that ran out, rings the office's bell and the office text. */
export async function refreshRegister(now = new Date()): Promise<{ checked: number; changed: number; skipped?: "not-due" }> {
  const day = now.toISOString().slice(0, 10);
  const stamp = await db.syncState.findUnique({ where: { key: REGISTER_DAY_KEY } }).catch(() => null);
  if (stamp?.cursor === day) return { checked: 0, changed: 0, skipped: "not-due" };
  await db.syncState.upsert({ where: { key: REGISTER_DAY_KEY }, create: { key: REGISTER_DAY_KEY, cursor: day }, update: { cursor: day } }).catch(() => undefined);
  const due = await db.contractor.findMany({
    where: { license: { not: null }, OR: [{ registerCheckedAt: null }, { registerCheckedAt: { lt: new Date(now.getTime() - 20 * 3600_000) } }] },
    select: { id: true, organizationId: true, name: true, license: true, licenseStatus: true, insuranceUntil: true, organization: { select: { timezone: true, deletedAt: true } } },
    take: 200,
  });
  let checked = 0;
  let changed = 0;
  for (let i = 0; i < due.length; i += 50) {
    const batch = due.slice(i, i + 50).filter((c) => c.license && !c.organization.deletedAt);
    const licenses = batch.map((c) => c.license!.trim());
    let rows: RegisterRow[] = [];
    try {
      rows = await registerByLicenses(licenses);
    } catch (err) {
      console.warn(`[subs-register] the register did not answer: ${words(err)}`);
      break;
    }
    const [ins, bond] = await Promise.all([insuranceFor(licenses).catch((): Map<string, InsuranceRow> => new Map()), bondFor(licenses).catch((): Map<string, BondRow> => new Map())]);
    for (const c of batch) {
      const key = c.license!.trim().toUpperCase();
      const r = rows.find((x) => x.license.toUpperCase() === key) ?? null;
      checked += 1;
      if (!r) {
        await db.contractor.update({ where: { id: c.id }, data: { registerCheckedAt: now } }).catch(() => undefined);
        continue;
      }
      const today = localDayKey(now, c.organization.timezone || "America/New_York");
      const before = licenseKindOf(c.licenseStatus);
      const insurance = ins.get(key) ?? null;
      const hadInsurance = c.insuranceUntil ? c.insuranceUntil.toISOString().slice(0, 10) >= today : false;
      const lapsed = hadInsurance && !!insurance?.expires && insurance.expires < today;
      await keepRegister(c.organizationId, c.id, r, insurance, bond.get(key) ?? null);
      const line = standingChangeWords(c.name, before, r.kind, lapsed);
      if (line) {
        changed += 1;
        await logActivity({ organizationId: c.organizationId, actorId: null, kind: SUB_EVENT_KIND, summary: line, meta: { contractorId: c.id, href: "/dashboard/subcontractors" } });
        await textOffice(c.organizationId, "sub-quote", line).catch(() => undefined);
      }
    }
  }
  return { checked, changed };
}

// ── the JobFlex Network ──────────────────────────────────────────────────────

export async function networkSettings(organizationId: string): Promise<NetworkSettings> {
  const o = await db.organization.findUnique({ where: { id: organizationId }, select: { networkJson: true } });
  return networkSettingsOf(o?.networkJson);
}

export async function saveNetworkSettings(organizationId: string, actorId: string | null, input: NetworkSettings): Promise<NetworkSettings> {
  const current = await networkSettings(organizationId);
  const clean = networkSettingsOf(JSON.stringify({ ...input, since: input.on ? (current.since ?? new Date().toISOString()) : null }));
  await db.organization.update({ where: { id: organizationId }, data: { networkJson: JSON.stringify(clean) } });
  await logActivity({ organizationId, actorId, kind: TRAIL_KINDS.PROJECT, summary: clean.on ? `Listed the company on the JobFlex Network for ${clean.trades.join(", ") || "any trade"}${clean.serviceAreas ? ` in ${clean.serviceAreas}` : ""}` : "Took the company off the JobFlex Network", meta: { network: clean.on } });
  return clean;
}
