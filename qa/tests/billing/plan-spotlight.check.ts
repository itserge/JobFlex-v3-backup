// The tool the visitor came for (lib/planSpotlight, 2026-10-14): which tool a
// link or a trade means, which feature line it marks, and how the rows reorder.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/billing/plan-spotlight.check.ts
import { SPOTLIGHT, SPOTLIGHT_TOOLS, parseSpotlightTool, spotlightFor, spotlightFromTrade, planCardRows, showsTool, spotlightBanner, spotlightInPlan, spotlightNarrows, spotlightRow, visibleRows, withSpotlightFirst } from "../../../src/lib/planSpotlight";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

console.log("── the seven tools");
check("seven tools, each with a label, a match and a who", SPOTLIGHT_TOOLS.length === 7 && SPOTLIGHT_TOOLS.every((k) => SPOTLIGHT[k].label && SPOTLIGHT[k].match instanceof RegExp && SPOTLIGHT[k].who));

console.log("── the link's own word");
check("keys and spellings read; case and spaces do not matter", parseSpotlightTool("roof") === "roof" && parseSpotlightTool(" Roofing ") === "roof" && parseSpotlightTool("ai-desk") === "aidesk" && parseSpotlightTool("blueprints") === "blueprint" && parseSpotlightTool("deck-studio") === "deck" && parseSpotlightTool("smart-proposal") === "smart" && parseSpotlightTool(["hvac"]) === "hvac");
check("anything else is nothing", parseSpotlightTool("plumbing") === undefined && parseSpotlightTool("") === undefined && parseSpotlightTool(undefined) === undefined && parseSpotlightTool("<script>") === undefined);

console.log("── the trade's own estimator");
check("roofing → roof, hvac → hvac, fencing → fence, decking → deck; by key or by name", spotlightFromTrade("roofing") === "roof" && spotlightFromTrade("Roofing") === "roof" && spotlightFromTrade("hvac") === "hvac" && spotlightFromTrade("HVAC") === "hvac" && spotlightFromTrade("fencing") === "fence" && spotlightFromTrade("Fencing") === "fence" && spotlightFromTrade("decking") === "deck" && spotlightFromTrade("Decking") === "deck");
check("a trade without an ad tool marks nothing", spotlightFromTrade("plumbing") === undefined && spotlightFromTrade("General Contractor") === undefined && spotlightFromTrade(null) === undefined);
check("the tool on the link wins over the trade; no link, the trade; neither, nothing", spotlightFor({ tool: "aidesk", industry: "roofing" }) === "aidesk" && spotlightFor({ industry: "roofing" }) === "roof" && spotlightFor({ tool: "nope", industry: "plumbing" }) === null && spotlightFor({}) === null);

console.log("── the row it marks");
const rows = ["Proposal management", "Client management", "Smart proposal generation", "Roof estimator", "Fence estimator", "HVAC estimator", "Blueprint estimator", "Deck Studio", "AI phone answering", "Unlimited users"];
check("each tool finds its line however the catalog words it", spotlightRow(rows, "roof") === "Roof estimator" && spotlightRow(rows, "fence") === "Fence estimator" && spotlightRow(rows, "hvac") === "HVAC estimator" && spotlightRow(rows, "smart") === "Smart proposal generation" && spotlightRow(rows, "blueprint") === "Blueprint estimator" && spotlightRow(rows, "aidesk") === "AI phone answering");
check("Deck Studio is never a plan's line, whatever the catalog says (owner-locked 2026-10-20: an add-on on any plan)", spotlightRow(rows, "deck") === null && withSpotlightFirst(rows, "deck").join("|") === rows.join("|"));
check("'AI desk' and 'receptionist' wordings also read as the desk", spotlightRow(["AI desk"], "aidesk") === "AI desk" && spotlightRow(["Phone receptionist"], "aidesk") === "Phone receptionist");
check("a catalog without the line marks nothing", spotlightRow(["Proposal management", "CRM"], "roof") === null && spotlightRow(rows, null) === null);
const first = withSpotlightFirst(rows, "blueprint");
check("the marked line goes first; the rest keep their order; nothing is lost", first[0] === "Blueprint estimator" && first.length === rows.length && first.slice(1).join("|") === rows.filter((r) => r !== "Blueprint estimator").join("|"));
check("no tool, or no line: the rows as they were", withSpotlightFirst(rows, null).join("|") === rows.join("|") && withSpotlightFirst(["CRM"], "roof").join("|") === "CRM");

console.log("── one trade, one estimator (owner, 2026-11-07)");
// The live catalog's rows as /pricing printed them on 2026-11-07, plus a few wordings the catalog may grow.
const catalog = ["Proposal management", "Client management", "CRM", "Calendar", "Workers management", "Financials", "Messages", "1 user", "Smart proposal generation", "Roof estimator", "Fence estimator", "HVAC estimator", "Deck Studio", "Video estimator", "Blueprints estimator (coming soon)", "AI phone answering", "Custom branding & domain", "Up to 3 users", "Unlimited users", "Follow-up automations", "SMS"];
const others = catalog.filter((r) => !["Roof estimator", "Fence estimator", "HVAC estimator", "Deck Studio"].includes(r));
const only = (tool: "roof" | "hvac" | "fence", line: string) => {
  const seen = withSpotlightFirst(visibleRows(catalog, tool), tool);
  return seen[0] === line && seen.slice(1).join("|") === others.join("|") && showsTool("deck", tool) === false && showsTool(tool, tool) && showsTool("smart", tool) && showsTool("aidesk", tool);
};
check("fence: only the Fence estimator among the trades, pinned first; no Roof/HVAC/Deck rows nor the Deck add-on line; the rest stay", only("fence", "Fence estimator"));
check("roofing: only the Roof estimator", spotlightFor({ industry: "roofing" }) === "roof" && only("roof", "Roof estimator"));
check("hvac: only the HVAC estimator", spotlightFor({ industry: "hvac" }) === "hvac" && only("hvac", "HVAC estimator"));
check("the Deck Studio panel under the cards follows the narrowing: hidden for a roof/hvac/fence ad visit, shown otherwise", (["roof", "hvac", "fence"] as const).every((t) => !showsTool("deck", spotlightNarrows(t, t, undefined) ? t : null) && showsTool("deck", spotlightNarrows(t, null, undefined) ? t : null)) && showsTool("deck", "deck") && showsTool("deck", null));
check("deck does not narrow: every row and the add-on line", visibleRows(catalog, "deck").join("|") === catalog.join("|") && showsTool("deck", "deck") && showsTool("roof", "deck"));
check("no spotlight (direct visitor): every row and the add-on line", visibleRows(catalog, null).join("|") === catalog.join("|") && showsTool("deck", null) && showsTool("fence", undefined));
check("smart / blueprint / aidesk do not narrow", (["smart", "blueprint", "aidesk"] as const).every((t) => visibleRows(catalog, t).join("|") === catalog.join("|") && showsTool("deck", t)));
check("a catalog without the spotlighted line: the other trades still go", visibleRows(["CRM", "Roof estimator", "Deck Studio"], "fence").join("|") === "CRM");

console.log("── the spotlighted row is always there, marked by the gate (owner, 2026-11-07)");
const card = (rows: string[], tool: Parameters<typeof planCardRows>[1], narrow: boolean) => planCardRows(rows, tool, narrow);
const syn = card(["CRM", "Roof estimator", "Messages"], "fence", true);
check("no Fence line in the catalog: a 'Fence estimator' row is drawn first under SPOTLIGHT's label", syn.spot === "Fence estimator" && syn.rows.join("|") === "Fence estimator|CRM|Messages");
const own = card(catalog, "roof", true);
check("the catalog's own line is the one pinned when the SPOTLIGHT map finds it; never a second copy", own.spot === "Roof estimator" && own.rows.filter((r) => /roof/i.test(r)).length === 1 && own.rows[0] === "Roof estimator");
check("the mark is the gate's: every catalog plan carries it, a Custom plan only with its page", spotlightInPlan("fence", { slug: "starter" }) && !spotlightInPlan("fence", { slug: "custom", customPages: ["roof-estimator"] }) && spotlightInPlan("fence", { slug: "custom", customPages: ["fence-estimator"] }));
check("Deck Studio has no plan row (its add-on line is the card's own); no spotlight: no row added", card(catalog, "deck", false).spot === null && card(catalog, "deck", false).rows.join("|") === catalog.join("|") && card(catalog, null, false).rows.join("|") === catalog.join("|"));
const P = [{ slug: "starter", name: "Starter" }, { slug: "professional", name: "Professional" }, { slug: "enterprise", name: "Advanced" }];
check("banner: every plan carries it → 'it's in every plan'; no 'ask us' any more", spotlightBanner("fence", P) === "You came for the Fence estimator — it's in every plan." && !/ask us/.test(spotlightBanner("roof", [])));
check("banner: some plans carry it → names them", spotlightBanner("hvac", [...P, { slug: "custom", name: "Custom", customPages: [] }]) === "You came for the HVAC estimator — it's in Starter, Professional and Advanced." && spotlightBanner("roof", [{ slug: "custom", name: "Custom", customPages: [] }, { slug: "starter", name: "Starter" }]) === "You came for the Roof estimator — it's in Starter.");
check("banner: Deck Studio keeps its add-on words", /^You came for Deck Studio — the trial includes it, then it's \$79/.test(spotlightBanner("deck", P)));

console.log("── narrowing only during the ad visit (owner, 2026-11-07)");
check("the URL carries roof / hvac / fence → narrows", spotlightNarrows("fence", "fence", undefined) && spotlightNarrows("roof", "roof", null) && spotlightNarrows("hvac", spotlightFor({ industry: "hvac" }), undefined));
check("no URL, the visit's session cookie names the tool → narrows", spotlightNarrows("fence", null, "fence"));
check("no URL, no session cookie (a new browser session), only the 30-day cookie → every row, the spotlight still pinned", !spotlightNarrows("fence", null, undefined) && (() => { const c = card(catalog, "fence", false); return c.rows[0] === "Fence estimator" && c.spot === "Fence estimator" && c.rows.length === catalog.length && c.rows.includes("Roof estimator") && c.rows.includes("HVAC estimator"); })());
check("a session cookie for another tool does not narrow this one; nonsense in it is nothing", !spotlightNarrows("fence", null, "roof") && !spotlightNarrows("fence", null, "<x>"));
check("deck / smart / blueprint / aidesk / none never narrow, URL or cookie", (["deck", "smart", "blueprint", "aidesk"] as const).every((t) => !spotlightNarrows(t, t, t)) && !spotlightNarrows(null, null, "fence"));
const narrowed = card(catalog, "fence", spotlightNarrows("fence", "fence", undefined));
check("/?industry=fence: Fence pinned, no Roof/HVAC/Deck rows, the rest stay", narrowed.rows.join("|") === ["Fence estimator", ...others].join("|"));

console.log(bad ? `\n${bad} FAILED` : "\nall good");
process.exit(bad ? 1 : 0);
