import "server-only";
// WASHINGTON'S CONTRACTOR REGISTER (2026-11-08, the subcontractors plan, part 3): L&I's open data on data.wa.gov —
// the general license file, the insurance file and the bond file — read through Socrata's SoQL endpoints. Free and
// public (Public Domain); SOCRATA_APP_TOKEN raises the rate limit when set. In development LNI_REGISTER_BASE points
// the calls at the stand's fake. The rules that read the rows are ./shared.

import { REGISTER_DATASETS, REGISTER_HOME, bondRowOf, insuranceRowOf, pickBond, pickInsurance, registerRowOf, type BondRow, type InsuranceRow, type RegisterRow } from "./shared";

const TIMEOUT_MS = 15_000;

function base(): string {
  const dev = process.env.NODE_ENV !== "production" ? process.env.LNI_REGISTER_BASE?.trim() : "";
  return (dev || REGISTER_HOME).replace(/\/$/, "");
}

/** A SoQL string literal. */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const list = (xs: readonly string[]) => xs.map(lit).join(", ");

async function soql(dataset: string, params: Record<string, string>): Promise<Array<Record<string, unknown>>> {
  const url = new URL(`${base()}/resource/${dataset}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { accept: "application/json" };
  const token = process.env.SOCRATA_APP_TOKEN?.trim();
  if (token) headers["X-App-Token"] = token;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) {
    const words = await res.text().catch(() => "");
    throw new Error(`The state register answered ${res.status}${words ? `: ${words.slice(0, 160)}` : ""}`);
  }
  const j = (await res.json().catch(() => null)) as unknown;
  return Array.isArray(j) ? (j as Array<Record<string, unknown>>) : [];
}

export type RegisterSearch = {
  /** The register's specialty names for the trade ([] = none: the name words decide). */
  specialties: readonly string[];
  /** Words in the business name that mark the trade, used when there is no specialty for it. */
  nameWords: readonly string[];
  city: string | null;
  zip: string | null;
  /** The office's own words, matched in the name. */
  words: string | null;
  /** Expired and suspended too (the default shows only the licensed). */
  includeLapsed?: boolean;
  limit?: number;
};

/** Contractors in the register near the address and in the trade: by city (else ZIP), by specialty (else a word in
 *  the name), active unless asked otherwise, up to `limit`. With neither a place nor words the search is refused —
 *  the register has 160,000 rows. */
export async function searchRegister(input: RegisterSearch): Promise<RegisterRow[]> {
  const where: string[] = [];
  if (!input.includeLapsed) where.push(`contractorlicensestatus in ('ACTIVE', 'RE-LICENSED')`);
  if (input.city) where.push(`upper(city) = ${lit(input.city.toUpperCase())}`);
  else if (input.zip) where.push(`zip = ${lit(input.zip)}`);
  if (input.specialties.length) where.push(`(specialtycode1desc in (${list(input.specialties)}) OR specialtycode2desc in (${list(input.specialties)}))`);
  else if (input.nameWords.length) where.push(`(${input.nameWords.map((w) => `upper(businessname) like ${lit(`%${w.toUpperCase()}%`)}`).join(" OR ")})`);
  if (input.words?.trim()) where.push(`upper(businessname) like ${lit(`%${input.words.trim().toUpperCase()}%`)}`);
  if (!input.city && !input.zip && !input.words?.trim()) throw new Error("Give the search an address or a name — the register lists every contractor in the state.");
  const rows = await soql(REGISTER_DATASETS.general, { $where: where.join(" AND "), $order: "businessname", $limit: String(Math.min(input.limit ?? 60, 200)) });
  return rows.map(registerRowOf).filter((r): r is RegisterRow => Boolean(r));
}

/** The rows for these license numbers (the nightly check, the verify button). */
export async function registerByLicenses(numbers: readonly string[]): Promise<RegisterRow[]> {
  const clean = [...new Set(numbers.map((n) => n.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  if (!clean.length) return [];
  const rows = await soql(REGISTER_DATASETS.general, { $where: `upper(contractorlicensenumber) in (${list(clean)})`, $limit: String(clean.length) });
  return rows.map(registerRowOf).filter((r): r is RegisterRow => Boolean(r));
}

/** The rows whose name carries these words, for a saved sub with no license number on file. */
export async function registerByName(name: string, city: string | null): Promise<RegisterRow[]> {
  const words = name.trim().toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(LLC|INC|CO|CORP|THE|AND)$/.test(w)).slice(0, 3);
  if (!words.length) return [];
  const where = [words.map((w) => `upper(businessname) like ${lit(`%${w}%`)}`).join(" AND ")];
  if (city) where.push(`upper(city) = ${lit(city.toUpperCase())}`);
  const rows = await soql(REGISTER_DATASETS.general, { $where: where.join(" AND "), $order: "licenseexpirationdate DESC", $limit: "10" });
  return rows.map(registerRowOf).filter((r): r is RegisterRow => Boolean(r));
}

/** The insurance on file per license, the live row with the latest expiry. */
export async function insuranceFor(numbers: readonly string[]): Promise<Map<string, InsuranceRow>> {
  const clean = [...new Set(numbers.map((n) => n.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  const out = new Map<string, InsuranceRow>();
  if (!clean.length) return out;
  const rows = (await soql(REGISTER_DATASETS.insurance, { $where: `upper(contractorlicensenumber) in (${list(clean)})`, $limit: "500" })).map(insuranceRowOf).filter((r): r is InsuranceRow => Boolean(r));
  for (const n of clean) {
    const pick = pickInsurance(rows.filter((r) => r.license.toUpperCase() === n));
    if (pick) out.set(n, pick);
  }
  return out;
}

/** The bond on file per license, the latest. */
export async function bondFor(numbers: readonly string[]): Promise<Map<string, BondRow>> {
  const clean = [...new Set(numbers.map((n) => n.trim().toUpperCase()).filter(Boolean))].slice(0, 100);
  const out = new Map<string, BondRow>();
  if (!clean.length) return out;
  const rows = (await soql(REGISTER_DATASETS.bond, { $where: `upper(contractorlicensenumber) in (${list(clean)})`, $limit: "500" })).map(bondRowOf).filter((r): r is BondRow => Boolean(r));
  for (const n of clean) {
    const pick = pickBond(rows.filter((r) => r.license.toUpperCase() === n));
    if (pick) out.set(n, pick);
  }
  return out;
}
