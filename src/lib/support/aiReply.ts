// SUPPORT · THE AI ANSWER (owner, 2026-10-15: "in admin support … add smart AI
// that answers them automatically … from the JobFlex code and everywhere you
// know how everything is set up — plans, Stripe, payments, accounts, passwords
// … professional and friendly, they feel taken care of … copy every reply to
// our email … a bug: tell the user we're on it, we'll let them know when it's
// done — but don't fix anything on your own; ask in admin and email us, and we
// confirm").
//
// Pure: the instructions the model reads, the answer it must return, whether
// that answer may go out on its own, and the letters around it. The model call,
// the account facts, the sends and the store are lib/support/aiSupport.ts; the
// admin's switches are actions/supportAi.ts.
//
// WHAT GOES OUT BY ITSELF, AND WHAT WAITS
// An answer is sent when the switch says "answers on its own", the model is at
// least SEND_CONFIDENCE_MIN sure, did not ask for a person, and wrote nothing
// that commits money or data (a refund, a credit, a deleted account) — those
// are the owner's to say — unless it is a SmartHelp hand-off ("Ask a person":
// a person sends that one). Anything else is HELD: the customer gets a short
// "we've got it, a person is on it" note at once, and the AI's full draft
// waits in admin for a person to send or rewrite. Every outcome — sent, held,
// drafted — is copied to the support inbox.
//
// A BUG is answered (thanks, our engineers have it, we'll email when it's
// fixed, a workaround if there is one) and carries a FIX PROPOSAL for the team:
// symptoms, likely cause, the change a developer would make, where in the
// code. Nothing is changed by the AI. The proposal waits in admin for Approve
// or Decline; "Mark fixed" later tells the customer.

import { z } from "zod";
import { trialExtensionEligible } from "@/lib/trialExtension";
import { SUPPORT_HANDBOOK } from "./handbook";
import {
  SEVERITIES,
  SUPPORT_AI_CATEGORIES,
  SUPPORT_AI_CATEGORY_LABEL,
  type SupportAiBug,
  type SupportAiFix,
  type SupportAiMode,
  type SupportAiOutcome,
  type SupportAiRecord,
} from "./aiState";

// The client-safe half (the switch, the record, the badges, the Help window's
// live state) lives in ./aiState so a browser bundle never carries the handbook.
export * from "./aiState";

// ── The answer the model returns ─────────────────────────────────────────────

const clip = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const clipOpt = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => {
      const t = s?.trim().slice(0, max);
      return t ? t : undefined;
    });

export const supportAiBugSchema = z.object({
  title: clip(140),
  symptoms: clip(1200),
  likelyCause: clip(1500),
  proposedFix: clip(2500),
  areas: z
    .array(z.string())
    .default([])
    .transform((a) => a.map((x) => x.trim().slice(0, 160)).filter(Boolean).slice(0, 10)),
  severity: z.enum(SEVERITIES).catch("normal"),
  workaround: clipOpt(800),
});

/** Free text is clipped, never refused — one long sentence must not lose the answer. */
export const supportAiAnswerSchema = z.object({
  language: z.string().default("en").transform((s) => s.trim().slice(0, 20) || "en"),
  category: z.enum(SUPPORT_AI_CATEGORIES).catch("other"),
  summary: clip(200),
  confidence: z.number().catch(50).transform((n) => Math.max(0, Math.min(100, Math.round(n)))),
  needsHuman: z.boolean().catch(false),
  humanReason: clipOpt(300),
  reply: clip(4000),
  internalNotes: z.string().nullish().transform((s) => (s ?? "").trim().slice(0, 3000)),
  factsUsed: z
    .array(z.string())
    .default([])
    .transform((a) => a.map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 12)),
  bug: supportAiBugSchema.nullish().transform((b) => (b && b.title ? b : null)),
});
export type SupportAiAnswer = z.infer<typeof supportAiAnswerSchema>;

// ── Whether it may go out on its own ─────────────────────────────────────────

export const SEND_CONFIDENCE_MIN = 60;

/** What an answer may not say on its own: money back or off a bill, an
 *  exception, deleted data. "Credit card", a proposal's "discount" line and
 *  "deleting a line item" are features, not commitments, and pass. */
const COMMITS =
  /\b(refund\w*|reimburs\w*|compensat\w*|chargeback\w*|waiv(e|ed|ing)\b|free (month|months|period|upgrade)|(credit|credited) (to )?your account|account credit|(we('| ha)ve|we will|we'll) (delete|deleted|erase|erased|remove|removed) your (account|data|company))/i;

export function commitsMoneyOrData(reply: string): boolean {
  return COMMITS.test(reply);
}

export type Delivery = { send: true } | { send: false; reason: string };

/** Where a ticket came from, when it matters to the answer: "smarthelp" — filed from SmartHelp's "Ask a person". */
export type SupportOrigin = "smarthelp";

/** `origin` "smarthelp": the person asked SmartHelp first and pressed "Ask a person" — an answer that could have gone
 *  out on its own waits for a person instead. Checked last, so any other reason to hold it is the one the team reads. */
export function deliveryFor(a: SupportAiAnswer, mode: SupportAiMode, origin?: SupportOrigin): Delivery {
  if (mode !== "auto") return { send: false, reason: "The AI is set to draft for you." };
  if (a.needsHuman) return { send: false, reason: a.humanReason || "It asked for a person to answer." };
  if (a.confidence < SEND_CONFIDENCE_MIN) return { send: false, reason: `Not sure enough to send on its own (${a.confidence}% sure).` };
  if (a.reply.length < 40) return { send: false, reason: "The answer came back too short to send." };
  if (commitsMoneyOrData(a.reply)) {
    return { send: false, reason: "The answer talks about money back, credits or deleting data — that's yours to say." };
  }
  if (origin === "smarthelp") return { send: false, reason: "Came from SmartHelp — a person sends this one." };
  return { send: true };
}

/** A ticket's origin from its row (SyncState `supportOrigin:<ticketId>`, `{"origin":"smarthelp","logId":…}`, written
 *  when it was filed). No row, or one that can't be read, is no origin. */
export function supportOriginOf(raw: string | null | undefined): SupportOrigin | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as { origin?: unknown } | null;
    return v && typeof v === "object" && v.origin === "smarthelp" ? "smarthelp" : undefined;
  } catch {
    return undefined;
  }
}

// ── What is kept per ticket (SyncState `supportAi:<ticketId>`) ───────────────

/** The record a ticket gets from an answer and how it was delivered. */
export function recordFor(
  a: SupportAiAnswer,
  input: { at: string; model: string; outcome: SupportAiOutcome; reason?: string; ackSent?: boolean },
): SupportAiRecord {
  return {
    v: 1,
    at: input.at,
    model: input.model,
    outcome: input.outcome,
    ...(input.reason ? { reason: input.reason } : {}),
    category: a.category,
    summary: a.summary,
    confidence: a.confidence,
    language: a.language,
    reply: a.reply,
    ...(input.ackSent ? { ackSent: true } : {}),
    internalNotes: a.internalNotes,
    factsUsed: a.factsUsed,
    fix: a.bug ? { ...a.bug, status: "awaiting" } : null,
  };
}

/** A failure kept as a record, so the admin sees that the AI tried and why it stopped. */
export function failedRecord(at: string, model: string, reason: string): SupportAiRecord {
  return {
    v: 1,
    at,
    model,
    outcome: "failed",
    reason: reason.slice(0, 300),
    category: "other",
    summary: "",
    confidence: 0,
    language: "en",
    reply: "",
    internalNotes: "",
    factsUsed: [],
    fix: null,
  };
}

// ── The words around an answer ───────────────────────────────────────────────

export function firstNameOf(name: string | null | undefined, email?: string | null): string | null {
  const n = (name ?? "").trim().split(/\s+/)[0];
  if (n && /^[\p{L}'-]{2,}$/u.test(n)) return n.charAt(0).toUpperCase() + n.slice(1);
  const local = (email ?? "").split("@")[0]?.split(/[._+-]/)[0] ?? "";
  if (/^[a-z]{2,}$/i.test(local) && !/^(info|admin|office|support|hello|contact|sales|team|mail|jobs|billing|service)$/i.test(local)) {
    return local.charAt(0).toUpperCase() + local.slice(1).toLowerCase();
  }
  return null;
}

/** The note a customer gets at once when the answer waits for a person. */
export function holdingReply(name: string | null, subject: string): string {
  const topic = subject.replace(/\s+/g, " ").trim().slice(0, 90);
  return [
    name ? `Hi ${name},` : "Hi there,",
    `Thank you for reaching out${topic ? ` about “${topic}”` : ""}. We've got your message, and a member of our team is looking into it personally — we'll write back as soon as we have a full answer for you.`,
    "If there's anything you'd like to add in the meantime — a screenshot, the page you were on, or what you expected to happen — just reply to this email and it will reach us.",
  ].join("\n\n");
}

/** The "it's fixed" note when the AI cannot write one (no key, a failed call). */
export function fixedReplyTemplate(name: string | null, subject: string): string {
  const topic = subject.replace(/\s+/g, " ").trim().slice(0, 90);
  return [
    name ? `Hi ${name},` : "Hi there,",
    `Good news — the problem you reported${topic ? ` (“${topic}”)` : ""} has been fixed. Thank you for letting us know; it made JobFlex better for everyone.`,
    "If you still see anything off, just reply to this email and we'll take another look right away.",
  ].join("\n\n");
}

// ── What the model reads ─────────────────────────────────────────────────────

/** The topics only a person answers — the owner's NEVER list, one place for the support AI and SmartHelp
 *  (lib/smarthelp/answer). Interpolated back into SUPPORT_AI_RULES word for word; the "less than 60% sure" line stays
 *  in the rules, since SmartHelp says "not sure" (kind unknown) rather than "a person" for that. */
export const PERSON_ONLY_TOPICS: string = `- Promise or discuss refunds, credits, compensation, discounts on their bill, free months or exceptions to policy.
- Change, or promise to change, their plan, billing, account, data or settings — you cannot change anything.
- Ask for passwords, full card numbers, bank details or one-time codes. If they shared one, tell them kindly not to and that we never need it.
- Account ownership changes, deleting an account or data, security or privacy incidents, legal threats, chargeback threats, a very angry or upset customer, or anyone who asks for a person.`;

export const SUPPORT_AI_RULES = `You are JobFlex's senior support specialist. JobFlex is software for contractors and trades businesses: estimators (roof, fence, deck, HVAC, video walkthroughs, blueprints, Smart Proposal), proposals, clients and leads, projects, jobs and crews, texting and the AI desk, and the subscription that pays for it. You answer one support ticket by email, on behalf of the JobFlex team.

VOICE
- Warm, professional and plain — the best support lead they have ever dealt with. Write in the customer's language (the language of their message).
- Open with "Hi <first name>," when you have a first name, otherwise "Hi there,". One sentence that shows you understood their situation, then solve it.
- Exact steps with the real names from the HANDBOOK: menu labels, button labels, page paths written as full links on https://jobflex.app (for example https://jobflex.app/dashboard/subscription). Numbered steps when there are steps. Say what they should see, and what to do if it doesn't happen.
- Short paragraphs. No jargon, no internal file names, no code, no mention of AI, models, prompts or the handbook. Do not sign off with a name — the signature is added for you. End with one line inviting them to reply if anything is still unclear.
- Use the ACCOUNT FACTS to be specific ("your trial runs until October 20", "you're on the Professional plan"). Never quote internal ids, error codes or other customers.

TRUTH
- State only what the HANDBOOK or the ACCOUNT FACTS support. If something is not covered, do not guess: say a teammate will confirm it, set needsHuman=true and say why in humanReason.
- Never invent features, prices, limits, dates, timelines or policies. Never say something is fixed, changed or done unless the facts say so.

NEVER (set needsHuman=true instead, and still write your best suggested reply for the team to review)
${PERSON_ONLY_TOPICS}
- Anything you are less than 60% sure of.

BUGS — something in JobFlex is broken (an error message, a wrong number, a page that won't load or save, data missing, an email or text that didn't arrive though it should have)
- category "bug". In the reply: thank them for the detail, say plainly that we'll double-check it with our team right away and fix it as soon as we can, and that we'll email them the moment it's done; give a workaround if the HANDBOOK supports one. Never say it's fixed, never give a date.
- SOMETHING LOOKS WRONG — a measurement, a price, a count or a figure they doubt (a roof's squares, a proposal total, a count of leads): treat it as a bug. Ask for the exact address, proposal or screen so the team checks that very case, and say we'll double-check it with the team and put it right as soon as we can.
- Fill "bug" for the team: title (short), symptoms (their words plus the relevant account facts and server errors), likelyCause (your best diagnosis, naming the area from the HANDBOOK's internal code map — say how sure you are), proposedFix (the concrete change a developer should make, step by step), areas (file paths or routes from the code map), severity (high = they cannot work or money is affected; low = cosmetic), workaround (if any).
- If it is really a how-to misunderstanding, answer the how-to and leave "bug" null.

CANCELLATIONS — they want to cancel or downgrade the plan, ask how to cancel, or say they are leaving (also "close my account" when they mean the plan)
- category "billing" (the plan, the bill) or "account" (the whole account). Set needsHuman=true with humanReason "Someone is leaving — a person sends this one" — and still write the full reply: it is the draft the team sends.
- SHORT — about 120 words — warm, never pushy, no guilt, never arguing with their reason. Two CARDS first, then the steps. A card is its own paragraph that starts with [offer] or [note]: the rest of that first line is the card's title, the next line its text (one or two sentences). The customer sees each card as a box. Exactly this order:
  1. "Hi <first name>," and ONE warm line — sorry to hear they're thinking of leaving. No question yet.
  2. The [offer] card, first:
     - When the ACCOUNT FACTS say "TRIAL EXTENSION: AVAILABLE": title "Two more weeks, free". Text: if they haven't had time to really try JobFlex, they just reply "yes" and we add two weeks to their trial — nothing to set up, nothing charged.
     - When a request is already PENDING: title "Your extra time is on its way". Text: we're on it and will email them the moment it's set. Don't offer again.
     - When NOT available (a paying plan, a trial long over, a plan granted by hand): title "Let us help first". Text: a short walkthrough call, or we set up the part that slowed them down — they reply "help". Never refunds, credits, discounts or free time here.
  3. The [note] card, always, in these words: title "Today's price — yours for life". Text: "JobFlex prices are going up. Stay, and today's price is yours for life — as long as your plan stays active. If you cancel, coming back means the new prices."
  4. "If you'd still like to cancel:" then the HANDBOOK's exact numbered steps with the link, and one line on what happens after (the plan runs to the end of the period, then the Free plan, nothing more is charged) — nobody should feel trapped.
  5. One short honest question: what made them decide — a missing feature, the price, not enough time, something that didn't work? We read every answer. Then: the door stays open, and they can reply to this email.

FEATURE REQUESTS AND FEEDBACK: thank them warmly, say it has been shared with the product team, and never promise it will be built or when.

OUTPUT — JSON only, exactly these keys:
{"language": "en", "category": "how-to"|"billing"|"account"|"bug"|"feature-request"|"feedback"|"other", "summary": "one line for the admin list", "confidence": 0-100, "needsHuman": true|false, "humanReason": "why a person must answer, or null", "reply": "the full email body to the customer, plain text, paragraphs separated by blank lines", "internalNotes": "for the team: what you checked, what you assumed, what to watch", "factsUsed": ["the account facts or handbook points you relied on"], "bug": null | {"title": "", "symptoms": "", "likelyCause": "", "proposedFix": "", "areas": [""], "severity": "low"|"normal"|"high", "workaround": "" }}`;

// ── The trial-extension offer, as a fact for the model and a flag for the admin ──────────────────────────────────

export interface OfferSubscription {
  status: string;
  trialEndsAt: Date | null;
  provider?: string | null;
  plan?: string | null;
}

/** Whether the team can add days (lib/trialExtension's rule: on the trial, or within 14 days after it ended), said
 *  as a line of ACCOUNT FACTS the model reads — and the flag the admin page shows its button on. */
export function extensionOfferFact(sub: OfferSubscription | null | undefined, pending: { days: number } | null, now = Date.now()): { eligible: boolean; fact: string } {
  if (!sub) return { eligible: false, fact: "TRIAL EXTENSION: not available — no subscription (the free tier)." };
  if (sub.provider === "MANUAL") return { eligible: false, fact: "TRIAL EXTENSION: not available — a plan granted by hand." };
  if (!trialExtensionEligible(sub, now)) {
    const paying = sub.status === "ACTIVE";
    return { eligible: false, fact: paying ? `TRIAL EXTENSION: not available — they pay for the ${sub.plan ?? "plan"} (no trial to extend); offer help instead, never money.` : "TRIAL EXTENSION: not available — the trial ended more than 14 days ago." };
  }
  if (pending) return { eligible: true, fact: `TRIAL EXTENSION: a request for ${pending.days} more days is already PENDING with the team — say we're on it, don't offer again.` };
  const when = sub.trialEndsAt ? sub.trialEndsAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null;
  const where = sub.status === "TRIALING" ? `they are on their trial${when ? ` (it ends ${when})` : ""}` : `their trial ended${when ? ` ${when}` : ""}, within the last 14 days`;
  return { eligible: true, fact: `TRIAL EXTENSION: AVAILABLE — ${where}; the team can add 7 or 14 free days on top. If they haven't had time to explore, offer two more weeks — they reply "yes" and a teammate sets it up.` };
}

/** The whole system message: the rules, then the knowledge. */
export function supportSystemPrompt(): string {
  return `${SUPPORT_AI_RULES}\n\nHANDBOOK — how JobFlex works, written from its code. Internal reference: the customer never sees it.\n\n${SUPPORT_HANDBOOK}`;
}

export interface TicketForPrompt {
  ref: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  filedAt: string;
}

/** The ticket, the account facts, the thread so far and recent server errors, as the model reads them. */
export function supportUserPrompt(input: {
  ticket: TicketForPrompt;
  facts: string[];
  /** The conversation after the ticket's own words, oldest first. `from` absent: one of our answers. */
  thread: Array<{ by: string; at: string; body: string; from?: "customer" | "team" | "ai" }>;
  errors: string[];
  appUrl: string;
}): string {
  const t = input.ticket;
  const parts = [
    `TICKET ${t.ref} — filed ${t.filedAt} · their category: ${t.category} · priority: ${t.priority}`,
    `Subject: ${t.subject}`,
    `Message:\n${t.body}`,
    `ACCOUNT FACTS (from our database, accurate now):\n${input.facts.length ? input.facts.map((f) => `- ${f}`).join("\n") : "- (none found)"}`,
  ];
  if (input.thread.length) {
    const who = (r: (typeof input.thread)[number]) => (r.from === "customer" ? "THE CUSTOMER" : r.from === "ai" ? "JobFlex support (you, earlier)" : `JobFlex support — ${r.by}`);
    const last = input.thread[input.thread.length - 1];
    parts.push(
      `THE CONVERSATION SINCE (oldest first; ALREADY ANSWERED parts — don't repeat them; build on them)${last.from === "customer" ? ". The customer's last message is the one to answer now" : ""}:\n${input.thread
        .map((r) => `[${r.at} · ${who(r)}]\n${r.body}`)
        .join("\n\n")}`,
    );
  }
  parts.push(
    `SERVER ERRORS FOR THIS ACCOUNT, LAST 7 DAYS:\n${input.errors.length ? input.errors.map((e) => `- ${e}`).join("\n") : "- none recorded"}`,
  );
  parts.push(`Links go to ${input.appUrl.replace(/\/$/, "")}.`);
  return parts.join("\n\n");
}

export const FIXED_NOTE_RULES = `You write one short email from the JobFlex support team telling a customer that the problem they reported has been fixed. Warm, plain, in the customer's language, 2–4 short paragraphs: greet them by first name when given ("Hi there," otherwise), say it's fixed in words they'll recognise from their own report, thank them for reporting it, and invite them to reply if anything still looks wrong. No technical detail, no file names, no mention of AI, no promises beyond the fix itself, no sign-off name. Return JSON only: {"reply": "the email body"}.`;

export function fixedNoteUserPrompt(input: { firstName: string | null; subject: string; message: string; fixTitle: string; note?: string }): string {
  return [
    `Customer first name: ${input.firstName ?? "(unknown)"}`,
    `Their ticket subject: ${input.subject}`,
    `What they wrote:\n${input.message.slice(0, 2000)}`,
    `What was fixed (internal title): ${input.fixTitle}`,
    input.note ? `Note from the team: ${input.note}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── The copy to the support inbox, and the fix brief ─────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const block = (s: string) => esc(s).replace(/\n/g, "<br>");

export const OUTCOME_SUBJECT: Record<SupportAiOutcome, string> = {
  sent: "AI answered",
  held: "Needs you",
  drafted: "AI draft waiting",
  failed: "AI couldn't answer",
};

/** The brief a developer works from once the fix is approved. */
export function fixBrief(ticket: { ref: string; subject: string; body: string; orgName: string }, fix: SupportAiBug): string {
  return [
    `FIX — ${fix.title} (ticket ${ticket.ref}, ${ticket.orgName}) · severity ${fix.severity}`,
    `What the customer reported:\n${ticket.subject}\n${ticket.body.slice(0, 1500)}`,
    `Symptoms:\n${fix.symptoms}`,
    `Likely cause:\n${fix.likelyCause}`,
    `Proposed fix:\n${fix.proposedFix}`,
    fix.areas.length ? `Where to look:\n${fix.areas.map((a) => `- ${a}`).join("\n")}` : "",
    fix.workaround ? `Workaround told to the customer:\n${fix.workaround}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export interface TeamCopyInput {
  ticket: { ref: string; subject: string; body: string; orgName: string; customerEmail: string | null };
  record: SupportAiRecord;
  /** What actually went to the customer: the answer, the holding note, or nothing. */
  sentBody: string | null;
  facts: string[];
  link: string;
}

/** The copy every AI outcome sends to the support inbox ("copy to our email"). */
export function teamCopyEmail(input: TeamCopyInput): { subject: string; html: string; text: string } {
  const { ticket, record: r } = input;
  const fix = r.fix;
  const head = fix && fix.status === "awaiting" ? "Fix needs your OK" : OUTCOME_SUBJECT[r.outcome];
  const subject = `[${head}] ${ticket.ref} · ${ticket.subject.replace(/\s+/g, " ").slice(0, 90)}`;
  const lines: Array<[string, string]> = [
    ["Customer", `${ticket.orgName}${ticket.customerEmail ? ` · ${ticket.customerEmail}` : ""}`],
    ["What the AI did", r.outcome === "sent" ? "Answered the customer" : r.outcome === "held" ? `Held the answer for you — the customer got a "we're on it" note${r.ackSent ? "" : " (not sent)"}` : r.outcome === "drafted" ? "Wrote a draft for you (nothing sent)" : "Could not answer"],
  ];
  if (r.reason) lines.push(["Why", r.reason]);
  if (r.outcome !== "failed") {
    lines.push(["Read as", `${SUPPORT_AI_CATEGORY_LABEL[r.category]} · ${r.confidence}% sure`]);
    if (r.summary) lines.push(["Summary", r.summary]);
  }
  const text = [
    `${head} — ticket ${ticket.ref}`,
    ...lines.map(([k, v]) => `${k}: ${v}`),
    `\nTheir message:\n${ticket.subject}\n${ticket.body}`,
    input.sentBody ? `\nSent to the customer:\n${input.sentBody}` : "",
    r.outcome !== "sent" && r.reply ? `\nThe AI's answer, waiting for you:\n${r.reply}` : "",
    r.internalNotes ? `\nNotes for the team:\n${r.internalNotes}` : "",
    input.facts.length ? `\nAccount facts it saw:\n${input.facts.map((f) => `- ${f}`).join("\n")}` : "",
    fix ? `\n${fixBrief(ticket, fix)}\n\nApprove or decline the fix: ${input.link}` : "",
    `\nOpen the ticket: ${input.link}`,
  ]
    .filter(Boolean)
    .join("\n");
  const row = ([k, v]: [string, string]) =>
    `<tr><td style="padding:3px 12px 3px 0;color:#6b6b6b;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:3px 0">${block(v)}</td></tr>`;
  const section = (title: string, body: string, tone = "#f6f5f2") =>
    `<div style="margin:16px 0 0"><div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 6px">${esc(title)}</div><div style="background:${tone};border-radius:6px;padding:12px 14px;line-height:1.5">${block(body)}</div></div>`;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:680px">`,
    `<div style="font-size:18px;font-weight:800;margin:0 0 10px">${esc(head)} — ticket ${esc(ticket.ref)}</div>`,
    `<table style="border-collapse:collapse;font-size:14px">${lines.map(row).join("")}</table>`,
    section("Their message", `${ticket.subject}\n\n${ticket.body}`),
    input.sentBody ? section("Sent to the customer", input.sentBody, "#eef6ef") : "",
    r.outcome !== "sent" && r.reply ? section("The AI's answer, waiting for you", r.reply, "#fff7e6") : "",
    r.internalNotes ? section("Notes for the team", r.internalNotes) : "",
    input.facts.length ? section("Account facts it saw", input.facts.map((f) => `• ${f}`).join("\n")) : "",
    fix ? section(`Fix proposal · ${fix.severity} · ${fix.status === "awaiting" ? "waiting for your OK" : fix.status}`, fixBrief(ticket, fix), "#fdeeee") : "",
    `<p style="margin:18px 0 0"><a href="${esc(input.link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700">${fix && fix.status === "awaiting" ? "Approve or decline the fix" : "Open the ticket"}</a></p>`,
    `</div>`,
  ].join("");
  return { subject, html, text };
}

/** The note to the inbox when the customer pressed "I still need help" after the AI's answer. */
export function stillStuckEmail(input: {
  ticket: { ref: string; subject: string; body: string; orgName: string; customerEmail: string | null };
  answer: string;
  note?: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const t = input.ticket;
  const subject = `[Needs you] ${t.ref} · still stuck after the AI's answer · ${t.subject.replace(/\s+/g, " ").slice(0, 70)}`;
  const text = [
    `${t.orgName}${t.customerEmail ? ` · ${t.customerEmail}` : ""} pressed "I still need help" after the AI's answer. The ticket is Open again and waiting for a person.`,
    input.note ? `What they added:\n${input.note}` : "They added nothing more.",
    `Their message:\n${t.subject}\n${t.body}`,
    `The AI's answer they saw:\n${input.answer}`,
    `Open the ticket: ${input.link}`,
  ].join("\n\n");
  const section = (title: string, body: string, tone = "#f6f5f2") =>
    `<div style="margin:16px 0 0"><div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#6b6b6b;margin:0 0 6px">${esc(title)}</div><div style="background:${tone};border-radius:6px;padding:12px 14px;line-height:1.5">${block(body)}</div></div>`;
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:680px">`,
    `<div style="font-size:18px;font-weight:800;margin:0 0 10px">Still stuck — ticket ${esc(t.ref)}</div>`,
    `<p style="margin:0">${esc(t.orgName)}${t.customerEmail ? ` · ${esc(t.customerEmail)}` : ""} pressed <b>I still need help</b> after the AI's answer. The ticket is Open again and waiting for a person.</p>`,
    input.note ? section("What they added", input.note, "#fff7e6") : "",
    section("Their message", `${t.subject}\n\n${t.body}`),
    section("The AI's answer they saw", input.answer, "#eef6ef"),
    `<p style="margin:18px 0 0"><a href="${esc(input.link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700">Open the ticket</a></p>`,
    `</div>`,
  ].join("");
  return { subject, html, text };
}

/** The note to the inbox when a fix is approved: the brief, ready for whoever makes the change. */
export function fixApprovedEmail(input: {
  ticket: { ref: string; subject: string; body: string; orgName: string };
  fix: SupportAiFix;
  by: string;
  link: string;
}): { subject: string; html: string; text: string } {
  const brief = fixBrief(input.ticket, input.fix);
  const subject = `[Fix approved] ${input.ticket.ref} · ${input.fix.title.slice(0, 90)}`;
  const text = `Approved by ${input.by}.${input.fix.note ? ` Note: ${input.fix.note}` : ""}\n\n${brief}\n\nWhen it's live, press "Mark fixed — tell the customer" on the ticket: ${input.link}`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#111;max-width:680px"><div style="font-size:18px;font-weight:800;margin:0 0 8px">Fix approved — ticket ${esc(input.ticket.ref)}</div><p style="margin:0 0 12px">Approved by ${esc(input.by)}.${input.fix.note ? ` Note: ${block(input.fix.note)}` : ""}</p><div style="background:#f6f5f2;border-radius:6px;padding:12px 14px;line-height:1.5;white-space:normal">${block(brief)}</div><p style="margin:16px 0 0">When it's live, press <b>Mark fixed — tell the customer</b> on the ticket.</p><p style="margin:12px 0 0"><a href="${esc(input.link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:700">Open the ticket</a></p></div>`;
  return { subject, html, text };
}
