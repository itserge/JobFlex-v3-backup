import "server-only";
// HVAC BY VOICE (2026-11-05, the AI Operator's estimators batch): "price a new system for 14 Oak St, 2,000 square
// feet, two floors, built 1990" → the house (the county's record through the HVAC estimator's own lookup — lib/hvac/
// siteLookup — when the size wasn't said; what was said stands), the Manual J-style load and the catalog's fit
// (lib/hvac/engine, as the HVAC page runs it in the browser), Good · Better · Best priced as whole jobs on the
// company's rate card (lib/hvac/ledger tiersFor), the tier they asked for — Better unless they said — kept as an
// HVAC estimate row like the page's Save, then filed as a DRAFT (lib/hvac/proposalWrite) and offered for sending.
// The reply says all three prices; "make it the best one" is build_hvac again with that tier and `replaces`.
import { z } from "zod";
import { db } from "@/lib/db";
import type { WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { money } from "@/lib/assistant/shared";
import { archiveReplaced, buildCaps, landed, overPrior, priorBuild, replaceable, whoFor } from "@/lib/assistant/estimatorShared";
import { HVAC_JOB_WORDS, HVAC_JOBS, HVAC_TIER_ID, HVAC_TIERS } from "@/lib/assistant/estimatorWords";
import { isPageLocked } from "@/lib/customPageAccess";
import { checkPlanLimit } from "@/lib/limitsEngine";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap } from "@/lib/trialMeter";
import { logActivity, TRAIL_KINDS } from "@/lib/activityLog";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { geocodePlace } from "@/lib/maps";
import { censusGeocode } from "@/lib/hvac/publicGeo";
import { lookupSiteFacts } from "@/lib/hvac/siteLookup";
import { lookupPropertyBoundary } from "@/lib/fence/boundaryLookup";
import { applyStated, applyStatedNested, modelFromSite, type SiteFacts } from "@/lib/hvac/intake";
import { designConditionsFor } from "@/lib/hvac/designConditions";
import { runEngine } from "@/lib/hvac/engine";
import { buildLedger, STARTER_CATALOG, tiersFor, type LedgerLine } from "@/lib/hvac/ledger";
import type { JobInput } from "@/lib/hvac/jobs";
import { TIER_LABEL } from "@/lib/hvac/catalogView";
import { hvacBook } from "@/lib/webEstimatorTrades";
import { hvacConvertSchema, writeHvacProposal } from "@/lib/hvac/proposalWrite";
import { filingFromIds } from "@/lib/filingContext";

const ID = z.string().min(1).max(64);

type HvacArgs = {
  address: string | null;
  clientId: string | null;
  leadId: string | null;
  job: (typeof HVAC_JOBS)[number];
  sqft: number | null;
  storeys: number | null;
  yearBuilt: number | null;
  existing: "split-ac-furnace" | "split-heat-pump" | "furnace-only" | "none" | null;
  gas: boolean | null;
  outdoorKind: "air-conditioner" | "heat-pump" | null;
  tier: (typeof HVAC_TIERS)[number] | null;
  replaces: string | null;
};

const hvacArgs = z.object({
  address: z.string().max(200).nullable().describe("the house, with city and state; null = the client's or lead's address on file"),
  clientId: ID.nullable(),
  leadId: ID.nullable(),
  job: z.enum(HVAC_JOBS).describe("what they're pricing: replace-system = heating and cooling together (AC + furnace, or a heat pump); replace-outdoor = the condenser or heat pump only; replace-furnace; add-ac = cooling for a furnace-only house; heat-pump-conversion; ductless = a mini-split for one room or addition; water-heater"),
  sqft: z.number().min(100).max(20000).nullable().describe("the conditioned square feet when said (a ductless zone: the room's); null = looked up from the county's record of the house"),
  storeys: z.number().int().min(1).max(4).nullable().describe("floors, when said"),
  yearBuilt: z.number().int().min(1800).max(2030).nullable().describe("when said"),
  existing: z.enum(["split-ac-furnace", "split-heat-pump", "furnace-only", "none"]).nullable().describe("what is there now, when said"),
  gas: z.boolean().nullable().describe("gas at the house, when said; null = assumed yes"),
  outdoorKind: z.enum(["air-conditioner", "heat-pump"]).nullable().describe("an AC or a heat pump outside, when they say which; null = the engine's pick"),
  tier: z.enum(HVAC_TIERS).nullable().describe("which of Good / Better / Best goes on the proposal; null = Better"),
  replaces: ID.nullable().describe("the proposalId of an HVAC estimate built earlier that this one changes (another tier, another job), else null"),
});

async function hvacGate(actor: AssistantActor): Promise<string | null> {
  if (await isPageLocked(actor.organizationId, "hvac-estimator")) return "The HVAC estimator isn't in your plan yet (Settings → Billing). I can price it with Smart Proposal instead — say 'price it'.";
  return null;
}

/** The point and the county for the design day — Google when the server has a key, the Census Bureau's free
 *  geocoder otherwise. Never the parcel quota: that is spent only when the house's size has to be looked up. */
async function placeOf(address: string): Promise<{ lat?: number; lng?: number; county?: string; state?: string } | null> {
  try {
    const g = (await geocodePlace(address)) ?? (await censusGeocode(address));
    return g ? { lat: g.lat, lng: g.lng, county: g.county, state: g.state } : null;
  } catch {
    return null;
  }
}

const SIZE_ASK = "Tell me the square feet (and the floors) and I'll size it from that.";

const buildHvac: WriteTool<HvacArgs, HvacArgs & { address: string }> = {
  kind: "write",
  instant: "now",
  name: "build_hvac",
  need: "estimates.build",
  card: {
    "label": "HVAC estimate",
    "purpose": "Size an HVAC job from the house and price Good, Better and Best with the company's catalog and rate card, as a DRAFT.",
    "when": "HVAC from an ADDRESS: build_hvac with the job (a full system, the outdoor unit, a furnace, adding AC, a heat pump, a ductless zone, a water heater), the square feet, floors and year when said (it looks the house up otherwise), AC or heat pump when said, and the tier. 'The best one', 'make it good', '1, 2 or 3': build_hvac again with that tier and replaces = its proposalId.",
    "objects": [
      "estimate",
      "proposal",
      "property",
      "client",
      "lead"
    ],
    "effect": "draft",
    "group": "estimates",
    "version": 1,
    "since": "2026-11-05",
    "steps": [
      "House",
      "Load",
      "Priced",
      "Saved"
    ],
    "samples": [
      {
        "say": "price a new system for 14 Oak St, Tacoma WA, 2,000 square feet, two-story, built 1990",
        "args": {
          "address": "14 Oak St, Tacoma WA",
          "clientId": null,
          "leadId": null,
          "job": "replace-system",
          "sqft": 2000,
          "storeys": 2,
          "yearBuilt": 1990,
          "existing": null,
          "gas": null,
          "outdoorKind": null,
          "tier": null,
          "replaces": null
        }
      },
      {
        "say": "make it the best one",
        "args": {
          "address": null,
          "clientId": null,
          "leadId": null,
          "job": "replace-system",
          "sqft": null,
          "storeys": null,
          "yearBuilt": null,
          "existing": null,
          "gas": null,
          "outdoorKind": null,
          "tier": "best",
          "replaces": "p_1"
        }
      }
    ]
  },
  description:
    "Size and price an HVAC job at an address with the company's HVAC catalog and rate card: the load from the house (looked up from the county's record, or the square feet, floors and year they say), the unit that fits, Good / Better / Best priced as whole jobs, the tier they asked for saved as a DRAFT proposal (nothing goes to the client). Pass `replaces` to change one built earlier — another tier ('the best one'), another job.",
  params: hvacArgs,
  payload: hvacArgs.extend({ address: z.string() }),
  async plan({ actor }, said) {
    const gate = await hvacGate(actor);
    if (gate) return { ok: false, say: gate };
    const caps = await buildCaps(actor, ["hvacEstimates"]);
    if (caps) return { ok: false, say: caps };
    // "The best one" keeps the house and the job the earlier build was asked for, under what is said now.
    const a = overPrior(said.replaces ? await priorBuild<HvacArgs>(actor, said.replaces, "build_hvac") : null, said);
    const w = await whoFor(actor, a.clientId, a.leadId);
    if (!w.ok) return w;
    const address = a.address?.trim() || w.who.address;
    if (!address) return { ok: false, say: "Which house? Give me the address." };
    if (!stateFromAddress(address)) return { ok: false, say: `Which state is ${address} in? Add it to the address — the design temperatures go by it.` };
    if (a.replaces) {
      const miss = await replaceable(actor, a.replaces, "HVAC");
      if (miss) return { ok: false, say: miss };
    }
    const house = a.sqft ? ` — ${a.sqft.toLocaleString("en-US")} sq ft${a.storeys ? `, ${a.storeys} floor${a.storeys === 1 ? "" : "s"}` : ""}${a.yearBuilt ? `, built ${a.yearBuilt}` : ""}` : " from the county's record of the house";
    return {
      ok: true,
      payload: { ...a, address },
      readback: `On it — sizing ${HVAC_JOB_WORDS[a.job]} for ${address}${house}, and pricing Good, Better and Best with your HVAC book${w.who.name ? ` for ${w.who.name}` : ""}.`,
    };
  },
  async execute({ actor, report }, p) {
    const org = actor.organizationId;
    const state = (stateFromAddress(p.address) ?? "").toUpperCase();
    await report?.("House");
    let site: SiteFacts;
    if (p.sqft) {
      const g = await placeOf(p.address);
      site = { address: p.address, state: state || (g?.state ?? "").toUpperCase(), county: g?.county, lat: g?.lat, lng: g?.lng, livingSqft: Math.round(p.sqft), storeys: p.storeys ?? undefined, yearBuilt: p.yearBuilt ?? undefined, sources: {} };
    } else {
      await enforceRateLimit(`hvac-site:${org}`, 40, HOUR, "site lookups");
      const trial = await takeTrialCap(org, "hvacLookups", { dedupe: `hvac:${p.address.trim().toLowerCase().replace(/\s+/g, " ")}` });
      if (!trial.ok) throw new Error(trial.failure.error);
      const r = await lookupSiteFacts({ address: p.address, state }, org, {
        boundary: async (lat, lng) => {
          const b = await lookupPropertyBoundary(lat, lng);
          return b.ok ? { ok: true, buildings: b.buildings } : { ok: false, buildings: [], error: b.error };
        },
      });
      if (!r.ok) throw new Error(`${r.error} ${SIZE_ASK}`);
      site = r.facts;
      if (!site.livingSqft && !site.footprintSqft) throw new Error(`I couldn't find the house's size on record for ${p.address}. ${SIZE_ASK}`);
    }
    const model = modelFromSite(site);
    if (p.sqft) applyStated(model, "conditionedSqft", Math.round(p.sqft));
    if (p.storeys) applyStated(model, "storeys", p.storeys);
    if (p.yearBuilt) applyStated(model, "yearBuilt", p.yearBuilt);
    if (p.existing) applyStatedNested(model, "existing.kind", p.existing);
    if (p.gas != null) applyStatedNested(model, "gas.available", p.gas);
    await report?.("Load");
    const { conditions } = designConditionsFor(model.state, model.county, model.elevationFt ?? 0);
    const { card, catalog: all } = await hvacBook(org);
    // The shop's rows less those turned off; the US catalog when it has none; the starter ladder as the page's last resort.
    const live = all.filter((c) => !c.offList);
    const catalog = live.length ? live : STARTER_CATALOG;
    const input: JobInput = p.job === "ductless" ? { zoneSqft: Math.round(p.sqft ?? model.conditionedSqft), heads: 1 } : {};
    const run = (pick?: string) => runEngine(model, { conditions, catalog, job: p.job, input, outdoorKind: p.outdoorKind ?? undefined, pick });
    const engine = run();
    if (p.job !== "water-heater" && !engine.selection.chosen) throw new Error("Your HVAC catalog has no unit that fits this load. Add one on the HVAC catalog page, or load the US catalog there.");
    const tiers = tiersFor(engine, model, card, catalog, { job: p.job, input }, (id) => run(id));
    const want = HVAC_TIER_ID[p.tier ?? "better"];
    const tier = tiers.find((t) => t.tier === want) ?? tiers.find((t) => t.tier === "mid") ?? tiers[0] ?? null;
    const chosen = tier ? run(tier.candidate.item.id) : engine;
    const ledger = buildLedger(chosen, model, card, catalog, { job: p.job, input, pick: tier?.candidate.item.id });
    await report?.("Priced");
    // The estimate row, as the HVAC page saves before it converts — a new estimate on the plan's HVAC meter.
    const quota = await checkPlanLimit(org, "hvacEstimates", 1, { actorId: actor.userId });
    if (!quota.allowed) throw new Error("Your plan's HVAC estimate limit is reached for this cycle (Settings → Billing).");
    const perSystem = chosen.selection.chosen?.item.tons ?? chosen.selection.targetTons;
    const sizedTons = perSystem ? Math.round(perSystem * (chosen.selection.systems ?? 1) * 10) / 10 : null;
    const pick = tier?.candidate.item.id ?? chosen.selection.chosen?.item.id;
    const draft = { job: p.job, input, outdoorKind: p.outdoorKind ?? undefined, pick, title: ledger.title, scope: ledger.scope, materials: ledger.materials, labor: ledger.labor, assumptions: ledger.assumptions };
    const row = await db.hvacEstimate.create({
      data: {
        organizationId: org,
        createdById: actor.userId,
        address: p.address,
        state: model.state,
        county: model.county ?? null,
        siteFactsJson: JSON.stringify(site),
        modelJson: JSON.stringify(model),
        engineJson: JSON.stringify(chosen),
        draftJson: JSON.stringify(draft),
        subtotal: Math.round(ledger.subtotal * 100) / 100,
        sizedTons,
        jobKind: p.job,
      },
    });
    await logActivity({
      organizationId: org,
      actorId: actor.userId,
      kind: TRAIL_KINDS.ESTIMATE,
      summary: `Saved an HVAC estimate at ${p.address}${sizedTons ? ` — ${sizedTons} tons` : ""}, ${p.job.replace(/-/g, " ")}, $${Math.round(ledger.subtotal).toLocaleString("en-US")} (the AI Operator)`,
      meta: { estimateId: row.id, trade: "hvac", address: p.address, amount: ledger.subtotal, sizedTons, updated: false },
    }).catch(() => null);
    const line = (l: LedgerLine) => ({ id: l.id, name: l.name.slice(0, 200), quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
    const data = hvacConvertSchema.parse({ estimateId: row.id, address: p.address, title: ledger.title.slice(0, 200), scope: ledger.scope.slice(0, 6000), materials: ledger.materials.map(line), labor: ledger.labor.map(line), clientId: p.clientId });
    const filing = await filingFromIds(org, { clientId: p.clientId, leadId: p.leadId });
    const id = await writeHvacProposal({ organizationId: org, userId: actor.userId, role: actor.role }, data, filing);
    await report?.("Saved");
    const archived = p.replaces ? await archiveReplaced(actor, p.replaces) : false;
    const load = chosen.load;
    const house = `${Math.round(model.conditionedSqft).toLocaleString("en-US")} sq ft${model.storeys > 1 ? `, ${model.storeys} floors` : ""}${model.yearBuilt ? `, built ${model.yearBuilt}` : ""}`;
    const sizing = p.job === "water-heater" ? `for ${house}` : `${load.coolingTons.toFixed(1)} tons for ${house} (${Math.round(load.heatingBtuh).toLocaleString("en-US")} BTU/h heating, ${Math.round(load.coolingTotalBtuh).toLocaleString("en-US")} BTU/h cooling; design ${conditions.heatingF}° / ${conditions.coolingF}°, ${conditions.county || `${model.state} median`})`;
    const ladder = tiers.length > 1 ? tiers.map((t) => `${TIER_LABEL[t.tier]} ${money(Math.round(t.subtotal))}`).join(" · ") : "";
    const unit = tier ? `${tier.candidate.item.brand} ${tier.candidate.item.model}` : chosen.selection.chosen ? `${chosen.selection.chosen.item.brand} ${chosen.selection.chosen.item.model}` : null;
    const picked = unit ? `this one is ${tier ? TIER_LABEL[tier.tier] : "the engine's pick"}: ${unit}${tiers.length > 1 ? ' — say "make it the best one" or "the good one" to switch' : ""}` : "";
    return landed(actor, id, { facts: [sizing, ladder, picked].filter(Boolean).join(" · "), archived });
  },
};

export const HVAC_TOOLS = [buildHvac];
