import "server-only";
// A FENCE BY VOICE (2026-11-05, the AI Operator's estimators batch): "here's the
// address" → the lot, the house and the street from the fence estimator's own
// lookups (lib/fence/boundaryLookup, lib/parcels); "across the backyard 20 feet
// from the house, tied to the property lines, a gate on the right" → the fence
// laid out in feet (lib/fence/voiceLayout), priced with the company's fence
// catalog (lib/fence/pricing — installed rates, the profit inside, as the fence
// page prices), filed as a DRAFT proposal with its plan for the client's page
// and the Operator's sheet (lib/fence/proposalWrite), then offered for sending.
// The site is kept for an hour under the person (lib/assistant/estimatorShared, with the rest the estimators
// share), so the layout can follow the address in a later sentence. Left and right are as you face the house from
// the street; the Operator says which side it took for the front.
import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { andList } from "@/lib/assistant/shared";
import { archiveReplaced, buildCaps, landed, rememberSite, rememberedSite, replaceable, whoFor } from "@/lib/assistant/estimatorShared";
import { isPageLocked } from "@/lib/customPageAccess";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap, trialPointKey } from "@/lib/trialMeter";
import { geocode } from "@/lib/maps";
import { lookupPropertyBoundary, type LatLngPoint } from "@/lib/fence/boundaryLookup";
import { detectFrontSides, type ParcelSide, type RingPoint } from "@/lib/parcels";
import { layoutFence, orient, pickHouse, siteWords, type FenceSite, type FenceSpec, type Pt } from "@/lib/fence/voiceLayout";
import { priceFencePackage, fenceScope, packageNotes, type CustomFenceType } from "@/lib/fence/pricing";
import { fenceCatalogSchema } from "@/lib/fence/catalogSchema";
import { sanitizeRateBook } from "@/lib/fence/rates";
import { resolveMarket } from "@/lib/fence/market";
import { typedRuns } from "@/lib/fence/layout";
import { fenceConvertSchema } from "@/lib/fence/convertSchema";
import { writeFenceProposal } from "@/lib/fence/proposalWrite";
import { filingFromIds } from "@/lib/filingContext";
import { saidHouseAddress } from "@/lib/assistant/address";

const ID = z.string().min(1).max(64);

// ── the site ────────────────────────────────────────────────────────────────

const FT_PER_M = 3.28084;
const EARTH_R_M = 6_371_000;
const D2R = Math.PI / 180;
function localFeet(origin: LatLngPoint, p: LatLngPoint): Pt {
  const east = (p.lng - origin.lng) * D2R * Math.cos(origin.lat * D2R) * EARTH_R_M;
  const north = (p.lat - origin.lat) * D2R * EARTH_R_M;
  return { x: east * FT_PER_M, y: north * FT_PER_M };
}

async function fenceGate(actor: AssistantActor): Promise<string | null> {
  if (await isPageLocked(actor.organizationId, "fence-estimator")) return "The fence estimator isn't in your plan yet (Settings → Billing). I can price it with Smart Proposal instead — say 'price it'.";
  return null;
}

/** The lot, the house and the street at an address, oriented — the fence estimator's lookups, under its limits. */
export async function lookupSite(actor: AssistantActor, address: string): Promise<{ ok: true; site: FenceSite } | { ok: false; say: string }> {
  const org = actor.organizationId;
  const spot = await geocode(address).catch(() => null);
  if (!spot) return { ok: false, say: `I couldn't place "${address}" on the map. Check the address, or tell me the lengths instead.` };
  await enforceRateLimit(`parcels:${org}`, 30, HOUR, "property lookups");
  const trial = await takeTrialCap(org, "fenceLookups", { dedupe: trialPointKey(spot.lat, spot.lng), coveredBy: ["hvacLookups", "roofMeasurements"] });
  if (!trial.ok) return { ok: false, say: trial.failure.error };
  const r = await lookupPropertyBoundary(spot.lat, spot.lng);
  if (!r.ok) return { ok: false, say: `${r.error.replace(/Drop the pin inside the lot, or draw the fence manually\./, "").trim()} Tell me the lengths and I'll price it that way.` };
  const origin = { lat: spot.lat, lng: spot.lng };
  const lot = r.ring.map((p) => localFeet(origin, p));
  const buildings = r.buildings.map((b) => b.ring.map((p) => localFeet(origin, p)));
  const house = pickHouse(buildings, { x: 0, y: 0 });
  const neighbors = buildings.filter((b) => b !== house);
  // The front: the lot side nearest a street (lib/parcels), as the fence page decides it.
  const ring: RingPoint[] = r.ring.map((p) => [p.lat, p.lng]);
  const sides: ParcelSide[] = ring.map((from, i) => {
    const to = ring[(i + 1) % ring.length];
    const a = localFeet(origin, { lat: from[0], lng: from[1] });
    const b = localFeet(origin, { lat: to[0], lng: to[1] });
    const feet = Math.hypot(a.x - b.x, a.y - b.y);
    const bearing = ((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI + 360) % 360;
    return { start: i, span: 1, from, to, feet, boundaryFeet: feet, bearing, short: feet < 12 };
  });
  const fronts = detectFrontSides(sides, r.roads);
  const front = fronts[0] ? sides[fronts[0].index] : null;
  const axes = orient(lot, front ? { a: localFeet(origin, { lat: front.from[0], lng: front.from[1] }), b: localFeet(origin, { lat: front.to[0], lng: front.to[1] }) } : null);
  return { ok: true, site: { address, origin, lot, house, neighbors, right: axes.right, back: axes.back, street: fronts[0]?.streetName ?? null, frontKnown: Boolean(front) } };
}

const fenceSite: ReadTool<{ address: string }> = {
  kind: "read",
  name: "fence_site",
  need: "estimates.build",
  card: {
    "label": "Fence site",
    "purpose": "The lot lines, the house and the street side at an address, for a fence.",
    "when": "An address for a fence: fence_site first; say back the lot and house sizes and the street side, then ask where the fence goes.",
    "objects": [
      "property"
    ],
    "effect": "read",
    "group": "estimates",
    "version": 1,
    "since": "2026-11-05",
    "deps": [
      "maps"
    ],
    "samples": [
      {
        "say": "here's the address: 14 Oak St, Tacoma WA",
        "args": {
          "address": "14 Oak St, Tacoma WA"
        }
      }
    ]
  },
  description:
    "Look up a property for a fence: the lot lines, the house and which side faces the street, from the address. Say back the lot and house sizes and the street side, then ask where the fence goes. Use before build_fence when the person gives an address; the site is remembered for an hour.",
  params: z.object({ address: z.string().min(6).max(200).describe("the full street address, with city and state") }),
  async run({ actor }, a) {
    const gate = await fenceGate(actor);
    if (gate) return { notAllowed: gate };
    const place = saidHouseAddress(a.address);
    if (place.ask || !place.address) return { notDone: place.ask ?? "Which property? Give me the address." };
    const r = await lookupSite(actor, place.address);
    if (!r.ok) return { notDone: r.say };
    await rememberSite(actor, "fence", r.site);
    const w = siteWords(r.site);
    return {
      address: r.site.address,
      lot: w.lot,
      house: w.house ?? "no house outline on file here",
      backyardDepthFt: w.backyardFt,
      street: r.site.frontKnown ? `the front faces ${r.site.street ? r.site.street : "the street"}; left and right are as you face the house from it` : "I couldn't tell which side faces the street, so I'm taking south as the front — say 'the street is on the north/east/west side' to change it",
      next: "Ask where the fence goes: how far behind the house, whether the sides follow the lot lines, which side the gate is on, the height and the type.",
    };
  },
};

// ── the fence ───────────────────────────────────────────────────────────────

const TYPE_WORDS: Array<[RegExp, string]> = [
  [/board.?on.?board/i, "board-on-board"],
  [/shadow.?box/i, "shadowbox"],
  [/horizontal|modern/i, "horizontal-modern"],
  [/vinyl.*picket|picket.*vinyl/i, "vinyl-picket"],
  [/vinyl|pvc/i, "vinyl-privacy"],
  [/composite|trex/i, "composite-privacy"],
  [/black.*chain|chain.*black/i, "chain-link-black"],
  [/chain/i, "chain-link-galv"],
  [/aluminum|aluminium/i, "aluminum-ornamental"],
  [/steel|wrought|iron/i, "steel-ornamental"],
  [/split.?rail/i, "split-rail-2"],
  [/ranch|3.?rail|three.?rail/i, "ranch-rail-3"],
  [/picket/i, "wood-picket"],
  [/pressure|treated|pine|\bpt\b/i, "pt-pine-privacy"],
  [/cedar|privacy|wood/i, "cedar-privacy"],
];

function typeIdFor(words: string | null, customs: Array<{ id: string; label: string }>): string {
  const w = (words ?? "").trim();
  if (!w) return "cedar-privacy";
  const custom = customs.find((c) => c.label.toLowerCase() === w.toLowerCase() || w.toLowerCase().includes(c.label.toLowerCase()));
  if (custom) return custom.id;
  for (const [re, id] of TYPE_WORDS) if (re.test(w)) return id;
  return "cedar-privacy";
}

type FenceArgs = {
  address: string | null;
  clientId: string | null;
  leadId: string | null;
  rearOffsetFt: number | null;
  rearOnLotLine: boolean;
  gates: Array<{ where: "left" | "right" | "rear"; widthFt: number | null }>;
  type: string | null;
  heightFt: number | null;
  removeExisting: boolean;
  replaces: string | null;
};

const fenceArgs = z.object({
  address: z.string().max(200).nullable().describe("the property, when it wasn't looked up with fence_site already; null = the site looked up last"),
  clientId: ID.nullable(),
  leadId: ID.nullable(),
  rearOffsetFt: z.number().min(3).max(500).nullable().describe("the rear run's distance out from the back of the house, ft ('20 feet from the house'); null = 20 unless it's on the lot line"),
  rearOnLotLine: z.boolean().describe("true when the rear run follows the back property line"),
  gates: z.array(z.object({ where: z.enum(["left", "right", "rear"]), widthFt: z.number().min(3).max(16).nullable() })).max(4).describe("each gate: which run it is on (left/right side of the house, or the rear run) and its width, null = 4 ft walk gate"),
  type: z.string().max(80).nullable().describe("the fence in their words: cedar privacy, vinyl, chain link, aluminum…; null = cedar privacy"),
  heightFt: z.number().min(3).max(10).nullable().describe("null = 6"),
  removeExisting: z.boolean().describe("true when an old fence comes out first"),
  replaces: ID.nullable().describe("the proposalId of a fence built earlier that this one changes, else null"),
});

async function catalogOf(organizationId: string): Promise<{ rates: ReturnType<typeof sanitizeRateBook>; customs: CustomFenceType[] }> {
  try {
    const row = await db.fenceCatalog.findUnique({ where: { organizationId } });
    if (!row) return { rates: sanitizeRateBook({}), customs: [] };
    const doc = fenceCatalogSchema.parse(JSON.parse(row.catalogJson));
    // The schema checked each `like` against the catalog's ids; the page reads them the same way.
    return { rates: sanitizeRateBook(doc.rates), customs: doc.custom as CustomFenceType[] };
  } catch {
    return { rates: sanitizeRateBook({}), customs: [] };
  }
}

const buildFence: WriteTool<FenceArgs, FenceArgs & { siteAddress: string }> = {
  kind: "write",
  instant: "now",
  name: "build_fence",
  need: "estimates.build",
  card: {
    "label": "Fence estimate",
    "purpose": "Lay out and price a fence on the lot from words — the rear run, the sides on the lot lines, the gates — as a DRAFT with its plan.",
    "when": "After fence_site: build_fence with the layout in feet — the rear run so many feet out from the house or on the rear lot line, gates on the left or right side of the house or the rear, the type and height. To change a fence built lately: build_fence again with the whole layout and replaces = its proposalId.",
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
    "deps": [
      "maps"
    ],
    "steps": [
      "Lot & house",
      "Layout",
      "Priced",
      "Saved"
    ],
    "samples": [
      {
        "say": "fence across the backyard 20 feet from the house, attach to the property lines, gate on the right side, 6 foot cedar",
        "args": {
          "address": null,
          "clientId": null,
          "leadId": null,
          "rearOffsetFt": 20,
          "rearOnLotLine": false,
          "gates": [
            {
              "where": "right",
              "widthFt": null
            }
          ],
          "type": "cedar",
          "heightFt": 6,
          "removeExisting": false,
          "replaces": null
        }
      }
    ]
  },
  description:
    "Lay out and price a fence on the property looked up with fence_site (or at an address): the rear run across the backyard so many feet out from the house (or on the rear lot line), the sides along the property lines from the house's back corners, gates on the left/right side of the house or the rear. Priced with the company's fence catalog and saved as a DRAFT proposal (nothing goes to the client). Needs the address first. Pass `replaces` to change a fence built earlier.",
  params: fenceArgs,
  payload: fenceArgs.extend({ siteAddress: z.string() }),
  async plan({ actor }, a) {
    const gate = await fenceGate(actor);
    if (gate) return { ok: false, say: gate };
    const caps = await buildCaps(actor, ["estimatorUses"]);
    if (caps) return { ok: false, say: caps };
    let site = await rememberedSite<FenceSite>(actor, "fence");
    const place = saidHouseAddress(a.address);
    if (place.ask) return { ok: false, say: place.ask };
    if (place.address && (!site || site.address.toLowerCase() !== place.address.toLowerCase())) {
      const r = await lookupSite(actor, place.address);
      if (!r.ok) return { ok: false, say: r.say };
      site = r.site;
      await rememberSite(actor, "fence", site);
    }
    if (!site) return { ok: false, say: "Which property? Give me the address first." };
    const who = await whoFor(actor, a.clientId, a.leadId);
    if (!who.ok) return who;
    if (a.replaces) {
      const miss = await replaceable(actor, a.replaces, "fence");
      if (miss) return { ok: false, say: miss };
    }
    const heightFt = a.heightFt ?? 6;
    const rearWords = a.rearOnLotLine ? "on the rear lot line" : `${a.rearOffsetFt ?? 20} ft out from the back of the house`;
    const gateWords = a.gates.length ? andList(a.gates.map((g) => `a ${g.widthFt ?? 4}-ft gate on the ${g.where === "rear" ? "rear run" : `${g.where} side`}`)) : "no gates";
    return {
      ok: true,
      payload: { ...a, siteAddress: site.address },
      readback: `On it — laying out the fence at ${site.address}: across the back ${rearWords}, along both lot lines to the house, ${gateWords}. Pricing ${heightFt}' ${a.type ?? "cedar privacy"} with your fence rates${who.who.name ? ` for ${who.who.name}` : ""}.`,
    };
  },
  async execute({ actor, report }, p) {
    const org = actor.organizationId;
    let site = await rememberedSite<FenceSite>(actor, "fence");
    if (!site || site.address.toLowerCase() !== p.siteAddress.toLowerCase()) {
      const r = await lookupSite(actor, p.siteAddress);
      if (!r.ok) throw new Error(r.say);
      site = r.site;
    }
    await report?.("Layout");
    const spec: FenceSpec = { rear: { offsetFt: p.rearOffsetFt, onLotLine: p.rearOnLotLine }, gates: p.gates };
    const laid = layoutFence(site, spec);
    if ("error" in laid) throw new Error(laid.error);
    const { rates, customs } = await catalogOf(org);
    const typeId = typeIdFor(p.type, customs);
    const heightFt = p.heightFt ?? 6;
    const market = resolveMarket({ address: site.address });
    const layout = {
      type: typeId,
      heightFt,
      runs: typedRuns([laid.totalLf]).map((r) => ({ ...r, corners: laid.corners })),
      openings: laid.gates.map((g) => ({ widthFt: g.widthFt, kind: "gate" as const, label: g.label })),
      terrain: "flat" as const,
      removalLf: p.removeExisting ? Math.round(laid.totalLf) : 0,
    };
    const pkg = priceFencePackage(layout, { rates, customs, market });
    await report?.("Priced");
    const where = site.address;
    const placement = [
      `Fence placed from the address: ${laid.words.join("; ")}.`,
      site.frontKnown ? `Front taken as the ${site.street ? `${site.street} side` : "street side"}; left and right as you face the house from the street.` : "The street side wasn't certain: south taken as the front.",
      "Ground taken as level; a site visit confirms the lines, the grade and the utilities.",
    ];
    const who = await whoFor(actor, p.clientId, p.leadId);
    const name = who.ok ? who.who.name : null;
    const title = `${heightFt}' ${pkg.resolved.label} fence — ${Math.round(pkg.netFenceLf)} ft${name ? ` for ${name}` : ""}`.slice(0, 200);
    const data = fenceConvertSchema.parse({
      title,
      scope: fenceScope(pkg, layout, where).join("\n").slice(0, 6000),
      materials: [],
      labor: [],
      assumptions: [...placement, ...packageNotes(layout, pkg.resolved.type, pkg.takeoff)].slice(0, 20).map((n) => n.slice(0, 600)),
      lines: pkg.lines.map((l) => ({ name: l.name.slice(0, 200), description: l.description?.slice(0, 400), quantity: l.quantity, unit: l.unit, materialCost: l.materialCost, laborCost: l.laborCost })),
      // The crew's pick list, as the studio would keep it (lib/fence/savedTakeoff).
      takeoff: pkg.takeoff.bom.slice(0, 80).map((b) => ({ label: b.label.slice(0, 240), qty: b.qty, unit: b.unit })),
      address: site.address,
      clientId: p.clientId,
      plan: {
        points: laid.points,
        gates: laid.gates.map((g) => ({ segmentIndex: g.segmentIndex, t: g.t, widthFt: g.widthFt, kind: g.kind, label: g.label, x: g.x, y: g.y })),
        buildings: [...(site.house ? [{ ring: site.house, role: "subject" as const }] : []), ...site.neighbors.slice(0, 12).map((ring) => ({ ring, role: "neighbor" as const }))],
        lots: [site.lot],
        origin: site.origin,
        heightFt,
        typeLabel: pkg.resolved.label,
        totalLf: laid.totalLf,
        address: site.address,
      },
    });
    const filing = await filingFromIds(org, { clientId: p.clientId, leadId: p.leadId });
    const id = await writeFenceProposal({ organizationId: org, userId: actor.userId, role: actor.role }, data, filing);
    await report?.("Saved");
    const archived = p.replaces ? await archiveReplaced(actor, p.replaces) : false;
    const facts = `${Math.round(pkg.netFenceLf)} ft of ${heightFt}' ${pkg.resolved.label.toLowerCase()} · ${laid.words.join(" · ")}`;
    return landed(actor, id, { facts, archived });
  },
};

export const FENCE_TOOLS = [fenceSite, buildFence];
