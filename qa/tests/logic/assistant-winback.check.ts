// BRING CLIENTS BACK — the AI Operator's six tools (Smart CRM part 6, 2026-11-10): registered with their rules.
// Reading a list and the campaigns only reads; drafting, sending, stopping and house facts are writes that are read
// back first (none is instant); sending is a message, never money, so no PIN; and all six are the owner's and the
// managers' alone, like the Win back tab.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant-winback.check.ts
import "../_lib/_server-only";
import { TOOLS } from "../../../src/lib/assistant/tools";
import { CAPABILITIES, roleAllows } from "../../../src/lib/assistant/roles";
import { needsPin } from "../../../src/lib/assistant/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const NEW = ["client_list", "campaigns", "draft_campaign", "send_campaign", "stop_campaign", "set_house_facts"];
const byName = new Map(TOOLS.map((t) => [t.name, t]));
check("the six win-back tools are registered", NEW.every((n) => byName.has(n)), NEW.filter((n) => !byName.has(n)));
check("all six ask for the campaign permission", NEW.every((n) => byName.get(n)?.need === "clients.campaign") && (CAPABILITIES as readonly string[]).includes("clients.campaign"));
check("reading a list and the campaigns only reads", ["client_list", "campaigns"].every((n) => byName.get(n)!.kind === "read" && byName.get(n)!.card.effect === "read"));
const effect = (n: string) => byName.get(n)!.card.effect;
check("the four writes: a draft, a message, and two records", byName.get("draft_campaign")!.kind === "write" && effect("draft_campaign") === "draft" && effect("send_campaign") === "message" && effect("stop_campaign") === "record" && effect("set_house_facts") === "record", NEW.map((n) => `${n}:${effect(n)}`));
check("nothing here is done without a yes: no tool is instant", NEW.every((n) => !(byName.get(n)!.card as { instant?: boolean }).instant));
check("sending a campaign is not money and never asks for the PIN", NEW.every((n) => effect(n) !== "money" && !needsPin(n)));
check("owners, admins and managers may", ["OWNER", "ADMIN", "MANAGER"].every((r) => roleAllows(r, "clients.campaign")));
check("estimators, sales reps and the crew may not", ["ESTIMATOR", "SALES", "INSTALLER"].every((r) => !roleAllows(r, "clients.campaign")), ["ESTIMATOR", "SALES", "INSTALLER"].filter((r) => roleAllows(r, "clients.campaign")));
check("each tool says what it does in the people group", NEW.every((n) => byName.get(n)!.card.group === "people" && byName.get(n)!.description.length > 40));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
