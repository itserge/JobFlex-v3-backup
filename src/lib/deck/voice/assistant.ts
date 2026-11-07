// THE ASSISTANT: WHAT WAS SAID, DONE AND ANSWERED (2026-10-21) — pure.
//
// Owner: "you would suggest and maybe talk back and show it in a 3D how it's gonna look" … "make sure when I speak to
// design my deck it shows in a live 3D, and everywhere switching numbers, design, sizes, in a live mode." One sentence
// in; out comes the new design (the studio puts it on screen at once — the 3D, the form's numbers, the price), the part
// to light or fly to, the fields to flash, and a short reply to say back: what was done, what the price did, and — where
// the change opened one — the next thing a good estimator would ask ("it's over 30 in. — add a railing?"). A question
// waiting for a yes is kept until the next sentence. What the rules could not read is handed back for the AI.

import { autoFixable } from "../settle";
import { applyDeckPatch, deckChecks, type DeckCheck } from "../checks";
import { buildStructure } from "../structure";
import { hasDeck, type DeckDesign, type FixtureKind } from "../design";
import type { FieldFocus } from "../fieldParts";
import { priceDeck, type DeckPackage } from "../pricing";
import { answer } from "./answer";
import { CHANGES, FIXTURE_SAY, type DeckCommand, type PartName } from "./commands";
import { bestHearing, matchRail, parseUtterance, type ParseContext, type Subject } from "./parse";
import { runCommand, type Flash, type Meta, type Outcome, type Pending, type RunEnv, type ViewChange } from "./run";
import { dollars, firstSentence, normalizeSpeech } from "./words";
import { isPraise } from "./speak";

export interface VoiceState {
  subject: Subject | null;
  last: DeckCommand | null;
  fixture: FixtureKind | null;
  pending: Pending | null;
  /** Suggestions already made, not made twice. */
  offered: string[];
}
export const freshVoiceState = (): VoiceState => ({ subject: null, last: null, fixture: null, pending: null, offered: [] });

export interface BrainEnv extends RunEnv {
  learned?: ParseContext["learned"];
  items?: ParseContext["items"];
}

export interface Reply {
  /** What was understood, cleaned. */
  heard: string;
  say: string;
  /** The design after, when it changed. */
  design: DeckDesign | null;
  light: FieldFocus | null;
  fly: [number, number, number] | null;
  flash: Flash[];
  touched: string[];
  view: ViewChange | null;
  meta: Meta & { teach?: Meta["teach"] & { cmds?: DeckCommand[] } };
  pending: Pending | null;
  /** Clauses no rule read: for the AI. */
  unknown: string[];
  chips: string[];
  state: VoiceState;
  price?: { before: number; after: number };
  /** The commands that ran (for the shop's learned phrases). */
  ran: DeckCommand[];
}

const price = (d: DeckDesign, env: RunEnv) => priceDeck(d, { rates: env.rates, market: env.market });
const failIds = (cs: readonly DeckCheck[]) => new Set(cs.filter((c) => c.level === "fail").map((c) => c.id));

/** Showing a part: its light (or, for the parts the owner keeps plain — stairs, rail, house — a flight there). */
function showPart(part: PartName, fixture: FixtureKind | undefined, pkg: DeckPackage): { say: string; light: FieldFocus | null; fly: [number, number, number] | null; view: ViewChange } {
  const d = pkg.design;
  const s = pkg.structure;
  const ask = (q: Parameters<typeof answer>[0]) => answer(q, "", pkg, []).say;
  switch (part) {
    case "joists":
      return { say: ask("joists"), light: { label: "Joists" }, fly: null, view: { xray: true } };
    case "beams":
      return { say: ask("beams"), light: { label: "Beams", step: "Frame" }, fly: null, view: { xray: true } };
    case "posts":
      return { say: ask("posts"), light: { label: "Posts", step: "Frame" }, fly: null, view: { xray: true } };
    case "roof-posts":
      return { say: s.roof ? `${s.roof.posts.length} roof posts, ${d.roof.post}.` : "No roof posts.", light: { label: "Posts", step: "step-roof" }, fly: null, view: {} };
    case "footings":
      return { say: ask("footings"), light: { label: "Footings" }, fly: null, view: { xray: true, look: "under" } };
    case "ledger":
      return { say: ask("ledger"), light: { label: "Ledger fastened with" }, fly: null, view: { xray: true } };
    case "decking":
      return { say: ask("boards"), light: { label: "Deck boards", step: "Surface" }, fly: null, view: { xray: false } };
    case "border":
      return { say: s.surface?.border ? `A ${s.surface.border === 2 ? "double " : ""}picture-frame border.` : "No border yet — say \"add a picture-frame border\".", light: { label: "Picture-frame border" }, fly: null, view: {} };
    case "fascia":
      return { say: s.surface?.fascia.on ? `Fascia over ${Math.round(s.surface.fascia.lf)} ft of open edge.` : "No fascia — the rim shows.", light: { label: "Fascia", step: "Surface" }, fly: null, view: {} };
    case "frame":
      return { say: ask("layout").replace(" Watch it go together.", ""), light: { label: "Framing lumber" }, fly: null, view: { xray: true } };
    case "blocking":
      return { say: "The blocking between the joists.", light: { label: "Mid-span blocking" }, fly: null, view: { xray: true } };
    case "braces":
      return { say: d.framing.braces ? "Knee braces at the corner posts." : "No knee braces.", light: { label: "Knee braces at corner posts" }, fly: null, view: { xray: true } };
    case "hardware":
      return { say: ask("hardware"), light: null, fly: null, view: { connections: true, xray: true } };
    case "rails":
      return { say: ask("rail"), light: null, fly: hasDeck(d) ? [d.shape.widthFt / 2, d.shape.depthFt, d.heightIn / 12 + 2] : null, view: {} };
    case "stairs": {
      const st = s.stairs[0];
      if (!st) return { say: ask("stairs"), light: null, fly: null, view: {} };
      const x = st.footprint.reduce((a, p) => a + p.x, 0) / Math.max(1, st.footprint.length) / 12;
      const y = st.footprint.reduce((a, p) => a + p.y, 0) / Math.max(1, st.footprint.length) / 12;
      return { say: ask("stairs"), light: null, fly: [x, y, Math.max(0.5, st.riseIn / 24)], view: {} };
    }
    case "roof":
      return { say: ask("roof"), light: s.roof ? { label: "Roofing", step: "step-roof" } : null, fly: null, view: { reset: true } };
    case "rafters":
      return { say: s.roof ? "The rafters." : ask("roof"), light: { label: "Rafters", step: "step-roof" }, fly: null, view: {} };
    case "headers":
      return { say: s.roof ? `The headers, ${Math.round(d.roof.eaveHeightIn / 12 * 10) / 10} ft up.` : ask("roof"), light: { label: "Headers", step: "step-roof" }, fly: null, view: {} };
    case "gutters":
      return { say: d.roof.gutters.kind === "none" || !s.roof ? "No gutters." : "The gutters and downspouts.", light: { label: "Gutters", step: "step-roof" }, fly: null, view: {} };
    case "ceiling":
      return { say: d.roof.ceiling === "none" ? "Open ceiling — the rafters show." : "The ceiling.", light: { label: "Ceiling", step: "step-roof" }, fly: null, view: { look: "under" } };
    case "walls":
      return { say: d.roof.walls.fill === "none" ? "Open between the posts." : "The walls between the posts.", light: { label: "Walls between the posts", step: "step-roof" }, fly: null, view: {} };
    case "slats":
      return { say: `${d.roof.slats.size} slats ${d.roof.slats.spacingIn} in. apart.`, light: { label: "Slats", step: "step-roof" }, fly: null, view: {} };
    case "cupola":
      return { say: d.roof.cupola ? "The cupola at the peak." : "No cupola — say \"add a cupola\".", light: { label: "Cupola at the peak" }, fly: null, view: {} };
    case "slab":
      return { say: d.floor === "slab" ? "The new concrete slab — it is in the price." : d.floor === "existing" ? "The existing slab — not in the price." : "It doesn't stand on a slab.", light: { label: "It stands" }, fly: null, view: {} };
    case "lights": {
      const f = d.electrical.fixtures.find((x) => !fixture || x.kind === fixture);
      if (!f) return { say: fixture ? `No ${FIXTURE_SAY[fixture][1]} yet — say "add ${FIXTURE_SAY[fixture][1]}".` : "No lights yet — say \"add post cap lights\" or \"add string lights\".", light: null, fly: null, view: {} };
      return { say: "Here they are after dark.", light: { label: "x", step: "step-electrical", fixture: f.id }, fly: null, view: { night: true } };
    }
    case "electrical":
      return { say: ask("electrical"), light: { label: "Panel to the structure", step: "step-electrical" }, fly: null, view: { night: true } };
    case "spa":
      return { say: ask("spa"), light: d.spa.on ? { label: "Where the tub stands" } : null, fly: null, view: {} };
    case "lower":
      return { say: ask("lower"), light: d.lower.on ? { label: "Along the house", level: "lower" } : null, fly: null, view: {} };
    case "house":
      return { say: "The house behind the deck.", light: null, fly: null, view: { reset: true, look: "yard" } };
    case "size":
      return { say: ask("area"), light: { label: "Along the house", step: "step-shape" }, fly: null, view: { look: "top" } };
    case "height":
      return { say: ask("height"), light: { label: "Deck height" }, fly: null, view: { look: "front" } };
    default:
      return { say: "", light: null, fly: null, view: { reset: true } };
  }
}

/** Good, Better and Best — or the boards and rails named ("composite and wood") — priced side by side on this deck. */
function compare(about: string, d: DeckDesign, env: RunEnv): { say: string; pending: Pending | null } {
  const t = about.toLowerCase();
  const kinds: Array<[RegExp, string, DeckCommand[]]> = [
    [/\b(?:wood|treated|pressure treated|pt|lumber)\b/, "treated wood", [{ do: "decking", set: { family: "treated" } }]],
    [/\bcomposite\b/, "composite", [{ do: "decking", set: { family: "composite" } }]],
    [/\b(?:pvc|azek)\b/, "PVC", [{ do: "decking", set: { product: "pvc" } }]],
    [/\bcedar\b/, "cedar", [{ do: "decking", set: { product: "cedar-54" } }]],
    [/\b(?:ipe|hardwood)\b/, "ipe", [{ do: "decking", set: { product: "ipe-1x6" } }]],
    [/\btrex\b/, "Trex", [{ do: "decking", set: { product: "trex-enhance-naturals" } }]],
    [/\btimbertech\b/, "TimberTech", [{ do: "decking", set: { product: "timbertech-prime-plus" } }]],
    [/\bfiberon\b/, "Fiberon", [{ do: "decking", set: { product: "fiberon-good-life" } }]],
    [/\baluminum\b/, "an aluminum rail", [{ do: "rail", set: { type: "aluminum" } }]],
    [/\bcable\b/, "a cable rail", [{ do: "rail", set: { type: "cable" } }]],
    [/\bglass\b/, "a glass rail", [{ do: "rail", set: { type: "glass" } }]],
    [/\bvinyl\b/, "a vinyl rail", [{ do: "rail", set: { type: "vinyl" } }]],
  ];
  const named = kinds.filter(([re]) => re.test(t)).map(([, label, cmds]) => ({ label, cmds }));
  const options = named.length >= 2
    ? named
    : [
        { label: "Good (treated boards, wood rail)", cmds: [{ do: "decking", set: { tier: "good" } }] as DeckCommand[] },
        { label: "Better (capped composite, composite rail)", cmds: [{ do: "decking", set: { tier: "better" } }] as DeckCommand[] },
        { label: "Best (premium composite, aluminum rail)", cmds: [{ do: "decking", set: { tier: "best" } }] as DeckCommand[] },
      ];
  const priced = options.map((o) => {
    let x = d;
    for (const c of o.cmds) x = runCommand(x, c, env).design;
    return { ...o, price: price(x, env).subtotal };
  });
  const now = price(d, env).subtotal;
  const cheapest = priced.reduce((a, b) => (b.price < a.price ? b : a));
  const say = `${priced.map((p) => `${p.label.charAt(0).toUpperCase()}${p.label.slice(1)}: ${dollars(p.price)}`).join(" · ")}. It's ${dollars(now)} as it stands.${named.length < 2 ? ' Say "the better package" to switch.' : ""}`;
  return { say, pending: cheapest.price < now - 1 ? { ask: `Switch to ${cheapest.label}?`, yes: cheapest.cmds } : null };
}

/** "Is 2x8 enough for the joists?" — the size asked for, laid out by the tables, against what stands. */
function joistAnswer(about: string, d: DeckDesign, env: RunEnv): string | null {
  const m = /\b(2x(?:6|8|10|12))\b/.exec(about);
  const now = price(d, env);
  const fr = now.frame;
  if (!m || !fr) return null;
  const size = m[1] as "2x6" | "2x8" | "2x10" | "2x12";
  const beamOut = (f: NonNullable<typeof fr>) => (f.beams.length ? Math.round(Math.max(...f.beams.map((b) => b.y)) / 12) : null);
  if (size === fr.joistSize) return `Yes — ${size} at ${fr.spacingIn} in. on center is what the code tables use here${beamOut(fr) ? `, with the beam about ${beamOut(fr)} ft out` : ""}.`;
  const alt = applyDeckPatch(d, { framing: { joist: size } });
  const s = buildStructure(alt, { rates: env.rates, market: env.market });
  const fails = deckChecks(s).filter((c) => c.level === "fail" && /^joist/.test(c.id));
  if (fails.length || !s.frame) return `No — ${size} won't span it at ${fr.spacingIn} in. on center. ${fails[0] ? firstSentence(fails[0].text) : ""} The tables use ${fr.joistSize}.`.replace(/\s+/g, " ").trim();
  const delta = Math.round(price(alt, env).subtotal - now.subtotal);
  const lines = (f: NonNullable<typeof fr>) => [...new Set(f.beams.map((b) => Math.round(b.y / 12)))].sort((a, b) => a - b);
  const was = lines(fr);
  const will = lines(s.frame);
  const beams = will.join(",") === was.join(",") ? "" : will.length > was.length ? ` with ${will.length} beams (${will.join(" and ")} ft out) where ${fr.joistSize} needs ${was.length}` : ` with the beam at about ${will[will.length - 1]} ft out`;
  return `Yes — ${size} works${beams}, ${delta === 0 ? "for the same price" : `${dollars(Math.abs(delta))} ${delta > 0 ? "more" : "less"}`}. Say "${size} joists" to use it.`;
}

/** What to say next, given what was just done — one suggestion at most, never twice. */
function suggest(before: DeckDesign, after: DeckDesign, checksBefore: readonly DeckCheck[], checksAfter: readonly DeckCheck[], offered: string[]): { say: string; pending: Pending; key: string } | null {
  const newFails = checksAfter.filter((c) => c.level === "fail" && !failIds(checksBefore).has(c.id));
  if (newFails.length && autoFixable([...checksAfter]) > 0) {
    const c = newFails[0];
    return { say: `Heads up — ${c.part.toLowerCase()}: ${firstSentence(c.text)} Say "fix it" and I'll sort it.`, pending: { ask: "Fix it?", yes: [{ do: "autofix" }] }, key: `fail:${c.id}` };
  }
  const deck = hasDeck(after);
  if (deck && after.heightIn > 30 && after.rail.type === "none" && before.rail.type === "none" && !offered.includes("guard")) {
    const type = matchRail(after);
    return { say: `It's over 30 in. up, so the code wants a guard. Add a ${type === "treated" ? "wood" : type} railing?`, pending: { ask: "Add a railing?", yes: [{ do: "rail", set: { type } }] }, key: "guard" };
  }
  const resized = before.heightIn !== after.heightIn || before.shape.widthFt !== after.shape.widthFt || before.shape.depthFt !== after.shape.depthFt;
  if (deck && after.heightIn > 10 && !after.stairs.length && !offered.includes("stairs") && resized) {
    return { say: "Want stairs down the front?", pending: { ask: "Add stairs down the front?", yes: [{ do: "stairs", op: "add", side: "front" }] }, key: "stairs" };
  }
  return null;
}

/** The next things to try, by what was just talked about. */
function chipsFor(subject: Subject | null, d: DeckDesign): string[] {
  const deck = hasDeck(d);
  const base = deck ? ["Make it bigger", d.stairs.length ? "Move the stairs left" : "Add stairs", "How much concrete?", "Show me at night"] : ["Make it bigger", "Steeper roof", "Show me at night"];
  switch (subject) {
    case "stairs":
      return ["Wider stairs", "Move them to the left side", "Handrails on both sides", "How many steps?"];
    case "rail":
      return ["Cable railing", "42-inch railing", "Add post cap lights", "How much is the railing?"];
    case "decking":
      return ["Darker", "Lighter", "Picture-frame border", "Hidden fasteners", "Diagonal boards"];
    case "roof":
    case "pitch":
    case "eave":
    case "overhang":
      return ["Steeper", "Higher ceiling", "Add a ceiling fan", "Standing-seam metal", "Screen it in"];
    case "height":
      return ["A little higher", "How many steps?", "Do I need a permit?", "Add a railing"];
    case "fixture":
      return ["Add string lights", "Add a heater", "Show it at night", "Daytime"];
    case "spa":
      return ["Bigger hot tub", "Move it to the left", "Can it hold a hot tub?"];
    case "lower":
      return ["Make the lower level bigger", "Two steps down", "Add stairs from the lower level"];
    case "house":
      return ["Two-story house", "Blue siding", "Bump-out on the right"];
    case "frame":
      return ["2x10 joists", "12 inches on center", "Show me the frame", "How is it built?"];
    default:
      return deck ? [...base, "What does it cost?"] : base;
  }
}

/**
 * The commands, carried out in order on the design, with the talk-back. `confirmed` runs the ones that ask first
 * (start over, make the proposal) — they come here again from a "yes".
 */
export function runCommands(cmds: readonly DeckCommand[], design: DeckDesign, state: VoiceState, env: BrainEnv, heard = "", opts: { confirmed?: boolean; whatIf?: { words: string; show: boolean } | null } = {}): Reply {
  const said: string[] = [];
  let d = design;
  let light: FieldFocus | null = null;
  let fly: [number, number, number] | null = null;
  const flash: Flash[] = [];
  const touched: string[] = [];
  let view: ViewChange | null = null;
  const meta: Reply["meta"] = {};
  let pending: Pending | null = null;
  let changed = false;
  const settledNotes: string[] = [];
  const ran: DeckCommand[] = [];
  let nextState: VoiceState = { ...state, pending: null };
  const mergeView = (v: ViewChange | undefined) => {
    if (v && Object.keys(v).length) view = { ...(view ?? {}), ...v };
  };
  const pkgBefore = price(design, env);
  const checksBefore = deckChecks(pkgBefore.structure);
  let pkgNow: DeckPackage = pkgBefore;
  let checksNow: DeckCheck[] = checksBefore;
  const refresh = () => {
    if (pkgNow.design !== d) {
      pkgNow = price(d, env);
      checksNow = deckChecks(pkgNow.structure);
    }
  };

  const seen = new Set<string>();
  let ranStructure = false;
  for (const cmd of cmds) {
    // The same command twice in one sentence ("a covered porch with a hip roof" names the cover twice) runs once.
    const key = JSON.stringify(cmd);
    if (seen.has(key)) continue;
    seen.add(key);
    ran.push(cmd);
    if (cmd.do === "confirm") {
      if (!cmd.yes && state.pending) said.push("OK, leaving it.");
      continue;
    }
    if (cmd.do === "ask" && cmd.q === "compare") {
      const c = compare(cmd.about ?? heard, d, env);
      said.push(c.say);
      if (c.pending) pending = c.pending;
      continue;
    }
    if (cmd.do === "ask" && cmd.q === "joists") {
      const j = joistAnswer(cmd.about ?? heard, d, env);
      if (j) {
        said.push(j);
        light = { label: "Joists" };
        continue;
      }
    }
    if (cmd.do === "ask") {
      refresh();
      const a = answer(cmd.q, cmd.about ?? heard, pkgNow, checksNow);
      said.push(a.say);
      if (a.light) light = a.light;
      mergeView(a.view);
      if (a.pending) pending = a.pending;
      if (a.meta) Object.assign(meta, a.meta);
      continue;
    }
    if (cmd.do === "show") {
      refresh();
      const sh = showPart(cmd.part, cmd.fixture, pkgNow);
      if (sh.say) said.push(sh.say);
      light = sh.light;
      fly = sh.fly;
      mergeView({ tab: "3d", ...sh.view });
      continue;
    }
    if (cmd.do === "compare" || cmd.do === "whatif") continue;
    if ((cmd.do === "reset" || cmd.do === "sample") && !opts.confirmed && (design.stairs.length || design.structure !== "deck" || design.shape.widthFt !== 16 || design.shape.depthFt !== 12)) {
      pending = { ask: cmd.do === "reset" ? "Start a new deck? This clears the design." : "Start from that sample? It replaces the design.", yes: [cmd] };
      said.push(cmd.do === "reset" ? "Start a new deck from scratch? Say yes to clear this one." : "That replaces what's here — say yes to start from the sample.");
      continue;
    }
    if (cmd.do === "save" && opts.confirmed) {
      meta.save = true;
      said.push("Making the proposal.");
      continue;
    }
    const o: Outcome = runCommand(d, cmd, ranStructure ? { ...env, freshRoof: true } : env);
    if (cmd.do === "structure") ranStructure = true;
    if (o.said.length) said.push(...o.said);
    if (o.design !== d) {
      d = o.design;
      changed = true;
      nextState = { ...nextState, last: cmd };
    }
    if (o.light !== undefined) light = o.light;
    if (o.fly) fly = o.fly;
    if (o.flash) flash.push(...o.flash);
    if (o.touched) touched.push(...o.touched);
    mergeView(o.view);
    if (o.pending) pending = o.pending;
    if (o.meta) Object.assign(meta, o.meta);
    if (o.settled) for (const n of o.settled) if (!settledNotes.includes(n)) settledNotes.push(n);
    if (cmd.do === "fixture") nextState.fixture = cmd.kind;
  }

  // Teaching: the words of a taught phrase are read now, so a phrase that cannot be done is refused at once.
  if (meta.teach) {
    const taught = parseUtterance(meta.teach.words, { design, subject: null, learned: env.learned, items: env.items });
    const tcmds = taught.clauses.flatMap((c) => c.cmds);
    if (taught.clauses.length && taught.clauses.every((c) => !c.unknown) && tcmds.length) {
      meta.teach = { ...meta.teach, cmds: tcmds };
      said.push(`Got it — when you say "${meta.teach.phrase}", I'll do that.`);
    } else {
      said.push(`I couldn't read what to do for "${meta.teach.phrase}" — say it another way.`);
      delete meta.teach;
    }
  }

  let priceInfo: Reply["price"];
  if (changed) {
    refresh();
    priceInfo = { before: pkgBefore.subtotal, after: pkgNow.subtotal };
    if (settledNotes.length) said.push(`Sized to the tables: ${settledNotes.slice(0, 2).join("; ").replace(/\.$/, "")}.`);
    const delta = Math.round(pkgNow.subtotal - pkgBefore.subtotal);
    if (Math.abs(delta) >= 1) said.push(`Price ${dollars(pkgNow.subtotal)} (${delta > 0 ? "up" : "down"} ${dollars(Math.abs(delta))}).`);
    if (!pending) {
      const sg = suggest(design, d, checksBefore, checksNow, state.offered);
      if (sg) {
        said.push(sg.say);
        pending = sg.pending;
        nextState = { ...nextState, offered: [...nextState.offered, sg.key] };
      }
    }
    if (!view || !("tab" in (view as ViewChange))) mergeView({ tab: "3d" });
  }

  // What-if: the same commands on a copy; the price said, the change offered.
  if (opts.whatIf && !opts.whatIf.show) {
    const delta = Math.round(pkgNow.subtotal - pkgBefore.subtotal);
    const lead = /^\d/.test(opts.whatIf.words) ? `At ${opts.whatIf.words}` : `With ${opts.whatIf.words}`;
    const said2 = `${lead}, it would be ${dollars(pkgNow.subtotal)} — ${delta === 0 ? "the same" : `${dollars(Math.abs(delta))} ${delta > 0 ? "more" : "less"}`}. Want me to make it?`;
    return {
      heard,
      say: said2,
      design: null,
      light: null,
      fly: null,
      flash: [],
      touched: [],
      view: null,
      meta: {},
      pending: { ask: "Make that change?", yes: cmds.filter((c) => CHANGES.has(c.do)) },
      unknown: [],
      chips: ["Yes", "No", "What else would it cost?"],
      state: { ...state, pending: { ask: "Make that change?", yes: cmds.filter((c) => CHANGES.has(c.do)) } },
      ran: [],
    };
  }
  if (opts.whatIf?.show && changed) said.unshift(`Here it is with ${opts.whatIf.words}.`);
  if (opts.whatIf?.show && changed) said.push("Keep it, or say undo.");

  const text = said.filter(Boolean).join(" ");
  return {
    heard,
    say: text,
    design: changed ? d : null,
    light,
    fly,
    flash,
    touched,
    view,
    meta,
    pending,
    unknown: [],
    chips: chipsFor(nextState.subject, d),
    state: { ...nextState, pending },
    price: priceInfo,
    ran,
  };
}

/** One sentence heard (or the recogniser's alternatives for it): understood, carried out, answered. */
export function hear(utterance: string | readonly string[], design: DeckDesign, state: VoiceState, env: BrainEnv = {}): Reply {
  const ctx: ParseContext = { design, subject: state.subject, last: state.last, fixture: state.fixture, learned: env.learned, items: env.items };
  const raw = typeof utterance === "string" ? utterance : bestHearing(utterance, ctx);
  const heard = normalizeSpeech(raw);
  // "I like it", "looks great": answered, nothing changed (it used to go to the AI).
  if (isPraise(raw) && !state.pending) return { ...runCommands([], design, state, env, heard), say: "Glad you like it. Anything you'd change?" };
  // A question waiting: a yes runs it, a no drops it, a price prices the item it asked about.
  if (state.pending) {
    const p = state.pending;
    const first = parseUtterance(raw, ctx);
    const only = first.clauses.length === 1 ? first.clauses[0].cmds : [];
    // A price, said as one: "$1,200", "1,200 dollars", "twelve hundred", "about 900", "900 each" — not a number in
    // another sentence ("privacy on 1 side" was the fire pit's $1).
    const money = /\$(\d+(?:\.\d+)?)/.exec(heard) ?? /^(?:(?:it'?s|it is|about|around|roughly|maybe|say|for|at|call it|the price is|price is)\s+)*(\d+(?:\.\d+)?)(?:\s+(?:each|apiece|total|flat))?[.!]?$/.exec(heard.trim());
    if (p.price && money && !first.clauses.some((c) => c.cmds.some((x) => CHANGES.has(x.do) && x.do !== "item"))) {
      const cmd: DeckCommand = { do: "item", op: "add", name: p.price.item, qty: 1, unit: "ea", price: Number(money[1]) };
      return runCommands([cmd], design, { ...state, pending: null }, env, heard, { confirmed: true });
    }
    if (only.length === 1 && only[0].do === "confirm") {
      if (only[0].yes) {
        const r = runCommands(p.yes, design, { ...state, pending: null }, env, heard, { confirmed: true });
        return r.say ? r : { ...r, say: "Done." };
      }
      return { ...runCommands([], design, { ...state, pending: null }, env, heard), say: "OK, leaving it." };
    }
  }
  const parsed = parseUtterance(raw, ctx);
  const cmds = parsed.clauses.flatMap((c) => c.cmds);
  const unknown = parsed.clauses.filter((c) => c.unknown).map((c) => c.text);
  const nextState: VoiceState = { ...state, subject: parsed.ctx.subject ?? state.subject, last: parsed.ctx.last ?? state.last, fixture: parsed.ctx.fixture ?? state.fixture, pending: null };
  if (parsed.whatIf) {
    const changes = cmds.filter((c) => CHANGES.has(c.do));
    if (changes.length) return { ...runCommands(changes, design, nextState, env, heard, { whatIf: parsed.whatIf }), unknown };
  }
  // A lone yes or no with nothing waiting.
  if (cmds.length === 1 && cmds[0].do === "confirm") {
    return { ...runCommands([], design, nextState, env, heard), say: "OK." };
  }
  const r = runCommands(cmds, design, nextState, env, heard);
  return { ...r, unknown };
}

/** For the AI's prompt: the design in a few lines. */
export function designSummary(d: DeckDesign): string {
  const lines = [
    `structure: ${d.structure}${d.structure !== "deck" ? ` (roof ${d.roof.kind}, pitch ${d.roof.pitch}/12, roofing ${d.roof.roofing}, ceiling ${d.roof.ceiling}, walls ${d.roof.walls.fill})` : ""}, floor: ${d.floor}`,
    `size: ${d.shape.widthFt} ft along the house × ${d.shape.depthFt} ft out (${d.shape.kind}), height ${d.heightIn} in., placement ${d.placement}, wall ${d.wall}`,
    `decking: ${d.decking.product}, pattern ${d.decking.pattern}, border ${d.decking.border}; rail: ${d.rail.type} ${d.rail.heightIn} in.`,
    `stairs: ${d.stairs.length ? d.stairs.map((s) => `${s.side} ${s.widthFt} ft${s.wrap ? " wrap" : ""}`).join(", ") : "none"}; lower level: ${d.lower.on ? `${d.lower.widthFt}×${d.lower.depthFt}` : "no"}; hot tub: ${d.spa.on ? "yes" : "no"}`,
    `fixtures: ${d.electrical.fixtures.map((f) => `${f.qty} ${f.kind}`).join(", ") || "none"}; house: ${d.house.storeys} story, ${d.house.siding} siding`,
  ];
  return lines.join("\n");
}
