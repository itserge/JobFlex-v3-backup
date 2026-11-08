import "server-only";
// LAWN CARE BY VOICE (2026-11-05, the AI Operator's estimators batch): "the yard at 14 Oak St" → the property read
// as the lawn estimator reads it (lib/lawn/read: the county's lot, the USDA aerial photo classed pixel by pixel, the
// slope) and measured (lib/lawn/site measureSite), said back and kept an hour under the person; "price weekly
// mowing, fertilizer and the fall cleanup" → the season priced by the crew's time at the company's lawn rates
// (lib/lawn/pricing priceYard, the visits counted on the season's calendar as the lawn page counts them), filed as
// a DRAFT (lib/lawn/proposalWrite) and offered for sending. Where the photo can't be read — or they just say the
// lawn's size — a yard sized from what was said stands in (lib/assistant/estimatorWords yardFromSaid) and the scope
// says the first visit measures it. The lawn estimator is in preview: the same accounts the page lets in.
import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool, WriteTool } from "@/lib/assistant/tools";
import type { AssistantActor } from "@/lib/assistant/actor";
import { andList } from "@/lib/assistant/shared";
import { archiveReplaced, buildCaps, landed, overPrior, priorBuild, rememberSite, rememberedSite, replaceable, whoFor } from "@/lib/assistant/estimatorShared";
import { LAWN_SERVICES, LAWN_SERVICE_WORDS, LAWN_USUAL, sqftWords, yardFromSaid } from "@/lib/assistant/estimatorWords";
import { enforceRateLimit, HOUR, RateLimitError } from "@/lib/rateLimit";
import { stateFromAddress } from "@/lib/pricing/salesTax";
import { locationIndex } from "@/lib/estimate/location-index";
import { canUseLawnEstimator } from "@/lib/lawn/access";
import { readProperty, ReadError } from "@/lib/lawn/read";
import { measureSite } from "@/lib/lawn/site";
import type { YardMeasures } from "@/lib/lawn/measure";
import { cleanLawnSettings, DEFAULT_LAWN_SETTINGS, DEFAULT_OPTIONS, priceYard, type LawnSettings, type ServiceId, type ServiceOptions } from "@/lib/lawn/pricing";
import { monthsOf } from "@/lib/lawn/season";
import { rulesAt } from "@/lib/lawn/rules";
import { seasonCalendar } from "@/lib/lawn/calendar";
import { lawnTaxed } from "@/lib/lawn/tax";
import { lawnConvertSchema, writeLawnProposal } from "@/lib/lawn/proposalWrite";
import { filingFromIds } from "@/lib/filingContext";
import { saidHouseAddress } from "@/lib/assistant/address";

const ID = z.string().min(1).max(64);
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n >= 1000 ? 0 : 2 });

/** The yard as the Operator keeps it: the measures and where they came from — never the photo itself. */
type LawnRead = {
  v: 1;
  address: string;
  state: string | null;
  county: string | null;
  place: string;
  locationFactor: number;
  stories: number | null;
  measures: YardMeasures;
  source: "photo" | "said";
  photoDate: string | null;
};

async function lawnGate(actor: AssistantActor): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, email: true } });
  if (!user || !(await canUseLawnEstimator(user))) return "The lawn estimator is in preview for admins, so I can't price lawns on your account yet. I can price it with Smart Proposal instead — say 'price it'.";
  return null;
}

/** The property read and measured, the lawn estimator's way; a sentence when it can't be. */
async function readLawn(actor: AssistantActor, address: string): Promise<{ ok: true; read: LawnRead } | { ok: false; say: string }> {
  try {
    await enforceRateLimit(`lawn-read:${actor.organizationId}`, 80, HOUR, "property reads");
    const site = await readProperty({ address });
    const measures = measureSite(site);
    return { ok: true, read: { v: 1, address: site.address || address, state: site.state, county: site.county ?? null, place: site.place, locationFactor: site.locationFactor, stories: site.lot.stories, measures, source: "photo", photoDate: site.photo?.date ?? null } };
  } catch (err) {
    if (err instanceof ReadError || err instanceof RateLimitError) return { ok: false, say: `${err.message} Or tell me the lawn's square feet and I'll price it from that.` };
    return { ok: false, say: "The aerial photo couldn't be read right now. Try again in a minute, or tell me the lawn's square feet and I'll price it from that." };
  }
}

/** A yard sized from what was said. */
function saidLawn(address: string, lawnSqft: number, bedSqft: number | null): LawnRead {
  const loc = locationIndex(address);
  return { v: 1, address, state: stateFromAddress(address), county: null, place: loc.place, locationFactor: loc.factor, stories: null, measures: yardFromSaid(lawnSqft, bedSqft), source: "said", photoDate: null };
}

async function lawnSettingsFor(organizationId: string): Promise<{ settings: LawnSettings; own: boolean }> {
  const row = await db.syncState.findUnique({ where: { key: `lawnsettings:${organizationId}` }, select: { cursor: true } }).catch(() => null);
  if (!row) return { settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  try {
    return { settings: cleanLawnSettings(JSON.parse(row.cursor)), own: true };
  } catch {
    return { settings: { ...DEFAULT_LAWN_SETTINGS }, own: false };
  }
}

const yardWords = (m: YardMeasures, source: LawnRead["source"]) =>
  source === "photo"
    ? `${sqftWords(m.lawnSqft)} of lawn (front ${sqftWords(m.lawnByZone.front)}, back ${sqftWords(m.lawnByZone.back)}, sides ${sqftWords(m.lawnByZone.side)}), ${sqftWords(m.bedSqft)} of beds, ${m.treesInLawn} tree${m.treesInLawn === 1 ? "" : "s"} in the lawn`
    : `${sqftWords(m.lawnSqft)} of lawn as said${m.bedSqft ? `, ${sqftWords(m.bedSqft)} of beds` : ""}`;

const lawnSite: ReadTool<{ address: string }> = {
  kind: "read",
  name: "lawn_site",
  need: "estimates.build",
  card: {
    "label": "Yard",
    "purpose": "The lawn, beds and trees at an address, measured on the aerial photo.",
    "when": "An address for lawn care with no lawn size said: lawn_site first; say back the lawn and beds, ask what to price.",
    "objects": [
      "property"
    ],
    "effect": "read",
    "group": "estimates",
    "version": 1,
    "since": "2026-11-05",
    "samples": [
      {
        "say": "the yard at 14 Oak St, Tacoma WA",
        "args": {
          "address": "14 Oak St, Tacoma WA"
        }
      }
    ]
  },
  description:
    "Read a property for lawn care from the address: the lot from the county, the lawn, beds and trees measured on the aerial photo, front and back. Say back what it found, then ask what to price. Use before build_lawn when the person gives an address and no lawn size; the yard is remembered for an hour.",
  params: z.object({ address: z.string().min(6).max(200).describe("the full street address, with city and state") }),
  async run({ actor }, a) {
    const gate = await lawnGate(actor);
    if (gate) return { notAllowed: gate };
    const place = saidHouseAddress(a.address);
    if (place.ask || !place.address) return { notDone: place.ask ?? "Which property? Give me the address." };
    const r = await readLawn(actor, place.address);
    if (!r.ok) return { notDone: r.say };
    await rememberSite(actor, "lawn", r.read);
    const m = r.read.measures;
    return {
      address: r.read.address,
      lawnSqft: m.lawnSqft,
      front: m.lawnByZone.front,
      back: m.lawnByZone.back,
      sides: m.lawnByZone.side,
      bedSqft: m.bedSqft,
      treesInLawn: m.treesInLawn,
      lotSqft: m.lotSqft,
      yard: yardWords(m, "photo"),
      next: "Ask what to price: mowing weekly or every other week, fertilizer, aeration, the cleanups, mulch, shrubs, gutters, snow — or the usual season.",
    };
  },
};

type LawnArgs = {
  address: string | null;
  lawnSqft: number | null;
  bedSqft: number | null;
  clientId: string | null;
  leadId: string | null;
  frequency: "weekly" | "biweekly" | null;
  services: ServiceId[] | null;
  fertRounds: number | null;
  mulchDepthIn: number | null;
  stories: number | null;
  snowPushes: number | null;
  replaces: string | null;
};

const lawnArgs = z.object({
  address: z.string().max(200).nullable().describe("the property; null = the yard read last with lawn_site, else the client's or lead's address on file"),
  lawnSqft: z.number().min(100).max(500000).nullable().describe("the lawn's square feet when they say it (then no photo is read)"),
  bedSqft: z.number().min(0).max(100000).nullable().describe("the beds' square feet when said"),
  clientId: ID.nullable(),
  leadId: ID.nullable(),
  frequency: z.enum(["weekly", "biweekly"]).nullable().describe("mowing every week or every other week; null = weekly"),
  services: z.array(z.enum(LAWN_SERVICES as [ServiceId, ...ServiceId[]])).max(15).nullable().describe("the services they named; null = the usual season (mowing, fertilizer, aeration, the cleanups, mulch, sprinklers, shrubs, hedges, snow — those the yard calls for)"),
  fertRounds: z.number().int().min(0).max(8).nullable().describe("fertilizer rounds a year, when said; null = 5"),
  mulchDepthIn: z.number().int().min(2).max(3).nullable().describe("mulch depth, 2 or 3 inches; null = 2"),
  stories: z.number().int().min(1).max(4).nullable().describe("the house's floors, for gutters, when said"),
  snowPushes: z.number().int().min(0).max(60).nullable().describe("snow pushes a season, when snow is asked for; null = none"),
  replaces: ID.nullable().describe("the proposalId of a lawn estimate built earlier that this one changes, else null"),
});

const buildLawn: WriteTool<LawnArgs, LawnArgs & { address: string }> = {
  kind: "write",
  instant: "now",
  name: "build_lawn",
  need: "estimates.build",
  card: {
    "label": "Lawn estimate",
    "purpose": "Price a season of lawn care with the company's lawn rates, as a DRAFT.",
    "when": "Lawn care: build_lawn from the yard read with lawn_site, the aerial photo at the address, or the lawn's square feet when said (then no photo is read); pass the services they name, else null for the usual season; mowing weekly or every other week. To change it: build_lawn again with replaces.",
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
      "Yard",
      "Priced",
      "Saved"
    ],
    "samples": [
      {
        "say": "price lawn care at 14 Oak St, Tacoma WA, the lawn is about 8,000 square feet, weekly mowing, fertilizer and fall cleanup",
        "args": {
          "address": "14 Oak St, Tacoma WA",
          "lawnSqft": 8000,
          "bedSqft": null,
          "clientId": null,
          "leadId": null,
          "frequency": "weekly",
          "services": [
            "mow",
            "fert",
            "fallCleanup"
          ],
          "fertRounds": null,
          "mulchDepthIn": null,
          "stories": null,
          "snowPushes": null,
          "replaces": null
        }
      }
    ]
  },
  description:
    "Price a season of lawn care for a property with the company's lawn rates — mowing weekly or every other week, fertilizer, aeration, overseeding, the spring and fall cleanups, mulch, shrubs, hedges, sprinklers, gutters, snow — from the yard read with lawn_site, the aerial photo at the address, or the lawn's square feet when they say it; saved as a DRAFT proposal (nothing goes to the client). Pass `replaces` to change one built earlier.",
  params: lawnArgs,
  payload: lawnArgs.extend({ address: z.string() }),
  async plan({ actor }, said) {
    const gate = await lawnGate(actor);
    if (gate) return { ok: false, say: gate };
    const caps = await buildCaps(actor, []);
    if (caps) return { ok: false, say: caps };
    // "Every other week instead" keeps the yard and the services the earlier build was asked for, under what is said now.
    const a = overPrior(said.replaces ? await priorBuild<LawnArgs>(actor, said.replaces, "build_lawn") : null, said);
    const w = await whoFor(actor, a.clientId, a.leadId);
    if (!w.ok) return w;
    const kept = await rememberedSite<LawnRead>(actor, "lawn");
    // Measured from the photo, the address must be whole; with the lawn's square feet said it is only a label.
    const place = saidHouseAddress(a.address);
    if (place.ask && !a.lawnSqft) return { ok: false, say: place.ask };
    const address = place.address || (!a.lawnSqft && kept ? kept.address : null) || w.who.address;
    if (!address) return { ok: false, say: "Which property? Give me the address, or the lawn's square feet." };
    if (a.replaces) {
      const miss = await replaceable(actor, a.replaces, "lawn");
      if (miss) return { ok: false, say: miss };
    }
    const same = kept && kept.address.toLowerCase() === address.toLowerCase();
    const how = a.lawnSqft ? `pricing ${sqftWords(a.lawnSqft)} of lawn at ${address}` : same ? `pricing the yard at ${address}` : `reading the yard at ${address} from the aerial photo and pricing it`;
    const what = a.services?.length ? andList(a.services.map((s) => LAWN_SERVICE_WORDS[s])) : "the usual season";
    return { ok: true, payload: { ...a, address }, readback: `On it — ${how}: ${what}, mowing ${a.frequency === "biweekly" ? "every other week" : "weekly"}, with your lawn rates${w.who.name ? ` for ${w.who.name}` : ""}.` };
  },
  async execute({ actor, now, report }, p) {
    const org = actor.organizationId;
    await report?.("Yard");
    let read: LawnRead | null = null;
    if (p.lawnSqft) read = saidLawn(p.address, p.lawnSqft, p.bedSqft);
    else {
      const kept = await rememberedSite<LawnRead>(actor, "lawn");
      if (kept && kept.address.toLowerCase() === p.address.toLowerCase()) read = kept;
      else {
        const r = await readLawn(actor, p.address);
        if (!r.ok) throw new Error(r.say);
        read = r.read;
        await rememberSite(actor, "lawn", read);
      }
    }
    const m = read.measures;
    const { settings, own } = await lawnSettingsFor(org);
    const options: ServiceOptions = {
      ...DEFAULT_OPTIONS,
      frequency: p.frequency ?? "weekly",
      fertRounds: p.fertRounds ?? DEFAULT_OPTIONS.fertRounds,
      mulchDepthIn: (p.mulchDepthIn ?? 2) as 2 | 3,
      stories: p.stories ?? (read.stories && read.stories > 0 ? Math.min(4, read.stories) : DEFAULT_OPTIONS.stories),
      snowPushes: p.snowPushes ?? (p.services?.includes("snow") ? 12 : 0),
    };
    await report?.("Priced");
    const quote = priceYard({ measures: m, settings, options, locationFactor: read.locationFactor, state: read.state, ownRate: own });
    const wanted = new Set<ServiceId>(p.services?.length ? p.services : LAWN_USUAL);
    const picked = new Set<ServiceId>(quote.services.filter((s) => wanted.has(s.id)).map((s) => s.id));
    const rules = rulesAt(read.state, read.county, read.place);
    const calendar = seasonCalendar({ start: now, quote, picked, fertRounds: options.fertRounds, frequency: options.frequency, rules, crewSize: settings.crewSize });
    const count = (id: ServiceId) => calendar.filter((v) => v.service === id).length;
    // Visits the calendar books are counted from it (mowing, bed weeding, fertilizer rounds the rules left in).
    const lines = quote.services.filter((x) => picked.has(x.id)).map((x) => (x.id === "mow" || x.id === "bedWeeding" || x.id === "fert" ? { ...x, qty: count(x.id) || x.qty } : x));
    if (!lines.length) throw new Error(`Nothing to price at ${read.address}: the yard has no lawn or beds those services apply to.`);
    const season = lines.reduce((t, l) => t + l.unitPrice * l.qty, 0);
    const tax = lines.reduce((t, l) => t + (lawnTaxed(read.state, l.taxClass) ? l.unitPrice * l.qty : 0), 0);
    const months = monthsOf(quote.climate);
    const scope = [
      `Lawn and landscape care for ${read.address}, ${MONTH[months[0] - 1]} through ${MONTH[months[months.length - 1] - 1]}.`,
      read.source === "photo"
        ? `Measured on the aerial photo: ${sqftWords(m.lawnSqft)} of lawn (front ${sqftWords(m.lawnByZone.front)}, back ${sqftWords(m.lawnByZone.back)}, sides ${sqftWords(m.lawnByZone.side)}) and ${sqftWords(m.bedSqft)} of beds.`
        : `Priced on ${sqftWords(m.lawnSqft)} of lawn${p.bedSqft ? ` and ${sqftWords(m.bedSqft)} of beds` : ""} as given; the yard is measured on the first visit.`,
      ...lines.map((l) => `${l.name}: ${l.desc}.`),
      `The season comes to ${usd(season)}${tax ? " plus sales tax on the lines the state taxes" : ""} — ${usd(season / 12)} a month over 12 months on a service plan.`,
    ].join("\n");
    const data = lawnConvertSchema.parse({
      title: `Lawn care — ${read.address}`.slice(0, 160),
      clientId: p.clientId,
      address: read.address,
      state: read.state,
      scope: scope.slice(0, 6000),
      lines: lines.map((l) => ({ key: l.id, name: l.name, description: l.desc.slice(0, 1500), quantity: l.qty, unit: l.unit, unitPrice: l.unitPrice, labor: l.labor, taxClass: l.taxClass })),
      draftId: null,
      site: null,
      measures: m,
    });
    const filing = await filingFromIds(org, { clientId: p.clientId, leadId: p.leadId });
    const id = await writeLawnProposal({ organizationId: org, userId: actor.userId, role: actor.role }, data, filing);
    await report?.("Saved");
    const archived = p.replaces ? await archiveReplaced(actor, p.replaces) : false;
    const facts = `${yardWords(m, read.source)} · ${lines.map((l) => `${l.name.toLowerCase()} ${l.qty > 1 ? `${l.qty} × ` : ""}${usd(l.unitPrice)}`).join(", ")} · the season ${usd(season)}, ${usd(season / 12)} a month on a plan`;
    return landed(actor, id, { facts, archived });
  },
};

export const LAWN_TOOLS = [lawnSite, buildLawn];
