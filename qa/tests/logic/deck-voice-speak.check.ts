// What the studio says aloud, and what a client hears (2026-10-21, owner: "don't repeat the pricing back for any
// changes … don't say any numbers … offer some other options really quick, and understand different wording for
// clients … on the contractor side don't speak back the measurements and pricing, just show it in the text").
//   npx tsx --tsconfig tsconfig.json qa/tests/logic/deck-voice-speak.check.ts
import { defaultDeckDesign, normalizeDeckDesign } from "../../../src/lib/deck/design";
import { freshVoiceState, hear } from "../../../src/lib/deck/voice/assistant";
import { CLIENT_SAYS, clientChips, clientGate, clientOffer, clientText, isPraise, isPriceAsk, noteLine, spokenReply } from "../../../src/lib/deck/voice/speak";
import type { DeckCommand } from "../../../src/lib/deck/voice/commands";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const d = defaultDeckDesign({ state: "WA" });
/** A number, a money figure, or a measurement in words ("about a quarter yard"). */
const NUMBERISH = /\d|\$|\bdollars?\b|\b(?:hundred|thousand)\b|\b(?:half|quarter|third|one|two|three|four|five|six|ten|twenty) (?:of an? )?(?:yards?|feet|foot|inch(?:es)?|bags?)\b/i;

console.log("── nothing spoken has a number in it");
const corpus = [
  "Make it 20 by 14", "A little bigger", "Push it out 3 more feet", "Make it L-shaped", "Curved front", "300 square feet",
  "Raise it 6 inches", "Second-story deck", "Ground level", "Trex Transcend", "Make it dark gray", "Picture-frame border",
  "Diagonal boards", "Cable railing", "42-inch railing", "Add stairs on the left", "Make them wider", "Handrails on both sides",
  "Wrap-around steps", "Add a gable roof", "Steeper", "9-foot ceiling", "Screen it in", "Make it a pergola", "Add two heaters",
  "Add a hot tub", "How much concrete do I need?", "How will the boards lay down?", "Do I need a permit?", "What if it was composite?",
  "Show me the joists", "Show it at night", "how much will it cost", "make it bigger", "glass railing", "steps down to the yard",
];
let worst = "";
let n = 0;
for (const who of ["contractor", "client"] as const) {
  for (const line of corpus) {
    const r = hear(line, d, freshVoiceState());
    const said = spokenReply({ say: who === "client" ? clientText(r.say) : r.say, pending: r.pending, changed: !!r.design }, who, n++);
    if (NUMBERISH.test(said)) worst = `${who}: "${line}" → "${said}"`;
  }
}
check(`${corpus.length} sentences × contractor and client: no number, no price spoken`, !worst, worst);

const big = hear("make it 20 by 14", d, freshVoiceState());
check("the written reply still has the size and the price", /20 ft × 14 ft/.test(big.say) && /Price \$/.test(big.say), big.say.slice(0, 80));
const spokenBig = spokenReply({ say: big.say, pending: big.pending, changed: true }, "contractor");
check("…the spoken one is short words", spokenBig.length > 0 && spokenBig.length < 120 && !NUMBERISH.test(spokenBig), spokenBig);
check("a question with a number keeps its words: \"It's over 30 in. up — add a railing?\" → \"Add a railing?\"", spokenReply({ say: "It's over 30 in. up — add a railing?", pending: null, changed: false }, "contractor") === "Add a railing?");
check("…after a change, \"Done\" leads it", /^(Done|Got it|There you go)[^?]*\. Add a railing\?$/.test(spokenReply({ say: "It's over 30 in. up — add a railing?", pending: null, changed: true }, "contractor")), spokenReply({ say: "It's over 30 in. up — add a railing?", pending: null, changed: true }, "contractor"));
// A count of things is said in words, and a second change of the same kind is said too (2026-10-22: "a chandelier and
// two heaters" said only the chandelier — the heaters' sentence had a "2" in it).
const both = spokenReply({ say: "Added a chandelier at the peak. Added 2 patio heaters on the headers, 120-volt (1.5 kW). Price $27,240 (up $2,772).", pending: null, changed: true }, "client");
check("\"a chandelier and two heaters\" says both, the count in words", both === "Added a chandelier at the peak. Added two patio heaters on the headers.", both);
check("…a measure stays out (\"6 risers of 6.5 in.\")", !/\d|six risers/.test(spokenReply({ say: "A 4 ft-wide stair — 6 risers of 6.5 in., 5 treads.", pending: null, changed: true }, "client")));
const guard = spokenReply({ say: "20 ft × 14 ft — 280 sq ft. Price $10,752 (up $3,289). It's over 30 in. up, so the code wants a guard. Add a composite railing?", pending: { ask: "Add a railing?" }, changed: true }, "contractor");
check("a change said as Done, the clause without a number kept, the question asked once", /^(Done|Got it|There you go)\. The code wants a guard\. Add a composite railing\?$/.test(guard), guard);
const stair = spokenReply({ say: "A 4 ft-wide stair on the left side — 6 risers of 6.5 in., 5 treads, onto a concrete pad. Price $8,153 (up $1,273). Heads up — stair 1 (left): 6 risers: a graspable handrail 34 to 38 in. above the nosings is required, and guards on both open sides. Say \"fix it\" and I'll sort it.", pending: { ask: "Fix it?" }, changed: true }, "contractor");
check("no fragments (\"Onto a concrete pad.\"); a code check is said as one", /^(Done|Got it|There you go)\. Heads up — there's a code check to look at\. Fix it\?$/.test(stair), stair);
check("a change said in words leads", spokenReply({ say: "A curved front, bowed out 2 ft at the middle. Price $7,762 (up $881). It's over 30 in. up, so the code wants a guard. Add a composite railing?", pending: { ask: "Add a railing?" }, changed: true }, "contractor") === "A curved front. Add a composite railing?");
check("a count answered on the screen (\"how many joists?\")", spokenReply({ say: "13 joists, 2x8 at 16 in. on center, up to 11'-8\" long — hung on the ledger at the house and resting on the beam. The code tables picked the size.", pending: null, changed: false }, "contractor") === "It's on your screen.");
check("a colour in brackets is said after a comma", spokenReply({ say: "Switched to Trex Transcend (reddish brown).", pending: null, changed: true }, "contractor") === "Switched to Trex Transcend, reddish brown.");
const height = spokenReply({ say: "Deck height 3 ft 6 in. (42 in.) above the ground. Want stairs down the front?", pending: { ask: "Add stairs down the front?" }, changed: true }, "contractor");
check("no broken leftover (\"Above the ground.\")", /^(Done|Got it|There you go)[^?]*\. Want stairs down the front\?$/.test(height), height);
const concrete = spokenReply({ say: "About 14 bags of 80-lb concrete mix — 8.4 cubic feet, about a quarter yard. 14 bags for 4 footings: 12-in. tubes on wider pads, 18 in. deep.", pending: null, changed: false }, "contractor");
check("a measure in words is not said (\"about a quarter yard\")", concrete === "It's on your screen.", concrete);
check("the client's money answer is said whole", spokenReply({ say: CLIENT_SAYS.price, pending: null, changed: false }, "client") === CLIENT_SAYS.price && clientText(CLIENT_SAYS.price) === CLIENT_SAYS.price);
check("a change with nothing left to say is acknowledged", /^(Done|Got it|There you go)/.test(spokenReply({ say: "20 ft × 14 ft — 280 sq ft. Price $9,000 (up $2,000).", pending: null, changed: true }, "contractor")));
check("a numbers answer points to the screen", spokenReply({ say: "$6,881 before tax — $36 a square foot.", pending: null, changed: false }, "contractor") === "It's on your screen.");

console.log("── the client never reads a price");
check("the price sentence goes, the rest stays", clientText("Glass panels, 36 in. high. Price $11,392 (up $4,511).") === "Glass panels, 36 in. high.", clientText("Glass panels, 36 in. high. Price $11,392 (up $4,511)."));
check("money questions in any wording", ["how much will it cost", "is this expensive", "what's the price", "give me a ballpark", "can we afford a roof", "what will it run"].every(isPriceAsk) && !isPriceAsk("make it bigger"));
const blocked = (cmds: DeckCommand[], heard = "x") => clientGate(cmds, heard);
check("money → the contractor prices it", blocked([{ do: "ask", q: "price" }], "how much is it").say === CLIENT_SAYS.price);
check("concrete, joists, permits → the contractor's side", blocked([{ do: "ask", q: "concrete" }]).say === CLIENT_SAYS.building && blocked([{ do: "ask", q: "permit" }]).say === CLIENT_SAYS.building);
check("making the proposal, teaching, the shop's items — not from a client", blocked([{ do: "save" }]).keep.length === 0 && blocked([{ do: "teach", phrase: "x", words: "y" } as DeckCommand]).keep.length === 0);
check("the look of the deck is theirs: size, boards, railing, stairs, views", blocked([{ do: "size", width: { to: 20 } } as DeckCommand, { do: "view", look: "night" } as DeckCommand]).keep.length === 2);
check("praise is answered, not sent to the AI", isPraise("I like it") && isPraise("looks great!") && isPraise("that's perfect") && !isPraise("I like it bigger"));
const praised = hear("I love it", d, freshVoiceState());
check("…and the studio says so", /Glad you like it/.test(praised.say) && !praised.design);

console.log("── what a client wants that the studio can't draw goes into their note");
// (2026-11-14: a fire pit is drawn now — a gas fire table's place, lib/deck/builtins; a pool is still a wish.)
const pit = hear("I want a pool", d, freshVoiceState());
const gp = clientGate(pit.ran, "I want a pool");
check("\"I want a pool\" → a note, not \"your contractor's side\"", gp.keep.length === 0 && gp.wishes.length === 1 && gp.say === "I've added a pool to your notes for your contractor. Anything else?", gp.say ?? "");
check("…written in the note as \"Pool\"", noteLine(gp.wishes[0]) === "Pool", noteLine(gp.wishes[0] ?? ""));
check("\"I want a fire pit\" places a gas fire table", hear("I want a fire pit", d, freshVoiceState()).ran.some((c) => c.do === "builtin" && c.kind === "fire"));
const priced = clientGate([{ do: "item", op: "add", name: "Outdoor kitchen", price: 9000 }], "add an outdoor kitchen for 9000 dollars");
check("a priced item from a client: its name goes to the note, never its price", priced.wishes[0] === "Outdoor kitchen" && !NUMBERISH.test(priced.say ?? "") && /an outdoor kitchen/.test(priced.say ?? ""), priced.say ?? "");
const two = clientGate([{ do: "wish", text: "a bench", item: "Bench" }, { do: "wish", text: "built-in benches", item: "Built-in benches" }, { do: "stairs", op: "add" } as DeckCommand], "x");
check("a change runs, the wishes ride along", two.keep.length === 1 && two.say === null && two.wishes.length === 2);
check("plural things take no article", CLIENT_SAYS.wish(["Built-in benches", "Gate"]) === "I've added built-in benches and a gate to your notes for your contractor. Anything else?", CLIENT_SAYS.wish(["Built-in benches", "Gate"]));

check("\"how much\" is money — not \"how much concrete\", \"how much bigger\"", isPriceAsk("how much is it") && isPriceAsk("how much for a roof") && !isPriceAsk("how much concrete do I need") && !isPriceAsk("how much bigger can it be"));
const chips = clientChips(["How much concrete?", "Show me the joists", "Make the proposal", "Add stairs", "Show it at night"]);
check("the studio's contractor chips stay off a client's page", chips.join("|") === "Add stairs|Show it at night", chips.join("|"));
check("…a client always has a few to tap", clientChips(["How much concrete?", "Do I need a permit?"]).length >= 2);

console.log("── privacy, in a client's words");
const railTalk = { ...freshVoiceState(), subject: "rail" as const };
for (const line of ["privacy on one side", "more privacy", "some privacy from the neighbors"]) {
  const fresh = hear(line, d, freshVoiceState()).ran;
  const inRail = hear(line, d, railTalk).ran;
  // (2026-11-14: an open deck's privacy screen is drawn — lib/deck/builtins — so the words build one, not a wish.)
  check(`"${line}" → a privacy screen on the deck's edge, even while talking railings`, [fresh, inRail].every((ran) => ran.length === 1 && ran[0].do === "builtin" && ran[0].kind === "screen" && ran[0].op === "add"), JSON.stringify(inRail));
}
const roofedDeck = normalizeDeckDesign({ ...d, structure: "covered-deck" });
check("under a roof the same words stay a wish — the roof's walls are the contractor's to choose", hear("more privacy", roofedDeck, freshVoiceState()).ran.every((c) => c.do === "wish" && c.item === "Privacy screen") && hear("more privacy", roofedDeck, freshVoiceState()).ran.length === 1, JSON.stringify(hear("more privacy", roofedDeck, freshVoiceState()).ran));
check("\"privacy on the right side\" keeps its side", (() => { const r = hear("privacy on the right side", d, freshVoiceState()).ran[0]; return r?.do === "builtin" && r.side === "right"; })(), JSON.stringify(hear("privacy on the right side", d, freshVoiceState()).ran));
check("a covered deck's \"privacy walls\" stay its walls; \"lattice for privacy\" stays lattice", hear("privacy walls", roofedDeck, freshVoiceState()).ran[0]?.do === "roof" && hear("add lattice for privacy", d, freshVoiceState()).ran[0]?.do === "roof");
check("\"a privacy screen\", \"a privacy trellis\" (one thing), \"lights\" (many)", CLIENT_SAYS.wish(["Privacy screen", "Privacy trellis", "Lights"]) === "I've added a privacy screen, a privacy trellis and lights to your notes for your contractor. Anything else?", CLIENT_SAYS.wish(["Privacy screen", "Privacy trellis", "Lights"]));

console.log("── a waiting price takes a price, not any number");
const pitAsk = hear("I want a pool", d, freshVoiceState());
check("the contractor is asked the pool's price", !!pitAsk.pending && /price/i.test(pitAsk.pending.ask), pitAsk.pending?.ask);
const stray = hear("privacy on one side", d, pitAsk.state);
check("\"privacy on one side\" is not the pool at $1", !stray.ran.some((c) => c.do === "item"), JSON.stringify(stray.ran));
for (const [said, n] of [["1,200 dollars", 1200], ["twelve hundred", 1200], ["about 900", 900], ["$450", 450]] as const) {
  const r = hear(said, d, pitAsk.state);
  check(`"${said}" prices it at $${n}`, r.ran.length === 1 && r.ran[0].do === "item" && r.ran[0].price === n, JSON.stringify(r.ran));
}

console.log("── a quick next idea after a change");
const wider = hear("make it bigger", d, freshVoiceState());
const o1 = clientOffer(d, wider.design!, wider.ran, []);
check("a bigger deck, no railing yet → offer a railing", !!o1 && /railing/i.test(o1.say) && !NUMBERISH.test(o1.say), o1?.say);
const o2 = clientOffer(d, wider.design!, wider.ran, [o1!.key]);
check("never the same idea twice", !o2 || o2.key !== o1!.key, o2?.say);
const boards = hear("darker boards", d, freshVoiceState());
const o3 = clientOffer(d, boards.design!, boards.ran, []);
check("darker boards → darker, lighter, or a border", !!o3 && /border/i.test(o3.say), o3?.say);

console.log("── a client's own words");
const words = (line: string) => hear(line, d, freshVoiceState());
check("\"darker wood\" changes the boards", !!words("darker wood").design?.decking && words("darker wood").design!.decking.product !== d.decking.product);
check("\"see-through railing\" and \"keep the view\" are glass", words("see-through railing").design?.rail.type === "glass" && words("I want to see the view").design?.rail.type === "glass");
check("\"shade from the sun\" is a pergola, not a board colour", words("shade from the sun").design?.structure === "pergola");
check("\"closer to the ground\" lowers it", (words("closer to the ground").design?.heightIn ?? 999) < d.heightIn);
check("\"low maintenance boards\" is composite", /composite/i.test(words("low maintenance boards").say));

console.log(bad ? `\n${bad} FAILED` : "\nall passed");
process.exit(bad ? 1 : 0);
