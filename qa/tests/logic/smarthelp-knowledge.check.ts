// SmartHelp's knowledge: the support handbook's customer-facing cut — every "### Internal — for the team" block gone,
// nothing of the code map, file paths or env var names left, every customer section kept — and the areas the
// handbook was brought up to date with (2026-10-29). Pure: no model, no database.
//   NODE_PATH="" npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/smarthelp-knowledge.check.ts
import { customerHandbook, withoutInternal } from "../../../src/lib/smarthelp/knowledge";
import { SUPPORT_HANDBOOK } from "../../../src/lib/support/handbook";

let bad = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${!ok && extra !== undefined ? ` :: ${JSON.stringify(extra)}` : ""}`);
}

const INTERNAL = "### Internal — for the team (not for customers)";
const cut = customerHandbook();
/** Any ALL_CAPS_WITH_UNDERSCORES token of two or more parts — an env var (OPENAI_API_KEY, TRIAL_REQUIRES_CARD,
 *  STRIPE_ALLOW_LIVE_WRITES) or a code constant. No allow-list: the customer text carries none (2026-10-29); a real
 *  customer-facing one would be named here. */
const CAPS_NAME = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;
const CAPS_NAMES = new RegExp(CAPS_NAME.source, "g"); // only to list them when the check fails
/** A code path — src/, lib/, actions/, components/, app/, prisma/ — never right after a word or a dot, so a link like
 *  jobflex.app/estimate/… is not one. */
const CODE_PATH = /(?<![\w.])(src|lib|actions|components|app|prisma)\//;
const headings = (md: string, level: number) => md.split("\n").filter((l) => l.startsWith("#".repeat(level) + " ")).map((l) => l.trim());

// ── The cut itself, on a small handbook ─────────────────────────────────────
const sample = [
  "## One",
  "",
  "### Kept",
  "Customer words.",
  "",
  INTERNAL,
  "**Code map** src/lib/x.ts",
  "- Env: SOME_API_KEY",
  "",
  "### After",
  "More customer words.",
  "",
  INTERNAL,
  "lib/y.ts",
  "",
  "## Two",
  "Second section.",
].join("\n");
const sampleCut = withoutInternal(sample);
check("an Internal block goes up to the next ### heading, and the heading after it stays", !sampleCut.includes("src/lib/x.ts") && sampleCut.includes("### After\nMore customer words."), sampleCut);
check("…and up to the next ## heading, which stays", !sampleCut.includes("lib/y.ts") && sampleCut.includes("## Two\nSecond section."), sampleCut);
check("…the customer words before it stay", sampleCut.includes("### Kept\nCustomer words."), sampleCut);
check("…no Internal heading and no env name left", !sampleCut.includes("Internal —") && !/SOME_API_KEY/.test(sampleCut), sampleCut);
check("…and no run of blank lines where a block was", !/\n{3,}/.test(sampleCut), sampleCut);
check("a text with no Internal block comes back as it was", withoutInternal("## A\n\nText.\n\n### B\nMore.") === "## A\n\nText.\n\n### B\nMore.");

// ── The guards themselves ───────────────────────────────────────────────────
check("the env-name guard catches every shape of env name", ["OPENAI_API_KEY", "TRIAL_REQUIRES_CARD", "STRIPE_ALLOW_LIVE_WRITES", "CRON_SECRET", "SMTP_HOST", "Set TWILIO_JOBFLEX_FROM."].every((s) => CAPS_NAME.test(s)));
check("…but not ordinary capitals", !["AI desk", "HVAC", "PRO-1042", "ACCA-approved", "NEW badge", "USD"].some((s) => CAPS_NAME.test(s)));
check("the path guard catches src/, lib/, actions/, components/, app/, prisma/", ["src/x", "in lib/sms", "actions/billing", "components/v3/x", "app/dashboard/x", "(app/api)", "prisma/seed.ts"].every((s) => CODE_PATH.test(s)));
check("…but not a JobFlex link", !["https://jobflex.app/dashboard/upgrade", "jobflex.app/estimate/<your handle>/roof", "www.jobflex.app/"].some((s) => CODE_PATH.test(s)));

// ── The real handbook's cut ─────────────────────────────────────────────────
check("the cut is a real handbook, smaller than the whole", typeof cut === "string" && cut.length > 20_000 && cut.length < SUPPORT_HANDBOOK.length, cut.length);
check("the cut is the same every call", customerHandbook() === cut);
check("no Internal block left", !cut.includes("### Internal —") && !cut.includes("for the team (not for customers)"));
check("…while the client Notes hint stays word for word as the screen shows it", cut.includes('Notes "Internal — never printed on a proposal."'));
check("no code map", !cut.includes("Code map"));
check("no file paths: src/, lib/, actions/, components/, app/, prisma/", !CODE_PATH.test(cut), [cut.match(new RegExp(".{0,40}" + CODE_PATH.source + ".{0,40}"))?.[0]]);
check("no env var names or code constants", !CAPS_NAME.test(cut), cut.match(CAPS_NAMES)?.slice(0, 5));
check("no personal addresses — only JobFlex's own", (cut.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/gi) ?? []).every((e) => /@(jobflex\.app|example\.com)$/i.test(e)));
check("every section of the handbook is kept", headings(SUPPORT_HANDBOOK, 2).every((h) => cut.includes(h)) && cut.includes("## Accounts & access"), headings(SUPPORT_HANDBOOK, 2).filter((h) => !cut.includes(h)));
const customerSubs = headings(SUPPORT_HANDBOOK, 3).filter((h) => h !== INTERNAL);
check("every customer subsection is kept", customerSubs.every((h) => cut.includes(h)), customerSubs.filter((h) => !cut.includes(h)));
check("the whole handbook still carries its Internal blocks for the support AI", SUPPORT_HANDBOOK.split(INTERNAL).length - 1 === headings(SUPPORT_HANDBOOK, 2).length);

// ── What shipped since 2026-10-15, now in the customer text ─────────────────
check("website estimators: the pane, its five trades and where the requests land", cut.includes("Website estimators") && cut.includes("Your estimators on your website") && cut.includes("Roof estimator on your website") && cut.includes("From your website estimator"));
check("Lead Center leads priced by the homeowner", cut.includes("Priced by the homeowner"));
check("the AI desk: Describe your business, the trade presets, booking hours", cut.includes("Describe your business") && cut.includes("Preset the desk") && cut.includes("Only hours we reserve") && cut.includes("AI desk hours"));
check("Deck Studio from a photo", cut.includes("Deck Studio") && cut.includes("Build the house from a photo") && cut.includes("Build my house"));
check("the Deck Studio add-on's price as the code has it", cut.includes("$79/mo"));
check("the AI desk setup's own page", cut.includes("AI desk setup"));
check("cancelling goes through Manage subscription", cut.includes("Manage subscription"));
check("HVAC sizing is Manual J-style", cut.includes("Manual J-style"));

process.exit(bad ? 1 : 0);
