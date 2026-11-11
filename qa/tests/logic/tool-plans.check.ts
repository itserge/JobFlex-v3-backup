// BASE + TOOLS — the new plans' rules (2026-11-10, parts 1–5), on the catalog as set. No database.
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
  tryEndsAt,
  tryReminderAt,
  tryWords,
  emptyToolsRecord,
  isToolsExtraKind,
  kindName,
  parseToolsRecord,
  planIdOfKind,
  priceProblems,
  shopFromRecord,
  toolIdOfKind,
  toolKind,
  triesToBill,
  withPrices,
  TOOLS_BASE_PAGES,
  TOOLS_ONLY_PAGE_IDS,
  classicEquivalent,
  isToolsOnlyPageId,
  projectKindPage,
  toolOffering,
  toolsPagesOpen,
  chosenTradeFor,
  toolsSubscriptionModel,
  tryDayWords,
  tryReminderWords,
} from "@/lib/toolPlans/shared";
import {
  CUSTOM_PAGES,
  PAID_FEATURES,
  PLAN_ENDED_MARK,
  TOOLS_MARK,
  TOOLS_PAGES,
  blockedCustomHrefs,
  classicPageId,
  customPriceCents,
  gatedPage,
  isCustomBlockedPath,
  isGatedPageId,
  lapsedBlockedHrefs,
  normalizeCustomPages,
  pageForPath,
  toolsBlockedHrefs,
} from "@/lib/customPlan";
import { flattenNavItems, navDropsBlocked, navSectionsFor, showsUpgradePlan, UPGRADE_PLAN_HREF } from "@/components/v3/blueprint-shell/nav-map";
import { hasEdition } from "@/lib/editions";
import { spaceOpen, spacePage, SPACE_IDS } from "@/lib/projectSpaces";
import { SPOTLIGHT_TOOLS, TOOLS_AD, TOOLS_AD_KEYS, adToolFor, keptAdTool, parseAdTool, parseSpotlightTool, spotlightFor } from "@/lib/planSpotlight";
import { catalogToolsLines, lineMonthlyCents, toolPlansNumbers, toolsFirstBill, toolsRowLabel, tryOutcome, type NumbersRow, type ToolsLine } from "@/lib/toolPlans/numbers";
import { adKeyOf, isToolsCatalog, mainToolFor, toolsBanner, toolsChoice, toolsPlanDTOs, toolsPlanFromAsk, toolsSignupPick, toolsSizeSwitch, withPlanQuery } from "@/lib/toolPlans/cards";
import { autoPlanFor } from "@/lib/signupAutoPlan";
import { isAddonLine, planLine } from "@/lib/deckAddon";

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

// ── free tries (owner, 2026-11-10): with the 7 free days they end together; after them, 3 days; then billed ──
const signup = new Date(Date.UTC(2026, 10, 10, 15));
const trialEnd = new Date(Date.UTC(2026, 10, 17, 15));
check("a try picked on the welcome page ends with the 7 free days", tryEndsAt(signup, trialEnd).getTime() === trialEnd.getTime());
const day3 = new Date(Date.UTC(2026, 10, 13, 15));
check("a try started on day 3 runs the 4 days left", (tryEndsAt(day3, trialEnd).getTime() - day3.getTime()) / 86_400_000 === 4);
const after = new Date(Date.UTC(2026, 10, 20, 9));
check("after the free days: 3 days", (tryEndsAt(after, trialEnd).getTime() - after.getTime()) / 86_400_000 === 3);
check("no trial at all (a Classic shop): 3 days", (tryEndsAt(after, null).getTime() - after.getTime()) / 86_400_000 === 3);
check("the reminder goes a day before the end", tryReminderAt(signup, trialEnd).getTime() === trialEnd.getTime() - 86_400_000);
const lastHours = new Date(Date.UTC(2026, 10, 17, 3));
check("…or at once when less than a day is left", tryReminderAt(lastHours, trialEnd).getTime() === lastHours.getTime());
check("the button says the date, the price and that it's billed", tryWords("roof", trialEnd, "UTC") === "Free until Nov 17, then $49/mo on your bill. Remove it any time before.");

// ── part 2: prices set in Admin → Plans ──
const raisedSeat = withPrices({ seats: { professional: 1299 } });
check("a changed extra-person price is said on the card, never typed into it", cardLines("professional", null).at(-1) === "$9.99 for each person after 5" && cardLines("professional", null, raisedSeat).at(-1) === "$12.99 for each person after 5" && !cardLines("basic", null).some((l) => /each person/.test(l)));
check("prices apply; nonsense keeps the default", withPrices({ tools: { roof: 5900, fence: 5 as number } }).tools.find((t) => t.id === "roof")!.cents === 5900 && withPrices({ tools: { fence: 5 } }).tools.find((t) => t.id === "fence")!.cents === 4900);
check("a card priced with Admin's prices", cardCents("basic", "roof", withPrices({ tools: { roof: 5900 } })) === 3999 + 5900);
check("a price set that breaks the rule is refused, in words", priceProblems({ plans: { professional: 11900 } }).some((p) => /Professional vs Basic \+ 4 more people/.test(p)));
check("an out-of-range price is refused", priceProblems({ tools: { roof: 50 } }).length === 1 && priceProblems({ tools: { roof: 2_000_000 } }).length === 1);
check("a sane change passes", priceProblems({ tools: { roof: 5900 }, seats: { professional: 899 } }).length === 0);

// ── part 2: the lines on the Stripe subscription ──
check("line kinds: a tool, the people, the plan", toolKind("roof") === "tool-roof" && toolIdOfKind("tool-roof") === "roof" && toolIdOfKind("tool-nope") === null && planIdOfKind("tools-professional") === "professional" && planIdOfKind("professional") === null);
check("tool and people lines are add-ons; the plan's line and Classic lines aren't new-plan extras", isToolsExtraKind("seat") && isToolsExtraKind("tool-deck") && !isToolsExtraKind("tools-professional") && !isToolsExtraKind("deck-addon") && !isToolsExtraKind("professional") && !isToolsExtraKind(undefined));
const line = (kind: string) => ({ price: { metadata: { jfKind: kind } } });
check("the plan's line is found whatever order Stripe lists them in", planLine([line("seat"), line("tool-roof"), line("tools-professional")])?.price.metadata.jfKind === "tools-professional" && isAddonLine(line("seat")) && isAddonLine(line("tool-roof")) && !isAddonLine(line("tools-basic")));
check("Classic lines read as before", planLine([line("deck-addon"), line("professional")])?.price.metadata.jfKind === "professional" && !isAddonLine(line("professional")) && !isAddonLine(line("custom-base")));
check("product names", kindName("tools-professional") === "JobFlex Professional" && kindName("tool-roof") === "JobFlex Roof estimator" && kindName("seat") === "JobFlex extra person");

// ── part 2: the shop's record ──
check("a record that isn't one opens nothing", parseToolsRecord("{oops") === null && parseToolsRecord(JSON.stringify({ plan: "enterprise" })) === null && parseToolsRecord(null) === null);
const stored = parseToolsRecord(JSON.stringify({ ...emptyToolsRecord("professional", "deck"), lines: { roof: { itemId: "si_1", cents: 4900, since: "2026-11-10" }, hacker: { itemId: "x" } } }));
check("unknown tools in a stored record are dropped", !!stored && Object.keys(stored.lines).join() === "roof" && stored.main === "deck");
const at = (d: number) => new Date(Date.UTC(2026, 10, d, 12));
const rec = {
  ...emptyToolsRecord("basic", "deck"),
  lines: { texting: { itemId: "si_t", cents: 2900, since: "2026-11-01" } },
  closing: { aidesk: at(20).toISOString() },
  tries: {
    roof: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false },
    fence: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false, removedAt: at(11).toISOString() },
    video: { startedAt: at(1).toISOString(), endsAt: at(4).toISOString(), onLine: false, billedAt: at(4).toISOString() },
  },
};
const open12 = toolsOpen(shopFromRecord(rec, at(12)));
check("open: main, on the bill, closing at the month's end, tries running (a removed one until its end)", ["deck", "texting", "aidesk", "roof", "fence"].every((t) => open12.has(t as never)) && !open12.has("video"));
const open21 = toolsOpen(shopFromRecord(rec, at(21)));
check("…after their dates: the closing tool and the tries are gone", !open21.has("aidesk") && !open21.has("roof") && !open21.has("fence") && open21.has("texting"));
check("to bill when its time is up: only the try nobody removed", triesToBill(rec, at(12)).length === 0 && triesToBill(rec, at(14)).join() === "roof");

// ── the ads ──
check("today's ad links find their tool (Smart Proposal stays in every plan)", SPOTLIGHT_TOOLS.filter((k) => k !== "smart").every((k) => toolForAdKey(k) !== null) && toolForAdKey("smart") === null);
check("the Deck Studio ad is the deck tool", toolForAdKey("deck")?.id === "deck" && toolById("deck").cents === 7900);
check("money words", money(3999) === "$39.99" && money(7500) === "$75" && money(123450) === "$1,234.50");

// ── part 3a: the gate ──
check("every new plan opens Smart Proposal, Calendar, Leads and Company", TOOLS_BASE_PAGES.join() === "smart-proposal,calendar,leads,company");
check("every id a tool or a size opens is a gated id", [...TOOLS.flatMap((t) => t.opens), ...TOOL_PLANS.flatMap((p) => p.features)].every((id) => isGatedPageId(id)));
check("the new ids have entries; only they are new-plan ids", TOOLS_ONLY_PAGE_IDS.every((id) => TOOLS_PAGES.some((t) => t.id === id) && isToolsOnlyPageId(id)) && TOOLS_PAGES.length === TOOLS_ONLY_PAGE_IDS.length && !isToolsOnlyPageId("roof-estimator") && !isToolsOnlyPageId("operator"));
const now = at(12);
const basicDeckRec = { ...emptyToolsRecord("basic", "deck") };
const bd = toolsPagesOpen(basicDeckRec, "TOOLS-BASIC", now);
check("Basic + Deck Studio: the base and the deck, nothing else", [...TOOLS_BASE_PAGES, "deck-estimator"].every((id) => bd.has(id)) && bd.size === 5, [...bd]);
check("…no roof, workers, Meta leads, texting, Operator, Smart CRM, Hire, team messages, commission, Remodeler", ["roof-estimator", "workers", "meta-leads", "texting", "operator", "smart-crm", "hire", "team-messages", "commission", "remodeler", "home-builder", "phone", "subcontractors", "project-tools"].every((id) => !bd.has(id)));
const bdTry = toolsPagesOpen({ ...basicDeckRec, tries: { roof: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false } } }, "tools-basic", now);
check("a running try opens its tool; an ended one doesn't", bdTry.has("roof-estimator") && !toolsPagesOpen({ ...basicDeckRec, tries: { roof: { startedAt: at(1).toISOString(), endsAt: at(4).toISOString(), onLine: false } } }, "tools-basic", now).has("roof-estimator"));
const pr = toolsPagesOpen(null, "tools-professional", now);
check("Professional (no record): the base and the team", ["workers", "meta-leads", "team-messages", "hire", "commission", "smartbook", "crew-field", "roles", ...TOOLS_BASE_PAGES].every((id) => pr.has(id)) && !pr.has("custom-domain") && !pr.has("phone") && !pr.has("texting"));
const ad = toolsPagesOpen(emptyToolsRecord("advanced"), "tools-advanced", now);
check("Advanced: the office tools and the Advanced lines", ["phone", "texting", "smart-crm", "operator", "custom-domain", "multi-org", "priority-support", "workers"].every((id) => ad.has(id)) && !ad.has("roof-estimator"));
check("Complete: everything", [...TOOLS.flatMap((t) => t.opens)].every((id) => toolsPagesOpen(null, "tools-complete", now).has(id)));
check("the slug's size wins over the record's", toolsPagesOpen(emptyToolsRecord("basic"), "tools-professional", now).has("workers") && !toolsPagesOpen(emptyToolsRecord("professional"), "tools-basic", now).has("workers"));
check("an unknown tools- slug with no record opens the base alone", toolsPagesOpen(null, "tools-foo", now).size === TOOLS_BASE_PAGES.length);

check("Classic answers: blueprint as Smart Proposal, Meta as Leads, the rest not closed", classicEquivalent("blueprint-estimator") === "smart-proposal" && classicEquivalent("meta-leads") === "leads" && TOOLS_ONLY_PAGE_IDS.filter((id) => id !== "blueprint-estimator" && id !== "meta-leads").every((id) => classicEquivalent(id) === null));
check("classicPageId leaves the Classic ids alone", classicPageId("roof-estimator") === "roof-estimator" && classicPageId("operator") === "operator" && classicPageId("blueprint-estimator") === "smart-proposal" && classicPageId("hire") === null);

check("toolOffering: a tool's page names the tool", (() => { const o = toolOffering("roof-estimator"); return o?.kind === "tool" && o.tool.id === "roof"; })());
check("…the AI desk page names the AI desk, Smart CRM its tool", (() => { const a = toolOffering("phone"), c = toolOffering("smart-crm"); return a?.kind === "tool" && a.tool.id === "aidesk" && c?.kind === "tool" && c.tool.id === "smartcrm"; })());
check("…subcontractors: Home Builder, also Remodeler", (() => { const o = toolOffering("subcontractors"); return o?.kind === "tool" && o.tool.id === "builder" && o.also.map((t) => t.id).join() === "remodeler"; })());
check("…a size feature: On Professional / On Advanced", (() => { const w = toolOffering("workers"), d = toolOffering("custom-domain"); return w?.kind === "size" && w.plan.id === "professional" && d?.kind === "size" && d.plan.id === "advanced"; })());
check("…a base page: nothing to sell", toolOffering("calendar") === null);
check("project kinds: remodel → Remodeler, new build → Home Builder, a job → none", projectKindPage("REMODEL") === "remodeler" && projectKindPage("NEW_BUILD") === "home-builder" && projectKindPage("JOB") === null && projectKindPage(null) === null);
check("workspaces: Job Projects is the base; a closed one is not open", spacePage("jobs") === null && spacePage("build") === "home-builder" && spacePage("remodel") === "remodeler" && SPACE_IDS.every((id) => spaceOpen(id)) && !spaceOpen("remodel", ["remodel"]) && spaceOpen("jobs", ["remodel", "build"]));

// pageForPath for the new hrefs
const pathId = (p: string) => pageForPath(p)?.id ?? null;
check("pageForPath: the blueprint estimator is its own page now (desk and phone)", pathId("/dashboard/blueprint-estimator") === "blueprint-estimator" && pathId("/mobile-blueprint-estimator-v1") === "blueprint-estimator");
check("pageForPath: Deck Studio and its Deck Lab", pathId("/dashboard/deck-estimator") === "deck-estimator" && pathId("/dashboard/deck-estimator/inventory") === "deck-estimator" && pathId("/dashboard/deck-v3") === "deck-estimator" && pathId("/dashboard/deck-lab") === "deck-estimator");
check("pageForPath: texting, team messages, Hire (desk and phone)", pathId("/dashboard/texting") === "texting" && pathId("/mobile-texting-v1") === "texting" && pathId("/dashboard/messages") === "team-messages" && pathId("/mobile-messages-v2") === "team-messages" && pathId("/dashboard/hire") === "hire" && pathId("/mobile-hire-v1") === "hire");
check("pageForPath: Smart Proposal and the base unchanged", pathId("/dashboard/advanced-ai") === "smart-proposal" && pathId("/dashboard/advanced-ai/roof") === "roof-estimator" && pathId("/dashboard/proposals") === null && pathId("/dashboard/subscription") === null && pathId("/dashboard/company/subscription") === null);
check("gatedPage finds the new entries", gatedPage("hire")?.href === "/dashboard/hire" && gatedPage("commission")?.href === null && gatedPage("deck-estimator")?.label === "Deck Studio");

// Classic must not move
check("Custom plan's picker and price unchanged (10 pages, deck retired)", CUSTOM_PAGES.length === 10 && !CUSTOM_PAGES.some((p) => isToolsOnlyPageId(p.id)) && customPriceCents(["roof-estimator", "deck-estimator"]) === 2000 + 2 * 1000 && normalizeCustomPages(["hire", "texting", "roof-estimator"]).join() === "roof-estimator");
const noSmart = blockedCustomHrefs(["roof-estimator"]);
check("a Custom shop without Smart Proposal: the blueprint estimator still blocked, desk and phone", isCustomBlockedPath(noSmart, "/dashboard/blueprint-estimator") && isCustomBlockedPath(noSmart, "/mobile-blueprint-estimator-v1") && isCustomBlockedPath(noSmart, "/dashboard/advanced-ai"));
const withSmart = blockedCustomHrefs(["smart-proposal"]);
check("…with Smart Proposal: open; the new pages are never a Custom shop's to block", !isCustomBlockedPath(withSmart, "/dashboard/blueprint-estimator") && ["/dashboard/deck-estimator", "/dashboard/texting", "/dashboard/messages", "/dashboard/hire"].every((h) => !isCustomBlockedPath(noSmart, h)));
check("the Custom list holds no marker and only Classic hrefs", !noSmart.includes(TOOLS_MARK) && noSmart.every((h) => CUSTOM_PAGES.some((p) => p.href === h) || h === "/dashboard/blueprint-estimator"));
const lapsedClassic = lapsedBlockedHrefs();
check("a lapsed Classic shop: the same pages as before (the blueprint estimator with Smart Proposal), nothing new", isCustomBlockedPath(lapsedClassic, "/dashboard/blueprint-estimator") && ["/dashboard/deck-estimator", "/dashboard/texting", "/dashboard/messages", "/dashboard/hire"].every((h) => !isCustomBlockedPath(lapsedClassic, h)) && PAID_FEATURES.every((f) => !f.href || lapsedClassic.includes(f.href)));
check("a lapsed new-plan shop: its own pages close too", ["/dashboard/deck-estimator", "/dashboard/texting", "/dashboard/messages", "/dashboard/hire"].every((h) => isCustomBlockedPath(lapsedBlockedHrefs(true), h)));

// the new plans' blocked list
const bdBlocked = toolsBlockedHrefs(bd);
check("a new-plan list carries the marker and the pages not held", bdBlocked.includes(TOOLS_MARK) && bdBlocked.includes("/dashboard/roof-estimator") && bdBlocked.includes("/dashboard/workers") && bdBlocked.includes("/dashboard/hire") && bdBlocked.includes("/dashboard/pipeline") && !bdBlocked.includes("/dashboard/deck-estimator") && !bdBlocked.includes("/dashboard/calendar") && !bdBlocked.includes(PLAN_ENDED_MARK));
check("…and blocks the Smart CRM inbox and the quotes through their pages", isCustomBlockedPath(bdBlocked, "/dashboard/inbox") && isCustomBlockedPath(bdBlocked, "/dashboard/quotes") && !isCustomBlockedPath(bdBlocked, "/dashboard/proposals") && !isCustomBlockedPath(bdBlocked, "/dashboard/subscription"));

// the menu
const hrefsOf = (role: string, locked?: readonly string[]) => navSectionsFor(role, locked).flatMap((s) => flattenNavItems(s.items));
const ownerTools = hrefsOf("OWNER", bdBlocked);
check("new plans: the menu leaves out what the shop can't open (no locked rows)", !ownerTools.some((i) => i.locked) && !ownerTools.some((i) => ["/dashboard/roof-estimator", "/dashboard/workers", "/dashboard/hire", "/dashboard/texting", "/dashboard/messages", "/dashboard/phone", "/dashboard/inbox", "/dashboard/pipeline", "/dashboard/subcontractors", "/dashboard/quotes", "/dashboard/blueprint-estimator"].includes(i.href)));
check("…and keeps what it can (deck, Smart Proposal, calendar, leads, company, projects, subscription)", ["/dashboard/deck-estimator", "/dashboard/advanced-ai", "/dashboard/calendar", "/dashboard/leads", "/dashboard/company", "/dashboard/projects", "/dashboard/subscription", "/dashboard/proposals"].every((h) => ownerTools.some((i) => i.href === h)));
const salesTools = hrefsOf("SALES", bdBlocked);
check("…a limited role's menu drops them too", !salesTools.some((i) => i.locked) && !salesTools.some((i) => i.href === "/dashboard/inbox" || i.href === "/dashboard/messages") && salesTools.some((i) => i.href === "/dashboard/leads"));
const ownerCustom = hrefsOf("OWNER", noSmart);
check("Classic Custom: the menu still MARKS the rows (padlock), drops nothing", ownerCustom.some((i) => i.href === "/dashboard/advanced-ai" && i.locked) && ownerCustom.some((i) => i.href === "/dashboard/blueprint-estimator" && i.locked) && ownerCustom.some((i) => i.href === "/dashboard/hire" && !i.locked));
check("Classic, nothing blocked: the map as authored", navSectionsFor("OWNER", []).length === navSectionsFor("OWNER").length && !hrefsOf("OWNER", []).some((i) => i.locked));
check("Upgrade your plan: the new plans' owner only", showsUpgradePlan("OWNER", bdBlocked) && !showsUpgradePlan("MANAGER", bdBlocked) && !showsUpgradePlan("OWNER", noSmart) && !showsUpgradePlan("OWNER", []) && !showsUpgradePlan("OWNER", undefined) && navDropsBlocked(bdBlocked) && !navDropsBlocked(lapsedClassic) && UPGRADE_PLAN_HREF === "/dashboard/subscription");

// Deck Studio on the new plans
check("Deck Studio on the new plans follows its tool, not the free days", hasEdition({ lapsed: false, trialing: true, tools: { deck: false } }) === false && hasEdition({ lapsed: false, tools: { deck: true } }) && hasEdition({ lapsed: false, tools: { deck: false }, fullAccess: true }) && hasEdition({ lapsed: false, tools: { deck: false }, granted: true }) && !hasEdition({ lapsed: true, tools: { deck: true } }));
check("…Classic unchanged: the trial holds it, a paid plan needs the add-on", hasEdition({ lapsed: false, trialing: true }) && !hasEdition({ lapsed: false }) && hasEdition({ lapsed: false, addon: true }));

// ── part 3b: the record's reminder stamp ──
const withStamp = parseToolsRecord(JSON.stringify({ ...emptyToolsRecord("basic", "deck"), tries: {
  roof: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false, remindedAt: at(12).toISOString() },
  fence: { startedAt: at(10).toISOString(), onLine: false },
  video: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: "yes", billedAt: 5, remindedAt: { x: 1 } },
} }));
check("a try keeps its reminder stamp", withStamp?.tries.roof?.remindedAt === at(12).toISOString());
check("…a try with no end is dropped; a stamp that isn't a date string is dropped", !!withStamp && !withStamp.tries.fence && !!withStamp.tries.video && withStamp.tries.video.remindedAt === undefined && withStamp.tries.video.billedAt === undefined && withStamp.tries.video.onLine === false, withStamp?.tries);
const old2a = parseToolsRecord(JSON.stringify(rec));
check("a record written before part 3b reads the same", !!old2a && JSON.stringify(old2a.tries) === JSON.stringify(rec.tries));

// ── part 3b: what the sweep never bills ──
const switched = { ...emptyToolsRecord("professional", "roof"), tries: { roof: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false } } };
check("a try that became the main tool is never billed as a try", triesToBill(switched, at(14)).length === 0);
const movedUp = { ...emptyToolsRecord("advanced", "deck"), chosenTrade: ["deck" as const], tries: { texting: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false }, fence: { startedAt: at(10).toISOString(), endsAt: at(13).toISOString(), onLine: false } } };
check("…nor one the size now includes (moved up to Advanced mid-try); another tool still is", triesToBill(movedUp, at(14)).join() === "fence");

// ── part 3b: Advanced's two trade tools on a move ──
check("Advanced picks the main tool, then the dearest trade tools on the bill", chosenTradeFor("advanced", "fence", ["roof", "deck", "texting"]).join() === "fence,deck" && chosenTradeFor("advanced", "aidesk", ["roof", "deck", "fence"]).join() === "deck,roof");
check("…a size that picks none: none", chosenTradeFor("professional", "deck", ["roof"]).length === 0 && chosenTradeFor("complete", "deck", ["roof"]).length === 0);

// ── part 3b: the Subscription page's and the welcome page's view ──
const nov = (d: number, h = 15) => new Date(Date.UTC(2026, 10, d, h));
check("a Classic slug has no view", toolsSubscriptionModel({ record: null, planSlug: "PROFESSIONAL", people: 1, now: nov(10), status: "ACTIVE", trialEndsAt: null }) === null);
const m1 = toolsSubscriptionModel({ record: emptyToolsRecord("basic", "deck"), planSlug: "TOOLS-BASIC", people: 1, now: nov(10), status: "TRIALING", trialEndsAt: nov(17), timeZone: "UTC" })!;
check("Basic + Deck Studio in the free days: the name, $118.99, just you, free until Nov 17", m1.plan.label === "Basic + Deck Studio" && m1.plan.monthlyCents === 11899 && m1.plan.paidPeople === 1 && m1.plan.seatCents === null && m1.inTrial && m1.trialDay === "Nov 17", m1.plan);
check("…its tools: Deck Studio, the main tool, billed on its own", m1.tools.length === 1 && m1.tools[0].id === "deck" && m1.tools[0].state === "main" && m1.tools[0].inPlan === false);
check("…to add: works well with Deck Studio first (texting, Smart CRM, AI Operator), then the other 8", m1.offer.length === 11 && m1.offer.slice(0, 3).map((o) => `${o.id}:${o.pair}`).join() === "texting:true,smartcrm:true,operator:true" && m1.offer.slice(3).every((o) => !o.pair));
check("…each a free try that ends with the free days, the date and the price said", m1.offer.every((o) => o.canTry && o.tryDay === "Nov 17") && m1.offer[0].tryWords === "Free until Nov 17, then $29/mo on your bill. Remove it any time before.");
const p1 = Object.fromEntries(m1.plans.map((p) => [p.id, p]));
check("…bigger plans priced with Deck Studio: Professional $154, Advanced $249 (deck included), Complete $449", m1.plans.length === 3 && m1.plans.every((p) => p.bigger && p.canMove) && p1.professional.cents === 15400 && p1.advanced.cents === 24900 && p1.complete.cents === 44900, m1.plans.map((p) => [p.id, p.cents]));
check("…Advanced says Deck Studio comes included; Professional doesn't", p1.advanced.includes.join() === "Deck Studio" && p1.professional.includes.length === 0 && p1.professional.loses.length === 0);
check("…the main tool can be switched to any of the other 11 in the free days", m1.switchTo.length === 11 && !m1.switchTo.some((t) => t.id === "deck"));
const m1after = toolsSubscriptionModel({ record: emptyToolsRecord("basic", "deck"), planSlug: "TOOLS-BASIC", people: 1, now: nov(18), status: "ACTIVE", trialEndsAt: nov(17), timeZone: "UTC" })!;
check("…after the free days: no switch, a try runs 3 days", !m1after.inTrial && m1after.switchTo.length === 0 && m1after.offer[0].tryDay === "Nov 21");

const proRec = {
  ...emptyToolsRecord("professional", "roof"),
  subId: "sub_x",
  lines: { roof: { itemId: "si_r", cents: 4900, since: nov(1).toISOString() }, texting: { itemId: "si_t", cents: 2900, since: nov(1).toISOString() } },
  seat: { itemId: "si_s", quantity: 2, cents: 999 },
  closing: { aidesk: new Date(Date.UTC(2026, 11, 3, 12)).toISOString() },
  tries: {
    texting: { startedAt: nov(1).toISOString(), endsAt: nov(4).toISOString(), onLine: false, billedAt: nov(4).toISOString() },
    video: { startedAt: nov(1).toISOString(), endsAt: nov(4).toISOString(), onLine: false, removedAt: nov(2).toISOString() },
    hvac: { startedAt: nov(19).toISOString(), endsAt: nov(22).toISOString(), onLine: false },
  },
};
const m2 = toolsSubscriptionModel({ record: proRec, planSlug: "tools-professional", people: 6, now: nov(20), status: "ACTIVE", trialEndsAt: null, hasCard: true, timeZone: "UTC" })!;
check("Professional, 6 on the team, 7 paid for: $75 + 2 × $9.99 + roof + texting = $172.98", m2.plan.people === 6 && m2.plan.paidPeople === 7 && m2.plan.extraPeople === 2 && m2.plan.monthlyCents === 17298 && m2.plan.label === "Professional + Roof estimator" && m2.hasCard, m2.plan);
const st2 = Object.fromEntries(m2.tools.map((t) => [t.id, t]));
check("…its tools: roof the main, texting on the bill, an HVAC try running, AI desk closing Dec 3", m2.tools.map((t) => `${t.id}:${t.state}`).join() === "roof:main,hvac:trying,texting:on-bill,aidesk:closing" && st2.texting.cents === 2900 && st2.hvac.day === "Nov 22" && st2.hvac.removed === false && st2.aidesk.day === "Dec 3", m2.tools);
const o2 = Object.fromEntries(m2.offer.map((o) => [o.id, o]));
check("…a used try can't be tried again (Add instead); one never tried can, for 3 days", o2.video.canTry === false && o2.video.tryWords === null && o2.smartcrm.canTry === true && o2.smartcrm.tryDay === "Nov 23" && !o2.hvac && !o2.aidesk && !o2.texting);
check("…works well with the roof: only Smart CRM is left of its three", m2.offer.filter((o) => o.pair).map((o) => o.id).join() === "smartcrm" && m2.offer[0].id === "smartcrm");
const p2 = Object.fromEntries(m2.plans.map((p) => [p.id, p]));
check("…Advanced with its own tools: $249 (roof and texting included, 6 people inside 10)", p2.advanced.cents === 24900 && p2.advanced.bigger && p2.advanced.includes.join() === "Roof estimator,Text messaging", p2.advanced);
check("…Complete $449; Basic can't take a team of 6, in words", p2.complete.cents === 44900 && !p2.basic.bigger && !p2.basic.canMove && p2.basic.why === "Basic is just you. Remove the other 5 people first.", p2.basic);
check("…no switch after the free days", !m2.inTrial && m2.switchTo.length === 0);

const advRec = { ...emptyToolsRecord("advanced", "deck"), chosenTrade: ["deck" as const, "roof" as const], lines: { fence: { itemId: "si_f", cents: 4900, since: nov(1).toISOString() } }, seat: { itemId: "si_s", quantity: 2, cents: 799 } };
const m3 = toolsSubscriptionModel({ record: advRec, planSlug: "TOOLS-ADVANCED", people: 12, now: nov(20), status: "ACTIVE", trialEndsAt: null, timeZone: "UTC" })!;
check("Advanced, 12 people: $249 + 2 × $7.99 + fence = $313.98, named Advanced (deck included)", m3.plan.monthlyCents === 31398 && m3.plan.label === "Advanced" && m3.plan.paidPeople === 12, m3.plan);
check("…its tools: deck the main (in the plan), roof and the four office tools included, fence on the bill", m3.tools.map((t) => `${t.id}:${t.state}`).join() === "deck:main,roof:included,aidesk:included,texting:included,smartcrm:included,operator:included,fence:on-bill" && m3.tools[0].inPlan === true, m3.tools.map((t) => t.id));
check("…to add: the five trade tools left, none of the office tools", m3.offer.map((o) => o.id).join() === "hvac,blueprint,video,builder,remodeler" && m3.offer.every((o) => !o.pair));
const p3 = Object.fromEntries(m3.plans.map((p) => [p.id, p]));
check("…Professional, smaller: $75 + 7 × $9.99 + deck + fence = $272.93, and what closes", p3.professional.cents === 27293 && !p3.professional.bigger && p3.professional.loses.join() === "Roof estimator,AI desk,Text messaging,Smart CRM,AI Operator", p3.professional);
check("…Complete: $449 + 2 × $7.99, fence comes included", p3.complete.cents === 46498 && p3.complete.includes.join() === "Fence estimator");
check("a Complete shop has nothing left to add", toolsSubscriptionModel({ record: emptyToolsRecord("complete", "deck"), planSlug: "tools-complete", people: 3, now: nov(20), status: "ACTIVE", trialEndsAt: null })!.offer.length === 0);

// ── part 3b: the reminder's words ──
check("one try: the owner's words", tryReminderWords([{ label: "Roof estimator", cents: 4900, day: "tomorrow" }]).line === "Your Roof estimator is free until tomorrow, then $49/mo on your bill. Nothing to do to keep it. Don't want it? Remove it on Subscription." && tryReminderWords([{ label: "Roof estimator", cents: 4900, day: "tomorrow" }]).subject === "Your Roof estimator is free until tomorrow");
check("two on the same day: one sentence", tryReminderWords([{ label: "Roof estimator", cents: 4900, day: "tomorrow" }, { label: "Text messaging", cents: 2900, day: "tomorrow" }]).line === "Your Roof estimator and Text messaging are free until tomorrow, then $49/mo and $29/mo on your bill. Nothing to do to keep them. Don't want one? Remove it on Subscription.");
check("the day in the shop's own zone: tomorrow, later today, or the date", tryDayWords(nov(17), nov(16, 16), "UTC") === "tomorrow" && tryDayWords(nov(17, 3), nov(16, 20), "America/Los_Angeles") === "later today" && tryDayWords(nov(17, 3), nov(16, 20), "UTC") === "tomorrow" && tryDayWords(nov(19), nov(16), "UTC") === "Nov 19");

// ── part 4: the public plan cards (the Plans switch on) ──
const deckCards = toolsPlanDTOs("deck");
check("four cards, the new plans' slugs, in size order", deckCards.map((p) => p.slug).join() === "tools-basic,tools-professional,tools-advanced,tools-complete" && isToolsCatalog(deckCards), deckCards.map((p) => p.slug));
check("a Deck Studio ad prices them: $118.99 · $154 · $249 · $449", deckCards.map((p) => p.priceCents).join() === "11899,15400,24900,44900", deckCards.map((p) => p.priceCents));
check("…a year is ten months", deckCards.every((p) => p.yearlyPriceCents === p.priceCents * 10));
check("…the tool is each card's first line: added on Basic and Professional, included on Advanced and Complete", deckCards.map((p) => p.features[0]).join("|") === "+ Deck Studio ($79/mo)|+ Deck Studio ($79/mo)|Deck Studio included|Deck Studio included", deckCards.map((p) => p.features[0]));
check("…Professional is the one marked Most picked, nothing is free, the 7-day trial", deckCards.filter((p) => p.highlight).map((p) => p.slug).join() === "tools-professional" && deckCards.every((p) => !p.isFree && p.active && p.trialDays === 7));
check("…the cards' own lines follow, with the extra-person price said", deckCards[1].features[1] === "Everything in Basic" && deckCards[1].features.at(-1) === "$9.99 for each person after 5" && deckCards[0].features.at(-1) === "Reviews, reports and financials");
const plainCards = toolsPlanDTOs(null);
check("no tool: the sizes alone ($39.99 · $75 · $249 · $449), the plan's own first line", plainCards.map((p) => p.priceCents).join() === "3999,7500,24900,44900" && plainCards[0].features[0] === "Just you: 1 user, the owner", plainCards.map((p) => p.priceCents));
const deskCards = toolsPlanDTOs("aidesk");
check("an AI desk ad: Basic $138.99, Professional $174, the desk included from Advanced", deskCards.map((p) => p.priceCents).join() === "13899,17400,24900,44900" && deskCards[2].features[0] === "AI desk included", deskCards.map((p) => p.priceCents));
const pricedCards = toolsPlanDTOs("deck", withPrices({ tools: { deck: 8900 }, plans: { professional: 7900 } }));
check("prices set in Admin → Plans reach the cards", pricedCards[1].priceCents === 16800 && pricedCards[1].features[0] === "+ Deck Studio ($89/mo)" && pricedCards[1].yearlyPriceCents === 168000, pricedCards[1]);
check("a Classic catalog is not the new plans' (the Classic cards draw it as before)", !isToolsCatalog([{ slug: "starter" }, { slug: "professional" }]) && !isToolsCatalog([]) && !isToolsCatalog([{ slug: "tools-basic" }, { slug: "enterprise" }]));
check("the sign-up rule on these cards: Professional by default, a card's ?plan= wins", autoPlanFor({ plans: deckCards, tool: null, preferred: "tools-professional" })?.slug === "tools-professional" && autoPlanFor({ plans: deckCards, tool: null, preferred: "tools-professional" })?.why === "default" && autoPlanFor({ plans: deckCards, tool: null, asked: "tools-basic", preferred: "tools-professional" })?.why === "asked");
check("the banner over the cards", toolsBanner("deck") === "Every plan is priced with Deck Studio: $79/mo on Basic and Professional, included in Advanced and Complete." && toolsBanner("texting") === "Every plan is priced with Text messaging: $29/mo on Basic and Professional, included in Advanced and Complete.", toolsBanner("deck"));
check("a card's start button opens the sign-up on its plan and tool, the rest of the link kept", withPlanQuery("/auth/register?industry=decking&utm_source=fb#x", "tools-basic", "deck") === "/auth/register?industry=decking&utm_source=fb&plan=tools-basic&tool=deck#x" && withPlanQuery("/auth/register", "tools-complete") === "/auth/register?plan=tools-complete");

// ── part 4: the new ad keys ──
check("six new ad keys, one per tool that had none", TOOLS_AD_KEYS.join() === "video,texting,crm,operator,home-builder,remodeler" && TOOLS.every((t) => typeof t.adKey === "string" && t.adKey.length > 0));
check("every tool's ad key finds it, and so does its own id", TOOLS.every((t) => toolForAdKey(parseAdTool(t.adKey))?.id === t.id && toolForAdKey(parseAdTool(t.id))?.id === t.id), TOOLS.filter((t) => toolForAdKey(parseAdTool(t.id))?.id !== t.id).map((t) => t.id));
check("…and their spellings: crm, assistant, builder, remodel", toolForAdKey(parseAdTool("crm"))?.id === "smartcrm" && toolForAdKey(parseAdTool("assistant"))?.id === "operator" && toolForAdKey(parseAdTool("Builder"))?.id === "builder" && toolForAdKey(parseAdTool("home-builder"))?.id === "builder" && toolForAdKey(parseAdTool(" remodel "))?.id === "remodeler" && toolForAdKey(parseAdTool("video"))?.id === "video" && toolForAdKey(parseAdTool("sms"))?.id === "texting");
check("CLASSIC IS UNTOUCHED: no new key is a Classic spotlight — a Classic card treats ?tool=video as no tool", SPOTLIGHT_TOOLS.join() === "roof,hvac,fence,smart,blueprint,aidesk,deck" && TOOLS_AD_KEYS.every((k) => parseSpotlightTool(k) === undefined && TOOLS_AD[k].aliases.every((a) => parseSpotlightTool(a) === undefined)) && spotlightFor({ tool: "video" }) === null && spotlightFor({ tool: "crm", industry: "roofing" }) === "roof");
check("today's keys read the same through the new plans' reader", SPOTLIGHT_TOOLS.every((k) => parseAdTool(k) === k) && parseAdTool("roofing") === "roof" && parseAdTool("deck-studio") === "deck" && parseAdTool("laser") === undefined && adToolFor({ industry: "decking" }) === "deck");
check("the visit's main tool: the link, else the trade, else the 30-day cookie; Smart Proposal is no tool", mainToolFor({ tool: "crm", cookie: "roof" }) === "smartcrm" && mainToolFor({ industry: "roofing", cookie: "deck" }) === "roof" && mainToolFor({ cookie: "home-builder" }) === "builder" && mainToolFor({ tool: "smart" }) === null && mainToolFor({}) === null && adKeyOf("smartcrm") === "crm" && adKeyOf(null) === null);

// ── part 4: the sign-up's card page ──
const proDeck = toolsChoice("professional", "deck");
check("the card page opens on Professional + Deck Studio, $154", proDeck.label === "Professional + Deck Studio" && proDeck.cents === 15400 && proDeck.yearlyCents === 154000 && proDeck.includedNote === null && proDeck.lines[0] === "+ Deck Studio ($79/mo)");
check("…Working alone? Basic + Deck Studio, $118.99", toolsSizeSwitch("professional", "deck")?.words === "Working alone? Basic + Deck Studio, $118.99" && toolsSizeSwitch("professional", "deck")?.to === "basic", toolsSizeSwitch("professional", "deck"));
check("…and back: Have a team? Professional + Deck Studio, $154", toolsSizeSwitch("basic", "deck")?.words === "Have a team? Professional + Deck Studio, $154" && toolsSizeSwitch("advanced", "deck") === null && toolsSizeSwitch("complete", null) === null);
check("Change tool → Roof: Professional $124, Basic $88.99", toolsChoice("professional", "roof").cents === 12400 && toolsChoice("basic", "roof").cents === 8899 && toolsChoice("basic", "roof").label === "Basic + Roof estimator" && toolsSizeSwitch("professional", "roof")?.words === "Working alone? Basic + Roof estimator, $88.99");
check("…no tool: Professional $75, the plan alone", toolsChoice("professional", null).label === "Professional" && toolsChoice("professional", null).cents === 7500 && toolsSizeSwitch("professional", null)?.words === "Working alone? Basic, $39.99");
check("Advanced + Deck Studio: $249, the tool included (no line of its own); Complete the same", toolsChoice("advanced", "deck").label === "Advanced" && toolsChoice("advanced", "deck").includedNote === "Deck Studio included" && toolsChoice("advanced", "deck").cents === 24900 && toolsChoice("complete", "builder").cents === 44900);
check("Advanced + an office tool is included too; a seventh tool on Basic is its price", toolsChoice("advanced", "aidesk").cents === 24900 && toolsChoice("basic", "builder").cents === 3999 + 9900);
check("the size a sign-up opens on: the card's ?plan=, else Professional", toolsPlanFromAsk("tools-basic") === "basic" && toolsPlanFromAsk("TOOLS-COMPLETE") === "complete" && toolsPlanFromAsk("professional") === "professional" && toolsPlanFromAsk(null) === "professional" && toolsPlanFromAsk("tools-enterprise") === "professional");

// ── part 4: the server's read of a pick (never the browser's price) ──
check("a real pick is read", JSON.stringify(toolsSignupPick({ plan: "tools-professional", tool: "deck" })) === '{"plan":"professional","main":"deck"}' && JSON.stringify(toolsSignupPick({ plan: "TOOLS-BASIC", tool: "Roof" })) === '{"plan":"basic","main":"roof"}');
check("…no tool is the plan alone", toolsSignupPick({ plan: "tools-advanced", tool: "" })?.main === null && toolsSignupPick({ plan: "tools-advanced", tool: "none" })?.main === null && toolsSignupPick({ plan: "tools-advanced", tool: null })?.main === null && toolsSignupPick({ plan: "tools-advanced", tool: undefined })?.main === null);
check("a forged pick is refused: a made-up size, a Classic slug, a tool that isn't ours, a price", toolsSignupPick({ plan: "tools-enterprise", tool: "deck" }) === null && toolsSignupPick({ plan: "professional", tool: "deck" }) === null && toolsSignupPick({ plan: "tools-professional", tool: "laser" }) === null && toolsSignupPick({ plan: "tools-professional", tool: "1" }) === null && toolsSignupPick({ plan: null, tool: "deck" }) === null && toolsSignupPick({ plan: "tools-", tool: null }) === null);

// ── part 5: the ad key a sign-up keeps (the Google round trip) ──
check("a new plans' key is kept as its key: video, crm from smartcrm, home-builder from builder", keptAdTool("video") === "video" && keptAdTool("smartcrm") === "crm" && keptAdTool("builder") === "home-builder" && keptAdTool(" Remodel ") === "remodeler");
check("…a Classic key as it was, the first good candidate wins, nothing is nothing", keptAdTool("roofing") === "roof" && keptAdTool(null, "deck") === "deck" && keptAdTool("laser", "crm") === "crm" && keptAdTool("smartcrm", "roof") === "crm" && keptAdTool() === undefined && keptAdTool(null, undefined, "") === undefined);
check("…switch off on the register page (no main tool): the spotlight, exactly as before", SPOTLIGHT_TOOLS.every((k) => keptAdTool(null, k) === k));
check("…every tool's own id round-trips to the same main tool", TOOLS.every((t) => mainToolFor({ tool: keptAdTool(t.id) ?? null }) === t.id));
check("…and a kept new key is no tool to every Classic reader", TOOLS_AD_KEYS.every((k) => parseSpotlightTool(keptAdTool(k)) === undefined));

// ── part 5: the numbers ──
const month = (kind: string, unitCents: number, quantity = 1): ToolsLine => ({ kind, unitCents, quantity, interval: "month", intervalCount: 1 });
const year = (kind: string, unitCents: number, quantity = 1): ToolsLine => ({ kind, unitCents, quantity, interval: "year", intervalCount: 1 });
check("a line's month: monthly as is, yearly ÷ 12, the quantity counted", lineMonthlyCents(month("tool-deck", 7900)) === 7900 && lineMonthlyCents(year("tool-deck", 79000)) === 6583 && lineMonthlyCents(month("seat", 999, 3)) === 2997 && lineMonthlyCents(year("seat", 9990, 2)) === 1665 && lineMonthlyCents({ ...month("x", 1200), intervalCount: 3 }) === 400);
const nrow = (id: string, plan: string, status: string, amountCents: number, lines: ToolsLine[] | null, extra: Partial<NumbersRow> = {}): NumbersRow => ({ id, organizationId: `org_${id}`, plan, status, countsTowardMrr: status === "ACTIVE", amountCents, toolsLines: lines, ...extra });
const nRows: NumbersRow[] = [
  // Professional + Deck Studio + Roof, 2 extra people: 7500 + 7900 + 4900 + 1998 = 22298
  nrow("a", "TOOLS-PROFESSIONAL", "ACTIVE", 22298, [month("tools-professional", 7500), month("tool-deck", 7900), month("tool-roof", 4900), month("seat", 999, 2)]),
  // Basic + Deck Studio, yearly: (39990 + 79000) / 12 = 3333 + 6583 = 9916
  nrow("b", "TOOLS-BASIC", "ACTIVE", 9916, [year("tools-basic", 39990), year("tool-deck", 79000)]),
  // Advanced in its trial: a shop, not MRR
  nrow("c", "TOOLS-ADVANCED", "TRIALING", 0, [month("tools-advanced", 24900)]),
  // Professional with a 50% coupon: lines 7500 + 2900, MRR 5200
  nrow("d", "TOOLS-PROFESSIONAL", "ACTIVE", 5200, [month("tools-professional", 7500), month("tool-texting", 2900)]),
  // a canceled new-plan subscription and the Free plan's row: neither is a shop
  nrow("e", "TOOLS-BASIC", "CANCELED", 0, [month("tools-basic", 3999)]),
  nrow("f", "TOOLS-BASIC", "CANCELED", 0, null, { onFree: true }),
  // Classic: two paying, one in trial
  nrow("g", "PROFESSIONAL", "ACTIVE", 9500, null),
  nrow("h", "STARTER", "ACTIVE", 4500, null),
  nrow("i", "PROFESSIONAL", "TRIALING", 0, null),
];
const rec5 = (plan: "basic" | "professional" | "advanced" | "complete", main: ReturnType<typeof emptyToolsRecord>["main"], tries: ReturnType<typeof emptyToolsRecord>["tries"], chosenTrade: ReturnType<typeof emptyToolsRecord>["chosenTrade"] = []) => ({ ...emptyToolsRecord(plan, main), tries, chosenTrade });
const T = (x: Partial<{ billedAt: string; removedAt: string; failedAt: string; remindedAt: string }> = {}, endsAt = "2026-11-18T12:00:00Z") => ({ startedAt: "2026-11-15T12:00:00Z", endsAt, onLine: false, ...x });
const nRecords = [
  { organizationId: "org_a", record: rec5("professional", "deck", { roof: T({ billedAt: "2026-11-18T13:00:00Z", remindedAt: "2026-11-17T12:00:00Z" }), texting: T({ removedAt: "2026-11-16T09:00:00Z" }), smartcrm: T({}, "2026-11-23T12:00:00Z") }) },
  { organizationId: "org_b", record: rec5("basic", "deck", { roof: T({ failedAt: "2026-11-18T13:00:00Z", remindedAt: "2026-11-17T12:00:00Z" }), video: T({ removedAt: "2026-11-16T00:00:00Z" }) }) },
  // Advanced: the office set is included — a texting try there was taken in by the size, so it's kept
  { organizationId: "org_c", record: rec5("advanced", "hvac", { texting: T({}, "2026-11-25T12:00:00Z") }, ["hvac"]) },
  { organizationId: "org_d", record: rec5("professional", null, {}) },
];
const n5 = toolPlansNumbers({ rows: nRows, records: nRecords });
check("shops on the new plans: the live ones only (4 — not the canceled one, not the Free row)", n5.shops === 4 && n5.paying === 3 && n5.trialing === 1 && !n5.empty, { shops: n5.shops, paying: n5.paying, trialing: n5.trialing });
const sz = (id: string) => n5.bySize.find((x) => x.plan === id)!;
check("…by size: Basic 1, Professional 2, Advanced 1 (in trial), Complete 0", sz("basic").shops === 1 && sz("professional").shops === 2 && sz("advanced").shops === 1 && sz("advanced").trialing === 1 && sz("advanced").paying === 0 && sz("complete").shops === 0);
check("MRR split: new plans 37,414 (22,298 + 9,916 + 5,200) vs Classic 14,000; trials count for nothing", n5.mrr.newCents === 37414 && n5.mrr.classicCents === 14000 && n5.mrr.newSubs === 3 && n5.mrr.classicSubs === 2 && Math.abs((n5.mrr.newShare ?? 0) - 37414 / 51414) < 1e-9, n5.mrr);
check("by size is the plan line + the extra people: Professional 7,500 + 1,998 + 7,500, two extra people", sz("professional").mrrCents === 7500 + 1998 + 7500 && sz("professional").extraPeople === 2 && sz("professional").paying === 2, sz("professional"));
check("…a yearly Basic line ÷ 12 (39,990 → 3,333)", sz("basic").mrrCents === 3333, sz("basic"));
const tl = (id: string) => n5.byTool.find((x) => x.tool === id)!;
check("by tool: Deck Studio 7,900 + 6,583 (yearly ÷ 12) on 2 bills; Roof 4,900; Text messaging 2,900 (before the coupon)", tl("deck").mrrCents === 14483 && tl("deck").paying === 2 && tl("roof").mrrCents === 4900 && tl("texting").mrrCents === 2900 && tl("video").mrrCents === 0, { deck: tl("deck"), roof: tl("roof") });
check("…the coupon is said, not hidden: 1 shop, 5,200 a month", n5.coupons.rows === 1 && n5.coupons.gapCents === 5200, n5.coupons);
check("…nothing double counted: every paying line adds up to MRR + the coupon gap", n5.bySize.reduce((a, x) => a + x.mrrCents, 0) + n5.byTool.reduce((a, x) => a + x.mrrCents, 0) === n5.mrr.newCents + n5.coupons.gapCents);
check("main tools: Deck Studio for 2 live shops, HVAC 1; a record with none adds none", tl("deck").mainOf === 2 && tl("hvac").mainOf === 1 && n5.byTool.reduce((a, x) => a + x.mainOf, 0) === 3);
check("tries: 6 started — kept 2 (billed; taken in by Advanced), removed 2, declined 1, open 1; 2 reminders", n5.tries.started === 6 && n5.tries.kept === 2 && n5.tries.removed === 2 && n5.tries.declined === 1 && n5.tries.open === 1 && n5.tries.reminded === 2, n5.tries);
check("…keep rate: kept ÷ decided = 2 ÷ 5", n5.tries.keepRate === 2 / 5, n5.tries.keepRate);
check("…per tool: Roof 1 of 2 kept (50%), Text messaging 1 of 2 (removed on Professional, kept on Advanced), Smart CRM still open (no rate)", tl("roof").tries.keepRate === 0.5 && tl("roof").tries.started === 2 && tl("texting").tries.kept === 1 && tl("texting").tries.removed === 1 && tl("smartcrm").tries.open === 1 && tl("smartcrm").tries.keepRate === null);
check("…a try of the shop's own main tool counts as kept (switching stamps it removed, it is never billed twice)", tryOutcome("deck", T({ removedAt: "2026-11-16T00:00:00Z" }), { plan: "basic", main: "deck", chosenTrade: [] }) === "kept" && tryOutcome("roof", T({ removedAt: "2026-11-16T00:00:00Z" }), { plan: "basic", main: "deck", chosenTrade: [] }) === "removed");
const n0 = toolPlansNumbers({ rows: nRows.filter((r) => !r.plan.startsWith("TOOLS")), records: [] });
check("EMPTY: no shop on the new plans and no record — empty, zeros, Classic MRR still counted", n0.empty && n0.shops === 0 && n0.mrr.newCents === 0 && n0.mrr.classicCents === 14000 && n0.mrr.newShare === 0 && n0.tries.started === 0 && n0.tries.keepRate === null && n0.byTool.every((x) => x.mrrCents === 0));
check("…and with nothing at all, no share to speak of", toolPlansNumbers({ rows: [], records: [] }).mrr.newShare === null && toolPlansNumbers({ rows: [], records: [] }).empty);
const twice = toolPlansNumbers({ rows: [nrow("s1", "TOOLS-PROFESSIONAL", "ACTIVE", 7500, [month("tools-professional", 7500)], { organizationId: "org_x", source: "stripe" }), nrow("r1", "TOOLS-PROFESSIONAL", "ACTIVE", 0, null, { organizationId: "org_x", source: "record", countsTowardMrr: false })], records: [] });
check("a shop listed twice (Stripe's subscription and an older record Stripe didn't return) is one shop; MRR once", twice.shops === 1 && twice.bySize.find((x) => x.plan === "professional")!.shops === 1 && twice.mrr.newCents === 7500 && twice.paying === 1, { shops: twice.shops, size: twice.bySize.find((x) => x.plan === "professional") });
check("a paying row nobody could price is counted in MRR and said, never guessed", toolPlansNumbers({ rows: [nrow("z", "TOOLS-BASIC", "ACTIVE", 3999, null)], records: [] }).unpriced === 1 && toolPlansNumbers({ rows: [nrow("z", "TOOLS-BASIC", "ACTIVE", 3999, null)], records: [] }).mrr.newCents === 3999);

// ── part 5: the subscribers list's name for a new-plan row ──
check("row label: the size by the plan line's kind, then its tools and extra people", toolsRowLabel("TOOLS-PROFESSIONAL", [month("tools-professional", 7500), month("tool-roof", 4900), month("tool-deck", 7900), month("seat", 999, 2)]) === "Professional · new plans · Roof estimator + Deck Studio · +2 people", toolsRowLabel("TOOLS-PROFESSIONAL", [month("tools-professional", 7500), month("tool-roof", 4900), month("tool-deck", 7900), month("seat", 999, 2)]));
check("…the line's kind wins over a stale slug; no lines is the size alone", toolsRowLabel("TOOLS-BASIC", [month("tools-advanced", 24900)]) === "Advanced · new plans" && toolsRowLabel("TOOLS-COMPLETE") === "Complete · new plans" && toolsRowLabel("TOOLS-BASIC", [month("tools-basic", 3999), month("seat", 999, 1)]) === "Basic · new plans · +1 person");

// ── part 5: the record's lines at the catalog's prices, and the first bill ──
const billRec = { ...emptyToolsRecord("professional", "deck"), lines: { deck: { itemId: "si_1", cents: 7900, since: "x" }, roof: { itemId: "si_2", cents: 4900, since: "x" } }, seat: { itemId: "si_3", quantity: 2, cents: 999 } };
const billLines = catalogToolsLines(billRec, "tools-professional");
check("catalog lines: plan, main + kept tools, extra people — their sum is the Subscription page's month", billLines.map((l) => `${l.kind}:${lineMonthlyCents(l)}`).join() === "tools-professional:7500,tool-deck:7900,tool-roof:4900,seat:1998" && billLines.reduce((a, l) => a + lineMonthlyCents(l), 0) === monthlyCents({ plan: "professional", main: "deck", kept: ["deck", "roof"] }, 7), billLines);
check("…Advanced takes its two trade tools in (no line), the office set too", catalogToolsLines({ ...emptyToolsRecord("advanced", "deck"), chosenTrade: ["deck", "roof"], lines: { roof: { itemId: "s", cents: 4900, since: "x" }, texting: { itemId: "t", cents: 2900, since: "x" } } }, "tools-advanced").map((l) => l.kind).join() === "tools-advanced" && catalogToolsLines(null, "professional").length === 0);
const fb = toolsFirstBill(billRec, "TOOLS-PROFESSIONAL")!;
check("first bill: Professional + Deck Studio, $222.98/month, made of four parts", fb.name === "Professional + Deck Studio" && fb.cents === 22298 && fb.price === "$222.98/month" && fb.parts.join(" + ") === "Professional $75 + Deck Studio $79 + Roof estimator $49 + 2 more people $19.98", fb);
check("…its tools are what the shop has (catalog order)", fb.tools.join() === "Roof estimator,Deck Studio", fb.tools);
const fbY = toolsFirstBill(billRec, "tools-professional", undefined, true)!;
check("…a yearly term: ten months for twelve, per year", fbY.cents === 222980 && fbY.price === "$2,229.80/year" && fbY.parts[0] === "Professional $750", fbY);
check("…Advanced with the main tool included says the size alone; Classic is no tools bill", toolsFirstBill({ ...emptyToolsRecord("advanced", "deck"), chosenTrade: ["deck"] }, "tools-advanced")?.name === "Advanced" && toolsFirstBill({ ...emptyToolsRecord("advanced", "deck"), chosenTrade: ["deck"] }, "tools-advanced")?.cents === 24900 && toolsFirstBill(null, "PROFESSIONAL") === null && toolsFirstBill(null, "tools-basic")?.price === "$39.99/month");

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
