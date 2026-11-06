"use server";

// HVAC estimator — the server side.
//
// What the server does here, and only this: it looks the site up (parcel,
// footprints, county, elevation, any roof measurement on file), it reads a
// nameplate photo with the vision model and hands the RULES module the text,
// it keeps the shop's catalog and rate card, it saves the estimate and it
// converts the priced draft into a proposal. The load, the selection and the
// checks run in src/lib/hvac — pure functions the browser runs too, so the
// design card updates as the contractor types without a round trip.
//
// DEPLOY NOTE: HvacEstimate / HvacCatalogItem / HvacSettings are new tables
// (2026-09-15). Until `prisma db push` has created them, every read below
// answers its default (starter catalog, default rate card, no history) and
// every write reports the failure instead of throwing — the RoofCatalog rule.
//
// Same gates as the other estimators: role, then the org's AI rate limit, then
// the plan's estimatorUses meter on the calls that spend a model run. New
// saved estimates (and an unsaved convert) are on the HVAC estimator's own
// hvacEstimates meter (2026-09-25).

import { z } from "zod";
import { requireEstimatorOrManager } from "@/lib/orgContext";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { db } from "@/lib/db";
import { clearFilingContext, readFilingContext } from "@/lib/filingContext";
import { checkPlanLimit, enforcePlanLimit } from "@/lib/limitsEngine";
import { PLAN_LIMIT_MESSAGE, type LimitKey } from "@/lib/planLimits";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { coolCalcConfig, coolCalcCreateProject, coolCalcCreateSystem, isCoolCalcEnabled, splitAddress } from "@/lib/hvac/coolcalc";
import { parseDirectoryCsv } from "@/lib/hvac/directory";
import { calibrationStats, type CalibrationStats } from "@/lib/hvac/calibration";
import { fetchPropertyBoundary } from "@/actions/fenceBoundary";
import { runVisionJson } from "@/lib/sdk/openaiVision";
import { isOpenAIEnabled } from "@/lib/sdk/openai";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import type { CatalogItem } from "@/lib/hvac/types";
import { catalogItemSchema } from "@/lib/hvac/catalogSchema";
import type { SiteFacts, NameplateRead } from "@/lib/hvac/intake";
import { lookupSiteFacts } from "@/lib/hvac/siteLookup";
import { DEFAULT_RATE_CARD, STARTER_CATALOG, normalizeRateCard, parseCatalogCsv, type HvacRateCard } from "@/lib/hvac/ledger";
import { JOBS, OUTDOOR_KINDS } from "@/lib/hvac/jobs";
import { US_CATALOG, US_CATALOG_VERIFIED_ON } from "@/lib/hvac/data/usCatalog";
import { notePaidCall, takeTrialCap } from "@/lib/trialMeter";
import { planEndedRefusal, takeHvacReportCap } from "@/lib/paidCaps";
import { requirePage } from "@/lib/customPageAccess";
import { hvacConvertSchema, hvacLineSchema, writeHvacProposal } from "@/lib/hvac/proposalWrite";

type Fail = { ok: false; error: string; code?: "PLAN_LIMIT_REACHED"; resource?: LimitKey };

const parseJson = <T,>(s: string | null | undefined): T | null => { if (!s) return null; try { return JSON.parse(s) as T; } catch { return null; } };

const missingTable = (err: unknown) => /does not exist|no such table|relation .* Hvac/i.test(err instanceof Error ? err.message : String(err));
/** Log the real error on the server; the browser gets a sentence without table or column names. */
const failed = (what: string, err: unknown): string => {
  console.error(`[hvacEstimator] ${what}:`, err instanceof Error ? err.message : err);
  return `Couldn't ${what} — try again in a moment; the details are in the server log.`;
};

/** A plan-limit failure for the first of these meters that is spent, or null. */
async function limitBlocked(organizationId: string, keys: LimitKey[]): Promise<Fail | null> {
  for (const key of keys) {
    const quota = await checkPlanLimit(organizationId, key);
    if (!quota.allowed) return { ok: false, error: PLAN_LIMIT_MESSAGE, code: "PLAN_LIMIT_REACHED", resource: quota.cappedBy ?? key };
  }
  return null;
}

/** A model run: the shared estimator gate. The nameplate read also serves the
 *  client's equipment panel, so the HVAC meter is checked where an estimate is
 *  made — save and convert here, and before each run on the estimator page. */
async function runBlocked(organizationId: string): Promise<Fail | null> {
  return limitBlocked(organizationId, ["estimatorUses"]);
}

// ── site facts ──────────────────────────────────────────────────────────────

const siteInput = z.object({
  address: z.string().min(3).max(300),
  state: z.string().max(2).optional(),
  county: z.string().max(80).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

/** Everything the server knows about a site before a question is asked. Never
 *  throws on a lookup: each fact is independent and the badges say which came. */
export async function hvacSiteFacts(raw: unknown): Promise<{ ok: true; facts: SiteFacts; warnings: string[] } | Fail> {
  let input: z.infer<typeof siteInput>;
  try {
    input = siteInput.parse(raw);
  } catch {
    return { ok: false, error: "Enter an address first." };
  }
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await requirePage(organizationId, "hvac-estimator");
    await enforceRateLimit(`hvac-site:${organizationId}`, 40, HOUR, "site lookups");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed" };
  }
  // The card-less trial's HVAC ceiling (lib/trialMeter): one use per address;
  // the lot outline asked below rides on it, not on a fence lookup.
  const trial = await takeTrialCap(organizationId, "hvacLookups", { dedupe: `hvac:${input.address.trim().toLowerCase().replace(/\s+/g, " ")}` });
  if (!trial.ok) return trial.failure;

  return lookupSiteFacts(input, organizationId, { boundary: fetchPropertyBoundary });
}

// ── nameplate reading ───────────────────────────────────────────────────────

const NAMEPLATE_SYSTEM = `You read HVAC equipment nameplates (rating plates) from a photo and return JSON only.
Return exactly this object; use null for anything not printed on the plate — never guess:
{"kind":"outdoor"|"furnace"|"air-handler"|"package"|"water-heater"|"other","brand":string|null,"model":string|null,"serial":string|null,"tons":number|null,"btuInput":number|null,"seer":number|null,"afue":number|null,"refrigerant":string|null,"yearMade":number|null,"voltage":string|null,"mcaAmps":number|null,"confidence":"high"|"medium"|"low","notes":string|null}
Rules: "model" and "serial" are copied character for character (letters, digits, dashes). "tons" only when the plate prints a BTU/h cooling rating or the word tons (36,000 BTU/h = 3 tons); "btuInput" is a furnace INPUT rating in BTU/h; "yearMade" only when a manufacture date is printed; "mcaAmps" is Minimum Circuit Ampacity. "confidence" is how legible the plate is. "notes" is one short sentence on what was hard to read.`;

const INLINE_IMG = /^data:image\/(jpe?g|png|webp);base64,[A-Za-z0-9+/=]+$/i;

/** One nameplate photo → the fields on it. The rules module then decodes the
 *  model number itself, so a misread capacity never goes unchecked. */
export async function readHvacNameplate(raw: unknown): Promise<{ ok: true; read: NameplateRead } | Fail> {
  const parsed = z.object({ dataUrl: z.string().max(2_500_000), hint: z.enum(["outdoor", "indoor", "panel", "other"]).default("other") }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid photo payload" };
  if (!INLINE_IMG.test(parsed.data.dataUrl)) return { ok: false, error: "That photo isn't a JPEG/PNG the browser rendered." };
  let organizationId: string;
  try {
    ({ organizationId } = await requireEstimatorOrManager());
    await enforceRateLimit(`ai:${organizationId}`, 60, HOUR, "AI runs");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed" };
  }
  const blocked = await runBlocked(organizationId);
  if (blocked) return blocked;
  // A paid vision read: closed once the plan has ended (lib/paidCaps).
  const ended = await planEndedRefusal(organizationId, "nameplate reading");
  if (ended) return ended;
  if (!isOpenAIEnabled()) return { ok: false, error: "Nameplate reading needs OPENAI_API_KEY — type the plate's model number instead." };
  // The card-less trial's AI ceiling (lib/trialMeter): one plate, one use.
  const trial = await takeTrialCap(organizationId, "aiCalls");
  if (!trial.ok) return trial.failure;

  const hintLine = parsed.data.hint === "outdoor" ? "This should be the OUTDOOR unit (condenser / heat pump) plate." : parsed.data.hint === "indoor" ? "This should be the INDOOR unit (furnace or air handler) plate." : parsed.data.hint === "panel" ? "This is an electrical panel: read the MAIN BREAKER amps into mcaAmps, set kind to \"other\" and put the count of free breaker slots in notes." : "";
  const out = await runVisionJson<Record<string, unknown>>({ systemPrompt: NAMEPLATE_SYSTEM, userPrompt: `Read this nameplate. ${hintLine}`.trim(), imageUrl: parsed.data.dataUrl });
  if (!out) return { ok: false, error: "The plate couldn't be read — try a closer, straight-on photo." };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const kindRaw = s(out.kind) ?? "other";
  const kind = (["outdoor", "furnace", "air-handler", "package", "water-heater", "other"] as const).find((k) => k === kindRaw) ?? "other";
  const conf = (["high", "medium", "low"] as const).find((c) => c === out.confidence) ?? "low";
  return {
    ok: true,
    read: { kind, brand: s(out.brand), model: s(out.model), serial: s(out.serial), tons: n(out.tons), btuInput: n(out.btuInput), seer: n(out.seer), afue: n(out.afue), refrigerant: s(out.refrigerant), yearMade: n(out.yearMade), voltage: s(out.voltage), mcaAmps: n(out.mcaAmps), confidence: conf, notes: s(out.notes) },
  };
}

// ── catalog ─────────────────────────────────────────────────────────────────

/** The org's catalog; with none (or the table not pushed yet), the built-in
 *  US list — real brands and model numbers, priced from the rate card until
 *  the shop imports its costs (2026-10-08, owner: "make sure you offer models
 *  and brands"; before this a shop with no rows saw a synthetic "Starter"
 *  ladder). The starter ladder remains only for a build whose US list is
 *  empty. `own` says whether the rows are the shop's; `source` which list. */
export async function listHvacCatalog(): Promise<{ items: CatalogItem[]; own: boolean; source: "shop" | "us" | "starter"; state: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  // The shop's state for the code check: the catalog page's pick (SyncState), else the one in the address.
  const state = await (async () => {
    const row = await db.syncState.findUnique({ where: { key: `hvacCatalogState:${organizationId}` } }).catch(() => null);
    if (row?.cursor && /^[A-Z]{2}$/.test(row.cursor)) return row.cursor;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { address: true } }).catch(() => null);
    return stateFromAddress(org?.address) ?? "";
  })();
  try {
    const rows = await db.hvacCatalogItem.findMany({ where: { organizationId }, orderBy: [{ kind: "asc" }, { brand: "asc" }, { model: "asc" }] });
    if (rows.length) return { items: rows.map((r) => JSON.parse(r.itemJson) as CatalogItem), own: true, source: "shop", state };
  } catch {
    /* table not pushed yet */
  }
  return US_CATALOG.length ? { items: US_CATALOG, own: false, source: "us", state } : { items: STARTER_CATALOG, own: false, source: "starter", state };
}

export async function importHvacCatalogCsv(raw: unknown): Promise<{ ok: true; imported: number; errors: string[]; note?: string } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const parsed = z.object({ csv: z.string().max(2_000_000), replace: z.boolean().default(false) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid import payload" };
  // The shop template has a `kind` column; an AHRI or NEEP export does not,
  // and is read by meaning instead.
  const firstLine = parsed.data.csv.split(/\r?\n/)[0] ?? "";
  const isShop = /(^|,)\s*"?kind"?\s*(,|$)/i.test(firstLine);
  const dir = isShop ? null : parseDirectoryCsv(parsed.data.csv);
  const { items, errors } = dir && dir.source ? { items: dir.items, errors: dir.errors } : parseCatalogCsv(parsed.data.csv);
  const note = dir && dir.source ? `Read as a ${dir.source.toUpperCase()} export · columns used: ${Object.values(dir.recognised).join(", ")}` : undefined;
  if (!items.length) return { ok: false, error: (dir && !dir.source ? dir.errors[0] : errors[0]) ?? "No rows to import." };
  try {
    // One transaction: a bad row halfway through leaves the catalog as it was,
    // instead of emptied by the Replace delete and half refilled.
    await db.$transaction([
      ...(parsed.data.replace ? [db.hvacCatalogItem.deleteMany({ where: { organizationId } })] : []),
      ...items.map((item) => db.hvacCatalogItem.upsert({
        where: { organizationId_itemId: { organizationId, itemId: item.id } },
        create: { organizationId, itemId: item.id, kind: item.kind, brand: item.brand, model: item.model, itemJson: JSON.stringify(item) },
        update: { kind: item.kind, brand: item.brand, model: item.model, itemJson: JSON.stringify(item) },
      })),
    ]);
    return { ok: true, imported: items.length, errors, note };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The catalog table isn't in this database yet — run `prisma db push`, then import again." : failed("import the catalog", err) };
  }
}

/** Load the built-in US catalog (the popular families, expanded to their
 *  size ladders) into the org's catalog — the starting pick list a shop
 *  edits from. Rows keep source "manufacturer" and the verified-on date. */
export async function loadUsCatalog(raw: unknown): Promise<{ ok: true; imported: number; verifiedOn: string } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const parsed = z.object({ replace: z.boolean().default(false) }).safeParse(raw ?? {});
  const replace = parsed.success ? parsed.data.replace : false;
  if (!US_CATALOG.length) return { ok: false, error: "The built-in catalog is empty in this build." };
  try {
    // Two statements, not 475 upserts: drop the rows this load owns (or all of
    // them on replace), then write the set in one insert.
    await db.$transaction([
      db.hvacCatalogItem.deleteMany({ where: replace ? { organizationId } : { organizationId, itemId: { in: US_CATALOG.map((i) => i.id) } } }),
      db.hvacCatalogItem.createMany({ data: US_CATALOG.map((item) => ({ organizationId, itemId: item.id, kind: item.kind, brand: item.brand, model: item.model, itemJson: JSON.stringify(item) })) }),
    ]);
    return { ok: true, imported: US_CATALOG.length, verifiedOn: US_CATALOG_VERIFIED_ON };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The catalog table isn't in this database yet — run `prisma db push`, then load again." : failed("load the US catalog", err) };
  }
}

/** Add one unit to the shop's catalog — the row a contractor typed on an
 *  estimate because the catalog had nothing like it. */
export async function saveHvacCatalogItem(raw: unknown): Promise<{ ok: true; item: CatalogItem } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const parsed = customItemSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "That unit is missing something the catalog needs — brand, model and kind at least." };
  const item: CatalogItem = { ...parsed.data, typed: undefined, source: "shop" };
  try {
    await db.hvacCatalogItem.upsert({
      where: { organizationId_itemId: { organizationId, itemId: item.id } },
      create: { organizationId, itemId: item.id, kind: item.kind, brand: item.brand, model: item.model, itemJson: JSON.stringify(item) },
      update: { kind: item.kind, brand: item.brand, model: item.model, itemJson: JSON.stringify(item) },
    });
    return { ok: true, item };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The catalog table isn't in this database yet — run `prisma db push`, then save again." : failed("save", err) };
  }
}

export async function clearHvacCatalog(): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  try {
    await db.hvacCatalogItem.deleteMany({ where: { organizationId } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The catalog table isn't in this database yet." : "Couldn't clear the catalog." };
  }
}

// ── rate card ───────────────────────────────────────────────────────────────

/** Anything the browser sends is normalised into a v2 card (a v1 card's
 *  hours × crew rate become per-task amounts); the check is that every figure
 *  is a finite non-negative number, which normalizeRateCard guarantees. */
const rateCardSchema = z.object({}).passthrough().transform((raw) => normalizeRateCard(raw));

export async function getHvacRateCard(): Promise<{ card: HvacRateCard; own: boolean }> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  try {
    const row = await db.hvacSettings.findUnique({ where: { organizationId } });
    if (row) return { card: normalizeRateCard(JSON.parse(row.rateCardJson)), own: true };
  } catch {
    /* table not pushed yet, or a row that no longer validates */
  }
  return { card: DEFAULT_RATE_CARD, own: false };
}

/** Save one of the shop's own service tasks onto its rate card, so it is on
 *  the menu next time. Same title → the row is replaced. */
export async function saveHvacServiceTask(raw: unknown): Promise<{ ok: true; card: HvacRateCard; id: string } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const parsed = z.object({
    title: z.string().min(2).max(120),
    includes: z.string().max(240).optional(),
    laborUsd: z.number().min(0).max(50_000),
    partName: z.string().max(120).optional(),
    partCost: z.number().min(0).max(50_000).optional(),
    brands: z.array(z.string().max(40)).max(6).optional(),
  }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "A task needs a name and a labor price." };
  const d = parsed.data;
  const id = `custom-${d.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`.slice(0, 80);
  try {
    const row = await db.hvacSettings.findUnique({ where: { organizationId } });
    const card = normalizeRateCard(row ? JSON.parse(row.rateCardJson) : DEFAULT_RATE_CARD);
    const task = { id, group: "custom" as const, title: d.title, includes: d.includes ?? "", laborUsd: d.laborUsd, part: d.partName ? { name: d.partName, costUsd: d.partCost ?? 0, brands: d.brands } : undefined, custom: true as const };
    card.serviceMenu = [...(card.serviceMenu ?? []).filter((t) => t.id !== id), task];
    const rateCardJson = JSON.stringify(card);
    await db.hvacSettings.upsert({ where: { organizationId }, create: { organizationId, rateCardJson }, update: { rateCardJson } });
    return { ok: true, card, id };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The settings table isn't in this database yet — run `prisma db push`, then save again." : failed("save", err) };
  }
}

export async function saveHvacRateCard(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  const parsed = rateCardSchema.safeParse(raw && typeof raw === "object" ? raw : {});
  if (!parsed.success) return { ok: false, error: "The rate card didn't validate." };
  const rateCardJson = JSON.stringify(parsed.data);
  try {
    await db.hvacSettings.upsert({ where: { organizationId }, create: { organizationId, rateCardJson }, update: { rateCardJson } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The settings table isn't in this database yet — run `prisma db push`, then save again. Your card stays in this browser meanwhile." : failed("save", err) };
  }
}

// ── the estimate ────────────────────────────────────────────────────────────

const lineSchema = hvacLineSchema;
const jobInputSchema = z.object({
  zoneSqft: z.number().min(0).max(20000).optional(),
  heads: z.number().int().min(1).max(8).optional(),
  designCoolingF: z.number().min(60).max(125).optional(),
  designHeatingF: z.number().min(-60).max(70).optional(),
  wh: z.object({ existingFuel: z.enum(["gas", "electric", "propane"]).optional(), fuel: z.enum(["gas", "electric", "propane"]).optional(), type: z.enum(["tank", "heat-pump", "tankless"]).optional(), gallons: z.number().min(0).max(200).optional(), vent: z.enum(["atmospheric", "power", "direct", "none"]).optional(), location: z.enum(["garage", "closet", "basement", "utility", "attic", "outdoor"]).optional() }).optional(),
  supplyRegisters: z.number().int().min(0).max(60).optional(),
  service: z.object({
    tasks: z.array(z.string().max(80)).max(40).optional(),
    refrigerantLb: z.number().min(0).max(50).optional(),
    custom: z.array(z.object({ name: z.string().max(120), laborUsd: z.number().min(0).max(50_000), partName: z.string().max(120).optional(), partCost: z.number().min(0).max(50_000).optional() })).max(20).optional(),
    parts: z.array(z.object({ name: z.string().max(120), cost: z.number().min(0).max(50000) })).max(20).optional(),
    task: z.string().max(200).optional(),
  }).optional(),
}).optional();
const jobKindSchema = z.enum(JOBS.map((j) => j.id) as [string, ...string[]]).optional();

/** A unit the contractor typed in for one estimate (or saves to the catalog): the shared schema (lib/hvac/catalogSchema). */
const customItemSchema = catalogItemSchema;

const draftSchema = z.object({
  job: jobKindSchema,
  input: jobInputSchema,
  outdoorKind: z.enum(OUTDOOR_KINDS).optional(),
  /** The measured line-set run, so a reopened estimate prices the same feet. */
  linesetFt: z.number().min(0).max(500).optional(),
  /** The unit the contractor chose by hand, and one they typed in. */
  pick: z.string().max(120).optional(),
  custom: customItemSchema.optional(),
  title: z.string().max(200),
  scope: z.string().max(6000),
  materials: z.array(lineSchema).max(80),
  labor: z.array(lineSchema).max(80),
  assumptions: z.array(z.string().max(500)).max(40),
});
const saveSchema = z.object({
  id: z.string().optional(),
  address: z.string().min(3).max(300),
  siteFacts: z.unknown(),
  model: z.unknown(),
  engine: z.unknown(),
  draft: draftSchema,
});

export interface HvacActual {
  tons?: number;
  price?: number;
  model?: string;
  notes?: string;
  recordedAt?: string;
}
export interface HvacPermit {
  provider: "coolcalc";
  projectId: string;
  systemId: string;
  projectUrl: string;
  reportUrl: string;
  requestedAt: string;
  attachedAt?: string;
}
export interface HvacEstimateSummary {
  id: string;
  address: string;
  status: string;
  subtotal: number;
  createdAt: string;
  title: string;
  sizedTons: number | null;
  jobKind: string | null;
  actual: HvacActual | null;
  permit: "none" | "requested" | "attached";
  approvedReportUrl: string | null;
}

export async function saveHvacEstimate(raw: unknown): Promise<{ ok: true; id: string } | Fail> {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid estimate payload" };
  let organizationId: string;
  let userId: string;
  try {
    const ctx = await requireEstimatorOrManager();
    await requirePage(ctx.organizationId, "hvac-estimator");
    organizationId = ctx.organizationId;
    userId = ctx.user.id;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Not allowed" };
  }
  const d = parsed.data;
  const model = (d.model ?? {}) as { state?: string; county?: string };
  const subtotal = [...d.draft.materials, ...d.draft.labor].reduce((a, l) => a + l.quantity * l.unitPrice, 0);
  const eng = (d.engine ?? {}) as { selection?: { systems?: number; targetTons?: number; chosen?: { item?: { tons?: number } } | null } };
  const perSystem = eng.selection?.chosen?.item?.tons ?? eng.selection?.targetTons;
  const sizedTons = perSystem ? Math.round(perSystem * (eng.selection?.systems ?? 1) * 10) / 10 : null;
  const data = {
    organizationId,
    createdById: userId,
    address: d.address,
    state: typeof model.state === "string" ? model.state : null,
    county: typeof model.county === "string" ? model.county : null,
    siteFactsJson: JSON.stringify(d.siteFacts ?? {}),
    modelJson: JSON.stringify(d.model ?? {}),
    engineJson: JSON.stringify(d.engine ?? {}),
    draftJson: JSON.stringify(d.draft),
    subtotal: Math.round(subtotal * 100) / 100,
    sizedTons,
    jobKind: d.draft.job ?? null,
  };
  try {
    const trail = (id: string, updated: boolean) =>
      logActivity({
        organizationId,
        actorId: userId,
        kind: TRAIL_KINDS.ESTIMATE,
        summary: `${updated ? "Updated" : "Saved"} an HVAC estimate at ${d.address}${sizedTons ? ` — ${sizedTons} tons` : ""}${d.draft.job ? `, ${String(d.draft.job).replace(/_/g, " ").toLowerCase()}` : ""}, $${Math.round(data.subtotal).toLocaleString("en-US")}`,
        meta: { estimateId: id, trade: "hvac", address: d.address, amount: data.subtotal, sizedTons, updated },
      });
    if (d.id) {
      const own = await db.hvacEstimate.findFirst({ where: { id: d.id, organizationId }, select: { id: true } });
      if (own) {
        await db.hvacEstimate.update({ where: { id: own.id }, data });
        await trail(own.id, true);
        return { ok: true, id: own.id };
      }
    }
    // A NEW estimate is what the plan's HVAC meter counts; re-saving one is free.
    const blocked = await limitBlocked(organizationId, ["hvacEstimates"]);
    if (blocked) return blocked;
    const row = await db.hvacEstimate.create({ data });
    await trail(row.id, false);
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The HVAC tables aren't in this database yet — run `prisma db push` to keep estimates." : failed("save", err) };
  }
}

export async function listHvacEstimates(): Promise<HvacEstimateSummary[]> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  try {
    const rows = await db.hvacEstimate.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, address: true, status: true, subtotal: true, createdAt: true, draftJson: true, sizedTons: true, jobKind: true, actualJson: true, permitJson: true, approvedReportUrl: true } });
    return rows.map((r) => {
      const title = String(parseJson<{ title?: string }>(r.draftJson)?.title ?? "");
      const permit = parseJson<HvacPermit>(r.permitJson);
      return { id: r.id, address: r.address, status: r.status, subtotal: r.subtotal, createdAt: r.createdAt.toISOString(), title, sizedTons: r.sizedTons, jobKind: r.jobKind, actual: parseJson<HvacActual>(r.actualJson), permit: r.approvedReportUrl ? "attached" : permit ? "requested" : "none", approvedReportUrl: r.approvedReportUrl };
    });
  } catch {
    return [];
  }
}

/** The calibration loop over every saved estimate with an actual. */
export async function hvacCalibration(): Promise<CalibrationStats> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  try {
    const rows = await db.hvacEstimate.findMany({ where: { organizationId, actualJson: { not: null } }, select: { sizedTons: true, subtotal: true, actualJson: true } });
    return calibrationStats(rows.map((r) => { const a = parseJson<HvacActual>(r.actualJson); return { sizedTons: r.sizedTons, subtotal: r.subtotal, actualTons: a?.tons ?? null, actualPrice: a?.price ?? null }; }));
  } catch {
    return calibrationStats([]);
  }
}

const actualSchema = z.object({ tons: z.number().min(0.5).max(40).optional(), price: z.number().min(0).max(10_000_000).optional(), model: z.string().max(120).optional(), notes: z.string().max(1000).optional() });

/** Record what was actually quoted or installed for a saved estimate. */
export async function recordHvacActual(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = z.object({ estimateId: z.string(), actual: actualSchema }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid actuals" };
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  const a = parsed.data.actual;
  if (a.tons === undefined && a.price === undefined) return { ok: false, error: "Enter the tons or the price." };
  try {
    const n = await db.hvacEstimate.updateMany({ where: { id: parsed.data.estimateId, organizationId }, data: { actualJson: JSON.stringify({ ...a, recordedAt: new Date().toISOString() }) } });
    return n.count ? { ok: true } : { ok: false, error: "That estimate isn't here any more." };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The HVAC tables aren't in this database yet." : failed("record the actuals", err) };
  }
}

// ── permit-grade report (Cool Calc) ─────────────────────────────────────────

export async function hvacPermitStatus(): Promise<{ enabled: boolean }> {
  await requirePage((await requireEstimatorOrManager()).organizationId, "hvac-estimator");
  return { enabled: isCoolCalcEnabled() };
}

/** Create the Cool Calc project and system for a saved estimate (once), so
 *  the contractor finishes the envelope in Cool Calc and the report can be
 *  pulled back. Idempotent: a second call answers the existing ids. */
export async function requestHvacPermitReport(raw: unknown): Promise<{ ok: true; permit: HvacPermit; appUrl: string } | Fail> {
  const parsed = z.object({ estimateId: z.string() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Save the estimate first." };
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  const cfg = coolCalcConfig();
  if (!cfg) return { ok: false, error: "Cool Calc isn't connected — set COOLCALC_CLIENT_ID, COOLCALC_API_KEY and COOLCALC_DEALER_ID on the server." };
  let row: { id: string; address: string; state: string | null; county: string | null; draftJson: string; permitJson: string | null; engineJson: string } | null;
  try {
    row = await db.hvacEstimate.findFirst({ where: { id: parsed.data.estimateId, organizationId }, select: { id: true, address: true, state: true, county: true, draftJson: true, permitJson: true, engineJson: true } });
  } catch {
    return { ok: false, error: "The HVAC tables aren't in this database yet." };
  }
  if (!row) return { ok: false, error: "That estimate isn't here any more." };
  const existing = parseJson<HvacPermit>(row.permitJson);
  const { COOLCALC_APP_URL } = await import("@/lib/hvac/coolcalc");
  if (existing?.projectId && existing.systemId) return { ok: true, permit: existing, appUrl: COOLCALC_APP_URL };
  // THE CEILINGS (lib/paidCaps, 2026-10-12): a new report is a paid credit —
  // 20 an hour and 30 a day per company; the answer above (a report already
  // made) is free and never counted. A refusal is said, not thrown.
  // THE PLAN'S MONTH first (owner, 2026-10-26 — audit §1): a new report is one
  // of the plan's manualJReports; the plan dialog says so.
  const spent = await limitBlocked(organizationId, ["manualJReports"]);
  if (spent) return spent;
  const cap = await takeHvacReportCap(organizationId);
  if (!cap.ok) return cap;
  // A new system is a Cool Calc report credit: the card-less trial's own
  // ceiling (lib/trialMeter) — none without a card.
  const trial = await takeTrialCap(organizationId, "hvacReports");
  if (!trial.ok) return trial.failure;
  const title = String(parseJson<{ title?: string }>(row.draftJson)?.title ?? row.address);
  // The saved state stands in when the typed address does not spell one.
  const parts = { ...splitAddress(row.address) };
  if (!parts.state && row.state) parts.state = row.state.toUpperCase();
  try {
    const project = await coolCalcCreateProject(cfg, { project: `${title} · JobFlex ${row.id.slice(-6)}`, address: parts.address, city: parts.city, state: parts.state, zip: parts.zip });
    const systems = Number(parseJson<{ selection?: { systems?: number } }>(row.engineJson)?.selection?.systems ?? 1);
    const system = await coolCalcCreateSystem(cfg, project, systems > 1 ? `System 1 of ${systems}` : "System 1");
    await notePaidCall("coolcalc", "report");
    const permit: HvacPermit = { provider: "coolcalc", projectId: project.projectId, systemId: system.systemId, projectUrl: project.projectUrl, reportUrl: system.reportUrl, requestedAt: new Date().toISOString() };
    await db.hvacEstimate.update({ where: { id: row.id }, data: { permitJson: JSON.stringify(permit) } });
    return { ok: true, permit, appUrl: COOLCALC_APP_URL };
  } catch (err) {
    await trial.refund();
    return { ok: false, error: failed("reach Cool Calc", err) };
  }
}

/** Attach the approved report: Cool Calc's own (served through
 *  /api/hvac/permit-report/[id] with the server's credentials) or a link the
 *  contractor pastes. */
export async function attachHvacPermitReport(raw: unknown): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const parsed = z.object({ estimateId: z.string(), url: z.string().max(1000).optional() }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid request" };
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  let url = parsed.data.url?.trim() ?? "";
  if (url && !/^https:\/\//i.test(url)) return { ok: false, error: "The report link must start with https://" };
  try {
    const row = await db.hvacEstimate.findFirst({ where: { id: parsed.data.estimateId, organizationId }, select: { id: true, permitJson: true } });
    if (!row) return { ok: false, error: "That estimate isn't here any more." };
    const permit = parseJson<HvacPermit>(row.permitJson);
    if (!url) {
      if (!permit) return { ok: false, error: "Request the Cool Calc report first, or paste a report link." };
      url = `/api/hvac/permit-report/${row.id}`;
    }
    await db.hvacEstimate.update({ where: { id: row.id }, data: { approvedReportUrl: url, permitJson: permit ? JSON.stringify({ ...permit, attachedAt: new Date().toISOString() }) : row.permitJson } });
    return { ok: true, url };
  } catch (err) {
    return { ok: false, error: missingTable(err) ? "The HVAC tables aren't in this database yet." : failed("attach the report", err) };
  }
}

export async function getHvacEstimate(id: string): Promise<{ ok: true; row: { id: string; address: string; status: string; siteFacts: unknown; model: unknown; engine: unknown; draft: z.infer<typeof draftSchema>; proposalId: string | null; approvedReportUrl: string | null; permit: HvacPermit | null; actual: HvacActual | null } } | { ok: false; error: string }> {
  const { organizationId } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  try {
    const r = await db.hvacEstimate.findFirst({ where: { id, organizationId } });
    if (!r) return { ok: false, error: "That estimate isn't here any more." };
    const draft = draftSchema.safeParse(JSON.parse(r.draftJson));
    if (!draft.success) return { ok: false, error: "That estimate's draft no longer validates." };
    return { ok: true, row: { id: r.id, address: r.address, status: r.status, siteFacts: JSON.parse(r.siteFactsJson), model: JSON.parse(r.modelJson), engine: JSON.parse(r.engineJson), draft: draft.data, proposalId: r.proposalId, approvedReportUrl: r.approvedReportUrl, permit: parseJson<HvacPermit>(r.permitJson), actual: parseJson<HvacActual>(r.actualJson) } };
  } catch {
    return { ok: false, error: "The HVAC tables aren't in this database yet." };
  }
}

// ── convert ─────────────────────────────────────────────────────────────────


// The schema and the proposal itself live in lib/hvac/proposalWrite (2026-11-05), shared with the AI Operator.
export async function convertHvacEstimateToProposal(raw: unknown): Promise<{ id: string }> {
  const { organizationId, user, role } = await requireEstimatorOrManager();
  await requirePage(organizationId, "hvac-estimator");
  await enforcePlanLimit(organizationId, "proposalsCreated");
  const data = hvacConvertSchema.parse(raw);
  // Converted without a saved estimate, this is a new HVAC estimate all the
  // same — the plan's HVAC meter applies (the client saves first, so this is
  // the backstop).
  if (!data.estimateId) await enforcePlanLimit(organizationId, "hvacEstimates");
  // Started from a project, a client's page or a lead, the picker recorded where this estimate files (lib/filingContext).
  const filing = await readFilingContext(organizationId);
  const id = await writeHvacProposal({ organizationId, userId: user.id, role }, data, filing);
  if (filing) await clearFilingContext();
  return { id };
}
