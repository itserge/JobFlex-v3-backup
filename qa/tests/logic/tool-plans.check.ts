// BASE + TOOLS — the new plans' rules (2026-11-10, parts 1–3a), on the catalog as set. No database.
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
import { SPOTLIGHT_TOOLS } from "@/lib/planSpotlight";
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

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
