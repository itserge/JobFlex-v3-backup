// BASE + TOOLS — the new plans' rules (2026-11-10, part 1), on the catalog as set. No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/tool-plans.check.ts

import {
  cardCents,
  cardLines,
  isToolId,
  isToolsSlug,
  ladderChecks,
  money,
  monthlyCents,
  pagesOpen,
  toolById,
  toolForAdKey,
  toolPlanById,
  toolPlanBySlug,
  TOOL_PLANS,
  TOOLS,
  toolsInOfferOrder,
  toolsOpen,
} from "@/lib/toolPlans/shared";
import { SPOTLIGHT_TOOLS } from "@/lib/planSpotlight";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

// ── the owner's prices (2026-11-10) ──
check("Basic $39.99, the owner alone, no extra people", toolPlanById("basic").cents === 3999 && toolPlanById("basic").seats === 1 && toolPlanById("basic").seatCents === null);
check("Professional $75, 5 people, $9.99 each after", toolPlanById("professional").cents === 7500 && toolPlanById("professional").seats === 5 && toolPlanById("professional").seatCents === 999);
check("twelve tools", TOOLS.length === 12 && new Set(TOOLS.map((t) => t.id)).size === 12);

// ── a bundle always costs less than its parts ──
const ladder = ladderChecks();
for (const c of ladder) check(`ladder: ${c.label} (${money(c.bundle)} < ${money(c.parts)})`, c.ok, c);
check("Professional vs Basic + 4 people is $75 vs $79.95", ladder[0].bundle === 7500 && ladder[0].parts === 7995);
const raised = TOOL_PLANS.map((p) => (p.id === "professional" ? { ...p, cents: 11900 } : p));
check("…and a price that breaks the rule is caught ($119 Professional)", !ladderChecks(raised)[0].ok);

// ── Classic is told by the slug alone ──
check("new slugs start with tools-", TOOL_PLANS.every((p) => isToolsSlug(p.slug)) && isToolsSlug("TOOLS-PROFESSIONAL"));
check("Classic slugs are never new plans", ["free", "starter", "professional", "enterprise", "custom", "PROFESSIONAL", "", null].every((s) => !isToolsSlug(s)));
check("a slug finds its plan, any case", toolPlanBySlug("Tools-Advanced")?.id === "advanced" && toolPlanBySlug("professional") === null);

// ── the card price with the ad's tool ──
check("Professional + Deck Studio = $154", cardCents("professional", "deck") === 15400);
check("Basic + Deck Studio = $118.99", cardCents("basic", "deck") === 11899);
check("Advanced includes a trade tool and the office tools", cardCents("advanced", "deck") === 24900 && cardCents("advanced", "aidesk") === 24900);
check("Complete includes everything", TOOLS.every((t) => cardCents("complete", t.id) === 44900));
check("no tool: the size alone", cardCents("professional", null) === 7500);
check("card lines: the tool first, priced or included", cardLines("professional", "deck")[0] === "+ Deck Studio ($79/mo)" && cardLines("advanced", "deck")[0] === "Deck Studio included" && cardLines("basic", null)[0] === "Just you: 1 user, the owner");

// ── the plan's example bills ──
check("HVAC, 6 people on Professional: $261.99", monthlyCents({ plan: "professional", main: "hvac", kept: ["aidesk", "texting"] }, 6) === 26199);
check("…the same on Advanced: $249", monthlyCents({ plan: "advanced", main: "hvac", kept: ["aidesk", "texting"], chosenTrade: ["hvac"] }, 6) === 24900);
check("Roofer, 8 people on Professional: $320.97", monthlyCents({ plan: "professional", main: "roof", kept: ["aidesk", "texting", "smartcrm"] }, 8) === 32097);
check("Home builder, 10 people on Professional: $370.95", monthlyCents({ plan: "professional", main: "builder", kept: ["remodeler", "smartcrm", "texting"] }, 10) === 37095);
check("Home builder, 7 people: $193.98", monthlyCents({ plan: "professional", main: "builder", kept: [] }, 7) === 19398);
check("Deck builder, 3 people, stays on Professional: $183", monthlyCents({ plan: "professional", main: "deck", kept: ["texting"] }, 3) === 18300);
check("Advanced, 12 people: $7.99 each after 10", monthlyCents({ plan: "advanced", main: null, kept: [] }, 12) === 24900 + 2 * 799);

// ── what a shop can open ──
const adv = toolsOpen({ plan: "advanced", main: null, kept: [], chosenTrade: ["roof", "deck", "fence"] });
check("Advanced: the office set and only 2 chosen trade tools", ["aidesk", "texting", "smartcrm", "operator", "roof", "deck"].every((id) => adv.has(id as never)) && !adv.has("fence"));
const basicDeck = pagesOpen({ plan: "basic", main: "deck", kept: [], trying: ["roof"] });
check("Basic + Deck Studio + a Roof try opens those two and nothing of the team", basicDeck.has("deck-estimator") && basicDeck.has("roof-estimator") && !basicDeck.has("workers") && !basicDeck.has("meta-leads") && !basicDeck.has("phone"));
const pro = pagesOpen({ plan: "professional", main: "roof", kept: [] });
check("Professional opens Meta leads and the team pages", ["meta-leads", "workers", "crew-field", "team-messages", "smartbook"].every((id) => pro.has(id)) && !pro.has("custom-domain"));

// ── the offer order ──
const offer = toolsInOfferOrder("hvac");
check("works-well-with first, then the rest, never the main tool", offer.slice(0, 3).map((t) => t.id).join() === "aidesk,texting,smartcrm" && offer.length === 11 && !offer.some((t) => t.id === "hvac"));
check("tools already held are left out", toolsInOfferOrder("hvac", ["aidesk"]).every((t) => t.id !== "aidesk"));
check("every pairing names a real tool, never itself", TOOLS.every((t) => t.pairs.length >= 2 && t.pairs.every((p) => isToolId(p) && p !== t.id)));
check("every tool opens something", TOOLS.every((t) => t.opens.length > 0));

// ── the ads ──
check("today's ad links find their tool (Smart Proposal stays in every plan)", SPOTLIGHT_TOOLS.filter((k) => k !== "smart").every((k) => toolForAdKey(k) !== null) && toolForAdKey("smart") === null);
check("the Deck Studio ad is the deck tool", toolForAdKey("deck")?.id === "deck" && toolById("deck").cents === 7900);
check("money words", money(3999) === "$39.99" && money(7500) === "$75" && money(123450) === "$1,234.50");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
