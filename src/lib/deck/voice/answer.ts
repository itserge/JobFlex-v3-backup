// ANSWERS, FROM THE DECK ITSELF (2026-10-21) — pure.
//
// Owner: "would understand how much concrete I need as well — or whatever, anything." Every answer is read off the
// priced design the studio shows (lib/deck/pricing: the material list, the frame, the stairs, the rail, the code
// checks), never estimated on the side, so what is said and what the yard list prints are one number. Each answer
// lights or shows the part it is about, and where there is a next step ("open the lumber list", "fix it") it asks.

import { BAG_CUFT } from "../frame";
import type { DeckCheck } from "../checks";
import { PERMIT_EXEMPT, ftIn } from "../codeTables";
import { DECKING, deckingProduct } from "../catalog";
import { electricalWords } from "../electrical";
import { ROOFING_LABEL, ROOF_KIND_LABEL, STAIR_LANDING_LABEL, hasDeck, sizeWords, structureWords, shapeAreaSqFt } from "../design";
import type { FieldFocus } from "../fieldParts";
import type { DeckPackage } from "../pricing";
import type { Question } from "./commands";
import type { Meta, Pending, ViewChange } from "./run";
import { boardWords, colorName } from "./run";
import { dollars, firstSentence, ftWords, inWords } from "./words";

export interface Answer {
  say: string;
  light?: FieldFocus | null;
  view?: ViewChange;
  meta?: Meta;
  pending?: Pending | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const yards = (cuFt: number) => {
  const yd = cuFt / 27;
  return yd < 0.2 ? "" : yd < 0.4 ? "about a quarter yard" : yd < 0.6 ? "about half a yard" : yd < 0.85 ? "about three quarters of a yard" : `about ${Math.round(yd * 10) / 10} yards`;
};
const first = firstSentence;

/** The parts of the price a question can name, by the words for them. */
const PRICE_PARTS: ReadonlyArray<[RegExp, RegExp]> = [
  [/\b(?:rail(?:ing)?s?|guards?)\b/, /rail/i],
  [/\b(?:stairs?|steps?)\b/, /stair/i],
  [/\b(?:boards?|decking)\b/, /decking|boards/i],
  [/\b(?:roof|roofing|shingles)\b/, /roof|shingle|rafter|header/i],
  [/\b(?:footings?|concrete)\b/, /footing|concrete/i],
  [/\b(?:fram(?:e|ing)|joists?|beams?)\b/, /fram|joist|beam/i],
  [/\b(?:lights?|electrical|heaters?|fans?|outlets?)\b/, /electric|light|heater|fan|outlet|fixture/i],
  [/\b(?:hot tub|spa)\b/, /tub|spa/i],
  [/\b(?:demo|tear[- ]?out)\b/, /demo|tear/i],
];

export function answer(q: Question, about: string, pkg: DeckPackage, checks: readonly DeckCheck[]): Answer {
  const d = pkg.design;
  const s = pkg.structure;
  const fr = s.frame;
  const sf = s.surface;
  switch (q) {
    case "concrete": {
      const bagLines = pkg.bom.filter((l) => l.kind === "concrete" && l.unit === "bags");
      const bags = bagLines.reduce((a, l) => a + l.qty, 0);
      const footingBags = bagLines.filter((l) => /^(?:concrete|roof-concrete)$/.test(l.id)).reduce((a, l) => a + l.qty, 0);
      const padBags = bagLines.filter((l) => /stair/.test(l.id)).reduce((a, l) => a + l.qty, 0);
      const slab = pkg.bom.find((l) => l.id === "slab");
      const blocks = pkg.bom.filter((l) => /pier-blocks|box-blocks/.test(l.id)).reduce((a, l) => a + l.qty, 0);
      const posts = fr?.posts.filter((p) => p.footing.type === "poured") ?? [];
      const parts: string[] = [];
      if (bags) {
        const cuFt = bags * BAG_CUFT;
        const yd = yards(cuFt);
        parts.push(`About ${plural(bags, "bag")} of 80-lb concrete mix — ${Math.round(cuFt * 10) / 10} cubic feet${yd ? `, ${yd}` : ""}.`);
        if (footingBags && posts.length) {
          const tubes = [...new Set(posts.map((p) => p.footing.pierIn))].sort((a, b) => a - b);
          const pads = posts.some((p) => p.footing.padIn > p.footing.pierIn);
          parts.push(`${plural(footingBags, "bag")} for ${plural(pkg.takeoff.footings, "footing")}: ${tubes.join("- and ")}-in. tubes${pads ? " on wider pads" : ""}, ${inWords(posts[0].footing.depthIn)} deep.`);
        }
        if (padBags) parts.push(`${plural(padBags, "bag")} for the stair pad${padBags > 1 && s.stairs.filter((x) => x.pad).length > 1 ? "s" : ""}.`);
        if (bags >= 60) parts.push("That much is worth ordering ready-mix.");
      }
      if (slab) parts.push(`The slab: ${plural(slab.qty, "square foot", "square feet")}, ${slab.note ?? "4 in. thick"}.`);
      if (blocks) parts.push(`${plural(blocks, "precast pier block")} — no concrete to pour for those.`);
      if (!parts.length) return { say: "No concrete on this one." };
      return { say: parts.join(" "), light: { label: "Footings" }, view: { xray: true } };
    }
    case "footings": {
      const posts = fr?.posts ?? [];
      const n = pkg.takeoff.footings;
      if (!n) return { say: "No footings on this one." };
      const p = posts.find((x) => x.footing.type === "poured");
      if (!p) return { say: `${plural(n, "footing")} — precast pier blocks on the ground.`, light: { label: "Footings" }, view: { xray: true } };
      return { say: `${plural(n, "footing")}, ${inWords(p.footing.depthIn)} deep (the frost line here is ${d.frostIn} in.), ${p.footing.pierIn}-in. tubes${p.footing.padIn > p.footing.pierIn ? ` on ${p.footing.padIn}-in. pads` : ""}, the tops ${d.footing.aboveGradeIn} in. above grade. Soil taken at ${d.soilPsf.toLocaleString("en-US")} psf.`, light: { label: "Footings" }, view: { xray: true } };
    }
    case "boards": {
      if (!sf) return { say: "There are no deck boards on this one — it stands on a slab or the ground." };
      const stock = sf.stock.filter((x) => x.count > 0).sort((a, b) => b.lengthFt - a.lengthFt);
      const total = stock.reduce((a, x) => a + x.count, 0);
      const fascia = sf.fascia.on ? ` Plus ${plural(sf.fascia.boards, "fascia board")}.` : "";
      return { say: `${plural(total, "board")} of ${sf.product.label}: ${stock.map((x) => `${x.count} at ${x.lengthFt} ft`).join(", ")} — ${Math.round(sf.boughtLf).toLocaleString("en-US")} ft of board, ${sf.wastePct}% waste included.${sf.border ? ` The ${sf.border === 2 ? "double " : ""}picture-frame border is in it.` : ""}${fascia}`, light: { label: "Deck boards", step: "Surface" } };
    }
    case "screws": {
      if (!sf) return { say: "No deck boards, so no deck screws." };
      const hidden = sf.fastening === "hidden";
      return { say: hidden ? `About ${plural(sf.crossings, "hidden clip")} — one where each board crosses a joist — plus their screws. Priced by the square foot.` : `About ${plural(sf.crossings * 2, "deck screw")} — two where each board crosses a joist, ${sf.crossings.toLocaleString("en-US")} crossings. Priced by the square foot.`, light: { label: "Deck boards", step: "Surface" } };
    }
    case "hardware": {
      if (!fr) return { say: "No deck frame here, so no joist hangers." };
      const h = fr.hardware;
      const bits = [h.hangers && plural(h.hangers, "joist hanger"), h.doubleHangers && plural(h.doubleHangers, "double hanger"), h.ties && plural(h.ties, "hurricane tie"), h.postBases && plural(h.postBases, "post base"), h.postCaps && plural(h.postCaps, "post cap"), h.lateralTies && plural(h.lateralTies, "lateral hold-down"), h.rimScrews && `${h.rimScrews} structural screws at the rim`].filter(Boolean);
      return { say: `${bits.join(", ")}.`, view: { connections: true, xray: true } };
    }
    case "lumber": {
      const lumber = pkg.bom.filter((l) => l.kind === "lumber");
      const pcs = lumber.filter((l) => l.unit === "pcs").reduce((a, l) => a + l.qty, 0);
      return { say: `About ${Math.round(pkg.takeoff.framingLf).toLocaleString("en-US")} ft of framing lumber${pcs ? ` in ${plural(pcs, "piece")}` : ""}${pkg.takeoff.groundContactLf ? `, ${Math.round(pkg.takeoff.groundContactLf)} ft of it ground-contact` : ""}. The list for the yard has every piece and length — open it?`, pending: { ask: "Open the lumber list?", yes: [{ do: "open", what: "yard" }] }, light: { label: "Framing lumber" } };
    }
    case "joists": {
      if (!fr) return { say: "No deck frame on this one." };
      const n = fr.joists.filter((j) => !j.sister).length;
      const longest = Math.max(0, ...fr.sticks.filter((x) => x.role === "joist").map((x) => x.lengthIn));
      const hung = d.placement === "attached" ? "hung on the ledger at the house" : "on a beam at the house end";
      return { say: `${plural(n, "joist")}, ${fr.joistSize} at ${fr.spacingIn} in. on center, up to ${ftIn(longest)} long — ${hung} and resting on the beam${fr.beams.length > 1 ? "s" : ""}.${d.framing.joist === "auto" ? " The code tables picked the size." : ""}`, light: { label: "Joists" }, view: { xray: true } };
    }
    case "beams": {
      if (!fr) return { say: "No deck frame on this one." };
      const sizes = [...new Set(fr.beams.map((b) => b.spec.size))];
      const longest = Math.max(...fr.beams.map((b) => b.spanIn));
      return { say: `${plural(fr.beams.length, "beam")}: ${sizes.join(", ")}, ${fr.beamStyle}, on ${plural(fr.posts.filter((p) => !p.roof).length, "post")} — the longest span between posts ${ftIn(longest)}.${fr.beamKindNote ? ` ${fr.beamKindNote}` : ""}`, light: { label: "Beams", step: "Frame" }, view: { xray: true } };
    }
    case "posts": {
      if (!fr) return { say: s.roof ? `${plural(s.roof.posts.length, "post")} hold the roof, ${d.roof.post}.` : "No posts here." };
      const deckPosts = fr.posts.filter((p) => !p.roof);
      const tallest = Math.max(0, ...deckPosts.map((p) => p.heightIn));
      return { say: `${plural(deckPosts.length, "post")}, ${d.framing.post}, the tallest ${ftIn(tallest)} from the footing to the beam.${s.roof ? ` The roof stands on ${plural(s.roof.posts.length, "post")} of its own, ${d.roof.post}.` : ""}`, light: { label: "Posts", step: "Frame" }, view: { xray: true } };
    }
    case "ledger": {
      if (!fr || !fr.ledgers.length) return { say: d.placement === "attached" ? "No ledger was laid." : "No ledger — it stands on its own posts." };
      const lf = fr.ledgers.reduce((a, l) => a + l.lengthIn, 0);
      const fasteners = fr.ledgers.reduce((a, l) => a + l.fasteners, 0);
      return { say: `${ftIn(lf)} of ledger on the house, ${plural(fasteners, "fastener")} (${d.ledger.fastener === "lag" ? "lag screws" : d.ledger.fastener === "ledgerlok" ? "LedgerLOK" : d.ledger.fastener === "sdws" ? "SDWS screws" : d.ledger.fastener === "anchor" ? "anchors" : "through-bolts"}) every ${fr.ledgers[0].spacingIn} in., flashed above, and ${plural(fr.hardware.lateralTies, "lateral hold-down")}.`, light: { label: "Ledger fastened with" }, view: { xray: true } };
    }
    case "price": {
      const words = about.toLowerCase();
      for (const [re, line] of PRICE_PARTS) {
        if (!re.test(words)) continue;
        const lines = pkg.lines.filter((l) => line.test(`${l.name} ${l.description ?? ""}`));
        if (!lines.length) break;
        const sum = lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
        return { say: `${dollars(sum)} for that — ${lines.map((l) => l.name.split(" — ")[0]).slice(0, 2).join("; ")}. The whole deck is ${dollars(pkg.subtotal)} before tax.` };
      }
      const top = [...pkg.lines].sort((a, b) => b.unitPrice * b.quantity - a.unitPrice * a.quantity).slice(0, 3);
      return { say: `${dollars(pkg.subtotal)} before tax${pkg.areaSqFt ? ` — ${dollars(pkg.pricePerSqFt)} a square foot` : ""}. Materials ${dollars(pkg.materialSubtotal)}, labor ${dollars(pkg.laborSubtotal)}. The biggest parts: ${top.map((l) => `${l.name.split(" — ")[0].toLowerCase()} ${dollars(l.unitPrice * l.quantity)}`).join(", ")}.${pkg.exampleShare > 0.5 ? " Most of it is on example prices — your own prices go under Package & price." : ""}` };
    }
    case "perSqFt":
      return { say: `${dollars(pkg.pricePerSqFt)} a square foot over ${Math.round(pkg.areaSqFt)} sq ft — ${dollars(pkg.subtotal)} in all.` };
    case "labor":
      return { say: `Labor ${dollars(pkg.laborSubtotal)}, materials ${dollars(pkg.materialSubtotal)} — ${dollars(pkg.subtotal)} before tax.` };
    case "time":
      return { say: `I don't schedule crews yet — the labor in this price is ${dollars(pkg.laborSubtotal)}. I've noted that you asked.`, meta: { wish: { text: about, item: "Build time" } } };
    case "area": {
      if (!hasDeck(d)) return { say: `${sizeWords(d)} — ${Math.round(pkg.areaSqFt)} sq ft under it.` };
      const area = Math.round(shapeAreaSqFt(d.shape));
      const lowerArea = d.lower.on ? Math.round(d.lower.widthFt * d.lower.depthFt) : 0;
      return { say: `${sizeWords(d)} — ${area} sq ft${lowerArea ? `, plus ${lowerArea} on the lower level` : ""}. ${ftWords(d.shape.widthFt)} along the house, ${ftWords(d.shape.depthFt)} out from it.`, light: { label: "Along the house", step: "step-shape" } };
    }
    case "height": {
      if (!hasDeck(d)) return { say: `It stands ${d.floor === "slab" ? "on a new slab" : d.floor === "existing" ? "on the existing slab" : "on the ground"}; the headers are ${inWords(d.roof.eaveHeightIn)} up.` };
      const flight = s.stairs.find((x) => x.kind === "flight" && x.level === "upper");
      return { say: `${inWords(d.heightIn)} above the ground${d.heightIn >= 24 ? ` (${d.heightIn} in.)` : ""}${flight ? ` — ${plural(flight.risers, "step")} down` : ""}.${d.heightIn > 30 ? " Over 30 in., so it needs a guard on the open sides." : ""}`, light: { label: "Deck height" } };
    }
    case "stairs": {
      if (!s.stairs.length) {
        if (!hasDeck(d)) return { say: "No deck, so no stairs." };
        return { say: d.heightIn > 8 ? `No stairs yet. At ${inWords(d.heightIn)} up you'll want one — add a 4-ft stair down the front?` : "No stairs — it's low enough to step off.", pending: d.heightIn > 8 ? { ask: "Add stairs down the front?", yes: [{ do: "stairs", op: "add", side: "front" }] } : null };
      }
      const words = s.stairs.map((b) => (b.kind === "box" ? `box steps, ${plural(b.risers, "step")} of ${inWords(Math.round(b.riserIn * 8) / 8)}` : `${ftWords(b.design.widthFt)} wide ${b.design.side === "front" ? "down the front" : `on the ${b.design.side}`}: ${plural(b.risers, "riser")} of ${inWords(Math.round(b.riserIn * 8) / 8)}, ${plural(b.treads, "tread")} of ${inWords(b.runIn)}, ${ftIn(b.totalRunIn)} out, onto ${STAIR_LANDING_LABEL[b.design.landing].toLowerCase()}`));
      return { say: `${words.join("; ")}. The code here: risers up to ${s.code.riserMaxIn} in., treads at least ${s.code.treadMinIn} in.` };
    }
    case "rail": {
      const r = s.rails;
      const need = r.required ? `It's over 30 in. up, so the code wants a ${s.code.guardIn}-in. guard on the open sides.` : "It's under 30 in. — a guard isn't required.";
      if (!r.on) return { say: `${need} No railing chosen yet.`, pending: r.required ? { ask: "Add a railing?", yes: [{ do: "rail", set: { type: "composite" } }] } : null };
      return { say: `${need} ${r.label}, ${r.heightIn} in. high, ${Math.round(r.lf)} ft around the deck${r.stairLf ? ` and ${Math.round(r.stairLf)} ft down the stairs` : ""}, ${plural(r.posts + r.stairPosts, "post")}.` };
    }
    case "permit": {
      const reasons: string[] = [];
      const area = pkg.areaSqFt;
      if (d.placement === "attached") reasons.push("it's attached to the house");
      if (area > PERMIT_EXEMPT.maxAreaSqFt) reasons.push(`it's over ${PERMIT_EXEMPT.maxAreaSqFt} sq ft`);
      if (hasDeck(d) && d.heightIn > PERMIT_EXEMPT.maxHeightIn) reasons.push(`it's more than ${PERMIT_EXEMPT.maxHeightIn} in. up`);
      if (d.structure !== "deck") reasons.push("a roof over it needs one almost everywhere");
      const set = " The studio draws the permit set — say \"open the permit set\".";
      if (reasons.length) return { say: `Almost certainly — ${reasons.join(", ")}.${set}`, pending: { ask: "Open the permit set?", yes: [{ do: "open", what: "permit" }] } };
      return { say: `It may not need one: the IRC lets a deck under ${PERMIT_EXEMPT.maxAreaSqFt} sq ft, under ${PERMIT_EXEMPT.maxHeightIn} in. up and not attached go without (R105.2) — but many towns ask anyway. Call the building department.${set}` };
    }
    case "code":
      return { say: `${s.code.name}. Guards ${s.code.guardIn} in. where it's over 30 in. up; stair risers up to ${s.code.riserMaxIn} in., treads at least ${s.code.treadMinIn} in.${s.code.statewide ? "" : " There's no statewide code — the city or county names the edition."}${d.site.state ? "" : " Set the job's address to check it against the state's own code."}` };
    case "checks": {
      const fails = checks.filter((c) => c.level === "fail");
      // The code edition's own reminder ("confirm with the city") is a note, not a thing to check on the deck.
      const warns = checks.filter((c) => c.level === "warn" && c.part !== "Code");
      const codeNote = checks.some((c) => c.level === "warn" && c.part === "Code") ? (s.code.statewide ? " Confirm the code edition with the building department." : " There's no statewide code here — confirm the edition with the city or county.") : "";
      if (!fails.length && !warns.length) return { say: `It passes every check the studio runs — the frame, the footings, the guard and the stairs.${codeNote}` };
      const fixable = checks.filter((c) => c.fix && (c.level === "fail" || c.level === "warn")).length;
      const lead = fails[0] ?? warns[0];
      return { say: `${fails.length ? `${plural(fails.length, "thing")} to fix` : "Nothing failing"}${warns.length ? `, ${plural(warns.length, "thing")} to check` : ""}. First: ${lead.part} — ${first(lead.text)}${fixable ? " Say \"fix it\" and I'll take care of what I can." : ""}`, pending: fixable ? { ask: "Fix them?", yes: [{ do: "autofix" }] } : null, meta: { go: "checks" } };
    }
    case "layout":
    case "frame": {
      if (!fr || !sf) return { say: s.roof ? `${ROOF_KIND_LABEL[d.roof.kind].split(" — ")[0]} roof on ${plural(s.roof.posts.length, "post")}: the headers sit on the posts, the rafters on the headers.` : "Nothing framed here." };
      const beamAt = fr.beams.length ? Math.round(Math.max(...fr.beams.map((b) => b.y)) / 12) : null;
      const joistWords = `The joists run out from the house, ${fr.joistSize} ${fr.spacingIn} in. apart, ${d.placement === "attached" ? "hung on the ledger" : "from a beam by the house"}${beamAt ? ` and over a beam about ${beamAt} ft out` : ""} on ${plural(fr.posts.filter((p) => !p.roof).length, "post")}.`;
      const boardWords2 = sf.pattern === "straight" ? `The boards run along the house, square across the joists — ${plural(sf.rows, "row")}.` : sf.pattern === "diagonal" ? "The boards run at 45° across the joists, so the joists are closer together." : "The boards meet in a herringbone down the middle, each at 45°.";
      const border = sf.border ? ` A ${sf.border === 2 ? "double " : ""}picture-frame border closes the edge.` : "";
      return { say: `${joistWords} ${boardWords2}${border} Watch it go together.`, view: { build: "play" }, light: { label: "Joists" } };
    }
    case "frost":
      return { say: `The frost line here is taken as ${d.frostIn} in.${fr?.posts[0] ? ` — the footings go ${inWords(fr.posts.find((p) => p.footing.type === "poured")?.footing.depthIn ?? d.frostIn)} down` : ""}${d.placement === "attached" ? " (an attached deck must reach it)" : ""}.`, light: { label: "Frost depth" } };
    case "snow":
      return { say: d.site.groundSnowPsf ? `Ground snow ${d.site.groundSnowPsf} psf; the deck is designed for ${d.loadPsf} psf${s.roof ? `, the roof for ${s.roof.roofLoad} psf` : ""}.` : `No snow load on file — the deck is designed for ${d.loadPsf} psf live load. Set the address for the local snow.` };
    case "load":
    case "weight":
      return { say: `It's designed for ${d.loadPsf} psf of people and furniture plus 10 psf for itself — about ${(Math.round((pkg.areaSqFt * (d.loadPsf + 10)) / 100) * 100).toLocaleString("en-US")} lb across the deck.${d.spa.on ? " The hot-tub spot is framed for the water's weight." : " A hot tub is far heavier (about 100 psf filled) — say \"add a hot tub\" and the frame under it is doubled."}`, light: { label: "Design load" } };
    case "wind":
      return { say: "The permit set reads the county's wind speed from the job's address and checks the roof's uplift path." };
    case "roof": {
      if (!s.roof) return { say: "No roof — it's an open deck. Say \"add a gable roof\" to cover it.", pending: { ask: "Add a roof?", yes: [{ do: "structure", to: "covered-deck" }] } };
      return { say: `${ROOF_KIND_LABEL[d.roof.kind].split(" — ")[0]}${d.structure === "pergola" ? "" : ` at ${d.roof.pitch}/12`}, ${d.structure === "pergola" ? `${d.roof.slats.size} slats ${d.roof.slats.spacingIn} in. apart` : ROOFING_LABEL[d.roof.roofing].toLowerCase()}, the headers ${inWords(d.roof.eaveHeightIn)} up, on ${plural(s.roof.posts.length, "post")}.${pkg.takeoff.roofSquares ? ` ${Math.round(pkg.takeoff.roofAreaSqFt)} sq ft of roof — ${pkg.takeoff.roofSquares} squares.` : ""}`, light: { label: "Roofing", step: "step-roof" } };
    }
    case "electrical":
      return { say: s.electrical.on ? `${electricalWords(s.electrical)}. The feed runs ${d.electrical.feedFt} ft from the house's panel.` : "No electrical yet — say \"add lights\", \"add a heater\" or \"add an outlet\"." };
    case "spa":
      return { say: d.spa.on ? `A ${ftWords(d.spa.widthFt)} × ${ftWords(d.spa.depthFt)} hot-tub spot at the ${d.spa.align === "centre" ? "middle" : d.spa.align}, the joists under it doubled — a filled tub is about 100 psf.` : "No hot-tub spot yet. Want one? The frame under it gets doubled for the water.", pending: d.spa.on ? null : { ask: "Add a hot-tub spot?", yes: [{ do: "spa", on: true }] }, light: d.spa.on ? { label: "Where the tub stands" } : null };
    case "lower":
      return { say: d.lower.on ? `A lower level, ${ftWords(d.lower.widthFt)} × ${ftWords(d.lower.depthFt)}, ${inWords(d.lower.dropIn)} below the main deck.` : "One level. Say \"add a lower level\" for a step-down platform." };
    case "colors": {
      const now = deckingProduct(d.decking.product);
      const line = DECKING.filter((p) => (now.brand ? p.brand === now.brand : p.family === now.family));
      const named = line.map((p) => `${p.label.replace(/^(Trex|TimberTech|Fiberon|Deckorators|MoistureShield) /, "")} (${colorName(p.color)})`);
      return { say: `It's ${now.label}${now.family === "composite" || now.family === "pvc" || now.family === "mineral" ? ` (${colorName(now.color)})` : ""}. In ${now.brand ?? now.family}: ${named.filter((x) => !x.startsWith(now.label.replace(/^(Trex|TimberTech|Fiberon|Deckorators|MoistureShield) /, ""))).slice(0, 5).join(", ")}. Say a color — "make it dark gray" — and I'll pick the closest board.` };
    }
    case "options":
      return { say: "Boards: treated wood, cedar or redwood, hardwoods like ipe, modified wood, capped composite (Trex, TimberTech, Fiberon, Deckorators, MoistureShield), PVC, mineral-based and aluminum. Rails: wood, cedar, composite, vinyl, aluminum, cable or glass. Say \"compare the packages\" for Good, Better and Best prices." };
    case "what":
      return { say: `${structureWords(d)}${hasDeck(d) && fr ? `, ${inWords(d.heightIn)} up, ${boardWords(fr.decking)}` : ""} — ${dollars(pkg.subtotal)} before tax.` };
    case "help":
      return { say: "Ask me anything about it — the concrete, the boards, the price, the code, the permit — or tell me what to change." };
    case "compare":
      return { say: "" };
  }
}
