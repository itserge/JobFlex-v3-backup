// HOW PEOPLE TALK TO DECK STUDIO (2026-10-21) — pure.
//
// Owner: "add as much as possible commands that could exist to work in Deck Studio as a human being. The way they talk,
// and understand their meaning … not just two by twelve — it would understand 'bigger', and you would suggest and talk
// back and show it in 3D … show me this, how it's going to lay down, how much concrete I need … anything."
//
// A sentence, cleaned (words.ts), is cut into its commands; each is read by the rules below into the commands of
// commands.ts. A rule reads its own words — the stairs rule the side, the width and the landing; the roof rule the
// shape, the pitch and the ceiling — so "a 6 ft stair on the left onto the patio" and "make the roof steeper" are each
// one rule's business. Which rule reads a clause is decided by what the clause is ABOUT: the first thing named after
// the verb ("add a roof over the hot tub" is about the roof). Words that name nothing new ("bigger", "a bit more",
// "the other side") are read against what was talked about last. What no rule reads is handed on (to the AI, or
// asked back) — never guessed into a change.

import { DECKING, deckingProduct, type DeckingFamily } from "../catalog";
import type { CustomSlot, DeckDesign, FixtureKind, NotchCorner, RoofKind, Roofing, StairSide } from "../design";
import { stateName } from "../stateCodes";
import {
  COLORS,
  DECKING_FAMILY_WORDS,
  DECKING_NAMES,
  FIXTURE_WORDS,
  NOT_DRAWN,
  ROOF_COLOUR_WORDS,
  SAMPLE_WORDS,
  SIDING_WORDS,
  type Amount,
  type DeckCommand,
  type DeckingSet,
  type FramingSet,
  type Look,
  type PartName,
  type Question,
  type RailSet,
  type RoofSet,
  type StairAt,
  type StairPick,
} from "./commands";
import { QUESTION_HEAD, halfFt, normalizeSpeech, phraseKey, splitClauses, trimClause } from "./words";

/** What the last command was about: "bigger", "more", "the other side" read against it. */
export type Subject = "deck" | "width" | "depth" | "height" | "stairs" | "rail" | "roof" | "pitch" | "eave" | "overhang" | "lower" | "spa" | "decking" | "house" | "fixture" | "frame" | "slats";

export interface ParseContext {
  design: DeckDesign;
  subject: Subject | null;
  /** The fixture talked about last ("make it two"). */
  fixture?: FixtureKind | null;
  /** The last command that moved something by an amount: "more", "again", "a bit less" repeat or undo it. */
  last?: DeckCommand | null;
  /** Phrases this shop taught, by their cleaned words. */
  learned?: Readonly<Record<string, DeckCommand[]>>;
  /** Items this shop priced before, by their name in lower case. */
  items?: Readonly<Record<string, { name: string; unit: "ea" | "pcs" | "ft" | "sq ft" | "bags"; price: number }>>;
}

export interface ClauseRead {
  /** The clause as read. */
  text: string;
  cmds: DeckCommand[];
  subject: Subject | null;
  /** Nothing in it was understood: the AI reads it, or it is asked back. */
  unknown: boolean;
}

type Read = { cmds: DeckCommand[]; subject: Subject | null } | null;
const read = (cmds: DeckCommand[], subject: Subject | null): Read => (cmds.length ? { cmds, subject } : null);

/* ------------------------------------------------------------------ */
/*  Numbers in a clause                                                */
/* ------------------------------------------------------------------ */

type Unit = "ft" | "in" | "sqft" | "%" | "$" | "psf" | null;
interface Num {
  n: number;
  unit: Unit;
  at: number;
}
/** Lumber ("2x12", "2-2x10"), a pitch ("8/12 pitch"), "5/4" and ordinals are not amounts. */
const NOT_AMOUNT = /\b\d+-\d+x\d+s?\b|\b\d+(?:\/\d+)?x\d+s?\b|\b\d{1,2}\/12 pitch\b|\b5\/4\b|\b\d+(?:st|nd|rd|th)\b|\b\d+ v(?:olts?)?\b|\b\d+ ?kw\b|\b\d+ ?(?:degrees?|deg)\b/g;
function nums(c: string): Num[] {
  const masked = c.replace(NOT_AMOUNT, (m) => "#".repeat(m.length));
  const out: Num[] = [];
  const re = /(\$)?(\d+(?:\.\d+)?)(%| (?:ft|in|sqft|psf)\b)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const unit: Unit = m[1] ? "$" : m[3] ? (m[3].trim() as Unit) : null;
    out.push({ n: Number(m[2]), unit, at: m.index });
  }
  return out;
}
/** "20 by 14", "20 ft x 14 ft": a size pair (lumber is already "2x12" and never matches). */
function pair(c: string): { a: Num; b: Num } | null {
  const masked = c.replace(NOT_AMOUNT, (m) => "#".repeat(m.length));
  const m = /(\d+(?:\.\d+)?)( ft| in)? (?:by|x) (\d+(?:\.\d+)?)( ft| in)?/.exec(masked);
  if (!m) return null;
  const ua = (m[2]?.trim() || null) as Unit;
  const ub = (m[4]?.trim() || null) as Unit;
  return { a: { n: Number(m[1]), unit: ua ?? ub, at: m.index }, b: { n: Number(m[3]), unit: ub ?? ua, at: m.index + m[0].length } };
}
const ftOf = (x: Num) => (x.unit === "in" ? x.n / 12 : x.n);
const money = (c: string): number | null => {
  const m = /\$(\d+(?:\.\d+)?)/.exec(c);
  return m ? Number(m[1]) : null;
};
/** The "N" of "N ft"/"N in" said as a length, in feet — a bare number taken as feet. */
function lengthFt(c: string): number | null {
  const n = nums(c).find((x) => x.unit === "ft" || x.unit === "in" || x.unit === null);
  return n ? ftOf(n) : null;
}

/* ------------------------------------------------------------------ */
/*  How much, and which way                                            */
/* ------------------------------------------------------------------ */

const SMALL_STEP = /\b(?:a (?:little|bit|tad|touch|smidge|hair|skosh)|slightly|little bit|tiny bit|just a bit|barely|a little bit|bit)\b/;
const BIG_STEP = /\b(?:a lot|lots|much|way|significantly|a bunch|quite a bit|a good bit|considerably|a ton|really|way more)\b/;
const step = (c: string, small: number, normal: number, big: number) => (SMALL_STEP.test(c) ? small : BIG_STEP.test(c) ? big : normal);
/** A number said as a change ("4 ft deeper", "by 2", "add 2 ft", "raise it 6 in"), not as the value to take. */
const RELATIVE_CUE = /\bby \$?\d|\b\d+(?:\.\d+)?(?: ft| in|%)? (?:more|less|extra|further|farther|wider|deeper|longer|higher|taller|bigger|larger|shorter|narrower|lower|smaller|shallower|out|up|down|off(?! (?:the )?(?:ground|grade|floor))|back|over|steeper|flatter)\b|\b(?:add|another|extra|extend|raise|lower|drop|take off|cut|shave|trim|push(?: it)? out|pull(?: it)? in|bump(?: it)? (?:up|down)|increase|decrease|grow|shrink|lift|move)\b(?:\s+(?!(?:a|an|one)\b)[a-z]+){0,3}\s+\d|\b(?:bring|pull|push|move|take|put|set|drop|shift)(?: it| the deck)? (?:in|out|back|up|down|over)\b/;
const ABSOLUTE_CUE = /\b(?:to|at|is|be|=|exactly|equal to|set to|of) \$?\d/;

/** The number said for this quantity as an amount: absolute ("to 20"), relative ("4 more", sign from the words), or a factor ("double"). */
function amountOf(c: string, n: number | null, dir: 1 | -1 | 0): Amount | null {
  if (/\b(?:double|twice(?: as)?)\b/.test(c) && n === null) return { times: 2 };
  if (/\b(?:triple|three times)\b/.test(c) && n === null) return { times: 3 };
  if (/\b(?:half(?: as)?|halve|in half)\b/.test(c) && n === null) return { times: 0.5 };
  const pct = /\b(\d+(?:\.\d+)?)% (bigger|larger|more|longer|wider|deeper|smaller|less|shorter|narrower)\b/.exec(c);
  if (pct) return { times: 1 + ((/smaller|less|shorter|narrower/.test(pct[2]) ? -1 : 1) * Number(pct[1])) / 100 };
  if (n === null) return null;
  const relative = RELATIVE_CUE.test(c) && !ABSOLUTE_CUE.test(c);
  if (relative) return { by: (dir === -1 ? -1 : 1) * n };
  return { to: n };
}

const UP = /\b(?:more|bigger|larger|wider|longer|deeper|higher|taller|up|raise|raised|extend|increase|add|grow|expand|further|farther|out|steeper|lift|plus|enlarge|widen|deepen|lengthen|heighten|boost|bump(?: it)? up)\b/;
const DOWN = /\b(?:less|smaller|narrower|shorter|shallower|lower|down|reduce|decrease|shrink|cut|trim|take off|minus|flatter|tighter|closer|in|back|drop|shave|narrow|shorten|bump(?: it)? down)\b/;
const dirOf = (c: string, up = UP, down = DOWN): 1 | -1 | 0 => {
  const u = up.test(c);
  const d = down.test(c);
  return u && !d ? 1 : d && !u ? -1 : 0;
};

/* ------------------------------------------------------------------ */
/*  Verbs                                                              */
/* ------------------------------------------------------------------ */

const ADD_VERB = /\b(?:add|put|place|install|include|give (?:me|it|us|them)|want|need|get|attach|throw in|stick|mount|hang|have|create|bring|insert|i'll take|we'll take|make room for|room for|spot for|space for|plus|with|build|set up|let's have|i'd like|another|extra)\b/;
const REMOVE_VERB = /\b(?:remove|delete|take (?:off|out|away|down)|take (?:the |that |those |these |my |it |them |all the )?(?:[a-z]+ ){0,2}(?:off|out|away)\b|get (?:the |that |it |them )?(?:[a-z]+ ){0,2}off\b|get rid of|no|without|drop the|lose|ditch|eliminate|scrap|cancel|skip|nix|don't (?:want|need)|do not (?:want|need)|no more|minus|kill|clear off|turn off|none)\b/;
const CHANGE_VERB = /\b(?:make|set|change|switch|turn|move|use|go with|swap|replace|convert|update|adjust|shift|slide|raise|lower|increase|decrease|extend|shrink|widen|narrow|deepen|bump|push|pull|flip|rotate|center|put)\b/;
const isRemove = (c: string) => REMOVE_VERB.test(c);

/* ------------------------------------------------------------------ */
/*  What a clause is about                                             */
/* ------------------------------------------------------------------ */

const STAIR_WORDS = /\b(?:stairs?|steps?|staircases?|stairway|stairwell|stringers?|treads?|risers?|handrails?)\b/;
const RAIL_WORDS = /\b(?:railings?|rails?|guards?|guardrails?|balusters|balustrade)\b/;
const SPA_WORDS = /\b(?:hot tub|spa|tub)\b/;
const LOWER_WORDS = /\b(?:lower (?:level|deck|platform|landing|tier|section|part)|second level|bottom level|two levels?|2 levels?|two[- ]tier(?:ed)?(?: deck)?|multi[- ]?level|step[- ]?down (?:deck|platform|level|section)|tiered deck|split[- ]level deck|landing (?:deck|platform))\b/;
const FIX_WORDS = new RegExp(FIXTURE_WORDS.map(([re]) => re.source).join("|"));
const LIGHT_WORDS = /\b(?:lights?|lighting|lamps?|leds?|bulbs?)\b/;
const ROOF_WORDS = /\b(?:roofs?|roofing|pitch|rafters?|ridge|shingles?|shakes|gutters?|downspouts?|ceiling|eaves?|headers?|cupola|soffit|covered|cover(?:ing)?|porch|patio cover|shelter|pergola|gazebo|pavilion|trellis|arbor|slats?|louver(?:ed)?|screen(?:ed)?(?: in| porch| room)?|screens|lattice|privacy (?:walls?|panels?|screens?)|walls between|metal roof|tin roof|standing seam|overhead|more shade|less shade|more sun|less sun|pagoda|gambrel|dutch gable|pyramid|purlins?|rake boards?|rakes)\b/;
const OVERHANG_WORD = /\boverhangs?\b/;
const HOUSE_WORDS = /\b(?:house|home|siding|bump ?out|nook|ranch|rambler|colonial|bungalow|(?:1|2|one|two|single) story)\b/;
const DECKING_WORDS = /\b(?:decking|deck boards?|boards?|planks?|surface|floor ?boards?|flooring|walking surface|border|picture ?frame|fascia|fasteners?|clips|pattern|herringbone|chevron|diagonal(?:ly)?|waste)\b/;
const FRAME_WORDS = /\b(?:joists?|beams?|girders?|posts?|framing|frame|ledger|footings?|footers?|piers?|blocking|braces?|bracing|rim|cantilever|lumber|hardware|concrete|sonotube|lags?|bolts?|hold ?downs?|stainless|galvanized|species|fir|pine|spf|spruce)\b/;

/** The subject named first in the clause decides which rule reads it first. */
function headOf(c: string, roofed = false): Subject | null {
  const hits: Array<[Subject, number]> = [];
  const at = (re: RegExp) => {
    const m = re.exec(c);
    return m ? m.index : -1;
  };
  const push = (s: Subject, i: number) => i >= 0 && hits.push([s, i]);
  push("fixture", Math.max(at(FIX_WORDS), -1));
  push("stairs", at(STAIR_WORDS));
  push("rail", at(RAIL_WORDS));
  push("spa", at(SPA_WORDS));
  push("lower", at(LOWER_WORDS));
  push("roof", at(ROOF_WORDS));
  if (roofed) push("roof", at(OVERHANG_WORD));
  if (ADD_VERB.test(c) || /\b(?:timer|photocell)\b/.test(c)) push("fixture", at(LIGHT_WORDS));
  push("house", at(HOUSE_WORDS));
  push("decking", at(DECKING_WORDS));
  push("frame", at(FRAME_WORDS));
  if (!hits.length) return null;
  hits.sort((a, b) => a[1] - b[1]);
  return hits[0][0];
}

/* ------------------------------------------------------------------ */
/*  Control: yes, no, undo, stop, help                                 */
/* ------------------------------------------------------------------ */

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|go for it|please do|sounds good|perfect|let's do it|let's go|confirm|apply|apply it|absolutely|of course|definitely|correct|that's right|yes please|ok do it|make it so|why not|do that|please|yes do it|yeah do it|sure thing|you bet|great|good|alright|all right|fine|cool|sounds great|that works|works for me)$/;
const NO = /^(?:no|nope|nah|cancel|don't|do not|leave it|skip|skip it|not now|keep it|forget it|no thanks|no thank you|never ?mind|not really|negative|no way|leave it as is|keep it as is|don't do it|no don't)$/;
const UNDO = /^(?:undo(?: that| it| the last (?:one|change|thing)| please)?|go back|take (?:that|it) back|revert(?: that| it)?|put it back(?: how it was| the way it was| like it was)?|back up|step back|reverse (?:that|it)|cancel (?:that|the last (?:one|change))|oops|whoops|my bad|that's wrong|wrong|i didn't mean that|not that|go back (?:one|a step))$/;
const REDO = /^(?:redo(?: that| it)?|do (?:that|it) again|undo the undo|bring it back|put it back again)$/;
const STOP = /^(?:stop listening|that's all|that is all|i'm done|i am done|we're done|done talking|goodbye|good bye|bye|bye bye|turn off (?:the )?mic(?:rophone)?|mic off|stop the mic|stop|close|close it|hang up|end)$/;
const MUTE = /^(?:be quiet|mute|mute (?:yourself|the voice|voice|it)|stop talking|silence|shush|quiet|shut up|no voice|don't talk|text only|stop reading|less talking)$/;
const UNMUTE = /^(?:talk to me|unmute|speak|voice on|talk back|read it to me|read (?:it )?out loud|say it|speak up|turn (?:on )?(?:the )?voice(?: on)?|talk)$/;
const HELP = /^(?:help|help me|what can (?:you|i) (?:do|say|ask)|what do you (?:do|know|understand)|how does this work|how do i use (?:this|you)|commands|show (?:me )?(?:the )?commands|examples|what can i ask(?: you)?|options|what are my options|what should i say)$/;
const AGAIN = /^(?:again|same again|once more|one more time|keep going|more of that|do that again|repeat that|repeat|more|a (?:little|bit|tad|touch) more|a little bit more|even more|further|go further|bit more|some more|little more)$/;
const LESS_AGAIN = /^(?:less|a (?:little|bit|tad|touch) less|a little bit less|not so much|too much|back a (?:bit|little)|go back a (?:bit|little)|bit less|little less|that's too much|too far|less than that)$/;

function readControl(c: string, raw: string, ctx: ParseContext): Read {
  const t = c || raw;
  if (YES.test(raw) || YES.test(t)) return read([{ do: "confirm", yes: true }], ctx.subject);
  if (NO.test(raw) || NO.test(t)) return read([{ do: "confirm", yes: false }], ctx.subject);
  if (UNDO.test(t)) return read([{ do: "undo" }], ctx.subject);
  if (REDO.test(t)) return read([{ do: "redo" }], ctx.subject);
  if (STOP.test(t)) return read([{ do: "stop" }], ctx.subject);
  if (MUTE.test(t)) return read([{ do: "mute", on: true }], ctx.subject);
  if (UNMUTE.test(t)) return read([{ do: "mute", on: false }], ctx.subject);
  if (HELP.test(t)) return read([{ do: "help" }], ctx.subject);
  if (/^(?:wait|hold on|hang on|one (?:sec|second|moment)|just a (?:sec|second|moment)|let me think|hmm+|um+|uh+)$/.test(t)) return read([{ do: "keep", what: "" }], ctx.subject);
  const keep = /^(?:keep|leave|don't change|do not change|don't touch|hold) (?:the )?(.+)$/.exec(t);
  if (keep && !/\b(?:going|it up|on)\b/.test(keep[1])) return read([{ do: "keep", what: keep[1] }], ctx.subject);
  // "more", "a bit more", "again": the last change by an amount, once more; "less", "too much": half of it back.
  if (ctx.last && (AGAIN.test(t) || LESS_AGAIN.test(t))) {
    const back = LESS_AGAIN.test(t);
    const scale = back ? -0.5 : SMALL_STEP.test(t) ? 0.5 : 1;
    const again = scaleCommand(ctx.last, scale);
    if (again) return read([again], ctx.subject);
  }
  return null;
}

/** A relative command scaled ("more" = once more, "a bit less" = half back); null when it was not relative. */
export function scaleCommand(cmd: DeckCommand, k: number): DeckCommand | null {
  const sc = (a: Amount | undefined): Amount | undefined => (a && "by" in a ? { by: Math.round(a.by * k * 100) / 100 } : a && "times" in a ? { times: k < 0 ? 1 / a.times : a.times } : undefined);
  const any = (a: Amount | undefined) => !!a && ("by" in a || "times" in a);
  switch (cmd.do) {
    case "size":
      return any(cmd.width) || any(cmd.depth) ? { do: "size", width: sc(cmd.width), depth: sc(cmd.depth), from: cmd.from } : null;
    case "height":
      return any(cmd.in) ? { do: "height", in: sc(cmd.in)! } : null;
    case "lower":
      return any(cmd.width) || any(cmd.depth) || any(cmd.dropIn) ? { do: "lower", width: sc(cmd.width), depth: sc(cmd.depth), dropIn: sc(cmd.dropIn) } : null;
    case "spa":
      return any(cmd.width) || any(cmd.depth) ? { do: "spa", width: sc(cmd.width), depth: sc(cmd.depth) } : null;
    case "stairs":
      if (cmd.op !== "change") return null;
      if (cmd.at && typeof cmd.at === "object" && "by" in cmd.at) return { ...cmd, at: { by: Math.round(cmd.at.by * k * 100) / 100 } };
      return any(cmd.width) ? { ...cmd, width: sc(cmd.width) } : null;
    case "roof": {
      const s = cmd.set;
      const keys = ["pitch", "eaveIn", "overhangIn", "slatSpacingIn", "widthFt", "depthFt", "acrossFt", "offsetFt"] as const;
      const out: RoofSet = {};
      let hit = false;
      for (const key of keys) if (any(s[key])) { out[key] = sc(s[key]); hit = true; }
      return hit ? { do: "roof", set: out } : null;
    }
    case "slide":
      return typeof cmd.ft === "number" ? { do: "slide", ft: Math.round(cmd.ft * k * 2) / 2 } : null;
    case "fixture":
      return any(cmd.qty) ? { ...cmd, qty: sc(cmd.qty) } : null;
    case "decking":
      return cmd.set.shade ? { do: "decking", set: { shade: k < 0 ? (cmd.set.shade === "lighter" ? "darker" : "lighter") : cmd.set.shade } } : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Teach, forget, name, address                                       */
/* ------------------------------------------------------------------ */

function readMeta(c: string, raw: string): Read {
  const teach = /^(?:when(?:ever)? i say|if i say|when i tell you)\s+(.+?)(?:,\s*|\s+(?:it means|that means|i mean|you should|then|please)\s+|\s+(?=(?:make|set|use|give|add|remove|put|switch|change|show|turn|build|go|do)\b))(.+)$/.exec(raw);
  if (teach) return read([{ do: "teach", phrase: teach[1].replace(/^["']|["']$/g, "").trim(), words: teach[2].trim() }], null);
  const forget = /^forget (?:that|it|what i (?:taught|told) you|the phrase |about |what )?(.*)$/.exec(c);
  if (forget && !/\b(?:roof|stairs|rail|deck|lights?)\b/.test(forget[1])) return read([{ do: "forget", phrase: forget[1].replace(/^["']|["']$/g, "").trim() || undefined }], null);
  const name = /^(?:call|name|title|label) (?:it|this|the (?:deck|job|project|design|draft|estimate))\s+(?:as\s+)?(.+)$/.exec(c) ?? /^(?:the )?(?:name|title) (?:is|should be|will be) (.+)$/.exec(c);
  if (name) return read([{ do: "name", title: titleCase(name[1].replace(/^["']|["']$/g, "")) }], null);
  const addr = /^(?:the )?(?:job |site |property )?address (?:is|to|should be|=|will be)\s+(.+)$/.exec(c) ?? /^(?:set|change|update|put) (?:the )?(?:job |site )?address (?:to |as )?(.+)$/.exec(c) ?? /^(?:it's|it is|the job is|this is|the house is|we're) (?:at|on) (\d+ .+)$/.exec(c);
  if (addr && /\d/.test(addr[1])) return read([{ do: "address", text: addressCase(addr[1]) }], null);
  return null;
}
const titleCase = (s: string) => s.trim().replace(/\s+/g, " ").replace(/\b([a-z])/g, (m) => m.toUpperCase()).slice(0, 120);
/** "1840 meadow glen dr allen tx 75002" → "1840 Meadow Glen Dr Allen TX 75002". */
function addressCase(s: string): string {
  const words = s.trim().replace(/\s+/g, " ").split(" ");
  return words
    .map((w, i) => {
      const nextIsZip = /^\d{5}(?:-\d{4})?$/.test(words[i + 1] ?? "");
      if (/^[a-z]{2}$/.test(w) && (nextIsZip || i === words.length - 1) && stateName(w)) return w.toUpperCase();
      return w.replace(/^([a-z])/, (m) => m.toUpperCase());
    })
    .join(" ")
    .slice(0, 300);
}

/* ------------------------------------------------------------------ */
/*  Questions                                                          */
/* ------------------------------------------------------------------ */

const ASK_TOPICS: ReadonlyArray<[RegExp, Question]> = [
  [/\b(?:compare|comparison|difference between|versus|vs|which is (?:better|cheaper)|cheapest way|cheaper way|good,? better,? (?:and )?best|the packages|packages|save (?:some )?money|budget options?)\b/, "compare"],
  [/\b(?:options|choices|what kinds? of|which brands?|what brands?)\b/, "options"],
  [/\b(?:concrete|cement|quikrete|sakrete|ready[- ]?mix|bags? of|yards? of|cubic)\b/, "concrete"],
  [/\b(?:attached|attach|connected|connect|fastened|hooked|bolted|tied) (?:in)?to (?:the )?house\b|\bhow (?:is|does) it (?:attach|connect|hook up)\b/, "ledger"],
  [/\b(?:holds? it up|supports? it|holding it up|keeps? it up|what's under(?:neath)? it|under the deck)\b/, "frame"],
  [/\b(?:lay(?:s)? (?:down|out)|laid|which way|what direction|direction|how (?:do|will|are|does) the (?:boards|joists|decking) (?:go|run|lay|sit)|run(?:s)? (?:parallel|perpendicular)|how (?:is it|will it be|it's|it is) (?:framed|laid out|built|put together)|framing layout|layout)\b/, "layout"],
  [/\b(?:footings?|footers?|piers?|holes|dig|how deep)\b/, "footings"],
  [/\b(?:screws?|fasteners?|clips|nails)\b/, "screws"],
  [/\b(?:boards?|decking|planks?)\b/, "boards"],
  [/\b(?:lumber|material list|materials list|shopping list|what (?:do i|should i|to) (?:need to )?(?:buy|order|get)|order list|what do i need)\b/, "lumber"],
  [/\b(?:hangers?|connectors?|hardware|simpson|brackets?)\b/, "hardware"],
  [/\b(?:per (?:square foot|sqft|sq ft)|a square foot|price per foot)\b/, "perSqFt"],
  [/\b(?:labor|labour|materials? (?:vs|versus|and) labor|crew cost)\b/, "labor"],
  [/\b(?:how long (?:will|does|would) it take|days|hours|timeline|schedule|how long to build|build time)\b/, "time"],
  [/\b(?:permit|permits|inspection|inspector|approval|allowed|legal)\b/, "permit"],
  [/\b(?:pass|problems?|issues?|errors?|wrong|fail(?:ing|s)?|safe|is it (?:ok|okay|good|right|fine)|good to go|red flags?|warnings?|any checks)\b/, "checks"],
  [/\b(?:code|irc|building code|which code|what code)\b/, "code"],
  [/\b(?:lay(?:s)? (?:down|out)|laid|which way|what direction|direction|how (?:do|will|are|does) the (?:boards|joists|decking) (?:go|run|lay|sit)|run(?:s)? (?:parallel|perpendicular)|how (?:is it|will it be|it's|it is) (?:framed|laid out|built|put together)|framing layout|layout)\b/, "layout"],
  [/\bjoists?\b/, "joists"],
  [/\b(?:beams?|girders?)\b/, "beams"],
  [/\bposts?\b/, "posts"],
  [/\bledger\b/, "ledger"],
  [/\b(?:stairs?|steps?|risers?|treads?|rise|run)\b/, "stairs"],
  [/\b(?:railings?|rails?|guards?|guardrails?)\b/, "rail"],
  [/\bfrost\b/, "frost"],
  [/\bsnow\b/, "snow"],
  [/\bwind\b|\bhurricane\b/, "wind"],
  [/\b(?:hot tub|spa|tub)\b/, "spa"],
  [/\b(?:weight|hold|capacity|load|how much can it)\b/, "load"],
  [/\b(?:roof|shingles?|rafters?|squares)\b/, "roof"],
  [/\b(?:wire|wiring|circuits?|electric(?:al)?|power|amps?|breakers?)\b/, "electrical"],
  [/\blower (?:level|deck)\b/, "lower"],
  [/\b(?:colou?rs?|shades?)\b/, "colors"],
  [/\b(?:what else|which (?:boards|decking|railings?)|brands)\b/, "options"],
  [/\b(?:cost|price|how much|total|budget|estimate|charge|quote|expensive|cheap)\b/, "price"],
  [/\b(?:how big|square (?:feet|footage)|sqft|area|size|dimensions|how wide|how deep|how long)\b/, "area"],
  [/\b(?:how high|how tall|height|off the ground)\b/, "height"],
  [/\b(?:what (?:is|are) (?:this|these|that|those|it)|what am i looking at|what's (?:this|that))\b/, "what"],
];

/** What-if: "what if it was 20 by 16", "how much would composite cost", "how much more for an aluminum railing". */
const WHATIF_HEAD = /^(?:what if (?:i |we )?(?:made it|make it|went with|go with|used|use|had|have|added|add|switched to|switch to|changed (?:it )?to|did|do)?|what about|how about|suppose (?:i |we )?|let's say|say we|imagine|how much (?:would|will|does|is) it (?:cost|be|run) (?:with|if|to|for)|how much (?:more|extra|less) (?:would it be |will it be |is it |does it cost )?(?:for|with|to|if)|how much (?:would|will|does|do) (?:a|an|the|some)? ?(.+?) (?:cost|add|run|be)|what (?:would|will) it cost (?:with|if|to)|price (?:it )?(?:with|if)|what's the price (?:with|if|for)|what does it cost (?:with|if|to))\s*/;
/** "show me with a gable roof", "what would it look like with composite": made, and shown — undo takes it back. */
const SHOW_WITH = /^(?:show me|show|see|let me see|let's see|lemme see|i want to see|i'd like to see|can i see|can you show me) (?:it |me )?(?:what it (?:would |will |)(?:look|looks) like |how (?:it|that) (?:would|will|is gonna|is going to|'d|looks?) (?:look )?|how it looks |it )?(?:with|as|in|if)\s+(.+)$|^what (?:would|will|does) it look like (?:with|as|in|if)\s+(.+)$|^how (?:would|will|does) (?:it|that) look (?:with|as|in|if)\s+(.+)$/;

/* ------------------------------------------------------------------ */
/*  The view                                                           */
/* ------------------------------------------------------------------ */

const LOOK_WORDS: ReadonlyArray<[RegExp, Look]> = [
  [/\b(?:from (?:the )?(?:top|above)|top view|(?:show (?:me )?|see )(?:the |it from the )?top|the top|top[- ]down|bird'?s?[- ]?eye|overhead(?: view)?|aerial|from up high|looking down|plan from above)\b/, "top"],
  [/\b(?:from (?:the )?(?:bottom|below|underneath|under)|under(?:neath)? the deck|underside|from beneath|worm'?s?[- ]?eye|looking up|bottom view|underneath|under it|below it)\b/, "under"],
  [/\b(?:from (?:the )?left(?: side)?|left side view|left view)\b/, "left"],
  [/\b(?:from (?:the )?right(?: side)?|right side view|right view|see the side|the side view|side view|from the side)\b/, "right"],
  [/\b(?:from (?:the )?(?:house|door|kitchen|inside|window|back door|patio door|deck))\b/, "house"],
  [/\b(?:from (?:the )?(?:front|yard|backyard|lawn|garden|street|back of the yard)|front view|straight on)\b/, "front"],
  [/\b(?:spin(?: it)?|rotate(?: it)?|turn (?:it )?around|360|walk (?:me )?around(?: it)?|orbit|all (?:the )?sides|all around|go around(?: it)?|every angle|all angles)\b/, "spin"],
];

function readView(c: string): Read {
  const cmd: Extract<DeckCommand, { do: "view" }> = { do: "view" };
  let hit = false;
  const set = <K extends keyof typeof cmd>(k: K, v: (typeof cmd)[K]) => {
    cmd[k] = v;
    hit = true;
  };
  const viewish = /\b(?:show|see|view|look|display|switch|go to|open|turn|put|make it|give me|let me|switch to|back to|how|watch|play|at|in|mode)\b/.test(c) || c.split(" ").length <= 3;
  if (/\b(?:framing plan|plan view|floor plan|blueprints?|layout drawing|2d|top[- ]down drawing|framing drawing|the plan|drawing)\b/.test(c) && viewish) set("tab", "plan");
  else if (/\b(?:house (?:and|&) deck|wall view|house view|the house wall|wall drawing|wall plan)\b/.test(c)) set("tab", "wall");
  else if (/\b(?:3d|three dimensional|back to (?:the )?model|the model|3d view)\b/.test(c)) set("tab", "3d");
  if (/\b(?:(?:turn )?off (?:the )?xray|xray off|no xray|solid|normal view|put the boards back)\b/.test(c)) set("xray", false);
  else if (/\b(?:xray|see[- ]?through|transparent|see inside|see the (?:frame|framing)|(?:show|see) (?:me )?(?:the )?(?:frame|framing|structure|bones|skeleton|substructure)(?: underneath| under| below)?|under the boards|without (?:the )?boards|hide (?:the )?boards)\b/.test(c)) set("xray", true);
  if (/\b(?:day|daytime|day time|daylight|morning|sunny|noon|turn off the lights|lights off)\b/.test(c) && viewish) set("night", false);
  else if (/\b(?:night|nighttime|night time|evening|after dark|at dark|dusk|sunset|turn on the lights|lights on|(?:show|see) (?:them |it |the lights )?lit|lit up|in the dark|light (?:it )?up)\b/.test(c)) {
    set("night", true);
    // "Show me at night": the whole deck in the evening, not the last part the camera flew to (2026-10-22).
    if (/\b(?:show|see|view|look)\b/.test(c)) set("reset", true);
  }
  if (/\b(?:hide (?:the )?connections|connections off)\b/.test(c)) set("connections", false);
  else if (/\b(?:connections?|how (?:is it|it's|it is|they're|are they|does it|do they) (?:connected|attached|fastened|held|tied|connect|attach)|connectors|joinery|the details|how (?:it|they) (?:connect|attach))\b/.test(c)) set("connections", true);
  if (/\b(?:(?:stop|pause) (?:the )?(?:build|building|animation)|stop building)\b/.test(c)) set("build", "stop");
  else if (/\b(?:finish(?:ed)? (?:it|building)|show (?:it )?finished|skip to the end|done building|show the finished)\b/.test(c)) set("build", "done");
  else if (/\b(?:build it(?: up)?|show (?:me )?how (?:it's|it is|it gets|they are|they're|you|it) (?:built|go(?:es)? together|framed|put together|lay(?:s)? down|laid(?: down)?|goes up|assembled|constructed)|how (?:it|they) (?:lay|lays|go|goes) (?:down|together)|step by step|construction (?:sequence|order|steps)|assemble(?: it)?|from the ground up|watch it (?:go up|being built|get built|built)|animate|animation|play (?:it|the build)|how it goes together|time ?lapse|build sequence|show the build)\b/.test(c)) set("build", "play");
  if (/\b(?:exit full(?:screen| view)?|leave full(?:screen| view)?|close full(?:screen| view)?|smaller (?:view|picture|screen)|minimi[sz]e|back to the form|normal size)\b/.test(c)) set("full", false);
  else if (/\b(?:fullscreen|bigger (?:view|picture|screen)|maximi[sz]e|full view|make (?:the )?(?:view|3d|picture|model) bigger|whole screen)\b/.test(c)) set("full", true);
  if (/\b(?:back to (?:the )?3d|3d view)\b/.test(c)) set("tab", "3d");
  if (/\b(?:done editing|stop editing|hide (?:the )?(?:handles|knobs|arrows)|editing off)\b/.test(c)) set("edit", false);
  else if (/\b(?:edit in 3d|let me drag|show (?:the )?(?:handles|knobs|arrows)|drag mode|edit mode)\b/.test(c)) set("edit", true);
  if (/\b(?:zoom out|reset (?:the )?(?:view|camera|angle)|back out|start(?:ing)? view|default view|see (?:it )?all|full picture|show (?:me )?everything)\b/.test(c) || (/\b(?:whole (?:thing|deck|structure)|the whole)\b/.test(c) && /\b(?:show|see|view|look|zoom)\b/.test(c) && !/\b(?:bigger|smaller|wider|longer|deeper)\b/.test(c))) set("reset", true);
  const lookish = /\b(?:show|see|view|look|looking|watch|angle|camera|perspective|vantage|turn|spin|rotate|orbit|walk|go)\b/.test(c) || c.split(" ").length <= 4;
  for (const [re, look] of LOOK_WORDS) {
    if (lookish && re.test(c)) {
      set("look", look);
      // "Spin it around": the whole deck goes round, not the part the camera last flew to (2026-10-22).
      if (look === "spin") set("reset", true);
      break;
    }
  }
  return hit ? read([cmd], null) : null;
}

/* ------------------------------------------------------------------ */
/*  Show me a part                                                     */
/* ------------------------------------------------------------------ */

const PART_WORDS: ReadonlyArray<[RegExp, PartName]> = [
  [/\broof posts?\b/, "roof-posts"],
  [/\bjoists?\b/, "joists"],
  [/\b(?:beams?|girders?)\b/, "beams"],
  [/\b(?:posts?|columns?)\b/, "posts"],
  [/\b(?:footings?|footers?|piers?|concrete|holes|foundation)\b/, "footings"],
  [/\bledger\b/, "ledger"],
  [/\b(?:border|picture[- ]?frame)\b/, "border"],
  [/\b(?:fascia|rim cover)\b/, "fascia"],
  [/\bblocking\b/, "blocking"],
  [/\b(?:knee )?brac(?:es|ing)\b/, "braces"],
  [/\b(?:hardware|hangers?|connectors?|brackets?|bolts|lags)\b/, "hardware"],
  [/\b(?:frame|framing|structure|substructure|skeleton|bones)\b/, "frame"],
  [/\b(?:decking|deck boards?|boards|surface|floor(?:ing)?|planks?)\b/, "decking"],
  [/\b(?:rail(?:ing)?s?|guards?|balusters)\b/, "rails"],
  [/\b(?:stairs?|steps?|staircase)\b/, "stairs"],
  [/\brafters?\b/, "rafters"],
  [/\bheaders?\b/, "headers"],
  [/\b(?:gutters?|downspouts?)\b/, "gutters"],
  [/\bceiling\b/, "ceiling"],
  [/\b(?:slats?|louvers?)\b/, "slats"],
  [/\bcupola\b/, "cupola"],
  [/\bslab\b/, "slab"],
  [/\b(?:walls|screens?|lattice|privacy panels?)\b/, "walls"],
  [/\broof\b/, "roof"],
  [/\b(?:wir(?:es|ing)|electrical|circuits?)\b/, "electrical"],
  [/\b(?:hot tub|spa|tub)\b/, "spa"],
  [/\blower (?:level|deck)\b/, "lower"],
  [/\b(?:house|home)\b/, "house"],
  [/\b(?:size|dimensions?|measurements?|width|depth)\b/, "size"],
  [/\b(?:height|how high)\b/, "height"],
];

function readShow(c: string): Read {
  const m = /^(?:show(?: me)?|let me see|let's see|let's look at|see|view|highlight|point (?:out|to)|where (?:is|are)|find|zoom (?:in )?(?:on|to)|focus (?:on)?|look at|fly (?:me )?to|take me to|go to|what do (?:the|my) (.+?) look like|can i see)\s+(?:me\s+)?(?:the |my |our |all the |those |these )?(.+)$/.exec(c);
  const rest = m ? (m[2] ?? m[1] ?? "") : "";
  if (!m || !rest) return null;
  for (const [re, kind] of FIXTURE_WORDS) if (re.test(rest)) return read([{ do: "show", part: "lights", fixture: kind }], "fixture");
  if (LIGHT_WORDS.test(rest)) return read([{ do: "show", part: "lights" }], "fixture");
  for (const [re, part] of PART_WORDS) if (re.test(rest)) return read([{ do: "show", part }], null);
  if (/^(?:it|the deck|the whole (?:deck|thing)|everything|my deck|the deck again)$/.test(rest)) return read([{ do: "view", reset: true, tab: "3d" }], null);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Open, go, save, samples, reset, fix                                */
/* ------------------------------------------------------------------ */

function readPlaces(c: string): Read {
  if (/\b(?:permit (?:set|sheets?|drawings?|plans?|package|pages?)|construction (?:drawings|plans)|print (?:the )?(?:permit|plans|drawings)|plans for the (?:county|city|inspector|permit)|submittal|the permit)\b/.test(c) && /\b(?:open|print|show|see|get|make|give|pull up|bring up|download|view|need|want|where)\b/.test(c)) return read([{ do: "open", what: "permit" }], null);
  if (/\b(?:lumber list|materials? list|shopping list|order list|yard list|list for the (?:lumber )?yard|what (?:do i|to) order|materials? to order|pick list|takeoff)\b/.test(c)) return read([{ do: "open", what: "yard" }], null);
  if (/\b(?:installer(?:'s)? (?:sheet|list|copy)|crew (?:sheet|list|copy)|cut list|for the (?:installer|crew)|install sheet)\b/.test(c)) return read([{ do: "open", what: "installer" }], null);
  if (/\b(?:save (?:it |this )?(?:as )?(?:a )?proposal|make (?:a |the )?proposal|create (?:a |the )?proposal|turn (?:it|this) into a proposal|convert (?:it |this )?(?:to|into) (?:a )?proposal|write (?:up )?(?:a |the )?proposal)\b/.test(c)) return read([{ do: "save" }], null);
  if (/\b(?:price breakdown|the package|line items|the price list|package (?:and|&) price|break ?down the price|itemi[sz]ed|send (?:it )?to (?:the )?(?:client|customer|homeowner))\b/.test(c)) return read([{ do: "open", what: "package" }], null);
  if (/\b(?:code checks|the checks|check ?list|show (?:me )?the (?:problems|issues|fails))\b/.test(c)) return read([{ do: "open", what: "checks" }], null);
  const go = /^(?:go to|scroll to|jump to|take me to|open) (?:the )?(size|type|kind|house|materials?|stairs?(?: and rails?)?|rails?|roof|lights|extras|electrical|checks?|package|price) ?(?:section|step|part|page|tab)?$/.exec(c);
  if (go) {
    const w = go[1];
    const to = /size/.test(w) ? "size" : /type|kind/.test(w) ? "kind" : /house/.test(w) ? "house" : /material/.test(w) ? "materials" : /stair|rail/.test(w) ? "stairs" : /roof/.test(w) ? "roof" : /light|extra|electric/.test(w) ? "extras" : /check/.test(w) ? "checks" : "package";
    return read([{ do: "go", to }], null);
  }
  if (/^(?:start (?:over|fresh|again|from scratch|a new (?:one|deck))|new (?:deck|design)|clear (?:it|everything|the design|all)|reset (?:it|everything|the (?:design|deck)|all)|from scratch|blank (?:slate|deck)|wipe it(?: out)?|begin again|start a new deck)$/.test(c)) return read([{ do: "reset" }], null);
  if (/\b(?:(?:auto[- ]?)?fix (?:it|that|this|them|everything|all(?: of it)?|the (?:problems?|errors?|issues?|checks?|code (?:issues?|problems?)|fails?|red ones|warnings?)|what'?s wrong|whatever'?s wrong)|make it (?:pass|legal|code compliant|compliant|safe|work|right)|bring it (?:up )?to code|pass (?:the )?code|auto[- ]?fix|resolve (?:the )?(?:checks|issues|problems)|meet (?:the )?code|up to code|code compliant)\b/.test(c)) return read([{ do: "autofix" }], null);
  const sample = /\b(?:start (?:over )?(?:from|with)|use|load|open|try|show me|give me|pull up|bring up) (?:a |an |the |one of the |your )?(.+?) ?(?:sample|example|template|preset|starter|design idea)s?\b/.exec(c) ?? /\b(?:sample|example|template|preset)s? (?:of |for |with )?(?:a |an |the )?(.+)$/.exec(c);
  if (sample) {
    const words = sample[1];
    for (const [re, id] of SAMPLE_WORDS) if (re.test(words)) return read([{ do: "sample", id }], "deck");
    return read([{ do: "sample", id: "deck-classic" }], "deck");
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Stairs                                                             */
/* ------------------------------------------------------------------ */

function stairSide(c: string): { side?: StairSide; at?: StairAt; both?: boolean } {
  if (/\b(?:both sides|each side|either side|left and right|two sides)\b/.test(c)) return { both: true };
  const corner = /\b(?:front[- ]?(left|right)(?: corner)?|(left|right) (?:front )?corner|(left|right) end(?: of the front)?|(?:at|on) the (left|right) end|far (left|right))\b/.exec(c);
  if (corner) return { side: "front", at: (corner[1] ?? corner[2] ?? corner[3] ?? corner[4] ?? corner[5]) as "left" | "right" };
  if (/\b(?:on|to|at|down|off|from|along|go(?:es)? (?:down )?(?:the|to the)) (?:the )?left(?: side| edge| hand side)?\b|\bleft[- ](?:side|hand side|edge)\b|\bleft (?:stairs|steps)\b/.test(c)) return { side: "left" };
  if (/\b(?:on|to|at|down|off|from|along|go(?:es)? (?:down )?(?:the|to the)) (?:the )?right(?: side| edge| hand side)?\b|\bright[- ](?:side|hand side|edge)\b|\bright (?:stairs|steps)\b/.test(c)) return { side: "right" };
  if (/\b(?:front|out the front|down the front|in front|toward the yard|towards the yard|into the yard|straight out|off the end|at the end|the far edge|facing the yard)\b/.test(c)) return { side: "front" };
  return {};
}

function readStairs(c: string, ctx: ParseContext): Read {
  if (!STAIR_WORDS.test(c)) return null;
  // "Two steps down to a lower level" is how far down the lower level sits, not a stair.
  if (LOWER_WORDS.test(c) && /\b(?:\d+|one|two|three|a) steps? down\b/.test(c)) return null;
  if (FIX_WORDS.test(c) && !/\bhandrails?\b/.test(c)) return null;
  const d = ctx.design;
  const n = d.stairs.length;
  const where = stairSide(c);
  const lower = /\b(?:from|off|on|to|for) (?:the )?lower (?:level|deck)\b|\blower (?:level )?(?:stairs|steps)\b/.test(c) ? "lower" : undefined;
  const wrap = /\b(?:wrap(?:[- ]?around)?|box steps?|steps? all (?:the way )?around|full[- ]width (?:steps|stairs)|cascad(?:e|ing) (?:steps|stairs)|bleacher (?:steps|stairs)|step down all (?:the way )?around|around the (?:deck|front)|steps? along the (?:whole |entire )?front|(?:whole|entire|full) front)\b/.test(c);
  const wrapSides = /\b(?:four|4|all) sides\b|\ball (?:the way )?around\b/.test(c) ? 4 : /\b(?:three|3) sides\b|\baround the sides\b|\bwrap(?:s)? the sides\b/.test(c) ? 3 : wrap ? 1 : undefined;
  const landing = /\b(?:onto|on|to|into) (?:a |the )?(?:new )?(?:concrete )?pad\b|\bconcrete (?:landing|pad)\b/.test(c) ? "pad" : /\b(?:patio|existing (?:patio|slab|concrete)|walkway|sidewalk|driveway|walk)\b/.test(c) ? "patio" : /\b(?:pavers?|stepping stones?|gravel|grass|lawn|dirt|the ground|on grade)\b/.test(c) ? "grade" : undefined;
  const handrail = /\bhandrails? on both sides\b|\btwo handrails\b|\bboth handrails\b|\bhandrails? (?:on )?each side\b/.test(c) ? "both" : /\bone handrail\b|\bhandrail on one side\b|\bsingle handrail\b|\bjust one handrail\b/.test(c) ? "one" : /\bno handrails?\b|\bwithout (?:a |any )?handrails?\b|\bremove (?:the )?handrails?\b/.test(c) ? "none" : /\bhandrails?\b/.test(c) ? "both" : undefined;
  // The width: "6 ft wide", "wider", a bare number at stair size (≤ 12 ft), inches over 12.
  let width: Amount | undefined;
  const wNum = nums(c).find((x) => x.unit !== "$" && x.unit !== "%" && x.unit !== "sqft" && x.unit !== "psf" && !/\b\d+(?:\.\d+)? (?:ft |in )?(?:from|off|in from)\b/.test(c.slice(x.at)));
  const wDir = dirOf(c, /\b(?:wider|bigger|broader|larger|widen)\b/, /\b(?:narrower|smaller|skinnier|thinner|narrow)\b/);
  const widthSaid = /\b(?:wide|width|wider|narrower|bigger|smaller|broader|skinnier|widen|narrow)\b/.test(c);
  if (widthSaid || (wNum && wNum.unit && /\b\d+(?:\.\d+)? (?:ft|in) (?:wide )?(?:stairs?|steps?|staircase)\b/.test(c))) {
    if (wNum) {
      const ft = wNum.unit === "in" || (wNum.unit === null && wNum.n > 12) ? wNum.n / 12 : wNum.n;
      width = amountOf(c, ft, wDir) ?? undefined;
    } else if (wDir) width = { by: wDir * step(c, 0.5, 1, 2) };
  }
  const fromNum = /\b(\d+(?:\.\d+)?)(?: ft| in)? (?:in )?from (?:the )?(left|right|house|corner|end|front)\b/.exec(c);
  // Which stair: by its side, its order, the last one, or all.
  const ord = /\b(first|second|third|fourth|1st|2nd|3rd|4th|other|last|new|newest|front|left|right)\b (?:set of )?(?:stairs?|steps?|staircase)/.exec(c);
  let which: StairPick | undefined;
  if (/\ball (?:the |of the )?(?:stairs|steps)\b|\bevery (?:stair|step)\b/.test(c)) which = "all";
  else if (ord) {
    const w = ord[1];
    which = w === "first" || w === "1st" ? { index: 0 } : w === "second" || w === "2nd" ? { index: 1 } : w === "third" || w === "3rd" ? { index: 2 } : w === "fourth" || w === "4th" ? { index: 3 } : w === "last" || w === "new" || w === "newest" || w === "other" ? "last" : { side: w as StairSide };
  }
  const flip = /\b(?:flip|mirror|other side|opposite side|swap sides)\b/.test(c);
  // "Handrails on both sides": the stairs' handrails — never two more stairs; with no stairs, the deck's railing.
  if (/\bhandrails?\b/.test(c) && !/\b(?:stairs?|steps?|staircases?|stairway)\b/.test(c)) {
    if (!n) return read([{ do: "rail", set: { type: d.rail.type === "none" ? matchRail(d) : d.rail.type } }], "rail");
    return read([{ do: "stairs", op: "change", which: n > 1 ? "all" : "only", handrail: handrail ?? "both" }], "stairs");
  }
  const remove = isRemove(c) && !/\bno handrails?\b|\bwithout (?:a |any )?handrails?\b/.test(c);
  const moving = /\b(?:move|slide|shift|scoot|turn|switch|relocate|bring|push|center|centre)\b/.test(c) || /\bput (?:the|them|those|it)\b/.test(c);
  const adding = (ADD_VERB.test(c) && !moving) || /\b(?:another|second|extra|more|two|2|both sides) (?:set of |sets of )?(?:stairs|steps)\b/.test(c);
  if (remove) {
    if (!n) return read([{ do: "keep", what: "the stairs — there are none" }], "stairs");
    return read([{ do: "stairs", op: "remove", which: which ?? (where.side ? { side: where.side } : n === 1 ? "only" : "last") }], "stairs");
  }
  if (!n || adding || (wrap && !d.stairs.some((s) => s.wrap))) {
    const count = where.both ? 2 : /\b(?:two|2) (?:sets of )?(?:stairs|steps)\b/.test(c) && !/\b(?:two|2) steps? (?:down|up)\b/.test(c) ? 2 : 1;
    const at: StairAt | undefined = fromNum ? { ft: Number(fromNum[1]) * (/ in$/.test(fromNum[0].split(" from")[0]) ? 1 / 12 : 1) } : /\b(?:middle|center|centered|centre)\b/.test(c) ? "center" : /\b(?:near|by|close to|next to) the house\b/.test(c) ? "house" : where.at;
    return read([{ do: "stairs", op: "add", side: where.both ? undefined : wrap ? "front" : where.side, at, width, wrap: wrap || undefined, wrapSides: wrapSides as 1 | 3 | 4 | undefined, landing, handrail, level: lower, count }], "stairs");
  }
  // A change to a stair that stands.
  const cmd: Extract<DeckCommand, { do: "stairs" }> = { do: "stairs", op: "change", which: which ?? (where.side && !moving && d.stairs.some((s) => s.side === where.side) ? { side: where.side } : undefined) };
  if (flip) cmd.flip = true;
  if (width) cmd.width = width;
  if (landing) cmd.landing = landing;
  if (handrail) cmd.handrail = handrail;
  if (lower) cmd.level = lower;
  if (wrap) {
    cmd.wrap = true;
    cmd.wrapSides = (wrapSides ?? 1) as 1 | 3 | 4;
  } else if (/\b(?:regular|normal|a flight|one flight|single flight|not wrap(?:ped)?|no wrap)\b/.test(c)) cmd.wrap = false;
  if (moving || where.side || where.at || fromNum || /\b(?:middle|center|centered|centre)\b/.test(c)) {
    const amount = nums(c).find((x) => x.unit === "ft" || x.unit === null);
    const toSide = /\bside\b/.test(c) || (where.side && where.side !== "front" && !/\b(?:a bit|a little|over|some|more)\b/.test(c) && !amount);
    if (fromNum) cmd.at = { ft: Number(fromNum[1]) };
    else if (/\b(?:middle|center|centered|centre)\b/.test(c)) cmd.at = "center";
    else if (where.at) {
      cmd.side = "front";
      cmd.at = where.at;
    } else if (where.side && toSide) cmd.side = where.side;
    else if (/\b(?:left|right)\b/.test(c)) cmd.at = { by: (/\bleft\b/.test(c) ? -1 : 1) * (amount ? ftOf(amount) : step(c, 1, 2, 4)) };
    else if (/\bover\b|\ba (?:bit|little)\b/.test(c) && !where.side) cmd.at = { by: amount ? ftOf(amount) : step(c, 1, 2, 4) };
    else if (/\b(?:toward|towards|closer to|near) the house\b/.test(c)) cmd.at = amount ? { by: -ftOf(amount) } : "house";
    else if (/\b(?:toward|towards|closer to) the (?:yard|front|end)\b|\bout(?:ward)?\b/.test(c)) cmd.at = amount ? { by: ftOf(amount) } : "out";
    else if (where.side) cmd.side = where.side;
  }
  const changed = Object.keys(cmd).length > 3 || cmd.flip;
  if (!changed) {
    // "Stairs" said with nothing to do: add another only when asked; otherwise show them.
    return read([{ do: "show", part: "stairs" }], "stairs");
  }
  return read([cmd], "stairs");
}

/* ------------------------------------------------------------------ */
/*  Railing                                                            */
/* ------------------------------------------------------------------ */

function railType(c: string): RailSet["type"] | undefined {
  if (/\bcable\b/.test(c)) return "cable";
  if (/\b(?:glass|plexi(?:glass)?|clear (?:panels?|rail)|acrylic|frameless)\b/.test(c)) return "glass";
  if (/\b(?:aluminum|metal|black|steel|iron|wrought|powder[- ]?coated)\b/.test(c)) return "aluminum";
  if (/\b(?:vinyl|white|pvc)\b/.test(c)) return "vinyl";
  if (/\b(?:composite|trex|timbertech|fiberon|azek|matching|match(?:es|ing)? the (?:deck|boards|decking))\b/.test(c)) return "composite";
  if (/\bcedar\b/.test(c)) return "cedar";
  if (/\b(?:wood(?:en)?|treated|pressure treated|lumber|pt)\b/.test(c)) return "treated";
  if (/\bcustom\b/.test(c)) return "custom";
  return undefined;
}

function readRail(c: string, ctx: ParseContext): Read {
  if (!RAIL_WORDS.test(c)) return null;
  if (FIX_WORDS.test(c) && !/\brail(?:ing)?s? (?:height|type)\b/.test(c)) return null;
  const d = ctx.design;
  if (isRemove(c) && !/\bno (?:cap|lights?)\b/.test(c)) return read([{ do: "rail", set: { type: "none" } }], "rail");
  const set: RailSet = {};
  const type = railType(c);
  if (type) set.type = type;
  const h = nums(c).find((x) => x.unit !== "$" && x.unit !== "%");
  if (h && /\b(?:high|tall|height|rail(?:ing)?s?|guards?|in|ft)\b/.test(c) && !/\b(?:apart|every|spacing|posts)\b/.test(c)) {
    const inches = h.unit === "ft" || (h.unit === null && h.n <= 4) ? h.n * 12 : h.n;
    set.heightIn = inches >= 39 ? 42 : 36;
  } else if (/\b(?:taller|higher|raise)\b/.test(c)) set.heightIn = 42;
  else if (/\b(?:shorter|lower)\b/.test(c)) set.heightIn = 36;
  else if (/\bcode height\b/.test(c)) set.heightIn = d.site.state === "CA" ? 42 : 36;
  if (/\b(?:balusters|spindle)\b/.test(c)) set.infill = "balusters";
  else if (/\bhorizontal\b/.test(c)) set.infill = "horizontal";
  else if (/\bpanels?\b/.test(c) && set.type !== "glass") set.infill = "panel";
  const spacing = /\bposts? (?:every|at|spaced|apart|on|each) (\d+(?:\.\d+)?)(?: ft)?|(\d+(?:\.\d+)?)(?: ft)? (?:apart|on center|oc|spacing)\b/.exec(c);
  if (spacing) {
    const v = Number(spacing[1] ?? spacing[2]);
    set.postSpacingFt = v <= 5 ? 4 : v <= 7 ? 6 : 8;
  }
  if (/\b(?:drink (?:rail|cap)|cocktail rail|flat cap|cap rail|2x6 cap|rail cap|bar top rail|wide cap)\b/.test(c)) set.cap = !/\bno\b/.test(c);
  if (/\blower level\b/.test(c)) set.lowerLevel = true;
  const perFt = /\$(\d+(?:\.\d+)?) (?:a|per|each) (?:foot|ft|linear foot|lf)\b/.exec(c);
  if (perFt) {
    set.type = "custom";
    set.customPerFt = Number(perFt[1]);
  }
  if (!Object.keys(set).length) {
    if (ADD_VERB.test(c) || CHANGE_VERB.test(c) || /^(?:a |the )?rail(?:ing)?s?$/.test(c) || d.rail.type === "none") return read([{ do: "rail", set: { type: d.rail.type === "none" ? matchRail(d) : d.rail.type } }], "rail");
    return read([{ do: "show", part: "rails" }], "rail");
  }
  return read([{ do: "rail", set }], "rail");
}

/** The railing that goes with the boards: composite with composite, aluminum with hardwood or metal, wood with wood. */
export function matchRail(d: DeckDesign): RailSet["type"] {
  const fam = deckingProduct(d.decking.product).family;
  if (fam === "composite" || fam === "pvc" || fam === "mineral") return "composite";
  if (fam === "aluminum" || fam === "hardwood" || fam === "modified") return "aluminum";
  if (fam === "softwood") return "cedar";
  return "treated";
}

/* ------------------------------------------------------------------ */
/*  Hot tub and lower level                                            */
/* ------------------------------------------------------------------ */

const alignOf = (c: string): "left" | "centre" | "right" | undefined => (/\b(?:on|to|at) the left\b|\bleft (?:side|end|corner)\b/.test(c) ? "left" : /\b(?:on|to|at) the right\b|\bright (?:side|end|corner)\b/.test(c) ? "right" : /\b(?:middle|center|centered|centre)\b/.test(c) ? "centre" : undefined);

function sizeAmounts(c: string, smallFt: number, normalFt: number, bigFt: number): { width?: Amount; depth?: Amount } {
  const p = pair(c);
  if (p) return { width: { to: ftOf(p.a) }, depth: { to: ftOf(p.b) } };
  const out: { width?: Amount; depth?: Amount } = {};
  const w = /(\d+(?:\.\d+)?)( ft| in)? (?:wide|long|across|along)\b/.exec(c);
  const dp = /(\d+(?:\.\d+)?)( ft| in)? (?:deep|out|front to back)\b/.exec(c);
  if (w) out.width = { to: Number(w[1]) / (w[2] === " in" ? 12 : 1) };
  if (dp) out.depth = { to: Number(dp[1]) / (dp[2] === " in" ? 12 : 1) };
  if (out.width || out.depth) return out;
  const sq = /(\d+(?:\.\d+)?)(?: ft)? (?:square|sq)\b/.exec(c);
  if (sq) return { width: { to: Number(sq[1]) }, depth: { to: Number(sq[1]) } };
  const dir = dirOf(c, /\b(?:bigger|larger|wider|deeper|longer|more room|grow|expand|enlarge)\b/, /\b(?:smaller|narrower|shallower|shorter|less room|shrink)\b/);
  if (dir) {
    const s = dir * step(c, smallFt, normalFt, bigFt);
    if (/\bwider|narrower|longer|shorter\b/.test(c)) return { width: { by: s } };
    if (/\bdeeper|shallower\b/.test(c)) return { depth: { by: s } };
    return { width: { by: s }, depth: { by: s } };
  }
  const one = nums(c).find((x) => x.unit === "ft" || x.unit === null);
  if (one && /\b(?:size|big|feet|ft)\b/.test(c)) return { width: { to: ftOf(one) }, depth: { to: ftOf(one) } };
  return out;
}

function readSpa(c: string, ctx: ParseContext): Read {
  if (!SPA_WORDS.test(c)) return null;
  if (isRemove(c)) return read([{ do: "spa", on: false }], "spa");
  const cmd: Extract<DeckCommand, { do: "spa" }> = { do: "spa" };
  if (!ctx.design.spa.on || ADD_VERB.test(c)) cmd.on = true;
  const sz = sizeAmounts(c, 0.5, 1, 2);
  if (sz.width) cmd.width = sz.width;
  if (sz.depth) cmd.depth = sz.depth;
  const al = alignOf(c);
  if (al) cmd.align = al;
  if (Object.keys(cmd).length === 1) return read([{ do: "show", part: "spa" }], "spa");
  return read([cmd], "spa");
}

function readLower(c: string, ctx: ParseContext): Read {
  if (!LOWER_WORDS.test(c)) return null;
  if (isRemove(c) || /\b(?:one level|single level|just one level)\b/.test(c)) return read([{ do: "lower", on: false }], "lower");
  const cmd: Extract<DeckCommand, { do: "lower" }> = { do: "lower" };
  if (!ctx.design.lower.on || ADD_VERB.test(c)) cmd.on = true;
  const drop = /(\d+(?:\.\d+)?)( ft| in)? (?:down|lower|drop|below|step(?: down)?)\b|\bdrop (?:of |it )?(\d+(?:\.\d+)?)( ft| in)?/.exec(c);
  const steps = /\b(one|1|two|2|three|3) steps? down\b/.exec(c);
  if (steps) cmd.dropIn = { to: ({ one: 1, "1": 1, two: 2, "2": 2, three: 3, "3": 3 } as Record<string, number>)[steps[1]] * 7.5 };
  else if (drop) {
    const v = Number(drop[1] ?? drop[3]);
    const u = drop[2] ?? drop[4];
    cmd.dropIn = { to: u === " ft" || (!u && v <= 4) ? v * 12 : v };
  }
  const rel = /\b(lower|drop|raise|lift) (?:the )?lower (?:level|deck|platform)(?: by)?(?: (\d+(?:\.\d+)?)( ft| in)?)?/.exec(c);
  if (rel && !steps) {
    const v = rel[2] ? Number(rel[2]) * (rel[3] === " ft" ? 12 : 1) : 3;
    cmd.dropIn = { by: (/lower|drop/.test(rel[1]) ? 1 : -1) * v };
  }
  const clause = drop ? c.replace(drop[0], " ") : rel ? c.replace(rel[0], " ") : c;
  const sz = sizeAmounts(clause, 1, 2, 4);
  if (sz.width) cmd.width = sz.width;
  if (sz.depth) cmd.depth = sz.depth;
  const al = alignOf(c);
  if (al) cmd.align = al;
  if (Object.keys(cmd).length === 1) return read([{ do: "show", part: "lower" }], "lower");
  return read([cmd], "lower");
}

/* ------------------------------------------------------------------ */
/*  Lights, heaters, outlets                                           */
/* ------------------------------------------------------------------ */

const COUNT_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, single: 1, couple: 2, "a couple": 2, pair: 2, "a pair": 2, few: 3, "a few": 3, several: 4, some: 2 };

function readFixture(c: string, ctx: ParseContext): Read {
  const d = ctx.design;
  let kind: FixtureKind | null = null;
  for (const [re, k] of FIXTURE_WORDS) if (re.test(c)) { kind = k; break; }
  const timer = /\b(?:timer|photocell|photo cell|dusk to dawn|dusk[- ]to[- ]dawn|auto(?:matic)? on)\b/.test(c);
  const panel = /\bpanel (?:is )?(?:on the )?(left|right)\b|\bfeed (?:from|on) the (left|right)\b/.exec(c);
  const feed = /\b(?:panel|feed)\b.*?(\d+(?:\.\d+)?)(?: ft)?(?: away| from)?|(\d+(?:\.\d+)?)(?: ft)? (?:from|to) the (?:electrical )?panel\b/.exec(c);
  if (!kind && (timer || panel || (feed && /\bpanel\b/.test(c)))) {
    const cmd: Extract<DeckCommand, { do: "electrical" }> = { do: "electrical" };
    if (timer) cmd.timer = !isRemove(c);
    if (panel) cmd.panelSide = (panel[1] ?? panel[2]) as "left" | "right";
    if (feed && /\bpanel|feed\b/.test(c)) cmd.feedFt = Number(feed[1] ?? feed[2]);
    return read([cmd], "fixture");
  }
  if (!kind && LIGHT_WORDS.test(c) && !/\b(?:lighter|light (?:gr[ae]y|brown|colou?r|wood|tan))\b/.test(c)) {
    // Lights with no kind said: where they go names them.
    kind = /\b(?:stairs?|steps?|risers?)\b/.test(c) ? "step-light" : /\b(?:rail(?:ing)?s?|posts?)\b/.test(c) ? "post-cap" : /\bunder\b/.test(c) ? "led-strip" : /\b(?:ceiling|roof|overhead|above)\b/.test(c) || (d.structure !== "deck" && d.structure !== "pergola") ? "ceiling-light" : d.structure === "pergola" ? "string-light" : "post-cap";
  }
  if (!kind) return null;
  const have = d.electrical.fixtures.filter((f) => f.kind === kind).reduce((a, f) => a + f.qty, 0);
  const supply = /\b(?:client|customer|owner|homeowner|they)(?:'s| will| would| is going to| is| are)? (?:own|buys?|buying|supplies|supplying|supplied|provides?|providing|provided|bring|brings|bringing|getting|gets|purchasing|purchases)\b|\b(?:client|customer|owner|homeowner)[- ]supplied\b|\bby the (?:client|owner)\b/.test(c) ? "client" : /\bwe (?:supply|buy|provide|furnish|are buying|are supplying)\b/.test(c) ? "we" : undefined;
  const volts240 = /\b(?:240|hard ?wired|big (?:heater|one)|4 ?kw|4000 ?w(?:att)?s?|electric(?:al)? heater)\b/.test(c) ? true : /\b(?:120|plug[- ]in|small(?:er)? (?:heater|one))\b/.test(c) ? false : undefined;
  const countWord = /\b(a couple|a pair|a few|several|couple|pair|few|some)\b/.exec(c);
  const n = nums(c).find((x) => x.unit === null && x.n >= 1 && x.n <= 40);
  const qtyNum = n ? n.n : countWord ? COUNT_WORDS[countWord[1]] : null;
  const remove = isRemove(c) && !/\bno (?:timer|photocell)\b/.test(c);
  if (remove) {
    if (qtyNum && have > qtyNum) return read([{ do: "fixture", op: "set", kind, qty: { by: -qtyNum } }], "fixture");
    return read([{ do: "fixture", op: "remove", kind }], "fixture");
  }
  const more = /\b(?:another|one more|more|extra|additional)\b/.test(c);
  const less = /\b(?:fewer|less)\b/.test(c);
  if (have && (more || less) && !qtyNum) return read([{ do: "fixture", op: "set", kind, qty: { by: less ? -1 : 1 }, supply, volts240 }], "fixture");
  if (have && qtyNum && (/\b(?:make it|make them|change to|set to|total|in all|altogether)\b/.test(c) || /^(?:\d+|a couple|a few) (?:of them|total)$/.test(c))) return read([{ do: "fixture", op: "set", kind, qty: { to: qtyNum }, supply, volts240 }], "fixture");
  if (have && !ADD_VERB.test(c) && (supply || volts240 !== undefined)) return read([{ do: "fixture", op: "set", kind, supply, volts240 }], "fixture");
  if (have && !ADD_VERB.test(c) && !more && !qtyNum) return read([{ do: "show", part: "lights", fixture: kind }], "fixture");
  const single = /\b(?:a|an|one|single)\b/.test(c) && !/\blights\b/.test(c);
  return read([{ do: "fixture", op: "add", kind, qty: { to: qtyNum ?? (more || single ? 1 : kind === "ceiling-light" ? 2 : 1) }, supply, volts240 }], "fixture");
}

/* ------------------------------------------------------------------ */
/*  The roof — and what is built: a deck, a covered deck, a gazebo,   */
/*  a pergola                                                          */
/* ------------------------------------------------------------------ */

/** Every way of naming a roof's shape — the most particular first (a Dutch gable before a gable, a barn before a gable). */
const ROOF_KIND_WORDS: ReadonlyArray<[RegExp, RoofKind]> = [
  [/\bdutch (?:gable|hip)\b|\bgablets?\b|\bjerkin ?head\b|\bclipped gable\b|\bhip (?:roof )?with (?:a )?(?:little |small )?gables?\b|\bgables? (?:on|at) (?:the )?(?:top|ends?) of (?:a |the )?hip\b/, "dutch-gable"],
  [/\bgambrel\b|\bbarn(?:[- ]style)?(?: roof)?\b|\bdutch barn\b|\bmansard\b|\btwo[- ]slope (?:sides|roof)\b|\bbroken slope\b/, "gambrel"],
  [/\bpagoda\b|\b(?:double|two|2)[- ]?tier(?:ed)?\b|\btiered roof\b|\bdouble[- ]decker roof\b|\btwo[- ]level roof\b|\b(?:japanese|asian|chinese|oriental)(?: style)? roof\b|\broof on (?:a|the) roof\b|\bstacked roof\b/, "double-tier"],
  [/\bpyramid(?:al|s)?\b|\btent(?: style)? roof\b|\bpavilion roof\b|\bpointed (?:top|roof)\b|\bcomes? (?:up )?to a point\b|\bmeets? (?:up )?(?:at|in) (?:a|one) (?:point|peak)\b|\bsquare hip\b/, "pyramid"],
  [/\bhip(?:ped|s)?\b|\b(?:four|4)[- ]sided roof\b|\bslopes? (?:down )?(?:on )?all (?:four|4) sides\b|\bslopes? (?:on )?every side\b|\bslopes? all (?:the way )?around\b|\bhip and valley\b/, "hip"],
  [/\bgable(?:d|s)?\b|\ba[- ]?frame\b|\bpeaked\b|\bpitched roof\b|\b(?:two|2)[- ]sided roof\b|\btriangle(?: shaped)? roof\b|\btriangular roof\b|\bpointy roof\b|\bregular roof\b|\btraditional roof\b|\bclassic roof\b|\bnormal roof\b|\bridge (?:in|down) the middle\b|\bsaltbox\b|\bcross gable\b|\bhouse[- ]style roof\b/, "gable"],
  [/\bshed(?: roof| style)\b|\blean[- ]?to\b|\bsingle[- ]?slope\b|\bone[- ]?slope\b|\bone[- ]way (?:slope|pitch)\b|\bsingle[- ]pitch\b|\bmono[- ]?(?:pitch|slope)\b|\bflat(?:ter)? roof\b|\bflat top(?:ped)? roof\b|\bskillion\b|\bslanted roof\b|\bsloped roof\b|\broof (?:that )?slopes? (?:away|out|down)(?: from the house)?\b|\bslopes? one way\b|\bmodern (?:flat )?roof\b|\bbutterfly\b|\bshed\b/, "shed"],
];
const hasDeckNow = (d: DeckDesign) => d.structure === "deck" || d.structure === "covered-deck" || d.floor === "deck";
/** "Make the roof 12 by 10" on a deck: the roof's own outline (a rectangle over part of the deck). */
const r_plan_rect = (d: DeckDesign) => hasDeckNow(d) && d.structure !== "deck";

/** A shape word that means a roof even with no "roof" said ("make it a gambrel", "an A-frame over it"). */
const ROOF_ONLY_KIND = /\b(?:gable|gambrel|dutch gable|pagoda|pyramid roof|a[- ]?frame|lean[- ]?to|double[- ]tier|hip roof|skillion|mansard|jerkin ?head)\b/;
const ROOFING_WORDS: ReadonlyArray<[RegExp, Roofing]> = [
  [/\bstanding seam\b/, "standing-seam"],
  [/\b(?:metal|tin|corrugated|steel roof(?:ing)?|exposed fastener|r[- ]panel|ag panel)\b/, "metal-panel"],
  [/\b(?:cedar )?shakes?\b|\bwood shingles?\b/, "cedar-shake"],
  [/\b(?:3 tab|three tab)\b/, "3tab-shingle"],
  [/\bdesigner shingles?\b|\bluxury shingles?\b|\bslate look\b/, "designer-shingle"],
  [/\b(?:architectural|arch|dimensional|asphalt)(?: shingles?)?\b|\bshingles?\b/, "arch-shingle"],
];

function readRoof(c: string, ctx: ParseContext): Read {
  const d = ctx.design;
  const kindSaid = ROOF_KIND_WORDS.some(([re]) => re.test(c));
  const polygonSaid = /\b(?:octagon(?:al)?|hexagon(?:al)?|(?:six|6|eight|8)[- ]sided|circular)\b/.test(c) && !/\bcorners?\b/.test(c);
  if (!ROOF_WORDS.test(c) && !polygonSaid && !(kindSaid && (/\broof\b/.test(c) || ROOF_ONLY_KIND.test(c) || d.structure !== "deck")) && !(OVERHANG_WORD.test(c) && d.structure !== "deck")) return null;
  // "Flat ground", "a shed in the yard": not a roof.
  if (!ROOF_WORDS.test(c) && kindSaid && !ROOF_ONLY_KIND.test(c) && /\b(?:ground|yard|lot|grade|storage|tool)\b/.test(c)) return null;
  // "A red roof", "make the roof gray": the colour is the house's roof (a deck's roof is coloured by its roofing).
  const colour = ROOF_COLOUR_WORDS.find(([re]) => re.test(c));
  if (colour && /\broof\b/.test(c) && !kindSaid && !/\b(?:covered|cover|porch|metal|tin|shingles?|shakes|standing seam|gutters?|ceiling|pitch|steeper|flatter|gazebo|pergola|higher|lower|raise)\b/.test(c)) {
    return read([{ do: "house", roofColour: colour[1] }], "house");
  }
  const cmds: DeckCommand[] = [];
  let structure = d.structure;
  const gazebo = (/\b(?:gazebo|pavilion)\b/.test(c) || polygonSaid) && !/\boctagon(?:al)? corners?\b/.test(c);
  const pergola = /\b(?:pergola|trellis|arbor|shade structure|open (?:slats|roof)|slatted)\b/.test(c) || (/\blouver/.test(c) && d.structure !== "covered-deck");
  const removeWhole = isRemove(c) && /\b(?:roof|cover|covering|pergola|gazebo|pavilion|top)\b/.test(c) && !/\b(?:gutters?|ceiling|cupola|soffit|fan|lights?|screens?|walls?|braces|fascia)\b/.test(c);
  if (removeWhole || /\b(?:just a deck|plain deck|open deck|no roof|uncovered|deck only|uncover(?: it)?|without a roof)\b/.test(c)) {
    return read([{ do: "structure", to: "deck" }], "deck");
  }
  // What is built comes from the words that name it (a gazebo, a pergola, a cover); a roof's SHAPE alone is left to
  // the roof's runner, which puts that shape on whatever carries it (lib/deck/voice/run runRoof).
  if (gazebo && structure !== "gazebo") structure = "gazebo";
  else if (pergola && structure !== "pergola") structure = "pergola";
  else if (structure === "deck" && !kindSaid && /\b(?:roof|roofed|cover(?:ed)?|porch|patio cover|shelter|covering|overhead|rain|shade it|shingles?|metal roof|gutters?|ceiling|rafters?)\b/.test(c)) structure = "covered-deck";
  else if (structure === "deck" && kindSaid && /\b(?:covered|cover|porch|patio cover)\b/.test(c) && /\b(?:gable|hip|shed|lean[- ]?to|flat|a[- ]?frame|single[- ]?slope)\b/.test(c) && !/\b(?:dutch|gambrel|barn|pagoda|tier|pyramid)\b/.test(c)) structure = "covered-deck";
  if (structure !== d.structure) cmds.push({ do: "structure", to: structure });
  if (structure === "gazebo" || structure === "pergola") {
    // Concrete already there ("the existing patio", "over the patio", "on the slab") is not poured again; "a slab",
    // "a new slab", "pour a slab" is (owner, 2026-11-06).
    const existing = (/\b(?:existing|old|current)\b/.test(c) && /\b(?:slab|patio|concrete|pad)\b/.test(c)) || /\bon (?:the |my |our )?patio\b|\bover (?:a |the |my )?patio\b|\bon the (?:slab|concrete|pad)\b/.test(c);
    const floor = existing ? "existing" : /\bon (?:a |the )?(?:new )?(?:concrete )?slab\b|\bon concrete\b|\bpour (?:a |the )?(?:new )?slab\b|\bnew slab\b/.test(c) ? "slab" : /\bon the (?:ground|grass|lawn|dirt)\b|\bin the (?:grass|lawn|yard)\b|\bon footings\b|\bin the ground\b/.test(c) ? "ground" : /\bon (?:a |the )?deck\b/.test(c) ? "deck" : null;
    if (floor && floor !== d.floor) cmds.push({ do: "floor", to: floor });
  }
  const set: RoofSet = {};
  if (!pergola) {
    for (const [re, k] of ROOF_KIND_WORDS) {
      if (re.test(c)) {
        set.kind = k;
        if (/\bflat\b/.test(c)) set.pitch = { to: 2 };
        break;
      }
    }
  }
  if (structure === "gazebo") {
    if (/\boctagon(?:al)?\b|\b8[- ]sided\b|\beight[- ]sided\b/.test(c)) set.planShape = "octagon";
    else if (/\bhexagon(?:al)?\b|\b6[- ]sided\b|\bsix[- ]sided\b/.test(c)) set.planShape = "hexagon";
    else if (/\bround\b|\bcircular\b/.test(c)) set.planShape = "round";
    else if (/\bsquare\b/.test(c) && !/\bsquare feet\b/.test(c)) set.planShape = "square";
    else if (/\brectang/.test(c)) set.planShape = "rect";
  }
  if (structure === "pergola") {
    if (/\blouver/.test(c)) set.pergolaStyle = "louvered";
    else if (/\barch(?:ed)?\b|\bcurved\b/.test(c)) set.pergolaStyle = "arched";
    else if (/\bflat (?:top|slats)\b|\bflat\b/.test(c)) set.pergolaStyle = "flat";
    const slat = /\b(2x2|2x4|2x6) slats?\b|\bslats? (?:of |in )?(2x2|2x4|2x6)\b/.exec(c);
    if (slat) set.slatSize = (slat[1] ?? slat[2]) as RoofSet["slatSize"];
    const sp = /\bslats? (?:every |at |spaced |)(\d+(?:\.\d+)?)(?: in)?(?: apart)?|(\d+(?:\.\d+)?)(?: in)? (?:apart|between (?:the )?slats)\b/.exec(c);
    if (sp) set.slatSpacingIn = { to: Number(sp[1] ?? sp[2]) };
    else if (/\b(?:more shade|denser|closer (?:slats|together)|tighter|less sun)\b/.test(c)) set.slatSpacingIn = { by: -3 };
    else if (/\b(?:less shade|more sun|farther apart|wider apart|more open)\b/.test(c)) set.slatSpacingIn = { by: 3 };
  }
  // The pitch.
  const pitchTok = /\b(\d{1,2})\/12 pitch\b/.exec(c) ?? /\bpitch (?:of |to |at |is )?(\d{1,2})\b/.exec(c);
  if (pitchTok) set.pitch = { to: Number(pitchTok[1]) };
  else if (/\b(?:flatter|less steep|not (?:as|so) steep|lower pitch|less pitch|less slope|shallower|lower slope|gentler)\b/.test(c)) set.pitch = { by: -step(c, 1, 2, 3) };
  else if (/\b(?:steeper|more pitch|higher pitch|more slope|steep(?:er)? roof|more angle|sharper)\b/.test(c)) set.pitch = { by: step(c, 1, 2, 3) };
  // How high it stands: the headers, the "ceiling height".
  const eave = /(\d+(?:\.\d+)?)( ft| in)? (?:tall |high )?(?:ceiling|posts|headers|clearance|headroom|to the headers|under the roof|eave|eaves|plate)\b|\b(?:ceiling|header|eave|post|plate) height (?:of |to |at |is )?(\d+(?:\.\d+)?)( ft| in)?|\b(?:headers?|eaves?|ceiling|roof (?:height|at|to|is)) (?:at |to |is |of )?(\d+(?:\.\d+)?)( ft| in)?(?: (?:high|tall|up))?(?!\/)(?! (?:to the|left|right))/.exec(c);
  if (eave && !/\b(?:pitch|overhang)\b/.test(c)) {
    const v = Number(eave[1] ?? eave[3] ?? eave[5]);
    const u = eave[2] ?? eave[4] ?? eave[6];
    set.eaveIn = { to: u === " in" || (!u && v > 16) ? v : v * 12 };
  } else if (/\b(?:raise the roof|higher roof|taller roof|roof (?:up|higher|taller)|more headroom|higher ceiling|taller ceiling|taller posts|raise (?:the )?(?:ceiling|headers|eaves?))\b/.test(c)) set.eaveIn = { by: step(c, 6, 12, 24) };
  else if (/\b(?:lower (?:the )?(?:roof|ceiling|headers|eaves?)|roof (?:down|lower)|lower ceiling|less headroom|shorter posts)\b/.test(c)) set.eaveIn = { by: -step(c, 6, 12, 24) };
  // The overhang.
  const oh = /\boverhangs?\b/.test(c) ? nums(c).find((x) => x.unit === "in" || x.unit === "ft" || x.unit === null) : undefined;
  if (oh) set.overhangIn = { to: oh.unit === "ft" || (oh.unit === null && oh.n <= 3) ? oh.n * 12 : oh.n };
  else if (/\b(?:bigger|longer|more|deeper|wider) (?:roof )?overhangs?\b|\boverhangs? (?:longer|bigger|more)\b/.test(c)) set.overhangIn = { by: step(c, 3, 6, 12) };
  else if (/\b(?:smaller|shorter|less|no) (?:roof )?overhangs?\b|\boverhangs? (?:shorter|smaller|less)\b/.test(c)) set.overhangIn = /\bno overhangs?\b/.test(c) ? { to: 0 } : { by: -step(c, 3, 6, 12) };
  for (const [re, r] of ROOFING_WORDS) if (re.test(c) && structure !== "pergola") { set.roofing = r; break; }
  // The ceiling.
  if (/\bceiling\b/.test(c) && !set.eaveIn) {
    if (/\b(?:beadboard)\b/.test(c)) set.ceiling = "beadboard";
    else if (/\b(?:no ceiling|open (?:ceiling|rafters)|exposed (?:rafters|beams)|remove (?:the )?ceiling)\b/.test(c)) set.ceiling = "none";
    else if (/\b(?:tongue-and-groove|wood ceiling|cedar ceiling|pine ceiling|boards? ceiling|ceiling boards)\b/.test(c) || ADD_VERB.test(c) || CHANGE_VERB.test(c)) set.ceiling = "tongue-groove";
  } else if (/\btongue-and-groove\b/.test(c)) set.ceiling = "tongue-groove";
  else if (/\bbeadboard\b/.test(c)) set.ceiling = "beadboard";
  else if (/\bexposed (?:rafters|beams)\b/.test(c)) set.ceiling = "none";
  // Gutters.
  if (/\bgutter guards?\b|\bleaf guards?\b|\bgutter covers?\b/.test(c)) set.guards = !isRemove(c);
  else if (/\bgutters?\b|\bdownspouts?\b/.test(c)) {
    if (isRemove(c)) set.gutters = "none";
    else if (/\bcopper\b/.test(c)) set.gutters = "half-round-copper";
    else if (/\bhalf round\b/.test(c)) set.gutters = "half-round-alum";
    else if (/\b6 in\b|\b6 inch\b|\bsix inch\b|\bbig(?:ger)? gutters\b|\boversized\b/.test(c)) set.gutters = "k6";
    else set.gutters = d.roof.gutters.kind === "none" ? "k5" : d.roof.gutters.kind;
  }
  if (/\bcupola\b/.test(c)) set.cupola = !isRemove(c);
  if (/\bsoffits?\b/.test(c)) set.soffit = !isRemove(c);
  if (/\b(?:pvc|azek) (?:trim|fascia)\b|\btrim (?:in|of) pvc\b/.test(c)) set.fasciaFinish = "pvc";
  else if (/\baluminum (?:wrap|wrapped|trim|fascia)\b|\bwrapped (?:fascia|trim)\b/.test(c)) set.fasciaFinish = "aluminum-wrap";
  else if (/\b(?:painted|wood) (?:trim|fascia)\b/.test(c)) set.fasciaFinish = "wood";
  // Walls between the posts.
  if (/\bscreen(?:ed)?(?: in| porch| room| it| walls?)?\b|\bscreens\b|\bbug screens?\b|\bmosquito\b|\bscreened[- ]in\b/.test(c)) set.walls = isRemove(c) ? "none" : "screen";
  else if (/\blattice\b/.test(c)) set.walls = isRemove(c) ? "none" : "lattice";
  else if (/\b(?:privacy (?:walls?|panels?|screens?|wall)|solid (?:walls?|panels?)|enclosed|closed in|wind ?break)\b/.test(c)) set.walls = isRemove(c) ? "none" : "solid";
  else if (/\b(?:open sides|no walls|remove (?:the )?(?:screens|walls|panels)|open (?:it )?up)\b/.test(c)) set.walls = "none";
  const sides = /\bon (all|two|three|four|one|1|2|3|4|5|6|7|8) sides\b|\b(all|two|three|four|1|2|3|4) sides\b/.exec(c);
  if (sides && (set.walls || /\bwalls?|screens?|panels?\b/.test(c))) {
    const w = sides[1] ?? sides[2];
    set.wallSides = w === "all" ? 16 : ({ one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[w] ?? Number(w);
  }
  // Size of a roof standing off the deck (a gazebo on a slab, a pergola on the lawn) or across a polygon.
  const across = /(\d+(?:\.\d+)?)(?: ft)? (?:across|wide (?:octagon|hexagon))\b/.exec(c);
  if (across) set.acrossFt = { to: Number(across[1]) };
  const p = pair(c);
  if (p && (d.floor !== "deck" || structure !== d.structure && (structure === "gazebo" || structure === "pergola") && cmds.some((x) => x.do === "floor" && x.to !== "deck"))) {
    set.widthFt = { to: ftOf(p.a) };
    set.depthFt = { to: ftOf(p.b) };
  }
  if (/\b(?:attach(?:ed)? to the house|off the house(?: wall)?|hung on the house|on the house wall|tied (?:in)?to the house|ledger)\b/.test(c)) set.attach = "wall";
  else if (/\b(?:freestanding|free standing|on its own posts|its own posts|own posts|separate from the house)\b/.test(c)) set.attach = "free";
  const post = /\b(4x4|6x6|8x8)\b/.exec(c);
  if (post && /\bposts?\b/.test(c)) set.post = post[1] as RoofSet["post"];
  if (/\bridge beam\b/.test(c)) set.ridge = "beam";
  else if (/\bridge board\b/.test(c)) set.ridge = "board";
  else if (/\btrusses\b/.test(c)) set.ridge = "trusses";
  const cross = /\b(\d) cross ?beams?\b|\bcross ?beams?\b/.exec(c);
  if (cross) set.crossBeams = isRemove(c) ? 0 : cross[1] ? Number(cross[1]) : 1;
  if (/\b(?:knee )?brac(?:es|ing)\b/.test(c)) set.braces = !isRemove(c);
  // Headers, rafters, the roof's load, purlins, the trim on the eaves and rakes.
  if (/\bheaders?\b/.test(c)) {
    const hb = /\b([23]-2x(?:6|8|10|12)|4x(?:6|8|10|12))\b/.exec(c);
    if (/\b(?:lvl|engineered|glulam|laminated)\b/.test(c)) set.header = "lvl";
    else if (hb) set.header = hb[1] as RoofSet["header"];
    else if (/\b(?:auto|cheapest|least cost|let the tables)\b/.test(c)) set.header = "auto";
  }
  if (/\brafters?\b/.test(c)) {
    const rs = /\b(2x(?:6|8|10|12))\b/.exec(c);
    if (rs) set.rafter = rs[1] as RoofSet["rafter"];
    else if (/\b(?:auto|let the tables)\b/.test(c)) set.rafter = "auto";
    const sp2 = /\b(12|16|24)(?: in)? (?:oc|apart|on center|spacing)\b|\b(?:every|at) (12|16|24)(?: in)?\b/.exec(c);
    if (sp2) set.rafterSpacingIn = Number(sp2[1] ?? sp2[2]) as 12 | 16 | 24;
  }
  const rl = /\broof load (?:of |to |at )?(\d+)|\b(\d+) (?:psf|pounds?) (?:roof|on the roof|of snow on the roof|roof load)\b/.exec(c);
  if (rl) {
    const v = Number(rl[1] ?? rl[2]);
    set.load = v <= 25 ? 20 : v <= 40 ? 30 : v <= 60 ? 50 : 70;
  } else if (/\broof load\b.*\bauto\b|\bauto(?:matic)? roof load\b/.test(c)) set.load = "auto";
  if (/\bpurlins?\b/.test(c)) set.roofDeck = isRemove(c) ? "sheathing" : "purlins";
  else if (/\b(?:sheathing|plywood|osb|decking) (?:under|beneath) the (?:metal|roofing|shingles)\b|\bon sheathing\b/.test(c)) set.roofDeck = "sheathing";
  if (/\brake boards?\b|\brakes?\b/.test(c) && !/\brake (?:the|a|it)\b/.test(c)) set.fasciaRake = !isRemove(c);
  if (/\b(?:eave fascia|fascia on the eaves|roof fascia|eaves? trim)\b/.test(c)) set.fasciaEave = !isRemove(c);
  // A roof over part of the deck, moved along it, or over all of it.
  if (d.structure !== "deck" || structure !== "deck") {
    const half = /\b(?:half|part|partial|some) (?:of )?(?:the )?deck\b|\bpartial roof\b|\bover (?:only )?(?:half|part)\b|\broof (?:only )?over the (left|right)(?: half| side| end)?\b|\b(left|right) half\b/.exec(c);
    if (half && /\b(?:roof|cover|covered)\b/.test(c)) {
      const side = /\bleft\b/.test(c) ? -1 : /\bright\b/.test(c) ? 1 : 0;
      set.planShape = "rect";
      set.widthFt = { to: halfFt(d.shape.widthFt / 2) };
      set.depthFt = { to: d.shape.depthFt };
      set.offsetFt = { to: side * halfFt(d.shape.widthFt / 4) };
    } else if (/\b(?:whole|entire|all of the|full) deck\b|\bfull roof\b|\bcover (?:it )?all\b|\bfollows? the deck\b/.test(c) && /\b(?:roof|cover)\b/.test(c)) set.planShape = "follows-deck";
    else if (/\b(?:square roof|roof square)\b/.test(c)) set.planShape = "square";
    const shift = /\b(?:move|shift|slide|push) (?:the )?roof (?:over )?(?:to the )?(left|right)(?: by)?(?: (\d+(?:\.\d+)?)(?: ft)?)?/.exec(c) ?? /\b(?:move|shift|slide|push) (?:the )?roof (?:over )?(\d+(?:\.\d+)?)(?: ft)? (?:to the )?(left|right)/.exec(c);
    if (shift) {
      const dirWord = /left|right/.test(shift[1]) ? shift[1] : shift[2];
      const amount = Number((/left|right/.test(shift[1]) ? shift[2] : shift[1]) ?? 2);
      set.offsetFt = { by: (dirWord === "left" ? -1 : 1) * amount };
    } else if (/\bcent(?:er|re) the roof\b|\broof in the (?:middle|center)\b/.test(c)) set.offsetFt = { to: 0 };
    if (p && !set.widthFt && (set.planShape === "rect" || r_plan_rect(d)) && /\broof\b/.test(c) && !gazebo) {
      set.widthFt = { to: ftOf(p.a) };
      set.depthFt = { to: ftOf(p.b) };
      if (!set.planShape) set.planShape = "rect";
    }
  }
  if (Object.keys(set).length) cmds.push({ do: "roof", set });
  if (!cmds.length) {
    if (d.structure !== "deck" && /\b(?:roof|pergola|gazebo|cover(?:ed)?)\b/.test(c)) return read([{ do: "show", part: "roof" }], "roof");
    return null;
  }
  const subject: Subject = set.pitch ? "pitch" : set.eaveIn ? "eave" : set.overhangIn ? "overhang" : set.slatSpacingIn ? "slats" : "roof";
  return read(cmds, subject);
}

/* ------------------------------------------------------------------ */
/*  The house behind the deck                                          */
/* ------------------------------------------------------------------ */

function readHouse(c: string, ctx: ParseContext): Read {
  const houseSaid = /\b(?:house|home|siding)\b/.test(c);
  const storeys = /\b(?:1|one|single) story\b|\branch\b|\brambler\b|\bbungalow\b/.test(c) ? 1 : /\b(?:2|two) story\b|\bcolonial\b|\btwo floors\b/.test(c) ? 2 : undefined;
  const wall = /\bbump ?out (?:on|at|to) the right\b|\bright bump ?out\b|\bbump ?out right\b/.test(c) ? "bump-right" : /\bbump ?out (?:on|at|to) the left\b|\bleft bump ?out\b|\bbump ?out left\b/.test(c) ? "bump-left" : /\b(?:nook|inside corner|between two walls|tucked in|recessed|in a corner)\b/.test(c) ? "nook" : /\b(?:straight (?:wall|back wall)|flat wall|no bump ?outs?|plain wall|remove the bump ?out)\b/.test(c) ? "straight" : undefined;
  const ext = /\bhouse (?:is |goes |runs |extends |sticks out |reaches )?(\d+(?:\.\d+)?)(?: ft)? (?:past|beyond|longer than|further than|farther than)(?: the deck)?(?: on| at)?(?: the)? (left|right)\b/.exec(c) ?? /\b(\d+(?:\.\d+)?)(?: ft)? of (?:house|wall) (?:past|beyond)(?: the deck)?(?: on| at)?(?: the)? (left|right)\b/.exec(c);
  const houseWide = /\b(?:the )?house is (\d+(?:\.\d+)?)(?: ft)? (?:wide|long|across)\b|\b(\d+(?:\.\d+)?)(?: ft)?[- ]wide house\b/.exec(c);
  if (!houseSaid && !storeys && !wall && !ext) return null;
  const cmd: Extract<DeckCommand, { do: "house" }> = { do: "house" };
  if (ext) cmd[ext[2] === "left" ? "leftFt" : "rightFt"] = { to: Number(ext[1]) };
  if (houseWide) cmd.widthFt = Number(houseWide[1] ?? houseWide[2]);
  if (storeys) cmd.storeys = storeys;
  if (wall) cmd.wall = wall;
  if (houseSaid && /\bhip(?:ped)? roof\b/.test(c)) cmd.roof = "hip";
  else if (houseSaid && /\bgable(?:d)? roof\b/.test(c)) cmd.roof = "gable";
  const roofColourSaid = /\broof (?:colou?r|shingles?)\b|\b(?:colou?r|shade) of the roof\b|\broof (?:is|to|in)\b|\b(?:\w+ )?roof\b/.test(c) && /\broof\b/.test(c);
  if (roofColourSaid) for (const [re, id] of ROOF_COLOUR_WORDS) if (re.test(c)) { cmd.roofColour = id; break; }
  if (houseSaid && !cmd.roofColour) {
    const clause = c.replace(/\broof\b.*$/, "");
    for (const [re, id] of SIDING_WORDS) if (re.test(clause)) { cmd.siding = id; break; }
  }
  if (Object.keys(cmd).length === 1) {
    if (/\b(?:center|centre|middle)\b/.test(c) && /\bdeck\b/.test(c)) return read([{ do: "slide", ft: "center" }], "deck");
    if (houseSaid && /^(?:the )?house$/.test(c)) return read([{ do: "show", part: "house" }], "house");
    return null;
  }
  void ctx;
  return read([cmd], "house");
}

/* ------------------------------------------------------------------ */
/*  How it meets the house; the wall                                   */
/* ------------------------------------------------------------------ */

function readPlacement(c: string): Read {
  // "The yard slopes away from the house" is the ground's fall, not where the deck stands.
  if (/\b(?:slopes?|sloped|sloping|drops?|falls?|downhill|uphill|grade)\b/.test(c)) return null;
  const cmds: DeckCommand[] = [];
  const not = /\b(?:not|don't|do not|without|no|isn't|is not|won't|wont|doesn't|does not|shouldn't|aren't)\b/;
  if (/\b(?:freestanding|detached|unattached|away from the house|island deck|floating deck|stand(?:s|ing)? alone|out in the yard|in the (?:middle of the )?(?:back ?)?yard|by itself|on its own in the yard)\b/.test(c) || (/\battach(?:ed)?\b/.test(c) && not.test(c) && !/\bbeside\b/.test(c))) cmds.push({ do: "placement", to: "detached" });
  else if (/\b(?:beside the house|next to the house|self supporting|on its own posts|own posts|not on a ledger|no ledger|without a ledger|doesn't touch the house|against the house but)\b/.test(c)) cmds.push({ do: "placement", to: "beside" });
  else if (/\b(?:attach(?:ed)? (?:it )?(?:to the house)?|on the house|bolt(?:ed)? (?:it )?to the house|ledger(?:ed)? to the house|tie (?:it )?(?:in)?to the house|hang (?:it )?(?:on|off) the house|use a ledger)\b/.test(c)) cmds.push({ do: "placement", to: "attached" });
  const wall: Array<[RegExp, Extract<DeckCommand, { do: "wall" }>["to"]]> = [
    [/\b(?:brick|stone veneer|stone|veneer|masonry veneer)\b/, "brick-veneer"],
    [/\b(?:hollow|cinder|concrete) blocks?\b|\bcmu\b|\bblock (?:wall|foundation)\b/, "hollow-block"],
    [/\b(?:poured )?concrete (?:wall|foundation)\b|\bfoundation wall\b|\bpoured wall\b/, "concrete"],
    [/\b(?:stucco|eifs|sips?|icf|structural insulated)\b/, "sip-icf"],
    [/\b(?:foam|foam board|rigid insulation|zip system)\b/, "foam-sheathing"],
    [/\bi[- ]?joists?\b|\bengineered rim\b|\brim board\b|\blvl rim\b/, "engineered-rim"],
    [/\bcantilever(?:ed)? floor\b|\bbay window\b|\boverhanging floor\b|\bfloor overhangs\b/, "cantilever"],
    [/\bfloor trusses\b|\bopen web\b|\btruss floor\b/, "open-truss"],
    [/\b(?:can't see|cannot see|don't know|not sure|unknown)\b.*\b(?:wall|framing|rim|house)\b/, "unknown"],
    [/\bwood frame(?:d)?\b|\bwood siding\b|\bvinyl siding\b|\brim joist\b|\b2x rim\b|\bstick built\b|\blumber rim\b/, "wood-rim"],
  ];
  if (/\b(?:house|wall|siding|foundation|it's|it is|the back)\b/.test(c)) for (const [re, id] of wall) if (re.test(c)) { cmds.push({ do: "wall", to: id }); break; }
  return read(cmds, "deck");
}

/* ------------------------------------------------------------------ */
/*  Decking                                                            */
/* ------------------------------------------------------------------ */

function colorOf(c: string): string | null {
  for (const col of COLORS) if (col.words.test(c)) return col.id;
  return null;
}

function readDecking(c: string, ctx: ParseContext): Read {
  const set: DeckingSet = {};
  for (const [re, id] of DECKING_NAMES) if (re.test(c)) { set.product = id; break; }
  if (!set.product) {
    for (const [re, fam] of DECKING_FAMILY_WORDS) if (re.test(c)) { set.family = fam; break; }
    if (set.family === "softwood") {
      const redwood = /\bredwood\b/.test(c);
      const thick2 = /\b2x6\b/.test(c);
      set.product = redwood ? (thick2 ? "redwood-2x6" : "redwood-54") : thick2 ? "cedar-2x6" : "cedar-54";
      delete set.family;
    } else if (set.family === "hardwood") {
      set.product = "ipe-1x6";
      delete set.family;
    } else if (set.family === "treated") {
      if (/\b2x6\b/.test(c)) set.thick = "2x6";
      else if (/\b5\/4\b/.test(c)) set.thick = "54";
    }
  }
  const tier = /\b(?:cheapest|cheaper|budget|basic|economy|entry[- ]level|good (?:tier|option|package|one)|least expensive|lowest price|save money|value)\b/.test(c) ? "good" : /\b(?:better (?:tier|option|package|one)|mid[- ]?range|middle|mid[- ]grade|mid[- ]tier|in between)\b/.test(c) ? "better" : /\b(?:best (?:tier|option|package|one)|premium|high[- ]end|top of the line|luxury|top tier|the best|nicest|most expensive|top shelf|fancy|upscale)\b/.test(c) ? "best" : undefined;
  if (tier && !set.product && (!set.family || set.family === "composite")) {
    if (set.family === "composite") set.product = tier === "good" ? "composite-good" : tier === "better" ? "composite-better" : "composite-best";
    else set.tier = tier;
    delete set.family;
  }
  // A colour, where the clause is about the boards (or the deck), not the rail, the house or a roof.
  const bareColour = COLORS.some((col) => new RegExp(`^(?:the |a |in |that )?(?:${col.words.source})(?: one| color| colour| please)?$`).test(c));
  const boardsSaid = (bareColour || /\b(?:decking|deck boards?|boards?|planks?|surface|floor|deck|it|colou?r)\b/.test(c)) && !RAIL_WORDS.test(c) && !/\b(?:house|siding|roof)\b/.test(c);
  if (/\b(?:lighter|light(?:er)? (?:colou?r|shade))\b/.test(c) && boardsSaid) set.shade = "lighter";
  else if (/\b(?:darker|dark(?:er)? (?:colou?r|shade))\b/.test(c) && boardsSaid) set.shade = "darker";
  else if (boardsSaid || set.product || set.family) {
    const col = colorOf(c);
    if (col && !(col === "light brown" && /\blight\b/.test(c) && !/\blight brown\b/.test(c) && set.product)) set.color = col;
  }
  if (/\b(?:diagonal(?:ly)?|45(?: degrees?)?|angled (?:boards|decking)|at an angle|on (?:a|the) bias)\b/.test(c) && !/\bcorners?\b/.test(c)) set.pattern = "diagonal";
  else if (/\b(?:herringbone|chevron|zig ?zag)\b/.test(c)) set.pattern = "herringbone";
  else if (/\b(?:straight|parallel(?: to the house)?|regular pattern|normal pattern|standard pattern|perpendicular|straight boards)\b/.test(c) && /\b(?:boards?|decking|pattern|lay|run)\b/.test(c)) set.pattern = "straight";
  if (/\b(?:double (?:picture[- ]?frame|border)|two (?:rows? of )?borders?|2 (?:rows? of )?borders?|double[- ]framed|2 border)\b/.test(c)) set.border = 2;
  else if (/\b(?:picture[- ]?frame(?:d)?|borders?|framed edge|breaker boards?)\b/.test(c)) set.border = isRemove(c) ? 0 : 1;
  if (/\b(?:hidden (?:fasteners?|clips?|screws?)|hide (?:the )?(?:screws|fasteners|screw heads)|clips|no (?:visible )?screws|(?:don't|do not) (?:want to )?see (?:the |any )?screws|camo|cortex|plugs|invisible fasteners?|screwless)\b/.test(c)) set.fastening = "hidden";
  else if (/\b(?:face[- ]?screw(?:ed|s)?|screws|face[- ]?fasten(?:ed)?|top screwed|deck screws)\b/.test(c)) set.fastening = "screws";
  if (/\bfascia\b|\brim (?:cover|boards?)\b|\bskirt boards?\b/.test(c)) set.fascia = isRemove(c) ? "none" : "match";
  const waste = /(\d+)% (?:waste|extra|overage)|(?:waste|overage|extra) (?:of |at |to )?(\d+)%/.exec(c);
  if (waste) set.wastePct = Number(waste[1] ?? waste[2]);
  if (!Object.keys(set).length) return null;
  void ctx;
  return read([{ do: "decking", set }], "decking");
}

/* ------------------------------------------------------------------ */
/*  The frame                                                          */
/* ------------------------------------------------------------------ */

const SPECIES_WORDS: ReadonlyArray<[RegExp, FramingSet["species"]]> = [
  [/\b(?:southern (?:yellow )?pine|syp|yellow pine)\b/, "southern-pine"],
  [/\bhem[- ]?fir\b/, "hem-fir"],
  [/\b(?:douglas fir|doug fir|df)\b/, "douglas-fir"],
  [/\b(?:spf|spruce(?: pine fir)?)\b/, "spf"],
  [/\bponderosa\b/, "ponderosa-pine"],
  [/\bred pine\b/, "red-pine"],
  [/\bredwood (?:framing|frame|joists|lumber)\b/, "redwood"],
  [/\bcedar (?:framing|frame|joists|lumber)\b/, "western-cedar"],
];

function readFrame(c: string, ctx: ParseContext): Read {
  const cmds: DeckCommand[] = [];
  const set: FramingSet = {};
  const joistSaid = /\bjoists?\b/.test(c);
  const beamSaid = /\b(?:beams?|girders?)\b/.test(c);
  const postSaid = /\bposts?\b/.test(c) && !/\b(?:roof posts?|rail posts?)\b/.test(c);
  const lum = /\b(2x(?:6|8|10|12))\b/.exec(c);
  if (joistSaid) {
    if (lum && !/\b\d-2x/.test(c)) set.joist = lum[1] as FramingSet["joist"];
    else if (/\b(?:bigger|stronger|beefier|heavier|deeper|larger|up ?size|up a size|thicker) joists\b|\bjoists? (?:bigger|stronger|up a size)\b|\bupsize the joists\b/.test(c)) set.joist = "up";
    else if (/\b(?:smaller|lighter|shallower|thinner) joists\b|\bjoists? (?:smaller|down a size)\b|\bdownsize the joists\b/.test(c)) set.joist = "down";
    else if (/\b(?:auto|let the (?:code|tables|engine) (?:pick|decide|choose)|code minimum|whatever (?:works|code says))\b/.test(c)) set.joist = "auto";
  }
  const sp = /\b(12|16|24)(?: in)? (?:oc|apart|spacing|on center|centers)\b|\bspacing (?:of |to |at )?(12|16|24)\b|\bjoists? (?:every|at) (12|16|24)\b/.exec(c);
  if (sp) set.spacingIn = Number(sp[1] ?? sp[2] ?? sp[3]) as 12 | 16 | 24;
  else if (joistSaid && /\b(?:closer|tighter|stiffer|more joists|closer together)\b/.test(c)) set.spacingIn = 12;
  else if (joistSaid && /\b(?:farther apart|further apart|fewer joists|wider spacing|spread (?:them )?out)\b/.test(c)) set.spacingIn = 24;
  if (beamSaid) {
    const built = /\b([23])-(2x(?:6|8|10|12))\b/.exec(c);
    const solid = /\b(4x(?:6|8|10|12))\b/.exec(c);
    if (built) {
      set.beamKind = "built-up";
      set.beam = `${built[1]}-${built[2]}` as FramingSet["beam"];
    } else if (solid) {
      set.beamKind = "solid";
      set.beam = solid[1] as FramingSet["beam"];
    } else if (lum && /\b(?:double|two|2)\b/.test(c)) {
      set.beamKind = "built-up";
      set.beam = `2-${lum[1]}` as FramingSet["beam"];
    } else if (lum && /\b(?:triple|three|3)\b/.test(c)) {
      set.beamKind = "built-up";
      set.beam = `3-${lum[1]}` as FramingSet["beam"];
    } else if (/\b(?:built[- ]?up|ply|plies|sistered)\b/.test(c)) set.beamKind = "built-up";
    else if (/\bsolid\b/.test(c)) set.beamKind = "solid";
    if (/\bflush\b|\bin (?:the )?(?:floor|plane)\b|\bno dropped\b|\binline\b/.test(c)) set.beamStyle = "flush";
    else if (/\bdropped\b|\bunder(?:neath)? the joists\b|\bbelow the joists\b/.test(c)) set.beamStyle = "dropped";
    if (/\b(?:lvl|glulam|steel|engineered)\b/.test(c)) cmds.push({ do: "wish", text: c, item: "Engineered deck beams" });
  }
  if (postSaid) {
    const p = /\b(4x4|4x6|6x6|8x8)\b/.exec(c) ?? /\b(4|6|8) by (4|6|8)\b/.exec(c);
    if (p) set.post = (p[2] ? `${p[1]}x${p[2]}` : p[1]) as FramingSet["post"];
    else if (/\b(?:bigger|beefier|stronger|thicker|heavier) posts\b/.test(c)) set.post = ctx.design.framing.post === "4x4" ? "6x6" : "8x8";
  }
  const cant = /\b(?:cantilever|overhang|joists? (?:run |hang )?past the beam)\b/.test(c);
  if (cant && !/\broof\b/.test(c)) {
    const v = nums(c).find((x) => x.unit !== "$" && x.unit !== "%");
    if (/\bno (?:cantilever|overhang)\b|\bbeam (?:at|on|under) the (?:edge|front|end)\b/.test(c)) set.overhangFt = 0;
    else if (v) set.overhangFt = v.unit === "in" || (v.unit === null && v.n > 4) ? v.n / 12 : v.n;
    else if (/\bauto\b|\bwhatever\b|\bthe table\b/.test(c)) set.overhangFt = "auto";
    else if (/\b(?:more|bigger|longer)\b/.test(c)) set.overhangFt = 2;
  }
  for (const [re, id] of SPECIES_WORDS) if (re.test(c)) { set.species = id; break; }
  if (/\bdouble(?:d)? (?:rim|band|rim joist)\b|\brim doubled\b/.test(c)) set.doubleRim = !isRemove(c);
  else if (/\bsingle rim\b/.test(c)) set.doubleRim = false;
  if (/\b(?:joist|flashing|butyl) tape\b|\btape the joists\b/.test(c)) set.joistTape = !isRemove(c);
  if (/\b(?:mid[- ]?span |solid |extra )?blocking\b/.test(c)) set.blocking = isRemove(c) ? "auto" : "mid-span";
  if (/\b(?:knee )?brac(?:es|ing)\b/.test(c) && !/\broof\b/.test(c)) set.braces = !isRemove(c);
  if (Object.keys(set).length) cmds.push({ do: "framing", set });
  // Hardware by the coast.
  if (/\bstainless\b|\bcoastal\b|\bsalt (?:water|air|spray)\b|\bocean\b|\bbeach\b|\bnear the (?:water|sea|ocean)\b|\bwaterfront\b/.test(c)) cmds.push({ do: "extras", stainless: !isRemove(c) });
  else if (/\bgalvanized\b|\bzmax\b|\bhot[- ]dip(?:ped)?\b|\bg185\b/.test(c)) cmds.push({ do: "extras", stainless: false });
  // The ledger.
  const fastener = /\b(?:through[- ]?bolts?|bolts?|carriage bolts)\b/.test(c) && !/\bhold[- ]?downs?\b/.test(c) ? "bolt" : /\bledgerlok\b|\bfastenmaster\b/.test(c) ? "ledgerlok" : /\bsdws\b|\bsimpson (?:sdws|screws)\b|\bstructural screws\b/.test(c) ? "sdws" : /\b(?:wedge|epoxy|expansion|concrete) anchors?\b|\banchors\b/.test(c) ? "anchor" : /\blag(?:s| screws| bolts)?\b/.test(c) ? "lag" : undefined;
  const lateral = /\b(?:four|4) hold[- ]?downs?\b|\b750\b/.test(c) ? "four" : /\b(?:two|2) hold[- ]?downs?\b|\b1500\b/.test(c) ? "two" : undefined;
  if (fastener || lateral) cmds.push({ do: "ledger", fastener, lateral });
  // The footings.
  const ft: Extract<DeckCommand, { do: "footing" }> = { do: "footing" };
  if (/\b(?:pier blocks?|deck blocks?|precast(?: blocks?| piers?)?|dek[- ]?blocks?|concrete blocks? on the ground|floating footings)\b/.test(c)) ft.type = "pier-block";
  else if (/\b(?:poured(?: concrete)?(?: footings| piers)?|concrete footings|sonotubes?|form tubes?|cast[- ]in[- ]place|concrete piers?|dig (?:holes|footings))\b/.test(c)) ft.type = "poured";
  if (/\b(?:dig (?:them |the footings )?(?:to|below) (?:the )?frost|frost (?:line )?always|below (?:the )?frost line|to frost depth|frost protected)\b/.test(c)) ft.frostAlways = !isRemove(c);
  const above = /(\d+(?:\.\d+)?)(?: in)? (?:above (?:grade|the ground)|out of the ground|proud|above ground)\b/.exec(c);
  if (above && /\b(?:footings?|piers?|concrete|tubes?)\b/.test(c)) ft.aboveGradeIn = Number(above[1]);
  if (Object.keys(ft).length > 1) cmds.push(ft);
  if (/\b(?:helical|screw piles?|diamond piers?)\b/.test(c)) cmds.push({ do: "wish", text: c, item: "Helical piles" });
  return read(cmds, "frame");
}

/* ------------------------------------------------------------------ */
/*  The site: frost, snow, load, soil, slope, the state                */
/* ------------------------------------------------------------------ */

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];
const STATE_BY_NAME = new Map(STATES.map((s) => [(stateName(s) ?? s).toLowerCase().replace(/^the /, ""), s]));

function readSite(c: string): Read {
  const cmd: Extract<DeckCommand, { do: "site" }> = { do: "site" };
  const all = nums(c).filter((x) => x.unit !== "$" && x.unit !== "%");
  if (/\bfrost\b/.test(c) && all.length) {
    const v = all[0];
    cmd.frostIn = { to: v.unit === "ft" || (v.unit === null && v.n <= 8) ? v.n * 12 : v.n };
  } else if (/\bfrost\b/.test(c) && /\b(?:deeper|more)\b/.test(c)) cmd.frostIn = { by: 6 };
  if (/\bsnow\b/.test(c) && all.length) cmd.snowPsf = all[0].n;
  else if (/\b(?:design |live )?load\b/.test(c) && all.length && !/\bsnow\b/.test(c)) {
    const v = all[0].n;
    cmd.loadPsf = v <= 45 ? 40 : v <= 55 ? 50 : v <= 65 ? 60 : 70;
  }
  if (/\bsoil\b|\bclay\b|\bsand(?:y)?\b|\bgravel\b|\brock(?:y)?\b|\bbedrock\b|\bloam\b|\bground is\b/.test(c)) {
    const v = all.find((x) => x.n >= 1000);
    cmd.soilPsf = v ? (v.n >= 2500 ? 3000 : v.n >= 1750 ? 2000 : 1500) : /\b(?:gravel|rock|bedrock|rocky)\b/.test(c) ? 3000 : /\bsand(?:y)?\b/.test(c) ? 2000 : /\b(?:clay|loam|soft|silt)\b/.test(c) ? 1500 : undefined;
  }
  if (/\b(?:slopes?|sloped|sloping|drops?|falls?|hill(?:side)?|grade drops|downhill|uphill|the yard (?:goes|runs) (?:down|up))\b/.test(c) && !/\broof\b/.test(c)) {
    const v = all[0];
    const inches = v ? (v.unit === "ft" || (v.unit === null && v.n <= 6) ? v.n * 12 : v.n) : 24;
    if (/\b(?:left to right|to the right|toward the right|downhill to the right)\b/.test(c)) cmd.acrossDropIn = inches;
    else if (/\b(?:right to left|to the left|toward the left|downhill to the left)\b/.test(c)) cmd.acrossDropIn = -inches;
    else if (/\b(?:toward the house|towards the house|up away from the house|uphill away)\b/.test(c)) cmd.outDropIn = -inches;
    else cmd.outDropIn = inches;
  } else if (/\b(?:flat|level) (?:ground|yard|lot|site|grade)\b|\bthe (?:ground|yard|lot) is (?:flat|level)\b/.test(c)) {
    cmd.outDropIn = 0;
    cmd.acrossDropIn = 0;
  }
  const st = /\b(?:in|state is|we're in|i'm in|job is in|located in|build(?:ing)? in) ((?:new |north |south |west |rhode |district of )?[a-z]+)\b/.exec(c);
  if (st) {
    const code = STATE_BY_NAME.get(st[1]) ?? (/^[a-z]{2}$/.test(st[1]) && STATES.includes(st[1].toUpperCase()) ? st[1].toUpperCase() : null);
    if (code) cmd.state = code;
  }
  return Object.keys(cmd).length > 1 ? read([cmd], "frame") : null;
}

/* ------------------------------------------------------------------ */
/*  Extras: tear-out, drainage                                         */
/* ------------------------------------------------------------------ */

function readExtras(c: string): Read {
  if (/\b(?:tear(?:ing)? (?:out|off|down)|demo(?:lish|lition|ing)?|rip(?:ping)? out|(?:remove|take down|haul away) (?:the )?(?:old|existing) deck|old deck (?:out|removed|gone)|existing deck)\b/.test(c)) {
    if (/\bno demo\b|\bnothing to tear out\b|\bno old deck\b/.test(c)) return read([{ do: "extras", demoSqFt: 0 }], "deck");
    const sq = nums(c).find((x) => x.unit === "sqft");
    const p = pair(c);
    return read([{ do: "extras", demoSqFt: sq ? sq.n : p ? Math.round(ftOf(p.a) * ftOf(p.b)) : "deck" }], "deck");
  }
  if (/\b(?:under[- ]?deck drain(?:age)?|dry space (?:under|below|underneath)|dry (?:area|patio|room) (?:under|below|underneath)|drain(?:age)? (?:under|system|ceiling)|keep (?:it |the area )?dry (?:under|below|underneath)|rain ?escape|dry ?span|watertight under)\b/.test(c)) return read([{ do: "extras", drain: !isRemove(c) }], "deck");
  return null;
}

/* ------------------------------------------------------------------ */
/*  The deck's shape, its place on the house, its height, its size    */
/* ------------------------------------------------------------------ */

const cornerOf = (c: string, fallback: NotchCorner): NotchCorner => {
  const f = /\bback\b|\bhouse side\b|\bby the house\b|\bnear the house\b/.test(c) ? "back" : /\bfront\b|\byard side\b|\bfar\b/.test(c) ? "front" : fallback.split("-")[0];
  const s = /\bleft\b/.test(c) ? "left" : /\bright\b/.test(c) ? "right" : fallback.split("-")[1];
  return `${f}-${s}` as NotchCorner;
};

function readShape(c: string, ctx: ParseContext): Read {
  const d = ctx.design;
  if (/\bl shaped?\b|\bl shape\b|\bin an l\b|\bnotch(?:ed)?\b|\bcut ?out\b|\bcut (?:out )?(?:the|a|off the|out the) (?:front |back )?(?:left |right )?corner\b|\b(?:take|cut|knock) (?:a|one|the) corner (?:out|off)\b|\btake (?:a |one )?corner out of it\b|\bwraparound\b|\bwrap around the corner\b/.test(c) && !/\b(?:clip|angle|45)\b/.test(c)) {
    if (isRemove(c) && !/\b(?:cut|take|knock)\b.*\bcorner\b/.test(c)) return read([{ do: "shape", kind: "rect" }], "deck");
    const corner = cornerOf(c, d.shape.kind === "L" ? d.shape.notch.corner : "front-right");
    const p = pair(c);
    return read([{ do: "shape", kind: "L", corner, notchWidthFt: p ? ftOf(p.a) : undefined, notchDepthFt: p ? ftOf(p.b) : undefined }], "deck");
  }
  if (/\b(?:curved?|rounded|round(?:ed)? (?:off )?(?:the )?(?:front|edge|end)|bow(?:ed)?(?: out)?|arc(?:hed)? front|half[- ]?moon|radius (?:front|edge)|semi[- ]?circle|circular front|curve the front|round (?:it )?off)\b/.test(c) && !/\b(?:rafters|pergola|corners?)\b/.test(c)) {
    if (isRemove(c)) return read([{ do: "shape", kind: "rect" }], "deck");
    const v = lengthFt(c);
    return read([{ do: "shape", kind: "curve", bulgeFt: v ?? undefined }], "deck");
  }
  // Corners cut at 45° (rounded corners are framed the same way: the studio cuts a corner straight).
  if (/\b(?:clip(?:ped)?|angled? corners?|45(?: degrees?)? corners?|chamfer(?:ed)?|cut (?:the |off the )?corners?|corners? (?:cut|angled|clipped|chamfered|at 45)|bay(?:[- ]shaped)?|octagon(?:al)? corners?|angle the corners|round(?:ed)? (?:off )?(?:the )?corners?|soft corners)\b/.test(c)) {
    if (isRemove(c)) return read([{ do: "shape", kind: "rect" }], "deck");
    const v = lengthFt(c);
    return read([{ do: "shape", kind: "clipped", clipFt: v ?? undefined }], "deck");
  }
  if (/\b(?:rectangle|rectangular|straight (?:front|edge)|square corners|plain shape|regular shape|normal shape|box shape|simple shape|no (?:curve|notch|cutout|clip|angles?)|square it off)\b/.test(c)) return read([{ do: "shape", kind: "rect" }], "deck");
  return null;
}

function readSlide(c: string): Read {
  if (!/\b(?:move|slide|shift|scoot|push|center|centre)\b/.test(c)) return null;
  if (!/\b(?:deck|it|the whole thing)\b/.test(c) || STAIR_WORDS.test(c) || SPA_WORDS.test(c) || LOWER_WORDS.test(c)) return null;
  if (/\b(?:center|centre|middle)\b/.test(c) && /\b(?:house|wall|on the house)\b/.test(c)) return read([{ do: "slide", ft: "center" }], "deck");
  const dir = /\bleft\b/.test(c) ? -1 : /\bright\b/.test(c) ? 1 : 0;
  if (!dir) return null;
  const v = lengthFt(c);
  return read([{ do: "slide", ft: dir * (v ?? step(c, 1, 2, 4)) }], "deck");
}

const HEIGHT_PRESETS: ReadonlyArray<[RegExp, number]> = [
  [/\b(?:ground level|grade level|at grade|on the ground|near the ground|low (?:deck|platform)|floating deck|platform deck|close to the ground|low to the ground|as low as (?:it can go|possible))\b/, 14],
  [/\b(?:one step(?: up)?|single step)\b/, 8],
  [/\b(?:two steps(?: up)?|couple (?:of )?steps(?: up)?)\b/, 24],
  [/\b(?:first floor|main floor|door level|level with (?:the )?(?:back |patio |kitchen )?door|kitchen level|at the door|threshold)\b/, 36],
  [/\b(?:walkout|basement level|garden level)\b/, 96],
  [/\b(?:second (?:floor|story|level of the house)|upstairs|2nd floor|upper floor|second[- ]story deck|balcony)\b/, 120],
  [/\b(?:third floor|3rd floor)\b/, 216],
];

function readHeight(c: string, ctx: ParseContext): Read {
  const heightWords = /\b(?:high|higher|height|tall|taller|raise|raised|lower|elevat(?:e|ed|ion)|off the ground|above (?:the )?(?:ground|grade)|up off|lift|drop (?:it|the deck)|drop it|up|down)\b/;
  let preset: number | null = null;
  for (const [re, inches] of HEIGHT_PRESETS) if (re.test(c)) { preset = inches; break; }
  if (preset !== null && !/\bstairs?|steps? (?:down|to)\b/.test(c.replace(/\b(?:one|two|couple (?:of )?)steps?(?: up)?\b/, ""))) return read([{ do: "height", in: { to: preset } }], "height");
  if (!heightWords.test(c)) return null;
  if (/\b(?:wider|deeper|longer|bigger|smaller)\b/.test(c) && !/\b(?:higher|taller|lower|raise)\b/.test(c)) return null;
  const v = nums(c).find((x) => x.unit === "ft" || x.unit === "in" || x.unit === null);
  if (/\bcut (?:it )?down\b|\bscale (?:it )?down\b/.test(c)) return null;
  const dir = dirOf(c, /\b(?:higher|taller|raise|raised|up|lift|elevate)\b/, /\b(?:lower|down|drop|shorter|closer to the ground)\b/);
  if (v) {
    const rel = (RELATIVE_CUE.test(c) && !ABSOLUTE_CUE.test(c)) || (dir !== 0 && !/\b(?:to|at)\s+\d/.test(c) && !/\b(?:high|tall|off the ground|above)\b/.test(c)) || /\b(?:bring|take|put|move|set) (?:it )?(?:down|up)\b/.test(c);
    const inches = v.unit === "in" ? v.n : v.unit === "ft" ? v.n * 12 : rel ? (v.n <= 3 ? v.n * 12 : v.n) : v.n <= 12 ? v.n * 12 : v.n;
    return read([{ do: "height", in: rel ? { by: (dir || 1) * inches } : { to: inches } }], "height");
  }
  if (dir) return read([{ do: "height", in: { by: dir * step(c, 6, 12, 24) } }], "height");
  if (/\bheight\b/.test(c)) return read([{ do: "show", part: "height" }], "height");
  void ctx;
  return null;
}

function readSize(c: string, ctx: ParseContext): Read {
  const p = pair(c);
  if (p) return read([{ do: "size", width: { to: ftOf(p.a) }, depth: { to: ftOf(p.b) } }], "deck");
  const sq = nums(c).find((x) => x.unit === "sqft");
  if (sq && !/\b(?:demo|tear|old deck)\b/.test(c)) return read([{ do: "size", areaSqFt: sq.n }], "deck");
  if (/\b(?:all the way|whole way|full length|the (?:whole|full|entire) (?:length|width))(?: of)?(?: across| along)?(?: the)?(?: back of the)? house\b|\b(?:across|along) the (?:whole|entire|full) (?:back of the )?house\b|\bwall to wall\b|\bcorner to corner of the house\b/.test(c)) return read([{ do: "size", from: "house" }], "width");
  // "It's too deep", "too wide", "too small": the other way, by the usual step.
  const too = /\btoo (deep|shallow|wide|narrow|long|short|big|small|tiny|large|high|tall|low)\b/.exec(c);
  if (too) {
    const w = too[1];
    if (w === "high" || w === "tall") return read([{ do: "height", in: { by: -12 } }], "height");
    if (w === "low") return read([{ do: "height", in: { by: 12 } }], "height");
    const by = /deep|wide|long|big|large/.test(w) ? -2 : 2;
    if (w === "deep" || w === "shallow") return read([{ do: "size", depth: { by } }], "depth");
    if (w === "wide" || w === "narrow" || w === "long" || w === "short") return read([{ do: "size", width: { by } }], "width");
    return read([{ do: "size", width: { by }, depth: { by } }], "deck");
  }
  const square = /\b(\d+(?:\.\d+)?)(?: ft)? square\b/.exec(c);
  if (square) return read([{ do: "size", width: { to: Number(square[1]) }, depth: { to: Number(square[1]) } }], "deck");
  if (/\bsquare\b/.test(c) && /\b(?:make|it|deck|shape)\b/.test(c) && !/\bsquare (?:feet|footage|foot|corners)\b/.test(c)) return read([{ do: "size", square: true }], "deck");
  const out: Extract<DeckCommand, { do: "size" }> = { do: "size" };
  const W = /\b(?:wide|width|wider|narrower|long|longer|length|across|along the house|widen|narrow|lengthen|shorten)\b/;
  const D = /\b(?:deep|depth|deeper|shallower|out from the house|projection|front to back|further out|farther out|out more|push (?:it )?out|pull (?:it )?in|bring (?:it )?in|extend (?:it )?out|deepen|out|(?:come|stick|reach)(?:s)? out (?:farther|further|more))\b/;
  const parts = c.split(/\b(?=and\b)/);
  for (const part of parts) {
    const n = nums(part).find((x) => x.unit === "ft" || x.unit === "in" || x.unit === null);
    const v = n ? ftOf(n) : null;
    const wDir = dirOf(part, /\b(?:wider|longer|widen|lengthen|extend|more|bigger|grow)\b/, /\b(?:narrower|shorter|narrow|shorten|less|smaller|shrink)\b/);
    const dDir = dirOf(part, /\b(?:deeper|further out|farther out|out more|push (?:it )?out|extend|deepen|more|bigger|grow|farther|further)\b/, /\b(?:shallower|pull (?:it )?in|bring (?:it )?in|less deep|less|smaller|shrink|in)\b/);
    if (D.test(part) && !/\bwide\b/.test(part)) {
      const a = amountOf(part, v, dDir) ?? (dDir ? { by: dDir * step(part, 1, 2, 4) } : null);
      if (a) out.depth = a;
    } else if (W.test(part)) {
      const a = amountOf(part, v, wDir) ?? (wDir ? { by: wDir * step(part, 1, 2, 4) } : null);
      if (a) out.width = a;
      const side = /\b(?:to|on|toward|towards) the (left|right)\b|\b(left|right)(?: side| end)?\b/.exec(part);
      if (side && a && "by" in a) out.from = (side[1] ?? side[2]) as "left" | "right";
    }
  }
  if (out.width || out.depth) return read([out], out.width && !out.depth ? "width" : out.depth && !out.width ? "depth" : "deck");
  // "extend it 4 ft": out from the house; "extend it to the left": along it.
  const ext = /\b(?:extend|expand|add on|add|grow)\b/.exec(c);
  if (ext && /\b(?:deck|it)\b/.test(c)) {
    const n = nums(c).find((x) => x.unit === "ft" || x.unit === null);
    const side = /\b(left|right)\b/.exec(c);
    const by = n ? ftOf(n) : step(c, 1, 2, 4);
    if (side) return read([{ do: "size", width: { by }, from: side[1] as "left" | "right" }], "width");
    if (n || /\bout\b/.test(c)) return read([{ do: "size", depth: { by } }], "depth");
  }
  const bigger = dirOf(c, /\b(?:bigger|larger|grow|expand|enlarge|more room|more space|roomier|supersize|maximi[sz]e|go big|huge|massive)\b/, /\b(?:smaller|shrink|tinier|less room|cozier|compact|cut (?:it )?down|scale (?:it )?(?:back|down)|downsize)\b/);
  const times = amountOf(c, null, bigger);
  if (times && "times" in times && /\b(?:size|deck|it|area)\b/.test(c)) return read([{ do: "size", width: { times: Math.sqrt(times.times) }, depth: { times: Math.sqrt(times.times) } }], "deck");
  if (bigger) {
    const n = nums(c).find((x) => x.unit === "ft" || x.unit === null);
    const s = bigger * (n ? ftOf(n) : step(c, 1, 2, 4));
    return read([{ do: "size", width: { by: s }, depth: { by: s } }], "deck");
  }
  void ctx;
  return null;
}

/* ------------------------------------------------------------------ */
/*  Words with no subject: read against the last one                   */
/* ------------------------------------------------------------------ */

/** A clause made only of pointing and measuring words ("make them a bit wider", "move it 2 ft left", "more"): it names
 *  nothing new, so it is about what was talked about last. "Add a fire pit" names something — it is not. */
const RELATIVE_WORD = /^(?:make|it|its|them|they|those|these|that|this|one|ones|a|an|the|bit|little|lot|tad|touch|much|way|even|more|less|bigger|smaller|larger|wider|narrower|longer|shorter|higher|lower|taller|deeper|shallower|steeper|flatter|lighter|darker|brighter|up|down|left|right|over|to|side|other|middle|center|centre|move|go|again|by|ft|in|and|please|some|slightly|just|too|so|fewer|another|extra|raise|drop|wide|width|flip|mirror|put|back|forward|toward|towards|out|of|total|now|same|slide|shift|scoot|push|pull|switch|turn|swap|opposite|both|sides|bring|keep|going|further|farther|closer|really|very|quite|no|not|enough|than|that's|all|way|then|okay|ok)$/;
const RELATIVE_ONLY = (c: string) => c.split(" ").every((w) => RELATIVE_WORD.test(w) || /^\$?\d+(?:\.\d+)?%?$/.test(w));

function readRelative(c: string, ctx: ParseContext): Read {
  const s = ctx.subject;
  // The rail and the boards take their own words after them ("glass panels", "posts every 6 ft", "aluminum"); every
  // other subject only pointing and measuring words.
  if (!s || (s !== "rail" && s !== "decking" && !RELATIVE_ONLY(c))) return null;
  const up = /\b(?:bigger|larger|wider|more|higher|taller|up|longer|deeper|steeper|raise|increase|grow)\b/;
  const down = /\b(?:smaller|narrower|less|lower|shorter|down|shallower|flatter|decrease|shrink)\b/;
  const dir = dirOf(c, up, down);
  const n = nums(c).find((x) => x.unit === "ft" || x.unit === "in" || x.unit === null);
  switch (s) {
    case "stairs": {
      if (/\b(?:left|right)\b/.test(c) && !/\bside\b/.test(c)) return read([{ do: "stairs", op: "change", which: "last", at: { by: (/\bleft\b/.test(c) ? -1 : 1) * (n ? ftOf(n) : step(c, 1, 2, 4)) } }], "stairs");
      if (/\b(?:left|right) side\b/.test(c)) return read([{ do: "stairs", op: "change", which: "last", side: /\bleft\b/.test(c) ? "left" : "right" }], "stairs");
      if (/\b(?:other side|flip|mirror)\b/.test(c)) return read([{ do: "stairs", op: "change", which: "last", flip: true }], "stairs");
      if (/\b(?:middle|center|centered|centre)\b/.test(c)) return read([{ do: "stairs", op: "change", which: "last", at: "center" }], "stairs");
      const sdir = dirOf(c, /\b(?:wider|bigger|broader|larger|more)\b/, /\b(?:narrower|smaller|skinnier|less)\b/);
      if (sdir || (n && /\b(?:wide|width)\b/.test(c))) return read([{ do: "stairs", op: "change", which: "last", width: n ? amountOf(c, n.unit === "in" || n.n > 12 ? n.n / 12 : n.n, sdir)! : { by: sdir * step(c, 0.5, 1, 2) } }], "stairs");
      return null;
    }
    case "height": {
      const hdir = dirOf(c, /\b(?:higher|taller|up|raise|lift)\b/, /\b(?:lower|down|shorter|drop)\b/);
      if (hdir || (n && !/\b(?:wide|deep|bigger|smaller|wider|deeper|longer)\b/.test(c))) return read([{ do: "height", in: n ? amountOf(c, n.unit === "ft" || (n.unit === null && n.n <= 12) ? n.n * 12 : n.n, hdir)! : { by: hdir * step(c, 6, 12, 24) } }], "height");
      return null;
    }
    case "pitch":
    case "roof": {
      if (/\b(?:steeper|flatter)\b/.test(c) || (s === "pitch" && (dir || n))) return read([{ do: "roof", set: { pitch: n ? amountOf(c, n.n, dir)! : { by: (/\bflatter\b/.test(c) ? -1 : dir || 1) * step(c, 1, 2, 3) } } }], "pitch");
      const edir = dirOf(c, /\b(?:higher|taller|raise|up)\b/, /\b(?:lower|shorter|down)\b/);
      if (edir) return read([{ do: "roof", set: { eaveIn: n ? amountOf(c, n.unit === "ft" || (n.unit === null && n.n <= 14) ? n.n * 12 : n.n, edir)! : { by: edir * step(c, 6, 12, 24) } } }], "eave");
      return null;
    }
    case "eave":
      if (dir || n) return read([{ do: "roof", set: { eaveIn: n ? amountOf(c, n.unit === "ft" || (n.unit === null && n.n <= 14) ? n.n * 12 : n.n, dir)! : { by: dir * step(c, 6, 12, 24) } } }], "eave");
      return null;
    case "overhang":
      if (dir || n) return read([{ do: "roof", set: { overhangIn: n ? amountOf(c, n.unit === "ft" ? n.n * 12 : n.n, dir)! : { by: dir * step(c, 3, 6, 12) } } }], "overhang");
      return null;
    case "slats":
      if (dir) return read([{ do: "roof", set: { slatSpacingIn: { by: dir * 3 } } }], "slats");
      return null;
    case "lower": {
      const sz = sizeAmounts(c, 1, 2, 4);
      if (sz.width || sz.depth) return read([{ do: "lower", ...sz }], "lower");
      if (/\b(?:lower|higher|drop)\b/.test(c) && (dir || n)) return read([{ do: "lower", dropIn: n ? amountOf(c, n.n, dir)! : { by: dir * 3 } }], "lower");
      return null;
    }
    case "spa": {
      const sz = sizeAmounts(c, 0.5, 1, 2);
      if (sz.width || sz.depth) return read([{ do: "spa", ...sz }], "spa");
      const al = alignOf(c);
      if (al) return read([{ do: "spa", align: al }], "spa");
      return null;
    }
    case "rail": {
      // "Make it two feet higher" after a rail was named is the DECK going up (a rail is only ever 36 or 42 in.; it is
      // "taller", the deck is "higher") — unless the rail, the posts or "them" are said (2026-10-24, the studio walk).
      if (/\b(?:higher|lower|raise|drop|up|down)\b/.test(c) && !/\b(?:taller|shorter|rails?|railings?|guards?|them|those|posts?)\b/.test(c)) return readRelative(c, { ...ctx, subject: "height" });
      const set: RailSet = {};
      const type = railType(c);
      if (type) set.type = type;
      if (/\bglass\b/.test(c)) set.type = "glass";
      const h = nums(c).find((x) => x.unit !== "$" && x.unit !== "%");
      const spacing = /\b(?:every|apart|spacing|on center|oc)\b/.test(c);
      if (h && spacing) set.postSpacingFt = h.n <= 5 ? 4 : h.n <= 7 ? 6 : 8;
      else if (h) set.heightIn = (h.unit === "ft" || (h.unit === null && h.n <= 4) ? h.n * 12 : h.n) >= 39 ? 42 : 36;
      else if (/\b(?:taller|higher)\b/.test(c)) set.heightIn = 42;
      else if (/\b(?:shorter|lower)\b/.test(c)) set.heightIn = 36;
      if (/\b(?:balusters|spindle)\b/.test(c)) set.infill = "balusters";
      else if (/\bhorizontal\b/.test(c)) set.infill = "horizontal";
      if (/\b(?:drink|cap)\b/.test(c)) set.cap = !isRemove(c);
      return Object.keys(set).length ? read([{ do: "rail", set }], "rail") : null;
    }
    case "decking":
      if (/\baluminum\b/.test(c)) return read([{ do: "decking", set: { product: "aluminum" } }], "decking");
      if (/\blighter\b/.test(c)) return read([{ do: "decking", set: { shade: "lighter" } }], "decking");
      if (/\bdarker\b/.test(c)) return read([{ do: "decking", set: { shade: "darker" } }], "decking");
      return null;
    case "fixture": {
      const fdir = dirOf(c, /\b(?:more|another|extra)\b/, /\b(?:fewer|less|one less)\b/);
      if (ctx.fixture && (fdir || (n && /\b(?:of them|total|make it)\b/.test(c)))) return read([{ do: "fixture", op: "set", kind: ctx.fixture, qty: n ? amountOf(c, n.n, fdir)! : { by: fdir } }], "fixture");
      return null;
    }
    case "width":
    case "depth":
    case "deck": {
      if (/\b(?:higher|taller|lower|raise)\b/.test(c)) return null;
      if (dir || n) {
        const key = s === "depth" ? "depth" : s === "width" ? "width" : null;
        const a = n ? amountOf(c, ftOf(n), dir)! : { by: dir * step(c, 1, 2, 4) };
        if (key) return read([{ do: "size", [key]: a }], s);
        if (/\b(?:bigger|smaller|larger)\b/.test(c) || !n) return read([{ do: "size", width: a, depth: a }], "deck");
      }
      return null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Things the studio does not draw: priced as the shop's own item     */
/* ------------------------------------------------------------------ */

function readItem(c: string, ctx: ParseContext): Read {
  const adding = ADD_VERB.test(c) || /^(?:a |an |some |\d+ )/.test(c);
  const price = money(c);
  for (const [re, name] of NOT_DRAWN) {
    if (!re.test(c)) continue;
    if (isRemove(c)) return read([{ do: "item", op: "remove", name }], "deck");
    const n = nums(c).find((x) => x.unit === null && x.n >= 1 && x.n <= 99);
    const known = ctx.items?.[name.toLowerCase()];
    const each = price ?? known?.price;
    if (each !== undefined) return read([{ do: "item", op: "add", name, qty: n?.n ?? 1, unit: known?.unit ?? "ea", price: each }], "deck");
    return read([{ do: "wish", text: c, item: name }], "deck");
  }
  const off = /^(?:remove|delete|take off|take out|get rid of|no more|drop)\s+(?:the |a |an |my |that )?(.{3,40})$/.exec(c);
  if (off && ctx.design.extras.items.some((it) => it.name.toLowerCase().includes(off[1]) || off[1].includes(it.name.toLowerCase()))) return read([{ do: "item", op: "remove", name: off[1] }], "deck");
  // "add a bench for $400", "add 2 planters at $150 each": any named thing with a price is the shop's own item.
  const named = /^(?:add|put|include|install|throw in|plus)?\s*(?:a |an |some |the )?(\d+ )?(.+?)\s+(?:for|at|that costs|costing|priced at|@)\s+\$(\d+(?:\.\d+)?)(?: (?:each|apiece|a piece|per (?:one|piece|unit)))?$/.exec(c);
  if (named && adding) {
    const name = titleCase(named[2]).replace(/^(?:A|An|The|Some) /, "");
    return read([{ do: "item", op: "add", name, qty: named[1] ? Number(named[1]) : 1, unit: "ea", price: Number(named[3]) }], "deck");
  }
  const want = /^(?:add|put|include|install|build|i want|we want|give me|throw in|i need|we need)\s+(?:a |an |some |the )?(.{3,40})$/.exec(c);
  if (want && !/\b(?:it|that|this|them|more|another one|something)\b$/.test(want[1])) {
    const name = titleCase(want[1]);
    const known = ctx.items?.[name.toLowerCase()];
    if (known) return read([{ do: "item", op: "add", name: known.name, qty: 1, unit: known.unit, price: known.price }], "deck");
    return read([{ do: "wish", text: c, item: name }], "deck");
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  The shop's own product in a list ("our own boards … at $9 a foot") */
/* ------------------------------------------------------------------ */

const CUSTOM_SLOT_WORDS: ReadonlyArray<[RegExp, CustomSlot]> = [
  [/\b(?:deck(?:ing)? boards?|decking|boards?|planks?)\b/, "decking"],
  [/\b(?:fasteners?|screws|clips)\b/, "fastening"],
  [/\b(?:roof trim|roof fascia|rake trim)\b/, "roofFascia"],
  [/\bfascia\b/, "fascia"],
  [/\b(?:roofing|shingles|metal roofing|roof panels?)\b/, "roofing"],
  [/\bceiling\b/, "ceiling"],
  [/\bgutters?\b/, "gutters"],
  [/\b(?:walls?|screens?|panels?)\b/, "walls"],
  [/\b(?:lumber|framing|joists)\b/, "species"],
];
function readCustom(c: string): Read {
  if (!/\b(?:my own|our own|custom|the shop's own|a brand called|called|named)\b/.test(c)) return null;
  const price = money(c) ?? (nums(c).find((x) => x.unit === null && /\b(?:dollars?|bucks|a foot|per foot|a square|per square|a sq ?ft|per sq ?ft)\b/.test(c))?.n ?? null);
  const name = /\b(?:called|named|brand(?:ed)?|the)\s+([a-z0-9][a-z0-9 &'.-]{1,40}?)(?:\s+(?:at|for|which|that|costs?|priced)\b|,|$)/.exec(c);
  for (const [re, slot] of CUSTOM_SLOT_WORDS) {
    if (!re.test(c)) continue;
    if (price === null && slot !== "species") return null;
    const label = name?.[1] && !CUSTOM_SLOT_WORDS.some(([r2]) => r2.test(name[1])) ? titleCase(name[1]) : "Our own";
    return read([{ do: "custom", slot, name: label, price: price ?? 0 }], slot === "decking" ? "decking" : "roof");
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  A look, said in a word ("make it look modern")                     */
/* ------------------------------------------------------------------ */

/** The looks people ask for, as the boards, the rail and the details that make them. Said back, and "undo" takes them back. */
const STYLES: ReadonlyArray<{ re: RegExp; name: string; cmds: DeckCommand[] }> = [
  { re: /\b(?:modern|contemporary|sleek|minimal(?:ist)?|clean lines?)\b/, name: "modern", cmds: [{ do: "decking", set: { color: "dark gray", fastening: "hidden", border: 1 } }, { do: "rail", set: { type: "cable" } }] },
  { re: /\b(?:rustic|cabin|lodge|mountain|natural look|woodsy)\b/, name: "rustic", cmds: [{ do: "decking", set: { product: "cedar-54" } }, { do: "rail", set: { type: "cedar" } }] },
  { re: /\b(?:coastal|beachy?|nautical|seaside|lake house)\b/, name: "coastal", cmds: [{ do: "decking", set: { color: "light gray", fastening: "hidden" } }, { do: "rail", set: { type: "vinyl" } }, { do: "extras", stainless: true }] },
  { re: /\b(?:farmhouse|traditional|classic|craftsman|colonial look)\b/, name: "traditional", cmds: [{ do: "decking", set: { color: "brown", border: 0 } }, { do: "rail", set: { type: "composite", infill: "balusters" } }] },
  { re: /\b(?:luxury|luxurious|high[- ]end look|upscale|resort|fancy)\b/, name: "luxury", cmds: [{ do: "decking", set: { tier: "best", border: 2, fastening: "hidden" } }, { do: "rail", set: { type: "glass" } }, { do: "fixture", op: "add", kind: "post-cap" }] },
  { re: /\b(?:low[- ]maintenance|no[- ]maintenance|easy to (?:keep|maintain)|never (?:stain|paint))\b/, name: "low-maintenance", cmds: [{ do: "decking", set: { family: "composite" } }, { do: "rail", set: { type: "aluminum" } }] },
];
function readStyle(c: string): Read {
  if (!/\b(?:look|style|feel|vibe|design|make it|go|more|theme)\b/.test(c) && c.split(" ").length > 3) return null;
  const st = STYLES.find((x) => x.re.test(c));
  return st ? read(st.cmds, "decking") : null;
}

/* ------------------------------------------------------------------ */
/*  One clause                                                         */
/* ------------------------------------------------------------------ */

/** The question, if this is one: what it asks about. */
export function readQuestion(c: string): Read {
  const lead = trimClause(c);
  if (!QUESTION_HEAD.test(lead) && !/\?$/.test(c)) return null;
  // "How much is the railing", "what do the stairs cost": the price of that part, not its facts.
  if (/\b(?:cost|costs|price|charge|expensive|dollars)\b|\bhow much (?:is|are|for) (?:the|a|an|my)\b/.test(lead) && !/\b(?:concrete|cement|bags?|boards?|decking|lumber|screws?|clips)\b/.test(lead)) return read([{ do: "ask", q: "price", about: lead }], null);
  for (const [re, q] of ASK_TOPICS) if (re.test(lead)) return read([{ do: "ask", q, about: lead }], null);
  return read([{ do: "ask", q: "what", about: lead }], null);
}

const DETECTORS: Record<Subject | "_", ((c: string, ctx: ParseContext) => Read) | null> = {
  fixture: readFixture,
  stairs: readStairs,
  rail: readRail,
  spa: readSpa,
  lower: readLower,
  roof: readRoof,
  house: readHouse,
  decking: readDecking,
  frame: (c, ctx) => readFrame(c, ctx) ?? readSite(c),
  deck: null,
  width: null,
  depth: null,
  height: null,
  pitch: null,
  eave: null,
  overhang: null,
  slats: null,
  _: null,
};

/** The rules in the order they are tried when the head subject's own rule reads nothing. */
const ORDER: Array<(c: string, ctx: ParseContext) => Read> = [
  readFixture,
  readStairs,
  readRail,
  readSpa,
  readLower,
  readRoof,
  readHouse,
  (c) => readSite(c),
  (c) => readPlacement(c),
  readDecking,
  readFrame,
  (c) => readExtras(c),
  readShape,
  (c) => readSlide(c),
  readHeight,
  readSize,
  readRelative,
];

export function readClause(raw: string, ctx: ParseContext): ClauseRead {
  const text = raw.trim();
  const c = trimClause(text);
  const learnedHit = ctx.learned?.[phraseKey(c)] ?? ctx.learned?.[phraseKey(text)];
  if (learnedHit?.length) return { text, cmds: learnedHit, subject: ctx.subject, unknown: false };
  const control = readControl(c, text, ctx);
  if (control) return { text, ...control, unknown: false };
  if (!c) return { text, cmds: [], subject: ctx.subject, unknown: false };
  const meta = readMeta(c, text);
  if (meta) return { text, ...meta, unknown: false };
  const question = readQuestion(text);
  if (question) return { text, ...question, unknown: false };
  const places = readPlaces(c);
  if (places) return { text, ...places, unknown: false };
  const style = readStyle(c);
  if (style) return { text, ...style, unknown: false };
  const custom = readCustom(c);
  if (custom) return { text, ...custom, unknown: false };
  const show = readShow(c);
  if (show) return { text, ...show, unknown: false };
  // A clause that names a part to change is read by that part's rule; "show me", "at night" and the like by the view.
  const head = headOf(c, ctx.design.structure !== "deck");
  const own = head ? DETECTORS[head] : null;
  const first = own ? own(c, ctx) : null;
  if (first) return { text, ...first, unknown: false };
  const view0 = readView(c);
  if (view0) return { text, ...view0, unknown: false };
  // Nothing named, and the talk was about a part ("make them wider" after the stairs): that part, before the deck.
  if (!head && ctx.subject && !["deck", "width", "depth"].includes(ctx.subject) && RELATIVE_ONLY(c)) {
    const rel = readRelative(c, ctx);
    if (rel) return { text, ...rel, unknown: false };
  }
  const view = readView(c);
  if (view) return { text, ...view, unknown: false };
  for (const rule of ORDER) {
    const r = rule(c, ctx);
    if (r) return { text, ...r, unknown: false };
  }
  const item = readItem(c, ctx);
  if (item) return { text, ...item, unknown: false };
  if (c.split(" ").length <= 6 && !ADD_VERB.test(c) && !CHANGE_VERB.test(c)) for (const [re, q] of ASK_TOPICS) if (re.test(c)) return { text, cmds: [{ do: "ask", q, about: c }], subject: ctx.subject, unknown: false };
  return { text, cmds: [], subject: ctx.subject, unknown: true };
}

/* ------------------------------------------------------------------ */
/*  A whole sentence                                                   */
/* ------------------------------------------------------------------ */

const VERB_HEAD = /^(?:add|put|place|install|include|remove|delete|take (?:off|out|away)|get rid of|no|make|set|change|use|switch to|swap|replace|give me|i want|we want|i need|want)\b/;

/** The context after a read: what it was about, and the last change by an amount. */
function advance(ctx: ParseContext, r: ClauseRead): ParseContext {
  const last = [...r.cmds].reverse().find((x) => scaleCommand(x, 1)) ?? ctx.last ?? null;
  const fixture = r.cmds.find((x): x is Extract<DeckCommand, { do: "fixture" }> => x.do === "fixture")?.kind ?? ctx.fixture ?? null;
  return { ...ctx, subject: r.subject ?? ctx.subject, last, fixture };
}

/**
 * A sentence → its clauses, each read. A clause with no verb borrows the one before it ("remove the stairs and the
 * railing"); one with "with" is read as two when both halves are commands ("16 by 12 with composite decking").
 */
export function parseUtterance(raw: string, ctx0: ParseContext): { clauses: ClauseRead[]; ctx: ParseContext; whatIf: { words: string; show: boolean } | null } {
  const normalized = normalizeSpeech(raw);
  let ctx = ctx0;
  const lead = trimClause(normalized);
  // What-if and show-me-with: the rest is read as commands, carried out on a copy (or for real, to be seen).
  const shownWith = SHOW_WITH.exec(lead);
  if (shownWith) return { clauses: readParts(shownWith[1] ?? shownWith[2] ?? shownWith[3] ?? "", ctx).clauses, ctx, whatIf: { words: shownWith[1] ?? shownWith[2] ?? shownWith[3] ?? "", show: true } };
  const wi = WHATIF_HEAD.exec(lead);
  if (wi && lead.length > wi[0].length - 1) {
    const rest = (wi[1] ? `${wi[1]} ${lead.slice(wi[0].length)}` : lead.slice(wi[0].length)).trim();
    if (rest) {
      const parts = readParts(rest, ctx);
      if (parts.clauses.some((x) => !x.unknown && x.cmds.some((cmd) => cmd.do !== "ask" && cmd.do !== "show" && cmd.do !== "view"))) return { clauses: parts.clauses, ctx, whatIf: { words: whatIfWords(lead, rest), show: false } };
    }
  }
  const out = readParts(normalized, ctx);
  ctx = out.ctx;
  return { clauses: out.clauses, ctx, whatIf: null };
}

function readParts(text: string, ctx0: ParseContext): { clauses: ClauseRead[]; ctx: ParseContext } {
  let ctx = ctx0;
  const clauses: ClauseRead[] = [];
  let verb: string | null = null;
  for (const part0 of splitClauses(text)) {
    const trimmed = trimClause(part0);
    const ownVerb = VERB_HEAD.exec(trimmed)?.[0] ?? null;
    const part = !ownVerb && verb && !QUESTION_HEAD.test(trimmed) && !/^(?:yes|no|undo|redo|ok)\b/.test(trimmed) ? `${verb} ${trimmed}` : part0;
    if (ownVerb) verb = ownVerb;
    // Kept whole: a question, a what-if, a taught phrase, and a roof's name that has "with" in it ("a hip with gables").
    const whole = /^(?:when(?:ever)? i say|if i say|when i tell you|what if|what about|how about|how much|show me (?:it )?with)\b/.test(trimClause(part)) || QUESTION_HEAD.test(trimClause(part)) || ROOF_KIND_WORDS.some(([re]) => /\bwith\b/.test(re.exec(trimClause(part))?.[0] ?? ""));
    const withParts = whole ? [part] : trimClause(part).split(/\s+(?:with|along with|together with|including|that has|which has|having)\s+/);
    let reads: ClauseRead[] | null = null;
    if (withParts.length > 1) {
      let wctx = ctx;
      const tried: ClauseRead[] = [];
      for (let i = 0; i < withParts.length; i++) {
        const p = i === 0 ? withParts[i] : VERB_HEAD.test(withParts[i]) ? withParts[i] : `${/^(?:remove|delete|no|take)/.test(withParts[0]) ? "add" : "add"} ${withParts[i]}`;
        const r = readClause(p, wctx);
        tried.push(r);
        wctx = advance(wctx, r);
      }
      if (tried.every((r) => !r.unknown && r.cmds.length)) reads = tried;
    }
    if (!reads) reads = [readClause(part, ctx)];
    for (const r of reads) {
      clauses.push(r);
      ctx = advance(ctx, r);
    }
  }
  return { clauses, ctx };
}

/** The what-if as said back: "a roof", "cable railing", "20 by 16" (never "it was 20 by 16"). */
function whatIfWords(lead: string, rest: string): string {
  const m = /^how much (?:would|will|does|do) ((?:a|an|the|some) .+?) (?:cost|add|run|be)\b/.exec(lead);
  const w = (m ? m[1] : rest).replace(/^(?:it (?:was|were|is)|it's|we (?:did|had|used|went with|made it)|i (?:used|went with|made it)|made it|make it|it|to)\s+/, "").trim();
  return w;
}

/** The best of several hearings (a recogniser's alternatives): the first that is read whole, else the first. */
export function bestHearing(alternatives: readonly string[], ctx: ParseContext): string {
  const list = alternatives.map((a) => a.trim()).filter(Boolean);
  for (const alt of list) {
    const r = parseUtterance(alt, ctx);
    if (r.clauses.length && r.clauses.every((x) => !x.unknown)) return alt;
  }
  return list[0] ?? "";
}

/** For the AI's prompt and the tests: the board's family by product id. */
export const familyOf = (id: string): DeckingFamily | null => DECKING.find((p) => p.id === id)?.family ?? null;
