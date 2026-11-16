// THE BASIC CRM AND SMART CRM, SEPARATE (owner, 2026-11-16: "the paid CRM and the basic CRM work separately, no
// conflicts") — lib/crm/smartAccess on made-up plans, plus the gate's own answer for every kind of plan it can meet
// (lib/toolPlans/shared toolsPagesOpen, the ids lib/customPlan says are Smart CRM's). No database.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/crm-basic-vs-smart.check.ts

import { SMART_CRM_OPEN, agentChoicesShown, smartOffer, smartTabsShown, waitsInQueueNote, type SmartCrmAccess } from "@/lib/crm/smartAccess";
import { isPaidFeature, pageForPath } from "@/lib/customPlan";
import { emptyToolsRecord, toolsPagesOpen, type ToolsRecord } from "@/lib/toolPlans/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const DAY = 86_400_000;
const now = new Date("2026-11-16T18:00:00Z");
const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();

// The four kinds of "closed" a screen can be told, and open.
const open: SmartCrmAccess = SMART_CRM_OPEN;
const toolsOwner: SmartCrmAccess = { open: false, tools: true, ended: false, owner: true };
const toolsMember: SmartCrmAccess = { ...toolsOwner, owner: false };
const endedOwner: SmartCrmAccess = { open: false, tools: false, ended: true, owner: true };
const endedMember: SmartCrmAccess = { ...endedOwner, owner: false };
const toolsEnded: SmartCrmAccess = { open: false, tools: true, ended: true, owner: true };
const unreadable: SmartCrmAccess = { open: false, tools: false, ended: false, owner: true };

console.log("── which pages are Smart CRM's");
check("the Inbox and the Pipeline are Smart CRM's pages", pageForPath("/dashboard/inbox")?.id === "smart-crm" && pageForPath("/dashboard/pipeline")?.id === "smart-crm");
check("the CRM sheet, its rules and queue, Clients, a client's page and the import are the basic workspace", ["/dashboard/crm", "/dashboard/crm/workflows", "/dashboard/crm/queue", "/dashboard/clients", "/dashboard/client-detail", "/dashboard/clients/import"].every((p) => pageForPath(p) === null));
check("Smart CRM is a paid feature (open on every live Classic plan)", isPaidFeature("smart-crm"));

console.log("── the new plans: who holds Smart CRM");
const basic = (patch: Partial<ToolsRecord> = {}): ToolsRecord => ({ ...emptyToolsRecord("basic", "roof"), ...patch });
const has = (r: ToolsRecord | null, slug: string) => toolsPagesOpen(r, slug, now).has("smart-crm");
check("Basic + Roof: no", !has(basic(), "tools-basic"));
check("Basic with no record at all: no", !has(null, "tools-basic"));
check("Professional + Deck Studio: no", !has(emptyToolsRecord("professional", "deck"), "tools-professional"));
check("Basic + Smart CRM on a free try: yes", has(basic({ tries: { smartcrm: { startedAt: iso(-DAY), endsAt: iso(2 * DAY), onLine: false } } }), "tools-basic"));
check("…the try over and not billed: no", !has(basic({ tries: { smartcrm: { startedAt: iso(-4 * DAY), endsAt: iso(-DAY), onLine: false, failedAt: iso(-DAY) } } }), "tools-basic"));
check("Basic + Smart CRM bought: yes", has(basic({ lines: { smartcrm: { itemId: "si_x", cents: 3900, since: iso(-9 * DAY) } } }), "tools-basic"));
check("removed, the paid month not over: yes — removed, the month over: no", has(basic({ closing: { smartcrm: iso(5 * DAY) } }), "tools-basic") && !has(basic({ closing: { smartcrm: iso(-DAY) } }), "tools-basic"));
check("signed up from the CRM ad (Smart CRM the main tool): yes", has(emptyToolsRecord("basic", "smartcrm"), "tools-basic"));
check("Advanced and Complete: yes (the office tools come with them)", has({ ...emptyToolsRecord("advanced", "roof"), chosenTrade: ["roof", "fence"] }, "tools-advanced") && has(emptyToolsRecord("complete", null), "tools-complete"));

console.log("── the CRM sheet's Inbox and Pipeline tabs");
check("open: drawn", smartTabsShown(open));
check("a new-plan shop without the tool: left out (no locks — its menu leaves them out too)", !smartTabsShown(toolsOwner) && !smartTabsShown(toolsMember));
check("a plan that ended, Classic or new: drawn — they lead to the plan-ended page, as the menu rows do", smartTabsShown(endedOwner) && smartTabsShown(toolsEnded));

console.log("── the follow-up rule editor");
check("the agent's choices only with Smart CRM", agentChoicesShown(open) && [toolsOwner, toolsMember, endedOwner, unreadable].every((a) => !agentChoicesShown(a)));
check("a rule set to wait, without Smart CRM, says where it waits", waitsInQueueNote() === "This rule waits for your OK in the Follow-up queue — press Send there.");
check("…the phone names its own tab", waitsInQueueNote("Due") === "This rule waits for your OK on the Due tab — press Send there.");

console.log("── the Smart CRM card (Win back, the pulse, the client 360)");
const tOwner = smartOffer(toolsOwner, "winback");
check("a new-plan owner: what it does, the price, and Upgrade your plan → the tools section", tOwner.title === "Bring clients back" && tOwner.price && tOwner.why === null && tOwner.button?.href === "/dashboard/subscription#tools" && tOwner.button.label === "See it in Upgrade your plan" && tOwner.note === null);
const tMember = smartOffer(toolsMember, "client");
check("someone else in that shop: no price, no button — ask the owner", !tMember.price && tMember.button === null && /owner/.test(tMember.note ?? ""));
const eOwner = smartOffer(endedOwner, "pulse");
check("a plan that ended: says so, See plans, no price", eOwner.why === "Your plan has ended, so Smart CRM is closed." && eOwner.button?.href === "/dashboard/subscription" && !eOwner.price);
check("…a new-plan shop whose plan ended is told the same (not offered a tool on a dead plan)", smartOffer(toolsEnded, "winback").why === eOwner.why && !smartOffer(toolsEnded, "winback").price);
check("…and someone else there is told to ask the owner", smartOffer(endedMember, "winback").button === null && /owner/.test(smartOffer(endedMember, "winback").note ?? ""));
check("an unreadable plan: closed, plainly, with the way to the plans", smartOffer(unreadable, "client").why === "Smart CRM isn't on your plan." && smartOffer(unreadable, "client").button?.href === "/dashboard/subscription");
check("every place has its own title and line", new Set(["winback", "pulse", "client"].map((p) => smartOffer(toolsOwner, p as "winback").title)).size === 3);
check("no card words promise a free try (a shop that tried may not get another)", ["winback", "pulse", "client"].every((p) => !/free/i.test(JSON.stringify(smartOffer(toolsOwner, p as "winback")))));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
