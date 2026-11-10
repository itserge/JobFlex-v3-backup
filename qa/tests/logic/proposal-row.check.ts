// THE PROPOSAL ROW AND SALES COMMISSION — the rules (2026-11-10, the ProSmart gaps plan, part 4), on made-up values.
//   NODE_PATH="" npx tsx --tsconfig tsconfig.json qa/tests/logic/proposal-row.check.ts

import { callFirstWords, cancelWarnings, cleanPct, cleanReason, commissionOf, commissionWords, effectivePct, isSold } from "@/lib/proposalRow/shared";

let bad = 0;
function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// ── which percent ──
check("a deal's own percent wins over the rep's", effectivePct(10, 8) === 10);
check("no deal percent: the rep's", effectivePct(null, 8) === 8);
check("neither, or zero: no commission", effectivePct(null, null) === null && effectivePct(0, null) === null && effectivePct(null, 0) === null);

// ── earned when collected, before tax ──
const c1 = commissionOf({ pct: 8, collected: 1100, contract: 3300, revenue: 3000 });
check("8% on a $3,000 job with $300 tax, $1,100 collected: $80 earned of $240", c1.earned === 80 && c1.full === 240, c1);
const c2 = commissionOf({ pct: 8, collected: 3300, contract: 3300, revenue: 3000 });
check("paid in full: the whole commission", c2.earned === 240 && c2.full === 240, c2);
check("nothing collected: nothing earned, the whole still shown", commissionOf({ pct: 8, collected: 0, contract: 3300, revenue: 3000 }).earned === 0);
check("an overpayment never earns past the whole", commissionOf({ pct: 10, collected: 5000, contract: 3300, revenue: 3000 }).earned === 300);
check("no tax: collected is all revenue", commissionOf({ pct: 5, collected: 1000, contract: 2000, revenue: 2000 }).earned === 50);
check("no percent or no contract: zero", commissionOf({ pct: null, collected: 100, contract: 100, revenue: 100 }).full === 0 && commissionOf({ pct: 5, collected: 0, contract: 0, revenue: 0 }).full === 0);
check("the chip's words", commissionWords(8, c1, usd) === "8% · $80 earned of $240" && commissionWords(null, c1, usd) === null);

// ── the office's percent ──
check("blank or 0 clears it", cleanPct(null) === null && cleanPct(0) === null);
check("two decimals", cleanPct(7.555) === 7.56);
check("over 100 or negative is refused in words", (() => {
  try {
    cleanPct(120);
    return false;
  } catch (e) {
    return /0 to 100/.test(String(e));
  }
})() && (() => {
  try {
    cleanPct(-1);
    return false;
  } catch {
    return true;
  }
})());

// ── sold, cancel ──
check("sold is accepted, completed or paid", isSold("ACCEPTED") && isSold("COMPLETED") && isSold("PAID") && !isSold("SENT") && !isSold("DECLINED"));
const w = cancelWarnings({ collected: 960, openInvoices: 1, installDays: 2, fmt: usd });
check("cancel says what it will do: the invoice, the install days, the money in", w.length === 4 && /1 invoice is out/.test(w[1]) && /2 install days are on the calendar/.test(w[2]) && /\$960 was already collected/.test(w[3]), w);
check("a quiet cancel says only the first line", cancelWarnings({ collected: 0, openInvoices: 0, installDays: 0, fmt: usd }).length === 1);
check("reasons: trimmed, one line, 300 at most, blank is none", cleanReason("  Went  with\n another ") === "Went with another" && cleanReason("   ") === null && (cleanReason("x".repeat(400)) ?? "").length === 300);

// ── call the rep first ──
check("call first: the first name and the phone", callFirstWords({ name: "Nelly Walk", phone: "(425) 555-0101" }) === "Call Nelly first · (425) 555-0101");
check("no phone: the name alone; no rep: nothing", callFirstWords({ name: "Nelly Walk", phone: null }) === "Call Nelly first" && callFirstWords(null) === null && callFirstWords({ name: null, phone: "1" }) === null);

console.log(bad ? `\n${bad} FAILED` : "\nall ok");
process.exit(bad ? 1 : 0);
