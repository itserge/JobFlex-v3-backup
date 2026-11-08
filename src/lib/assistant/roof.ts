import "server-only";
// A ROOF BY VOICE (2026-11-05, the AI Operator's estimators batch): "roof estimate at 14 Oak St, architectural
// shingles" → the roof measured from the air (lib/roofSolarMeasure — Google's model of the roof under the pin,
// kept as a RoofMeasurement row the way the roof page's Measure button keeps it, so the proposal gets the house
// photo and the estimator opens it again), its facts as the homeowner's range reads them (lib/publicEstimate/
// roof), the company's roof book (lib/webEstimatorTrades roofBook — its systems, brands and rates, the built-in
// catalog where it set none), the package built as the roof page builds it (lib/roofPackage/takeoff), filed as a
// DRAFT with its ROOF_PLAN (lib/roofPackage/proposalWrite) and offered for sending. Where the air can't read the
// roof — no Google coverage, or no key — the house's size and floors stand in, as the homeowner's range falls
// back, and the Operator asks for them. The card shows the aerial photo with the pin (api/assistant/photo) —
// never a drawn outline (the owner's rule).
//
// THE MEASUREMENT IS THE ROOF PAGE'S (owner, 2026-11-06: "on production roof uses EagleView"): the provider the
// Measure button uses — EagleView's Instant order through lib/roofInstantMeasure (the order ledger, the daily
// ceiling, the plan's month, the witnesses, the row the page opens again), Google's aerial model only where the
// server is set to it or EagleView is off (lib/roofMeasurementProvider), and Google behind an EagleView answer that
// holds no roof, as the page falls back. An order can take minutes, so the build runs after the reply.
import { z } from "zod";
import type { WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { archiveReplaced, buildCaps, landed, overPrior, priorBuild, replaceable, whoFor } from "@/lib/assistant/estimatorShared";
import { roofExistingFor, roofFamilyFor, roofSystemFor } from "@/lib/assistant/estimatorWords";
import { isPageLocked } from "@/lib/customPageAccess";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { splitAddress } from "@/lib/hvac/coolcalc";
import { isSolarEnabled } from "@/lib/solar";
import { isEagleViewEnabled } from "@/lib/eagleview";
import { roofMeasurementProvider } from "@/lib/roofMeasurementProvider";
import { instantMeasure } from "@/lib/roofInstantMeasure";
import { housePin, solarMeasure } from "@/lib/roofSolarMeasure";
import { measurementWords, roofFactsFromMeasurement } from "@/lib/roofPackage/measurementFacts";
import { enforceRateLimit, HOUR } from "@/lib/rateLimit";
import { takeTrialCap, trialPointKey } from "@/lib/trialMeter";
import { EXISTING, roofFactsFromSize, roofFactsFromSolar, type RoofAnswers } from "@/lib/publicEstimate/roof";
import { imageryWords, roofBook } from "@/lib/webEstimatorTrades";
import { isFlatRoof } from "@/lib/roofPackage/flatRule";
import { buildRoofPackage, defaultSpec, withSystem, type PkgLine, type RoofFacts } from "@/lib/roofPackage/takeoff";
import { rankBrandsFor, withBrand, withBrandPrice } from "@/lib/roofPackage/brands";
import { roofConvertSchema, writeRoofProposal } from "@/lib/roofPackage/proposalWrite";
import { filingFromIds } from "@/lib/filingContext";
import { saidHouseAddress } from "@/lib/assistant/address";

const ID = z.string().min(1).max(64);

type RoofArgs = {
  address: string | null;
  clientId: string | null;
  leadId: string | null;
  material: string | null;
  existing: string | null;
  storeys: number | null;
  homeSqft: number | null;
  tearOffLayers: number | null;
  replaces: string | null;
};

const roofArgs = z.object({
  address: z.string().max(200).nullable().describe("the house, with city and state; null = the client's or lead's address on file"),
  clientId: ID.nullable(),
  leadId: ID.nullable(),
  material: z
    .string()
    .max(80)
    .nullable()
    .describe("the roof they want, in their words: architectural shingles, 3-tab, impact-resistant, designer, standing-seam metal, metal panel, stone-coated steel, concrete tile, clay tile, cedar shake, synthetic slate, slate, TPO/EPDM/flat membrane; null = architectural shingles"),
  existing: z.string().max(60).nullable().describe("what is on the roof now, when said (asphalt shingle, metal, tile, shake, flat); null = not said"),
  storeys: z.number().int().min(1).max(3).nullable().describe("floors, when said"),
  homeSqft: z.number().min(300).max(20000).nullable().describe("the house's living area in sq ft, when said — the roof is sized from it when the air can't read the roof"),
  tearOffLayers: z.number().int().min(0).max(3).nullable().describe("layers to tear off, when said (0 = roof over the old one); null = one"),
  replaces: ID.nullable().describe("the proposalId of a roof built earlier that this one changes, else null"),
});

/** The provider the roof page's Measure button uses on this server. */
const eagleView = () => roofMeasurementProvider() !== "google" && isEagleViewEnabled();
/** Whether any aerial read is possible here. */
const fromTheAir = () => eagleView() || isSolarEnabled();

async function roofGate(actor: AssistantActor): Promise<string | null> {
  if (await isPageLocked(actor.organizationId, "roof-estimator")) return "The roof estimator isn't in your plan yet (Settings → Billing). I can price it with Smart Proposal instead — say 'price it'.";
  return null;
}

const SIZE_ASK = "Tell me the house's square feet and how many floors, and I'll price the roof from that.";

/** Solar's refusals in the Operator's words: "place the pin on the roof" means nothing by voice. */
function pinWords(error: string, address: string, pin: { how: "parcel" | "structures" | "geocode" }): string {
  if (/match the pin|location is missing/i.test(error)) {
    return pin.how === "geocode"
      ? `Google's roof model didn't line up with the map point for ${address} — the point isn't on the house, and I couldn't find the house's outline on record to move it. On the Roof page you can drop the pin on the roof yourself.`
      : `Google's roof model didn't line up with the house at ${address} even with the pin on its outline. On the Roof page you can drop the pin on the roof yourself.`;
  }
  if (/no high-resolution roof data|no coverage/i.test(error)) return `Google has no high-resolution roof imagery for ${address}.`;
  return error;
}

const buildRoof: WriteTool<RoofArgs, RoofArgs & { address: string }> = {
  kind: "write",
  // After the reply: an EagleView order can take minutes (the page's own budget), and the texted or spoken result lands then.
  instant: "background",
  name: "build_roof",
  need: "estimates.build",
  card: {
    "label": "Roof estimate",
    "purpose": "Measure a roof from the air and price it with the company's roof catalog, as a DRAFT with its photo and plan.",
    "when": "A roof from an ADDRESS: build_roof with the material they want, what is on it now, and the house's square feet and floors when said (the fallback when the air can't read the roof — ask for the size only when the build says so). To change it: build_roof again with replaces = its proposalId.",
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
      "Aerial read",
      "Rate book",
      "Priced",
      "Saved"
    ],
    "samples": [
      {
        "say": "roof estimate at 14 Oak St, Tacoma WA, architectural shingles",
        "args": {
          "address": "14 Oak St, Tacoma WA",
          "clientId": null,
          "leadId": null,
          "material": "architectural shingles",
          "existing": null,
          "storeys": null,
          "homeSqft": null,
          "tearOffLayers": null,
          "replaces": null
        }
      },
      {
        "say": "make it standing seam metal",
        "args": {
          "address": null,
          "clientId": null,
          "leadId": null,
          "material": "standing seam metal",
          "existing": null,
          "storeys": null,
          "homeSqft": null,
          "tearOffLayers": null,
          "replaces": "p_1"
        }
      }
    ]
  },
  description:
    "Measure a roof from the air at an address (Google's aerial model of the roof) and price it with the company's roof catalog — the system they ask for, tear-off, underlayment, edges, vents — saved as a DRAFT proposal (nothing goes to the client). Pass the house's square feet and floors when they say them: where the air can't read the roof, the roof is sized from the house. Pass `replaces` to change a roof built earlier (another material, more layers).",
  params: roofArgs,
  payload: roofArgs.extend({ address: z.string() }),
  async plan({ actor }, said) {
    const gate = await roofGate(actor);
    if (gate) return { ok: false, say: gate };
    const caps = await buildCaps(actor, eagleView() ? ["estimatorUses", "roofMeasurements"] : ["estimatorUses"]);
    if (caps) return { ok: false, say: caps };
    // A change keeps what the earlier build was asked — the address, the house — under what is said now.
    const a = overPrior(said.replaces ? await priorBuild<RoofArgs>(actor, said.replaces, "build_roof") : null, said);
    const w = await whoFor(actor, a.clientId, a.leadId);
    if (!w.ok) return w;
    // An address said now is put the way it is written, and never measured while it is missing its city or ZIP
    // (2026-11-07: "12103 200th Street Southeast" went to EagleView with no city, and was refused).
    const place = saidHouseAddress(a.address);
    if (place.ask) return { ok: false, say: place.ask };
    const address = place.address || w.who.address;
    if (!address) return { ok: false, say: "Which house? Give me the address." };
    if (!fromTheAir() && !a.homeSqft) return { ok: false, say: `I can't measure roofs from the air here. ${SIZE_ASK}` };
    if (a.replaces) {
      const miss = await replaceable(actor, a.replaces, "roof");
      if (miss) return { ok: false, say: miss };
    }
    const how = eagleView() ? `measuring the roof at ${address} from the air (EagleView)` : isSolarEnabled() ? `measuring the roof at ${address} from the air` : `sizing the roof at ${address} from a ${a.homeSqft!.toLocaleString("en-US")} sq ft house`;
    const back = actor.channel === "sms" ? "I'll text you" : actor.channel === "voice" ? "I'll tell you" : "You'll see";
    return { ok: true, payload: { ...a, address }, readback: `On it — ${how} and pricing ${a.material ?? "architectural shingles"} with your roof book${w.who.name ? ` for ${w.who.name}` : ""}. ${back} the price and the link when it's ready${eagleView() ? " — a minute or two" : ""}.` };
  },
  async execute({ actor, report }, p) {
    const org = actor.organizationId;
    const w = await whoFor(actor, p.clientId, p.leadId);
    const name = w.ok ? w.who.name : null;
    const parts = splitAddress(p.address);
    const state = (parts.state || stateFromAddress(p.address) || "").toUpperCase() || null;
    const answers: RoofAnswers = {
      existing: roofExistingFor(p.existing),
      storeys: (p.storeys ?? 2) as 1 | 2 | 3,
      material: "architectural",
      tearOffLayers: Math.min(2, p.tearOffLayers ?? 1) as 0 | 1 | 2,
      leaks: false,
      skylights: false,
      solarPanels: false,
    };
    await report?.("Aerial read");
    let facts: RoofFacts | null = null;
    let measurementId: string | null = null;
    let read = "";
    const existingSaid = EXISTING.find((e) => e.id === answers.existing)?.material ?? null;
    // Google behind an EagleView answer that holds no roof — the page's own fallback; nothing else switches provider.
    let googleToo = false;
    if (eagleView()) {
      const m = await instantMeasure({ address: parts.address || p.address, city: parts.city, state: parts.state, zip: parts.zip }, org, actor.userId);
      if (m.ok) {
        facts = roofFactsFromMeasurement(m.measurement, { state, storeys: answers.storeys, existingSaid });
        if (facts) {
          measurementId = m.measurement.id;
          read = measurementWords(m.measurement, Boolean(m.reusedInstant));
        } else if (!p.homeSqft) throw new Error(`The aerial measurement of ${p.address} came back without a roof I can price. ${SIZE_ASK}`);
        else read = "sized from the house (the aerial measurement held no roof to price)";
      } else if (m.noRoof && isSolarEnabled()) {
        googleToo = true;
      } else {
        const why = m.stillProcessing ? `The aerial measurement of ${p.address} is still being prepared — ask me again in a few minutes.` : m.error;
        if (!p.homeSqft) throw new Error(`${why} ${SIZE_ASK}`);
        read = `sized from the house (the aerial measurement didn't come: ${why.replace(/\.$/, "")})`;
      }
    }
    if (!facts && !read && (googleToo || (!eagleView() && isSolarEnabled()))) {
      // The pin on the house first (lib/roofSolarMeasure housePin): a geocoded address lands on the street or the
      // drive, and Solar refuses a pin off the roof. The lot lookup it may make rides on the roof's own allowance.
      await enforceRateLimit(`parcels:${org}`, 30, HOUR, "property lookups");
      const pin = await housePin(p.address);
      if (!pin) throw new Error(`I couldn't place ${p.address} on the map. Check the address, or ${SIZE_ASK.charAt(0).toLowerCase()}${SIZE_ASK.slice(1)}`);
      // The roof's own allowance, once by the pin — already spent by the EagleView order when Google reads behind it.
      if (!googleToo) {
        const trial = await takeTrialCap(org, "roofMeasurements", { dedupe: trialPointKey(pin.lat, pin.lng) });
        if (!trial.ok) throw new Error(trial.failure.error);
      }
      const m = await solarMeasure({ address: parts.address || p.address, city: parts.city || pin.place?.city || "", state: parts.state || pin.place?.state || "", zip: parts.zip || pin.place?.zip || "", lat: pin.lat, lng: pin.lng }, org, actor.userId, "covered");
      const solar = m.ok ? m.measurement.provenance.solar : null;
      if (m.ok && solar) {
        facts = roofFactsFromSolar(solar, answers, state);
        measurementId = m.measurement.id;
        const when = imageryWords(solar.imageryDate);
        read = `read from the air (Google imagery${when ? `, ${when}` : ""}): ${solar.pitchLabel} pitch, ${solar.segmentCount} roof planes`;
      } else {
        const why = m.ok ? "Google's read of that roof wasn't usable." : pinWords(m.error, p.address, pin);
        if (!p.homeSqft) throw new Error(`${why} ${SIZE_ASK}`);
        read = `sized from the house (the air couldn't read it: ${why.replace(/\.$/, "")})`;
      }
    }
    if (!facts) {
      if (!p.homeSqft) throw new Error(`${read ? "" : "I can't measure roofs from the air here. "}${SIZE_ASK}`);
      facts = roofFactsFromSize(p.homeSqft, answers, state);
      read = read || `sized from a ${p.homeSqft.toLocaleString("en-US")} sq ft, ${answers.storeys}-story house at a 6/12 pitch`;
    }
    await report?.("Rate book");
    const book = await roofBook(org);
    const family = isFlatRoof(facts) ? "low-slope" : roofFamilyFor(p.material);
    const sys = roofSystemFor(p.material, family, book.lists);
    if (!sys) throw new Error("Your roof book has no system to price with yet (Settings → Roof catalog).");
    let spec = withSystem(defaultSpec(facts, book.lists, book.lowSlope), sys, facts, book.lists);
    if (p.tearOffLayers != null) spec = { ...spec, tearOffLayers: Math.min(3, p.tearOffLayers) as 0 | 1 | 2 | 3 };
    const live = withBrandPrice(withBrand(spec, rankBrandsFor(sys.id, family, state), book.brands?.[sys.id] ?? null), book.brandRates);
    await report?.("Priced");
    const pkg = buildRoofPackage(live, facts);
    const line = (l: PkgLine) => ({ name: l.name.slice(0, 200), quantity: l.quantity, unitPrice: l.unitPrice, unit: l.unit });
    const squares = Math.round(facts.squares);
    const product = (live as { productName?: string }).productName ?? null;
    const title = `Roof — ${sys.label}, ${squares} squares${name ? ` for ${name}` : ""}`.slice(0, 200);
    const data = roofConvertSchema.parse({
      title,
      scope: pkg.scope.join("\n").slice(0, 6000),
      materials: pkg.materials.map(line),
      labor: pkg.labor.map(line),
      assumptions: [`Roof ${read}.`, ...pkg.assumptions].slice(0, 60).map((s) => s.slice(0, 2000)),
      clientId: p.clientId,
      measurementId,
      address: p.address,
      plan: {
        spec: live as unknown as Record<string, unknown>,
        factsKey: null,
        manual: measurementId ? null : { squares: facts.squares, pitchLabel: "6/12", address: p.address },
        extra: [],
        mainIndex: null,
        pitchEntered: measurementId ? null : "6/12",
        assumptions: pkg.assumptions.slice(0, 60).map((s) => s.slice(0, 2000)),
      },
    });
    const filing = await filingFromIds(org, { clientId: p.clientId, leadId: p.leadId });
    const id = await writeRoofProposal({ organizationId: org, userId: actor.userId, role: actor.role }, data, filing);
    await report?.("Saved");
    const archived = p.replaces ? await archiveReplaced(actor, p.replaces) : false;
    const layers = live.tearOffLayers;
    const facts2 = `${squares} squares ${read} · ${sys.label}${product ? ` (${product})` : ""} · ${layers ? `tear-off ${layers} layer${layers === 1 ? "" : "s"}` : "no tear-off (roofed over)"}`;
    return landed(actor, id, { facts: facts2, archived });
  },
};

export const ROOF_TOOLS = [buildRoof];
