// SmartHelp · THE AI ANSWER — what the model reads, the answer it must return, and what of that answer the panel may
// show. Pure: no model call, no database (the call, the limits and the log are Task 5's lib/smarthelp/server.ts).
//
// ONE SYSTEM MESSAGE FOR EVERYONE. smartHelpSystemPrompt() is the rules, the pages and Show me targets an answer may
// use, the guides and the customer handbook: the same bytes for every person and every question, so OpenAI's
// automatic prompt caching reuses the long prefix. Everything about the person — page, role, plan, setup facts, the
// conversation, the question — goes in smartHelpUserPrompt() only.
//
// THE MODEL IS NOT TRUSTED WITH THE SCREEN. cleanAnswer() drops an Open that is not a SmartHelp page and a Show me
// that is not a known target (the step's words stay), keeps a role- or plan-blocked step's words but not its
// buttons, gives no steps below CONFIDENCE_MIN, and turns an answer that commits money or data — or names the buttons
// that cancel or delete — into "Ask a person".
//
// PERSON TOPICS ARE CAUGHT TWICE: personTopic() (./personTopic, re-exported here) before the model, so no call is
// made; and after it the model's own kind "person" plus commitsMoneyOrData and the cancel/delete buttons on everything
// it wrote. The topics are the support AI's own (PERSON_ONLY_TOPICS, lib/support/aiReply) — shared, not copied.
import { z } from "zod";
import { NAV_SECTIONS, flattenNavItems } from "@/components/v3/blueprint-shell/nav-map";
import { PERSON_ONLY_TOPICS, commitsMoneyOrData } from "@/lib/support/aiReply";
import { GUIDES, GUIDE_TARGETS } from "./guides";
import { customerHandbook } from "./knowledge";
import { HELP_PAGES, isHelpPage, pathOf } from "./pages";
import { PERSON_REPLY, type PersonTopic } from "./personTopic";
import type { HelpContext, HelpStep, SetupKey, StepView } from "./types";
import { stepView } from "./view";

export { PERSON_REPLY, personTopic, type PersonTopic } from "./personTopic";

/** Below this the panel shows no steps, only "Ask a person". */
export const CONFIDENCE_MIN = 60;
/** The turns of the conversation the model reads. */
export const HISTORY_TURNS = 6;
const STEPS_MAX = 8;

/** The line an answer shows when the model was not sure enough to give steps. */
export const UNKNOWN_REPLY = "I'm not sure about this one — rather than guess, press Ask a person and our team will answer.";

// ── The answer the model returns ─────────────────────────────────────────────

const KINDS = ["steps", "explain", "person", "unknown"] as const;
const text = (max: number) =>
  z
    .string()
    .catch("")
    .transform((s) => s.trim().slice(0, max));
const optText = (max: number) =>
  z
    .string()
    .nullish()
    .catch(null)
    .transform((s) => s?.trim().slice(0, max) || undefined);
const stepSchema = z.object({ text: text(400), open: optText(300), show: optText(120) });

/** Steps as far as they are steps: a bare string is a step's text, anything without text is dropped, at most 8. */
function mendSteps(items: unknown[]): HelpStep[] {
  const out: HelpStep[] = [];
  for (const item of items) {
    const r = stepSchema.safeParse(typeof item === "string" ? { text: item } : item);
    if (!r.success || !r.data.text) continue;
    const { text: words, open, show } = r.data;
    out.push({ text: words, ...(open ? { open } : {}), ...(show ? { show } : {}) });
    if (out.length === STEPS_MAX) break;
  }
  return out;
}

/** Mended, never refused: an unknown kind is "unknown", junk steps are no steps, long text is clipped. */
export const smartHelpAnswerSchema = z.object({
  language: z
    .string()
    .catch("en")
    .transform((s) => s.trim().slice(0, 20) || "en"),
  kind: z.enum(KINDS).catch("unknown"),
  title: text(120),
  steps: z.array(z.unknown()).catch([]).transform(mendSteps),
  note: z
    .string()
    .nullish()
    .catch(null)
    .transform((s) => s?.trim().slice(0, 600) || null),
  confidence: z
    .number()
    .catch(50)
    .transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
});
export type SmartHelpAnswer = z.infer<typeof smartHelpAnswerSchema>;

export type SmartHelpReply = { kind: (typeof KINDS)[number]; title: string; steps: StepView[]; note: string | null };

// ── What the panel may show ──────────────────────────────────────────────────

/** The sidebar rows SmartHelp may light, href → label. Admin-preview rows are drawn for a few accounts only: left out. */
function sidebarRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const item of NAV_SECTIONS.flatMap((s) => flattenNavItems(s.items))) {
    if (!item.preview && item.href !== "#" && !rows.has(item.href)) rows.set(item.href, item.label);
  }
  return rows;
}

let targetsMemo: ReadonlySet<string> | null = null;

/** Every Show me an answer may carry: the guides' targets, and `nav:<path>` for each SmartHelp page drawn as a row. */
export function helpTargets(): ReadonlySet<string> {
  if (!targetsMemo) {
    const rows = sidebarRows();
    targetsMemo = new Set([...GUIDE_TARGETS, ...HELP_PAGES.filter((p) => rows.has(p.path)).map((p) => `nav:${p.path}`)]);
  }
  return targetsMemo;
}

/** Guide targets whose guide step names no page: "Save & send" sits on the proposal draft
 *  (components/v3/manual-card-lab/manual-blueprint), which every estimator's proposal button opens. */
const TARGET_HOME: Readonly<Record<string, string>> = { "proposal-send": "/dashboard/manual-blueprint" };

let targetPagesMemo: Map<string, { page?: string; guide: string }> | null = null;

/** Where each guide target lives: the page its guide step opens, else the last page that guide opened before it. */
function guideTargetPages(): Map<string, { page?: string; guide: string }> {
  if (!targetPagesMemo) {
    targetPagesMemo = new Map();
    for (const g of GUIDES) {
      let page: string | undefined;
      for (const s of g.steps) {
        page = s.open ?? page;
        if (s.show && !targetPagesMemo.has(s.show)) targetPagesMemo.set(s.show, { page: TARGET_HOME[s.show] ?? page, guide: g.title });
      }
    }
  }
  return targetPagesMemo;
}

/** The page a Show me target is on: a sidebar row's own page, or the guide page that holds the target. */
export function targetPage(show: string): string | undefined {
  return show.startsWith("nav:") ? show.slice(4) : guideTargetPages().get(show)?.page;
}

/** The same page for Show me: a sidebar row by route (it is drawn on every page); a page target by its full link. */
function samePage(home: string, open: string, nav: boolean): boolean {
  return nav ? pathOf(home) === pathOf(open) : home.split("#")[0] === open.split("#")[0];
}

/** The buttons of the person-only flows — an answer naming them is giving those steps: the account's delete button
 *  (data), the cancel and downgrade buttons (leaving), and the cancel window's trial extension (money — a free-time
 *  request, as personTopic files trial extensions). */
const DELETE_BUTTONS = /\b(Delete my account|Delete account)\b/;
const CANCEL_BUTTONS = /\b(Cancel subscription|Continue to cancel|Downgrade)\b/;
const EXTENSION_BUTTON = /\bRequest a trial extension\b/;
const DELETE_WORDS = /\b(delete|deleted|erase|erased|remove|removed) your (account|data|company)\b/i;

/** What a guarded answer is about, if it commits money or data or names a person-only flow's button. */
function guardTopic(words: string): PersonTopic | null {
  if (DELETE_BUTTONS.test(words) || (DELETE_WORDS.test(words) && commitsMoneyOrData(words))) return "data";
  if (CANCEL_BUTTONS.test(words)) return "leaving";
  if (EXTENSION_BUTTON.test(words) || commitsMoneyOrData(words)) return "money";
  return null;
}

function cleanStep(s: HelpStep, ctx: HelpContext, targets: ReadonlySet<string>): StepView {
  const open = s.open && isHelpPage(s.open) ? s.open : undefined;
  let show = s.show && targets.has(s.show) ? s.show : undefined;
  const home = show ? targetPage(show) : undefined;
  // A target on another page than the step's Open would light nothing there: the Show me goes, the Open stays.
  if (show && open && home && !samePage(home, open, show.startsWith("nav:"))) show = undefined;
  // The page the step's buttons lead to — the target's page (a sidebar row is its page), else the Open.
  const page = (show ? home : undefined) ?? open;
  const blocked = page ? stepView({ text: s.text, open: page }, ctx).blocked : undefined;
  if (blocked) return { text: s.text, blocked };
  return { text: s.text, ...(open ? { open } : {}), ...(show ? { show } : {}) };
}

/** The model's answer as the panel may show it. `targets` is helpTargets() (a parameter so a check can narrow it).
 *  A reply forced to "person" or "unknown" keeps the model's own title where it can — it is in the asker's language. */
export function cleanAnswer(a: SmartHelpAnswer, ctx: HelpContext, targets: ReadonlySet<string>): SmartHelpReply {
  const words = [a.title, a.note ?? "", ...a.steps.map((s) => s.text)].join("\n");
  const guarded = guardTopic(words);
  if (guarded) {
    // The model's title only when the model itself said person/unknown, and the title is not what tripped the guard.
    const own = (a.kind === "person" || a.kind === "unknown") && a.title && !guardTopic(a.title) ? a.title : null;
    return { kind: "person", title: own ?? PERSON_REPLY[guarded], steps: [], note: null };
  }
  if (a.kind === "person") return { kind: "person", title: a.title || PERSON_REPLY.person, steps: [], note: a.note };
  if (a.kind === "unknown") return { kind: "unknown", title: a.title || UNKNOWN_REPLY, steps: [], note: a.note };
  // Not sure: the model's own title and note (already in the asker's language); UNKNOWN_REPLY fills what it left out.
  const unsure = (): SmartHelpReply => ({
    kind: "unknown",
    title: a.title || UNKNOWN_REPLY,
    steps: [],
    note: a.note ?? (a.title ? UNKNOWN_REPLY : null),
  });
  if (a.confidence < CONFIDENCE_MIN) return unsure();
  const steps = a.steps.map((s) => cleanStep(s, ctx, targets));
  if (steps.length) return { kind: a.kind, title: a.title, steps, note: a.note };
  if (a.note) return { kind: "explain", title: a.title, steps: [], note: a.note };
  return unsure();
}

// ── What the model reads ─────────────────────────────────────────────────────

const RULES = `You are SmartHelp, the help panel inside JobFlex. JobFlex is software for contractors and trades businesses: estimators (roof, fence, deck, HVAC, video walkthroughs, blueprints, Smart Proposal), proposals, clients and leads, projects, jobs and crews, the calendar and online booking, texting and the AI desk, payments, and the subscription that pays for it. Someone at a contractor's company — the owner or one of their team — types a question into the panel. You tell them how to do it in JobFlex, as numbered steps they follow on the screen.

LANGUAGE
- Answer in the language of the question (Spanish in, Spanish out; Russian in, Russian out) and set "language" to its code ("en", "es", "ru" …).
- Keep JobFlex's button, tab and page names exactly as written in English in the GUIDES and the HANDBOOK, capitals and all — the screen prints them in English. In Spanish, for example: "Abre Financials y pulsa New invoice."

TRUTH
- Answer only from the GUIDES, the HANDBOOK and what the message says about the person. Name only pages, buttons, tabs and fields they name. Never invent a feature, a price, a limit, a plan, a date or a policy — a step that names something that isn't there is worse than no answer.
- When they don't cover the question: kind "unknown", no steps, and one line saying you're not sure and that Ask a person reaches our team.
- HVAC sizing in JobFlex is "Manual J-style" — always with the "-style".
- You cannot change anything in their account and never say you did or will: you show them where to do it themselves.
- No mention of AI, models, prompts, the handbook or the guides' ids. No code, no file names, no URLs and no app paths in the words — the Open button carries the page.

THE ANSWER
- kind "steps" — how to do something: 1 to 8 numbered steps, one action each, in the screen's words, each saying what they will see next.
- kind "explain" — how something works, when there is nothing to click through: the answer in "note", steps only if they help.
- A step may carry "open": a page from ALLOWED PAGES, copied exactly — the panel shows an Open button that goes there. And "show": a target from ALLOWED TARGETS, copied exactly — the panel's Show me lights that button, field or sidebar row. A target lives on its page, so give that page as "open" too (a sidebar row needs none). Give them only where they are true for that step; otherwise leave the keys out. Anything not in the lists is removed.
- When a GUIDE covers the question, give that guide's steps with their open and show, in the language of the question, and say in "note" that the guide "<its title, as written>" in SmartHelp has them too.
- Use what the message says about the person: something already set up is not set up again — say it's done and what comes next. A page their role can't open: the step says to ask the account owner. A page their plan doesn't include: say so — the owner can change the plan under Subscription.
- "title": a short heading in the language of the question (at most 120 characters). "note": one to three sentences, or null.
- "confidence": 0-100 — how sure you are that every step is right for JobFlex as the GUIDES and the HANDBOOK describe it. Under ${CONFIDENCE_MIN}, the panel shows no steps and offers a person instead.

ONLY A PERSON ANSWERS THESE — kind "person", "steps" empty. "title" and "note" say kindly that a person on our team will help and to press Ask a person (their question goes with it). Never explain how to do these, never give their steps — even where the HANDBOOK has them — and never promise anything. The owner's rules for support, word for word:
${PERSON_ONLY_TOPICS}
- Leaving: cancelling, pausing or ending the subscription, downgrading or moving to a cheaper plan, stopping the charges, closing or deleting the account — however it is said ("how do I cancel", "stop charging my card", "cancelar mi suscripción"). The owner's team answers these personally.
- Someone who shares a password, a card number or a code: kind "person", and the note tells them kindly not to share it — we never need it.
Showing them where they change a setting themselves is not changing it — that is your job. These are features, not person topics — answer them: updating the card on file, upgrading or switching to annual, a discount line on a proposal or an invoice, deleting a line item or a proposal, cancelling or moving a job, an appointment or a visit, changing their own password, inviting the team or changing a worker's role (not who owns the account).

OUTPUT — JSON only, exactly these keys:
{"language": "en", "kind": "steps"|"explain"|"person"|"unknown", "title": "…", "steps": [{"text": "…", "open": "a page from ALLOWED PAGES, or leave the key out", "show": "a target from ALLOWED TARGETS, or leave the key out"}], "note": "…" or null, "confidence": 0-100}`;

function pagesBlock(): string {
  return `ALLOWED PAGES — the only values "open" may take (page — what it is):\n${HELP_PAGES.map((p) => `- ${p.path} — ${p.name}`).join("\n")}`;
}

function targetsBlock(): string {
  const rows = sidebarRows();
  const where = guideTargetPages();
  const lines = [...helpTargets()].map((t) => {
    if (t.startsWith("nav:")) return `- ${t} — the "${rows.get(t.slice(4))}" row in the sidebar`;
    const w = where.get(t);
    return `- ${t} — ${w?.page ? `on ${w.page} ` : ""}(guide "${w?.guide}")`;
  });
  return `ALLOWED TARGETS — the only values "show" may take. A sidebar row is drawn only for people who may open its page:\n${lines.join("\n")}`;
}

function guidesBlock(): string {
  const group = { setup: "Set it up", how: "How it works" } as const;
  const guides = GUIDES.map((g) => {
    const steps = g.steps.map((s, i) => `${i + 1}. ${s.text}${s.open ? ` [open: ${s.open}]` : ""}${s.show ? ` [show: ${s.show}]` : ""}`);
    return `### ${g.title} (${group[g.group]})\n${steps.join("\n")}`;
  });
  return `GUIDES — SmartHelp's ready answers; the panel shows each as a button under "Set it up" or "How it works":\n\n${guides.join("\n\n")}`;
}

let systemMemo: string | null = null;

/** The whole system message — the same bytes for every person and question (prompt caching). */
export function smartHelpSystemPrompt(): string {
  if (systemMemo === null) {
    systemMemo = [
      RULES,
      pagesBlock(),
      targetsBlock(),
      guidesBlock(),
      `HANDBOOK — how JobFlex works, written from its code. The person never sees it; answer from it in your own words, keeping the screen's names:\n\n${customerHandbook()}`,
    ].join("\n\n");
  }
  return systemMemo;
}

const ROLE_WORDS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MANAGER: "Manager",
  ACCOUNTANT: "Accountant",
  SALES: "Sales",
  ESTIMATOR: "Estimator",
  INSTALLER: "Installer (crew)",
  USER: "Team member",
};

const SETUP_WORDS: ReadonlyArray<[key: SetupKey, label: string, done: string, todo: string]> = [
  ["profile", "Company profile", "complete", "not complete"],
  ["aiDesk", "AI desk", "set up", "not set up"],
  ["texting", "Texting", "number verified", "not set up"],
  ["payments", "Payments", "connected", "not connected"],
  ["booking", "Online booking", "on", "off"],
  ["website", "Website estimators", "on", "off"],
  ["team", "Team", "invited", "nobody invited yet"],
  ["proposalSent", "First proposal", "sent", "not sent yet"],
];

const clip = (s: string, max: number) => s.trim().slice(0, max);

/** One HELP_PAGES entry per route (the first, e.g. "AI desk" for every /dashboard/phone link). */
function helpRoutes(): Array<{ route: string; name: string }> {
  const seen = new Map<string, string>();
  for (const p of HELP_PAGES) if (!seen.has(pathOf(p.path))) seen.set(pathOf(p.path), p.name);
  return [...seen].map(([route, name]) => ({ route, name }));
}

function pageWords(page: string): string {
  const p = page.trim().slice(0, 200);
  const hit = HELP_PAGES.find((x) => x.path === p.split("#")[0]) ?? HELP_PAGES.find((x) => x.path === pathOf(p));
  return hit ? `${hit.name} (${p})` : p || "unknown";
}

/** The pages this person's role or plan keeps them from, in words. Nothing when every page is open to them. */
function accessLines(ctx: HelpContext): string[] {
  const routes = helpRoutes().map((r) => ({ ...r, blocked: stepView({ text: "", open: r.route }, ctx).blocked }));
  const lines: string[] = [];
  const roleOpen = routes.filter((r) => r.blocked !== "role");
  if (roleOpen.length < routes.length) {
    lines.push(`- Pages their role can open: ${roleOpen.map((r) => r.name).join(", ") || "none"} — for any other page, they ask the account owner.`);
  }
  const planOff = routes.filter((r) => r.blocked === "plan");
  if (planOff.length) lines.push(`- Pages their plan doesn't include: ${planOff.map((r) => r.name).join(", ")}`);
  return lines;
}

/** The person, the conversation so far (the last HISTORY_TURNS turns) and the question, as the model reads them. */
export function smartHelpUserPrompt(input: { question: string; history: Array<{ q: string; a: string }>; ctx: HelpContext }): string {
  const { ctx } = input;
  const person = [
    `- On the page: ${pageWords(ctx.page)}`,
    `- Role: ${ctx.role ? (ROLE_WORDS[ctx.role] ?? ctx.role) : "unknown"}`,
    `- Plan: ${ctx.plan?.trim() || "none on file"}`,
    ...accessLines(ctx),
    ...SETUP_WORDS.map(([key, label, done, todo]) =>
      (key === "booking" || key === "website") && !ctx.features[key]
        ? `- ${label}: not open to this account`
        : `- ${label}: ${ctx.setup[key] ? done : todo}`,
    ),
  ];
  const parts = [`THE PERSON (from their account, accurate now):\n${person.join("\n")}`];
  const turns = input.history.slice(-HISTORY_TURNS);
  if (turns.length) {
    parts.push(
      `EARLIER IN THIS CONVERSATION (oldest first — build on it, don't repeat it):\n${turns.map((t) => `Q: ${clip(t.q, 1000)}\nA: ${clip(t.a, 2000)}`).join("\n\n")}`,
    );
  }
  parts.push(`THE QUESTION:\n${input.question.trim().slice(0, 1000)}`);
  return parts.join("\n\n");
}
