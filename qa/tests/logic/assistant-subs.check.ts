// SUBCONTRACTORS, PART 6 — the AI Operator's tools for subs (2026-11-09): the nine are registered with their groups and
// effects; recording a payment to a sub is money (a yes and the PIN) and only owners and managers may; reading and the
// other writes follow the projects' own rules (estimators and managers write, SALES never; workers never).
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/assistant-subs.check.ts
import "../_lib/_server-only";
import { TOOLS } from "../../../src/lib/assistant/tools";
import { roleAllows } from "../../../src/lib/assistant/roles";
import { PIN_TOOLS, needsPin } from "../../../src/lib/assistant/shared";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? `  ${JSON.stringify(extra)}` : ""}`);
}

const NEW = ["find_subs", "sub_requests", "compare_quotes", "subs_budget", "sub_invoices", "sub_document", "remind_subs", "approve_sub_invoice", "pay_sub_invoice"];
const byName = new Map(TOOLS.map((t) => [t.name, t]));
check("the nine subs tools are registered", NEW.every((n) => byName.has(n)), NEW.filter((n) => !byName.has(n)));
const reads = ["find_subs", "sub_requests", "compare_quotes", "subs_budget", "sub_invoices", "sub_document"];
check("six of them only read, under the projects' read rule", reads.every((n) => byName.get(n)!.kind === "read" && byName.get(n)!.need === "projects.read"));
check("reminding and approving are writes under the projects' write rule", ["remind_subs", "approve_sub_invoice"].every((n) => byName.get(n)!.kind === "write" && byName.get(n)!.need === "projects.write"));
const pay = byName.get("pay_sub_invoice")!;
check("recording a payment is money: a write in the money group that needs the PIN", pay.kind === "write" && pay.card.effect === "money" && pay.card.group === "money" && pay.need === "subs.pay" && needsPin("pay_sub_invoice") && PIN_TOOLS.includes("pay_sub_invoice"));
check("approving and reminding never ask for the PIN", !needsPin("approve_sub_invoice") && !needsPin("remind_subs"));
check("owners, admins and managers may record a payment to a sub", ["OWNER", "ADMIN", "MANAGER"].every((r) => roleAllows(r, "subs.pay")));
check("estimators, sales and the crew may not", !roleAllows("ESTIMATOR", "subs.pay") && !roleAllows("SALES", "subs.pay") && !roleAllows("INSTALLER", "subs.pay"));
check("an estimator may approve an invoice and remind subs; sales may only read", roleAllows("ESTIMATOR", "projects.write") && !roleAllows("SALES", "projects.write"));

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
