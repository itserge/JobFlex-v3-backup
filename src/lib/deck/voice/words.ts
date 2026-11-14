// WHAT WAS SAID, MADE READABLE (2026-10-21) — pure.
//
// Owner: "add as much as possible commands that could exist to work in Deck Studio as a human being — the way they
// talk — and make sure it will understand not just two by twelve." A browser's speech engine writes what it heard
// the way it likes: "twelve and a half feet", "12' 6\"", "two by twelve", "2 x 12", "to buy 12", "8 in 12 pitch",
// "Joyce" for joists, "dec" for deck. This turns all of it into one plain form the command rules read:
//
//   numbers as digits ("twenty four" → 24, "twelve and a half" → 12.5, "a couple feet" → 2 ft),
//   units as tokens ("12 ft", "36 in", "300 sqft", "45%", "$1200", "8/12 pitch"),
//   lumber as the yard writes it ("2x12", "6x6", "2-2x10" for a doubled beam),
//   trade words the engine mishears put back ("joists", "fascia", "pergola", "Trex", "ipe"),
//
// and splits a sentence into the commands in it ("make it 20 by 14 and add stairs on the left").

const SMALL: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
/** "two by tens" — the plural a crew says for the lumber. */
const PLURAL_NUM: Record<string, string> = { twos: "2s", fours: "4s", sixes: "6s", eights: "8s", tens: "10s", twelves: "12s" };

/** Words a speech engine writes for the trade's own (and the spellings people type). Whole words, in order. */
const HEARD_AS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:joyce|joys|joice|joist's|joyces|joysts?)\b/g, "joists"],
  [/\b(?:dec|deque|dek|decks')\b/g, "deck"],
  [/\b(?:stares|stair's)\b/g, "stairs"],
  [/\b(?:per gola|bergola|pergolas|pergoda|pergolla|per goal a)\b/g, "pergola"],
  [/\b(?:gazebos|gazibo|gazeebo|gazeba|gazebo's)\b/g, "gazebo"],
  [/\b(?:facia|fasha|fascha|fascias|fascia's)\b/g, "fascia"],
  [/\b(?:t-rex|t rex|treks|trek's|trexx)\b/g, "trex"],
  [/\b(?:e pay|ee pay|ipay|epay|i p e|eepay|ipe's)\b/g, "ipe"],
  [/\b(?:a zek|a-zek|azec|asik|a zeck|azeck)\b/g, "azek"],
  [/\b(?:timber tech|timber-tech)\b/g, "timbertech"],
  [/\b(?:fiber on|fibre on|fibron)\b/g, "fiberon"],
  [/\b(?:deck orators|decorators)\b/g, "deckorators"],
  [/\b(?:moisture shield)\b/g, "moistureshield"],
  [/\b(?:armor guard|armour guard)\b/g, "armorguard"],
  [/\b(?:sono tubes?|sauna tubes?|sonar tubes?|sonotubes)\b/g, "sonotube"],
  [/\b(?:can't elevator|candle ever|cantaliver|canter lever|cantilevered)\b/g, "cantilever"],
  [/\b(?:hearing bone|herring bone|herringbones)\b/g, "herringbone"],
  [/\b(?:spindles?|pickets?)\b/g, "balusters"],
  [/\b(?:jacuzzi|jacuzzis|hot tubs|hottub)\b/g, "hot tub"],
  [/\b(?:banisters?)\b/g, "handrail"],
  [/\b(?:storeys|stories)\b/g, "story"],
  [/\bstorey\b/g, "story"],
  [/\bgrey\b/g, "gray"],
  [/\bcolour(s?)\b/g, "color$1"],
  [/\bcentre\b/g, "center"],
  [/\bcentred\b/g, "centered"],
  [/\baluminium\b/g, "aluminum"],
  [/\bledger lok\b/g, "ledgerlok"],
  [/\b(?:louvres?|louvers)\b/g, "louver"],
  [/\b(?:soffits|sofit|soffet)\b/g, "soffit"],
  [/\b(?:cupula|copula)\b/g, "cupola"],
  [/\bx ray\b/g, "xray"],
  [/\bx-ray\b/g, "xray"],
  [/\bthree d\b|\b3 d\b|\b3-d\b/g, "3d"],
  [/\btwo d\b|\b2 d\b|\b2-d\b/g, "2d"],
  [/\bo\.c\.|\bo c\b|\bon centers?\b/g, "oc"],
  [/\bpressure-treated\b/g, "pressure treated"],
  [/\bhalf-round\b/g, "half round"],
  [/\bk-style\b/g, "k style"],
  [/\bwalk-out\b/g, "walkout"],
  [/\bwalk out\b/g, "walkout"],
  [/\bfree-standing\b|\bfree standing\b/g, "freestanding"],
  [/\bself-supporting\b/g, "self supporting"],
  [/\bl-shaped\b|\bl-shape\b|\bel shaped\b|\bell shaped\b/g, "l shaped"],
  [/\bt-and-g\b|\bt&g\b|\bt and g\b|\btongue and groove\b|\btongue in groove\b/g, "tongue-and-groove"],
  [/\bpost and beam\b/g, "post-and-beam"],
  // Roof shapes as a recogniser writes them: "cable roof" is a gable, "gamble roof" a gambrel, "hit roof" a hip.
  [/\b(?:cable|gabel|gabble|able|gay bull|gay bowl)(?: style)? roofs?\b/g, "gable roof"],
  [/\b(?:gabel|gabled|gable's|gables|gabble)\b/g, "gable"],
  [/\b(?:hit|hips|hipp|hipped|hip's)(?: style)? roofs?\b/g, "hip roof"],
  [/\bhip proof\b/g, "hip roof"],
  [/\b(?:gamble|gambel|gambral|gamberel|gambrill|gamble style)(?: roofs?)?\b/g, "gambrel roof"],
  [/\bdutch (?:cable|gabel|gable|gabble|hip)(?: roofs?)?\b/g, "dutch gable roof"],
  [/\b(?:pa goda|pagota|pergoda roof)\b/g, "pagoda"],
  [/\blean (?:too|2|two)\b/g, "lean to"],
  [/\bskill ion\b/g, "skillion"],
  [/\bfull[- ]?screen\b/g, "fullscreen"],
  [/\bsalt and pepper\b/g, "salt-and-pepper"],
  [/\bbead board\b/g, "beadboard"],
  [/\b3-tab\b|\bthree-tab\b/g, "3 tab"],
  [/\bstanding-seam\b/g, "standing seam"],
];

/** Lower case, the typographic marks plain, digits' thousands joined, "×" and "*" between numbers read as "by". */
function plain(raw: string): string {
  return ` ${raw} `
    .toLowerCase()
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, " - ")
    .replace(/½/g, ".5")
    .replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/(\d)\s*[×*]\s*(\d)/g, "$1 by $2")
    .replace(/([a-z])-([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ");
}

type NumKind = "small" | "teen" | "tens" | "hundred" | "thousand";
const kindOf = (w: string): NumKind | null => {
  if (w in TENS) return "tens";
  if (w in SMALL) return SMALL[w] >= 10 ? "teen" : "small";
  if (w === "hundred") return "hundred";
  if (w === "thousand") return "thousand";
  return null;
};

/** "twenty four" → 24, "two hundred and fifty" → 250, "a thousand" → 1000, "a dozen" → 12. */
function numberWords(text: string): string {
  const tok = text.split(" ");
  const out: string[] = [];
  let i = 0;
  while (i < tok.length) {
    const w = tok[i];
    if (w in PLURAL_NUM) {
      out.push(PLURAL_NUM[w]);
      i++;
      continue;
    }
    if ((w === "a" || w === "one") && tok[i + 1] === "dozen") {
      out.push("12");
      i += 2;
      continue;
    }
    const startsWithA = w === "a" && (tok[i + 1] === "hundred" || tok[i + 1] === "thousand");
    if (!kindOf(w) && !startsWithA) {
      out.push(w);
      i++;
      continue;
    }
    let total = 0;
    let current = 0;
    let last: NumKind | "start" = "start";
    let j = i;
    if (startsWithA) {
      current = 1;
      last = "small";
      j++;
    }
    for (; j < tok.length; j++) {
      const t = tok[j];
      const k = kindOf(t);
      if (t === "and" && (last === "hundred" || last === "thousand") && kindOf(tok[j + 1] ?? "")) continue;
      if (k === "small" && (last === "start" || last === "tens" || last === "hundred" || last === "thousand")) current += SMALL[t];
      else if (k === "teen" && (last === "start" || last === "hundred" || last === "thousand")) current += SMALL[t];
      else if (k === "tens" && (last === "start" || last === "hundred" || last === "thousand")) current += TENS[t];
      else if (k === "hundred" && (last === "small" || last === "teen" || last === "tens")) current = (current || 1) * 100;
      else if (k === "thousand" && last !== "thousand" && last !== "start") {
        total += (current || 1) * 1000;
        current = 0;
      } else if (/^\d+$/.test(t) && (last === "hundred" || last === "thousand")) current += Number(t);
      else break;
      last = k ?? last;
    }
    out.push(String(total + current));
    i = j;
  }
  return out.join(" ");
}

const fmt = (n: number) => String(Math.round(n * 10000) / 10000);

/** The fractions, the halves and the "point five"s. */
function fractions(t: string): string {
  return t
    .replace(/\b(\d+) point (\d+)\b/g, "$1.$2")
    .replace(/\b(\d+(?:\.\d+)?) and (?:a |one )half\b/g, (_, n) => fmt(Number(n) + 0.5))
    .replace(/\b(\d+(?:\.\d+)?) and (?:a |one )quarter\b/g, (_, n) => fmt(Number(n) + 0.25))
    .replace(/\b(\d+(?:\.\d+)?) and (?:3|three) quarters\b/g, (_, n) => fmt(Number(n) + 0.75))
    .replace(/\b(\d+) (\d)\/(2|4|8|16)\b/g, (_, n, a, b) => fmt(Number(n) + Number(a) / Number(b)))
    .replace(/\b(?:a|one) half\b/g, "0.5")
    .replace(/\bhalf (?:a|an)\b/g, "0.5")
    .replace(/\b(?:a|one) quarter (?=inch|in\b|foot|ft\b)/g, "0.25 ")
    .replace(/\b1\/2 (?=inch|in\b|foot|ft\b)/g, "0.5 ")
    .replace(/\b(?:3|three) quarters? (?:of an |of a )?(?=inch|in\b)/g, "0.75 ");
}

/** "for feet deeper" → "4 feet deeper": the little words a recogniser writes for a number, where a unit follows. */
function homophones(t: string): string {
  return t
    .replace(/\b(?:for|fore)\s+(?=(?:more )?(?:feet|foot|ft|inches|inch)\b)/g, "4 ")
    .replace(/\b(?:to|too)\s+(?=(?:more )?(?:feet|foot|inches|inch)\b)/g, "2 ")
    .replace(/\bate\s+(?=(?:feet|foot|inches|inch)\b)/g, "8 ")
    .replace(/\bto buy (4|6|8|10|12)(s?)\b/g, "2 by $1$2")
    .replace(/\btoo by (4|6|8|10|12)(s?)\b/g, "2 by $1$2")
    .replace(/\ba couple(?: of)? (?=feet|foot|inches|inch)/g, "2 ")
    .replace(/\ba few (?=feet|foot|inches|inch)/g, "3 ")
    .replace(/(?<!(?:\$\d+(?:\.\d+)?|dollars|bucks|cents)\s)\ba (?=foot\b)/g, "1 ")
    .replace(/\ban (?=inch\b)/g, "1 ");
}

/** Units to one token each: "12 ft", "36 in", "300 sqft", "45%", "$1200", "40 psf". */
function units(t: string): string {
  let s = t
    .replace(/\$\s*(\d+(?:\.\d+)?)\s*k\b/g, (_, n) => `$${fmt(Number(n) * 1000)}`)
    .replace(/\$\s*(\d+(?:\.\d+)?)/g, "$$$1")
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:dollars|bucks|usd)\b/g, "$$$1")
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:square feet|square foot|sq\.?\s?ft\.?|sqft|sq feet|sf)\b/g, "$1 sqft")
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:percent|per cent|%)/g, "$1%")
    .replace(/\b(\d+(?:\.\d+)?)\s*(?:psf|pounds per square foot|lbs per square foot|pounds per sq ft)\b/g, "$1 psf")
    .replace(/\b(\d+(?:\.\d+)?)\s*-?\s*(?:feet|foot|ft\.?)(?![a-z])/g, "$1 ft")
    .replace(/\b(\d+(?:\.\d+)?)\s*'(?![a-z])/g, "$1 ft")
    .replace(/\b(\d+(?:\.\d+)?)\s*-?\s*(?:inches|inch|in\.)(?![a-z])/g, "$1 in")
    .replace(/\b(\d+(?:\.\d+)?)\s*"/g, "$1 in")
    .replace(/\b(\d+(?:\.\d+)?) in(?= (?:high|tall|wide|deep|apart|oc|thick|lower|higher|more|less|longer|shorter|bigger|smaller|up|down|off|above|below|deeper|taller|overhang|drop|step|rise|riser|of|by|x|and|to)\b|\s*$|\s*[,.;])/g, "$1 in");
  // Feet and inches together: "12 ft 6 in" → 12.5 ft; "12 ft 6" (a number under twelve, nothing after it) → 12.5 ft.
  s = s.replace(/\b(\d+(?:\.\d+)?) ft (?:and )?(\d+(?:\.\d+)?) in\b/g, (_, f, i) => `${fmt(Number(f) + Number(i) / 12)} ft`);
  s = s.replace(/\b(\d+) ft (\d{1,2})\b(?! ?(?:ft|in|by|x|%|sqft|psf|\/|\d|and|feet|foot))/g, (m, f, i) => (Number(i) < 12 ? `${fmt(Number(f) + Number(i) / 12)} ft` : m));
  return s;
}

/** A roof's slope: "8 in 12", "8 on 12", "8 over 12", "8:12", "8/12", "8 12 pitch" → "8/12 pitch". */
function pitches(t: string): string {
  return t
    .replace(/\b(\d{1,2})\s*(?:\/|:|\s+in\s+|\s+on\s+|\s+over\s+|\s+of\s+)\s*12\b(?:\s*(?:pitch|slope|roof pitch))?/g, "$1/12 pitch")
    .replace(/\b(\d{1,2}) 12 (?:pitch|slope)\b/g, "$1/12 pitch")
    .replace(/\b(\d{1,2})\/12 pitch(?: pitch| slope)+/g, "$1/12 pitch")
    .replace(/\b(\d{1,2}) in 12 pitch\b/g, "$1/12 pitch");
}

const LUMBER_A = new Set(["1", "2", "3", "4", "5/4", "6", "8"]);
const LUMBER_B = new Set(["2", "3", "4", "6", "8", "10", "12"]);
const LUMBER_NOUN = /^(?:posts?|beams?|joists?|rafters?|headers?|lumber|timbers?|studs?|girders?|stringers?|ledgers?|rims?|blocking|boards?|decking|slats?|braces?|plies|ply|lvl|framing|frame|treated|pt|cedar|pressure)$/;

/**
 * "2 by 12", "2 x 12", "2 by 10s" → "2x12": a pair that is a piece of lumber. A 2-by is always lumber (no deck is 2 ft
 * wide); a 4-by, 6-by or 8-by is lumber said plural ("6x6s") or with a lumber word right beside it ("6 by 6 posts"), and a
 * square 4x4 or 6x6 with no feet after it; anything else stays a size ("16 by 12", "8 by 12 lower level").
 */
function lumber(t: string): string {
  return t.replace(/\b(\d+(?:\/\d+)?)\s*(?:x|by)\s*(\d+)(s?)\b(?!\s*(?:ft|sqft))(?=(?:\s+([a-z]+))?)/g, (m, a: string, b: string, s: string, next: string | undefined, at: number, all: string) => {
    if (!LUMBER_A.has(a) || !LUMBER_B.has(b)) return m;
    const prev = /([a-z]+)\s*$/.exec(all.slice(0, at))?.[1] ?? "";
    const square = a === b && (a === "4" || a === "6");
    const beside = LUMBER_NOUN.test(next ?? "") || LUMBER_NOUN.test(prev);
    const yes = a === "1" || a === "2" || a === "3" || a === "5/4" || !!s || beside || square;
    return yes ? `${a}x${b}${s}` : m;
  });
}

/** A beam of plies: "double 2x10", "two 2x10s", "2 ply 2x12", "triple 2x12" → "2-2x10", "3-2x12". */
function plies(t: string): string {
  return t
    .replace(/\b(?:double|doubled|two|2)(?:[- ]ply)?\s+(2x(?:6|8|10|12))s?\b/g, "2-$1")
    .replace(/\b(?:triple|tripled|three|3)(?:[- ]ply)?\s+(2x(?:6|8|10|12))s?\b/g, "3-$1")
    .replace(/\b(2x(?:4|6|8|10|12))s\b/g, "$1");
}

/** Everything above, in order: what the command rules read. */
/**
 * What a homeowner says, in the studio's words (2026-10-21, owner: "understand different wording for clients — what
 * it means based on what we have in the Deck Studio"). Read before everything else, so the rules take them as their own.
 */
const EVERYDAY: ReadonlyArray<[RegExp, string]> = [
  // Shade, not a board colour ("shade" alone is a colour's shade).
  [/\b(?:some |more |a bit of |a little )?shade (?:from|against) the sun\b|\b(?:keep|block) (?:out )?the sun(?: off(?: us)?)?\b|\bsun (?:cover|shade)\b|\bsomething for (?:the )?shade\b|\bout of the sun\b/g, "a pergola"],
  // A railing you can see through.
  [/\b(?:see[- ]?through|clear|invisible) (?:rail(?:ing)?s?|fence|guards?|panels?)\b|\b(?:see|keep|not block|don'?t block|enjoy) (?:the |our )?view\b/g, "glass railing"],
  [/\b(?:wire|steel cable) (?:rail(?:ing)?s?|fence)\b/g, "cable railing"],
  // Lower, closer to the ground.
  [/\b(?:make it |bring it |set it )?(?:closer|nearer|lower) (?:to )?the (?:ground|grass|lawn)\b|\bnot (?:so|as|that) high\b|\bless high\b/g, "make it lower"],
  [/\b(?:make it |bring it )?(?:higher|taller) (?:off|above|from) the (?:ground|grass|lawn)\b/g, "make it higher"],
  // A colour said as wood, boards or the floor.
  // "darker wood", "a lighter floor", "a darker color" — the boards ("darker" alone keeps the studio's own subject).
  [/\b(?:a |the )?(?:bit |little |touch )?(darker|lighter) (?:wood|woods|boards?|floor(?:ing)?|colou?r|deck(?:ing)?|stain|shade)\b/g, "make the decking $1"],
  // Low upkeep — capped composite.
  [/\b(?:low|no|zero) (?:maintenance|upkeep)(?: boards?| decking| floor)?\b|\bnever (?:have to )?(?:stain|paint) (?:it|again)\b/g, "composite decking"],
  [/\b(?:looks? like|real looking|wood[- ]look(?:ing)?) (?:real )?wood\b/g, "composite decking"],
  // Steps.
  [/\b(?:steps|a way) (?:down )?(?:to|onto|into) the (?:yard|grass|lawn|garden|patio)\b/g, "stairs down the front"],
  // Privacy on an open deck — a privacy screen on its edge (2026-11-14; lib/deck/builtins, parse readBuiltIn reads
  // "privacy fence"; "privacy walls / panels / screens" stay a covered deck's walls; "lattice for privacy" stays
  // lattice). The side said goes with it.
  [/(?<!\bfor )\b(?:(?:some|more|a little|a bit of|a bit more|extra|get|give us|give me) )?privacy\b(?! (?:walls?|panels?|screens?|trellis|fence))(?: from (?:the )?(?:neighbou?rs?|street|road|house next door|people next door))?((?: (?:on|along|at) (?:one|1|the \w+|both|each|that|this) sides?| on the (?:left|right|back|front))?)/g, "a privacy fence$1"],
];

export function normalizeSpeech(raw: string): string {
  let t = plain(raw);
  for (const [re, to] of HEARD_AS) t = t.replace(re, to);
  for (const [re, to] of EVERYDAY) t = t.replace(re, to);
  t = numberWords(t.trim());
  t = fractions(t);
  t = homophones(t);
  t = units(t);
  t = pitches(t);
  t = lumber(t);
  t = plies(t);
  return t.replace(/\s+/g, " ").trim();
}

/** The words a sentence opens with that carry no command: "hey", "can you", "I'd like to", "let's"… */
const FILLER_HEAD = /^(?:(?:hey|hi|ok|okay|so|um+|uh+|uhm|hmm+|well|alright|all right|now|and|please|yeah so|right|deck studio|jobflex|studio|good|great|cool|nice|awesome|perfect)\b[,.!\s]*)+/;
const ASK_HEAD = /^(?:(?:can|could|would|will) you (?:please |just |maybe )?|(?:i(?:'d| would) (?:like|love) (?:you )?(?:to )?)|i want (?:you )?to |i wanna |i need (?:you )?to |i (?:really )?(?:like|love|prefer) |i'd (?:prefer|rather have|rather go with|rather) |let's try |let's |let us |try |go ahead and |please |i'm gonna |we need to |we want to |we'd like (?:to )?|could we |can we |should we |can i |could i |may i |maybe |just |try to |i think (?:we should |it should )?|(?:do|go with|let's do) (?!(?:i|we|you|they|it|the|my|these|those|people|most|all|that|this)\b))+/;
const FILLER_TAIL = /(?:[,\s]+(?:please|for me|thanks|thank you|now|right now|real quick|ok|okay|if you can|if possible))+\s*$/;

/** A clause without the words around the command. */
export function trimClause(clause: string): string {
  let c = clause.trim().replace(/^[,.;\s]+|[,.;\s]+$/g, "");
  for (let i = 0; i < 3; i++) {
    const before = c;
    c = c.replace(FILLER_HEAD, "").replace(ASK_HEAD, "").replace(FILLER_TAIL, "").trim();
    if (c === before) break;
  }
  return c;
}

/** A question asks: it opens with a question word (or ends in "?"), so it is answered whole, never split on "and". */
export const QUESTION_HEAD = /^(?:how|what|what's|whats|why|which|where|when|who|do (?:i|we|you|they|it|the|my|these|those|people|most|all)|does|did|is|are|was|were|should|shall|will|would it|can it|can the|could it|tell me|explain|show me how much|i wonder|any idea|do you know|compare|is it)\b/;

/**
 * The commands in a sentence: split at full stops, semicolons, commas, "and then", "then", "also", "plus", "but" and a
 * plain "and" — except a question or a what-if, which is kept whole. "With" is left in: the parser splits there only
 * when both halves are commands ("16 by 12 with composite decking", not "replace the boards with Trex").
 */
export function splitClauses(normalized: string): string[] {
  const text = normalized.trim();
  if (!text) return [];
  const sentences = text.split(/\s*(?:[;!?]+|\.(?!\d)|\n)\s*/).filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    const lead = trimClause(sentence);
    if (QUESTION_HEAD.test(lead) || /^(?:what if|what about|how about|how much|when i say|whenever i say|if i say)\b/.test(lead)) {
      out.push(sentence.trim());
      continue;
    }
    for (const part of sentence.split(/\s*,\s*(?:and\s+)?(?:then\s+)?|\s+(?:and then|then|and also|also|plus|after that|and|but|as well as)\s+/)) {
      const p = part.trim();
      if (p) out.push(p);
    }
  }
  return out;
}

/** Round to the nearest half foot (a size a crew can build to) or quarter inch. */
export const halfFt = (n: number) => Math.round(n * 2) / 2;
export const quarterIn = (n: number) => Math.round(n * 4) / 4;

/** How a length reads aloud: 12 ft, 12 ft 6 in. */
export function ftWords(ft: number): string {
  const inches = Math.round(ft * 12);
  const f = Math.floor(inches / 12);
  const i = inches % 12;
  if (!i) return `${f} ft`;
  if (!f) return `${i} in.`;
  return `${f} ft ${i} in.`;
}

/** A height in inches, read aloud: 36 in. → "3 ft", 42 in. → "3 ft 6 in.", 14 in. → "14 in.". */
export function inWords(inches: number): string {
  const n = Math.round(inches * 4) / 4;
  if (n < 24) return `${fmt(n)} in.`;
  return ftWords(n / 12);
}

/** Dollars as said: $18,420. */
export function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** The first sentence of a check's text — not cut at "in." or "ft.". */
export function firstSentence(text: string): string {
  const m = /^.*?[a-z0-9)\]](?<!\b(?:in|ft|sq|no|lb|lbs|oc|approx|min|max|e\.g|i\.e|vs|etc))\.(?=\s|$)/i.exec(text);
  return (m ? m[0] : text).trim();
}

/** A phrase as a shop's memory keeps and looks it up: the cleaned, trimmed words, plain characters only. */
export const phraseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9$%/.\s-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
