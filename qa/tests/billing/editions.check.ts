// THE EDITIONS (2026-10-11, lib/editions): the doors of one platform. The
// cookie's values, who holds the Deck Studio (owner-locked 2026-10-20: the
// trial, the $79/mo add-on — $49 for lines bought before 2026-10-26 — a grant, a platform admin — never a plan), how far
// the studio opens to everyone else, who may switch, where a sign-in lands,
// what the deck workspace's sidebar keeps and drops (one door since 2026-10-21 — nobody switches), and the sign-up link each
// door writes. Pure.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/billing/editions.check.ts
import * as editions from "../../../src/lib/editions";
import { EDITIONS, canSwitch, editionLevel, hasEdition, homeFor, navAllowed, parseDoor, registerHref, unlockedByEdition, workspaceFor, type AccessFacts } from "../../../src/lib/editions";
import { DECK_ADDON_CENTS, DECK_PICK_TRIAL_WORDS, addonHeld, deckAddonCents, deckAddonHeldWords, deckAddonPriceWords, deckAddonShortWords, deckTrialWords, isDeckAddonLine, parseDeckAddonRecord, planLine, planLines } from "../../../src/lib/deckAddon";
import { annualDeal, dealWords, savedWords } from "../../../src/lib/planDeal";
import { autoPlanFor } from "../../../src/lib/signupAutoPlan";
import { isAddOnTool, spotlightBanner, spotlightRow } from "../../../src/lib/planSpotlight";
import { freePlanLosses } from "../../../src/lib/freePlan";
import { NAV_SECTIONS, navSectionsFor, flattenNavItems } from "../../../src/components/v3/blueprint-shell/nav-map";

let bad = 0;
const check = (name: string, ok: boolean, extra = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const facts = (over: Partial<AccessFacts>): AccessFacts => ({ lapsed: false, ...over });

console.log("── the door cookie");
check("deck, platform and jobflex parse; junk does not; no deck door while it is coming soon", parseDoor("deck", true) === "deck" && parseDoor(" DECK ", true) === "deck" && parseDoor("deck", false) === null && parseDoor("platform") === "platform" && parseDoor("jobflex") === "platform" && parseDoor("roof") === null && parseDoor(null) === null);

console.log("── WHO HOLDS DECK STUDIO (owner-locked 2026-10-20) — the seven cases");
const trial = facts({ trialing: true });
const paid = facts({});
const paidAddon = facts({ addon: true });
const admin = facts({ fullAccess: true });
const grant = facts({ granted: true });
const trialEnded = facts({ lapsed: true });
check("1. the trial: full, without the add-on", editionLevel(trial) === "full" && hasEdition(trial));
check("2. a paid plan without the add-on: preview", editionLevel(paid) === "preview" && !hasEdition(paid));
check("3. a paid plan with the add-on: full", editionLevel(paidAddon) === "full");
check("4. a platform admin (hasFullAccess): full — whatever the plan, lapsed too, and while it is coming soon", editionLevel(admin) === "full" && editionLevel(facts({ fullAccess: true, lapsed: true })) === "full" && editionLevel(admin, "deck", false) === "full");
check("5. a grant (MANUAL): full", editionLevel(grant) === "full");
check("6. an ended trial (the Free plan): preview — not the whole studio, not a closed page", editionLevel(trialEnded) === "preview" && editionLevel(facts({ lapsed: true, trialing: true })) === "preview");
check("7. the add-on taken off: preview again", editionLevel({ ...paidAddon, addon: false }) === "preview");
check("8. Custom with the deck page: full — the add-on bought as a page", editionLevel(facts({ customDeckPage: true })) === "full" && hasEdition(facts({ customDeckPage: true })));
check("9. Custom without the deck page: preview", editionLevel(facts({ customDeckPage: false })) === "preview");
check("a lapsed Custom plan's deck page opens nothing", editionLevel(facts({ lapsed: true, customDeckPage: true })) === "preview");
check("a lapsed plan's stale add-on record opens nothing", editionLevel(facts({ lapsed: true, addon: true })) === "preview");
check("while it is coming soon: closed for everyone but an admin — the trial, the add-on and a grant included", editionLevel(paid, "deck", false) === "none" && editionLevel(trial, "deck", false) === "none" && editionLevel(paidAddon, "deck", false) === "none" && editionLevel(grant, "deck", false) === "none");
check("the platform edition is everyone's", hasEdition(facts({ lapsed: true }), "platform"));

console.log("── no plan carries it (the branches that gave it away are gone)");
const gone = ["isEditionPlan", "editionOnly", "upgradeTargetFrom", "planComingSoon", "featureLineForSale", "EDITION_FOR_EVERY_ACCOUNT", "EDITION_IN_TRIAL"].filter((k) => k in editions);
check("no deck plan, no feature-line or custom-page rule, no every-account switch is exported", gone.length === 0, gone.join(" "));
check("the deck edition names no plans or feature words", !("planSlugs" in EDITIONS.deck) && !("featureWords" in EDITIONS.deck) && !("customPage" in EDITIONS.deck));

console.log("── the workspace, the switch and the home");
check("every request works on the whole platform, whatever the door", workspaceFor(paidAddon, "deck") === "platform" && workspaceFor(trial, "deck") === "platform" && workspaceFor(admin, "deck") === "platform" && workspaceFor(paid, null) === "platform");
check("nobody switches", !canSwitch(paidAddon) && !canSwitch(trial) && !canSwitch(grant) && !canSwitch(paid) && !canSwitch(trialEnded));
check("a sign-in lands on the overview, whichever door", homeFor("deck") === "/dashboard" && homeFor("platform") === "/dashboard" && homeFor(null) === "/dashboard");

console.log("── the sign-up and the plan surfaces: the deck is an add-on on any plan");
const signupPlans = [
  { slug: "starter", features: ["Proposals"], priceCents: 4500 },
  { slug: "professional", features: ["Everything in Starter"], priceCents: 9500, highlight: true },
  { slug: "enterprise", features: ["Everything in Professional", "Deck Studio"], priceCents: 19900 },
];
const deckPick = autoPlanFor({ plans: signupPlans, tool: "deck" });
check("a deck ad never moves the sign-up off Professional, even onto a plan whose features name Deck Studio", deckPick?.slug === "professional" && deckPick?.why === "default", JSON.stringify(deckPick));
check("Deck Studio is an add-on tool: never marked on a plan's row, and the line says the trial includes it", isAddOnTool("deck") && !isAddOnTool("roof") && spotlightRow(["Deck Studio", "Roof estimator"], "deck") === null && spotlightRow(["Roof estimator"], "roof") === "Roof estimator" && spotlightBanner("deck", [{ slug: "starter", name: "Starter" }]) === "You came for Deck Studio — the trial includes it, then it's $79/month on any plan.");

console.log("── Before you go names the add-on when it is on the plan");
const withDeck = freePlanLosses({ pages: null, planProposals: null, freeProposals: 5, deckAddon: "$49/mo" });
const without = freePlanLosses({ pages: null, planProposals: null, freeProposals: 5 });
check("the add-on's line comes first, in the deck colour, and the list stays at five", withDeck[0]?.text === "Deck Studio — your $49/mo add-on ends with the plan" && withDeck[0]?.tone === "deck" && withDeck.length === 5, JSON.stringify(withDeck[0]));
check("without it, no Deck Studio line", !without.some((l) => /deck studio/i.test(l.text)));

console.log("── the deck workspace's sidebar");
const all = flattenNavItems(NAV_SECTIONS.flatMap((s) => s.items)).map((i) => i.href).filter((h) => h !== "#");
const kept = all.filter((h) => navAllowed("deck", h));
const dropped = all.filter((h) => !navAllowed("deck", h));
check("the studio keeps the office: proposals, clients, calendar, jobs, workers, financials, the deck estimator and its inventory", ["/dashboard/proposals", "/dashboard/clients", "/dashboard/calendar", "/dashboard/jobs", "/dashboard/workers", "/dashboard/financials", "/dashboard/deck-estimator", "/dashboard/deck-estimator/inventory", "/dashboard/subscription"].every((h) => kept.includes(h)), kept.join(" "));
check("and drops the other trades' tools: Smart Proposal, roof, fence, HVAC, video, the trade board", ["/dashboard/advanced-ai", "/dashboard/roof-estimator", "/dashboard/roof-estimator/inventory", "/dashboard/fence-estimator", "/dashboard/video-estimator", "/dashboard/hvac-estimator", "/dashboard/trade"].every((h) => dropped.includes(h)), dropped.join(" "));
check("a child route of a kept row is kept; the overview matches only itself", navAllowed("deck", "/dashboard/jobs/abc") && navAllowed("deck", "/dashboard/deck-estimator/inventory?tab=stock") && !navAllowed("deck", "/dashboard/roof-estimator/inventory") && navAllowed("platform", "/dashboard/roof-estimator"));
const ownerDeck = navSectionsFor("OWNER", [], [], { workspace: "deck", unlocked: [...unlockedByEdition("deck")] });
const ownerAll = navSectionsFor("OWNER", [], [], { workspace: "platform", unlocked: [...unlockedByEdition("deck")] });
const deckRow = (sections: typeof ownerDeck) => flattenNavItems(sections.flatMap((s) => s.items)).find((i) => i.href === "/dashboard/deck-estimator");
check("an owner's deck workspace has no roof row and the deck row no longer says Soon", !flattenNavItems(ownerDeck.flatMap((s) => s.items)).some((i) => i.href === "/dashboard/roof-estimator") && deckRow(ownerDeck)?.soon === false && deckRow(ownerDeck)?.children?.every((c) => c.soon === false) === true);
check("on the platform with the add-on the whole map stays and the deck row stops saying Soon", flattenNavItems(ownerAll.flatMap((s) => s.items)).some((i) => i.href === "/dashboard/roof-estimator") && deckRow(ownerAll)?.soon === false);
check("without a view the map is as it was: the deck row says Soon", deckRow(navSectionsFor("OWNER"))?.soon === true);
check("an estimator's deck workspace keeps proposals and the deck estimator only among the engines", (() => { const items = flattenNavItems(navSectionsFor("ESTIMATOR", [], [], { workspace: "deck" }).flatMap((s) => s.items)).map((i) => i.href); return items.includes("/dashboard/proposals") && items.includes("/dashboard/deck-estimator") && !items.includes("/dashboard/roof-estimator") && !items.includes("/dashboard/advanced-ai"); })());

console.log("── the doors' sign-up links");
check("the deck door's link carries the trade and the edition", registerHref("deck") === "/auth/register?industry=decking&edition=deck" && registerHref("deck", { utm_source: "fb" }) === "/auth/register?industry=decking&edition=deck&utm_source=fb");
check("the platform door's link is plain", registerHref("platform") === "/auth/register");
check("the editions name their homes and landings", EDITIONS.deck.homeHref === "/dashboard/deck-estimator" && EDITIONS.deck.landingPath === "/deck" && EDITIONS.platform.homeHref === "/dashboard");

console.log("── the annual deal in words (owner, 2026-10-11: months free, never a percentage; 2026-10-12: whole months or no stamp)");
check("$890 a year on $89 a month is 2 months free", dealWords(annualDeal(8900, 89000)) === "2 months free" && annualDeal(8900, 89000)?.monthsFree === 2);
check("$1,000 a year on $100 a month is 2 months free; $1,100 is one month", dealWords(annualDeal(10000, 100000)) === "2 months free" && dealWords(annualDeal(10000, 110000)) === "1 month free");
check("a year that is not a whole number of months off gets no stamp, not a percentage — only the dollars", annualDeal(8900, 95000)?.monthsFree === null && dealWords(annualDeal(8900, 95000)) === "" && savedWords(annualDeal(8900, 95000)) === "You save $118");
check("no yearly price, a dearer year, or a free plan: no deal", annualDeal(8900, null) === null && annualDeal(8900, 106800) === null && annualDeal(8900, 120000) === null && annualDeal(0, 1000) === null);

console.log("── THE ADD-ON (lib/deckAddon)");
check("$79 a month; $790 a year (ten months for twelve, the custom plan's rule) — owner, 2026-10-26", DECK_ADDON_CENTS === 7900 && deckAddonCents("MONTH") === 7900 && deckAddonCents("YEAR") === 79000 && deckAddonPriceWords("MONTH") === "$79/month" && deckAddonPriceWords("YEAR") === "$790/year" && deckAddonShortWords("MONTH") === "$79/mo" && deckAddonShortWords("YEAR") === "$790/yr");
check("the trial's words, as the owner wrote them", deckTrialWords() === "Included in your trial. After the trial, Deck Studio is a $79/mo add-on." && deckTrialWords("YEAR") === "Included in your trial. After the trial, Deck Studio is a $790/yr add-on." && DECK_PICK_TRIAL_WORDS === "Included in your trial, billed after it");
check(
  "a line bought at $49 keeps its words, marked \"your price\"; today's price is not marked; no price read says today's",
  deckAddonHeldWords(4900) === "$49/mo (your price)" && deckAddonHeldWords(49000, "YEAR") === "$490/yr (your price)" && deckAddonHeldWords(7900) === "$79/mo" && deckAddonHeldWords(null) === "$79/mo" && deckAddonHeldWords(4900, "MONTH", { long: true }) === "$49/month (your price)" && deckAddonHeldWords(4900, "MONTH", { mark: false }) === "$49/mo",
);
const planItem = { id: "si_plan", price: { id: "price_pro", metadata: { planSlug: "professional" } } };
const addonItem = { id: "si_deck", price: { id: "price_deck", metadata: { jfKind: "deck-addon", interval: "MONTH" } } };
const pageItem = { id: "si_page", price: { id: "price_page", metadata: { jfKind: "custom-page" } } };
check("the add-on's line is told by its price's kind; the plan's line is never the add-on, whichever comes first", isDeckAddonLine(addonItem) && !isDeckAddonLine(planItem) && !isDeckAddonLine(pageItem) && !isDeckAddonLine(null) && planLine([addonItem, planItem])?.id === "si_plan" && planLine([planItem, addonItem])?.id === "si_plan" && planLines([planItem, pageItem, addonItem]).map((i) => i.id).join() === "si_plan,si_page");
check("a line that is all there is stays the plan's line (nothing else to read)", planLine([addonItem])?.id === "si_deck" && planLine([]) === undefined);
const rec = parseDeckAddonRecord(JSON.stringify({ subId: "sub_1", itemId: "si_deck", interval: "MONTH", since: "2026-10-19T00:00:00Z" }));
check("a record reads back; a broken one reads as none", rec?.subId === "sub_1" && rec.itemId === "si_deck" && parseDeckAddonRecord("{") === null && parseDeckAddonRecord(JSON.stringify({ subId: "sub_1" })) === null && parseDeckAddonRecord(null) === null);
check(
  "a record carries the price its line bills (2026-10-26); one from before has none — read off the line once",
  rec?.cents === undefined && parseDeckAddonRecord(JSON.stringify({ subId: "sub_1", itemId: "si_deck", interval: "MONTH", since: "", cents: 4900 }))?.cents === 4900 && parseDeckAddonRecord(JSON.stringify({ subId: "sub_1", itemId: "si_deck", cents: "x" }))?.cents === undefined,
);
check("a grandfathered $49 line is still the add-on: told by its kind, never by its amount", isDeckAddonLine({ price: { unit_amount: 4900, metadata: { jfKind: "deck-addon" } } } as never) && !isDeckAddonLine({ price: { unit_amount: 7900, metadata: { jfKind: "professional" } } } as never));
check("the record holds only on the subscription it was bought on", addonHeld(rec, "sub_1") && !addonHeld(rec, "sub_2") && !addonHeld(rec, null) && !addonHeld(null, "sub_1"));

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
