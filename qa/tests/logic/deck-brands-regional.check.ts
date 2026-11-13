// THE BRANDS AND THE REGIONS (2026-10-12; owner: "check all the lists — the most popular materials, brands for decking,
// and what is most popular per state"): the brands' own deck-board lines carry their makers' rules and a price, and
// every state reads its region's lumber, its starting board and the boards most used there. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/deck-brands-regional.check.ts
import { DECKING, DECKING_BRAND_ORDER, FRAMING_SPECIES, defaultDecking, defaultFramingSpecies, deckingProduct, treatedDecking } from "../../../src/lib/deck/catalog";
import { REGIONS, REGIONAL_STATES, REGIONAL_BOARD_WORDS, regionalPicks, regionalWords } from "../../../src/lib/deck/regional";
import { STORE_PRICES } from "../../../src/lib/deck/storePrices";
import { DECK_RATES, deckRate } from "../../../src/lib/deck/rates";
import { applyDeckPatch, deckChecks } from "../../../src/lib/deck/checks";
import { defaultDeckDesign } from "../../../src/lib/deck/design";
import { priceDeck } from "../../../src/lib/deck/pricing";
import { materialList } from "../../../src/lib/deck/materialList";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};

console.log("── the regions");
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
check("all fifty states and DC have a region", STATES.length === 51 && STATES.every((st) => regionalPicks(st)) && REGIONAL_STATES.length === 51);
check("…read in any case, and an unknown state has none", regionalPicks(" ut ")?.region === "mountain" && regionalPicks("XX") === null && regionalPicks(null) === null && regionalPicks("") === null);
const ids = new Set(DECKING.map((d) => d.id));
const species = new Set(FRAMING_SPECIES.map((f) => f.id));
const regions = Object.values(REGIONS);
check("every region's boards, starting board, treated board and lumber are on the lists", regions.every((r) => r.decking.length === 3 && r.decking.every((id) => ids.has(id)) && ids.has(r.defaultBoard) && ids.has(r.treatedBoard) && species.has(r.framing)));
check("…its treated board is treated wood, and its words name every board it lists", regions.every((r) => deckingProduct(r.treatedBoard).family === "treated" && r.decking.every((id) => REGIONAL_BOARD_WORDS[id])));
check("the East frames in Southern pine and starts on 5/4 pine", ["TX", "GA", "NY", "MI", "MN", "ME", "FL"].every((st) => defaultFramingSpecies(st) === "southern-pine" && defaultDecking(st) === "pt-pine-54"));
check("the Mountain states and Alaska frame in hem-fir on a treated 2x6", ["UT", "CO", "AZ", "MT", "AK"].every((st) => defaultFramingSpecies(st) === "hem-fir" && defaultDecking(st) === "pt-hemfir-2x6"));
check("the Northwest frames in hem-fir and starts on composite", ["WA", "OR"].every((st) => defaultFramingSpecies(st) === "hem-fir" && defaultDecking(st) === "composite-better"));
check("California and Hawaii frame in Douglas fir and start on composite", ["CA", "HI"].every((st) => defaultFramingSpecies(st) === "douglas-fir" && defaultDecking(st) === "composite-better"));
check("the Good tier stays treated wood everywhere: a 2x6 in the West, 5/4 pine in the East", treatedDecking("CA") === "pt-hemfir-2x6" && treatedDecking("WA") === "pt-hemfir-2x6" && treatedDecking("TX") === "pt-pine-54" && treatedDecking(null) === "pt-pine-54");
check("the surveys' leaders: composite in NY, NJ, PA and the Great Lakes; treated pine in the South and New England", ["NY", "NJ", "PA", "OH", "IL"].every((st) => regionalPicks(st)!.decking[0] === "composite-better") && ["FL", "GA", "AL", "TX", "VT"].every((st) => regionalPicks(st)!.decking[0] === "pt-pine-54"));
check("…redwood in California, cedar in the Northwest, ipe in Hawaii, PVC in the Northeast", regionalPicks("CA")!.decking.includes("redwood-2x6") && regionalPicks("WA")!.decking.includes("cedar-2x6") && regionalPicks("HI")!.decking.includes("ipe-1x6") && regionalPicks("MA")!.decking.includes("pvc") && regionalPicks("NJ")!.decking.includes("pvc"));
const ut = regionalWords(regionalPicks("UT")!);
check("the words read as a sentence", ut === "Most used on decks in the Mountain states: capped composite, then treated hem-fir or fir 2x6, then cedar.", ut);
const d0 = defaultDeckDesign({ state: "CA" });
check("a new California deck is drawn in Douglas fir on composite boards", d0.framing.species === "douglas-fir" && d0.decking.product === "composite-better");

console.log("── the brands' own lines");
const brandLines = DECKING.filter((d) => d.brand);
// 2026-11-12: Owens Corning's two Marine Grade boards make thirty-one.
check("thirty-one brand lines (nine more makers 2026-10-24, Owens Corning 2026-11-12), every brand on the list has some, Trex five", brandLines.length === 31 && DECKING_BRAND_ORDER.every((b) => brandLines.some((d) => d.brand === b)) && brandLines.filter((d) => d.brand === "Trex").length === 5, `${brandLines.length}`);
check("each is the maker's line: its guide read, 16 in. square, 12 in. at 45°, grooved for hidden clips", brandLines.filter((d) => d.brand !== "OwensCorning").every((d) => d.source === "maker" && d.maxSpacingIn.square === 16 && d.maxSpacingIn.diagonal === 12 && d.hiddenFasteners && d.sourceNote.length > 20));
check("…but Owens Corning's glass-fiber boards: 24 in. square (its report), 16 in. at 45°, face-screwed", brandLines.filter((d) => d.brand === "OwensCorning").length === 2 && brandLines.filter((d) => d.brand === "OwensCorning").every((d) => d.source === "maker" && d.maxSpacingIn.square === 24 && d.maxSpacingIn.diagonal === 16 && !d.hiddenFasteners));
check("…named for its maker, the label starting with the brand", brandLines.every((d) => d.label.replace(/ /g, "").startsWith(d.brand!)));
check("…composite, PVC or mineral-based — never wood", brandLines.every((d) => d.family === "composite" || d.family === "pvc" || d.family === "mineral"));
check("AZEK PVC carries its blocking rows (6 ft) and 1½ in. of air; Fiberon its 1½ in.; Deckorators Vista 2 in.", brandLines.filter((d) => d.id.startsWith("timbertech-azek")).every((d) => d.blockingRowsMaxFt === 6 && d.minClearanceIn === 1.5) && brandLines.filter((d) => d.brand === "Fiberon").every((d) => d.minClearanceIn === 1.5) && deckingProduct("deckorators-vista").minClearanceIn === 2);
check("ground-contact boards (Surestone, MoistureShield) and Trex ask no fixed air gap", ["deckorators-summit", "deckorators-voyage", "moistureshield-vision", "trex-transcend"].every((id) => deckingProduct(id).minClearanceIn === undefined));
const rows = new Set(DECK_RATES.map((r) => r.key));
check("every brand line is a row of the price book", brandLines.every((d) => rows.has(`deck.${d.id}`)));
const HD = ["trex-enhance-basics", "trex-enhance-naturals", "trex-select", "trex-transcend", "trex-transcend-lineage", "timbertech-azek-harvest", "timbertech-azek-vintage", "fiberon-armorguard", "fiberon-paramount", "deckorators-summit", "deckorators-vista", "deckorators-voyage", "moistureshield-vision"];
check("the thirteen Home Depot sells are priced as Home Depot lists them", HD.every((id) => STORE_PRICES[`deck.${id}`] && deckRate(`deck.${id}`).source === "store" && Math.abs(STORE_PRICES[`deck.${id}`].price - deckingProduct(id).pricePerLf) < 0.011));
const dealer = brandLines.filter((d) => !HD.includes(d.id));
check("the eighteen it does not (the nine more makers and Owens Corning among them) are examples at a dealer's or Lowe's price", dealer.length === 18 && dealer.every((d) => !STORE_PRICES[`deck.${d.id}`] && deckRate(`deck.${d.id}`).source === "example"), dealer.map((d) => d.id).join(", "));
check("prices climb with the tier: Enhance Basics < Select < Transcend", deckingProduct("trex-enhance-basics").pricePerLf < deckingProduct("trex-select").pricePerLf && deckingProduct("trex-select").pricePerLf < deckingProduct("trex-transcend").pricePerLf);

console.log("── a deck on a brand's boards");
const tx = applyDeckPatch(defaultDeckDesign({ state: "TX" }), { heightIn: 36, decking: { product: "trex-transcend" } });
const pkg = priceDeck(tx);
const boards = pkg.bom.filter((l) => l.step === "decking" && l.id.startsWith("boards-"));
check("the boards go on the list by name, in Trex's lengths, at Home Depot's price", boards.length > 0 && boards.every((l) => l.label.startsWith("Trex Transcend × ") && /× (12|16|20) ft$/.test(l.label) && l.source === "store"), boards.map((l) => l.label).join(", "));
check("…joists 16 in. apart under them", pkg.frame?.spacingIn === 16);
const list = materialList(pkg);
check("…and on the material list for the yard", list.groups.some((g) => g.lines.some((l) => l.label.startsWith("Trex Transcend"))));
const base = defaultDeckDesign({ state: "TX" });
const airId = (h: number, product: string) => { const d = applyDeckPatch(base, { heightIn: h, decking: { product } }); return deckChecks(priceDeck(d).structure).some((c) => c.id === "low-air"); };
// The frame itself keeps 1½ in. of air (MIN_FRAME_CLEAR_IN), so a maker's rule matters when it asks for more.
const warnAt = [7.5, 7.75, 8, 8.25, 8.5, 8.75, 9, 9.5, 10].find((h) => airId(h, "deckorators-vista"));
check("a deck low enough on Deckorators Vista is warned about the 2 in. of air its maker asks; on Trex it is not (no fixed figure)", warnAt !== undefined && !airId(warnAt, "trex-enhance-basics"), `warned at ${warnAt} in.`);
const azek = priceDeck(applyDeckPatch(defaultDeckDesign({ state: "NJ" }), { decking: { product: "timbertech-azek-vintage" } }));
check("AZEK's blocking rows are framed in", azek.bom.some((l) => /block/i.test(l.label)), azek.bom.filter((l) => /block/i.test(l.label)).map((l) => l.label).join(", "));

console.log(bad ? `${bad} FAILED` : "ALL PASS");
process.exit(bad ? 1 : 0);
