// Pure (record) → EmailDoc builders for the six client-facing emails. No I/O,
// so the gallery can render them from fixtures and the senders stay thin.
// Voice: letter — greeting and sign-off (principle 19, client altitude).
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { capItems, truncate } from "../fit";

const ITEM_CAP = 12;
const ITEM_NAME_MAX = 140;
const TITLE_MAX = 70;

/**
 * True when a rendered prose paragraph is nothing but a URL — optionally
 * preceded by a short "Label:" lead-in (e.g. "View and accept online:
 * https://…"). Senders use this to drop link-only paragraphs from
 * contractor/house copy once a builder's CTA button already carries the
 * same link, so the URL doesn't render twice in the email (Task 5 fix
 * round 1, Finding A).
 */
export function isBareUrlParagraph(p: string): boolean {
  const stripped = p.replace(/^[^:]{0,40}:\s*/, "").trim();
  return /^https?:\/\/\S+$/i.test(stripped);
}

export interface OrgBrand {
  /** The organization's id: the mail links its logo by it (doc.ts Lockup). Without it the letter mark is drawn. */
  id?: string | null;
  name: string;
  logoUrl?: string | null;
  phone?: string | null;
}

function orgLockup(org: OrgBrand): Lockup {
  return { kind: "org", name: org.name, logoUrl: org.logoUrl ?? null, orgId: org.id ?? null };
}

function orgFooter(org: OrgBrand, ref?: string) {
  return { name: org.name, contact: org.phone ?? undefined, ref };
}

export function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  }).format(n);
}

function shortDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(d);
}

/**
 * `Proposal.taxRate` (and every caller of this builder) stores tax as a raw
 * FRACTION 0–1 — see `src/actions/proposals.ts` (`z.number().min(0).max(1)`,
 * `taxTotal = subtotal * input.taxRate`). This is the one place that
 * multiplies by 100 for display. Do not pass an already-scaled percentage in,
 * and do not re-multiply anywhere else. Strips trailing zeros so 0.05 → "5%"
 * and 0.0825 → "8.25%", not "5.00%".
 */
function formatTaxRate(fraction: number): string {
  const pct = Math.round(fraction * 100 * 100) / 100; // 2 decimal places, no float noise
  return `${pct}%`;
}

export interface ProposalSentInput {
  /** Lines after the box; the default asks for changes by reply. */
  after?: string[];
  org: OrgBrand;
  clientName: string;
  title: string;
  lineItems: { name: string; total: number }[];
  /** Raw fraction 0–1, e.g. 0.05 for 5%. Never a whole percentage. */
  taxRate: number;
  taxTotal: number;
  total: number;
  validUntil: Date | null;
  href: string;
  ref?: string;
  /** Contractor-authored template prose. Falls back to house copy. */
  prose?: string[];
}

export function buildProposalSent(i: ProposalSentInput): EmailDoc {
  const { shown, remainder, remainderTotal } = capItems(i.lineItems, ITEM_CAP, (li) => li.total);

  const box: BoxRow[] = shown.map((li) => ({
    type: "item" as const,
    name: truncate(li.name, ITEM_NAME_MAX),
    amount: formatUSD(li.total),
  }));

  if (remainder > 0) {
    box.push({ type: "item", name: `${remainder} more items`, amount: formatUSD(remainderTotal) });
  }
  // Principle 03 — the tax row renders only when there is tax.
  if (i.taxTotal > 0) {
    box.push({
      type: "rate",
      label: "Tax",
      rate: formatTaxRate(i.taxRate),
      amount: formatUSD(i.taxTotal),
    });
  }
  box.push({ type: "anchor", label: "Total", value: formatUSD(i.total) });
  if (i.validUntil) {
    box.push({ type: "cond", label: "Price held until", chip: shortDate(i.validUntil) });
  }

  return {
    subject: `Your proposal from ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Proposal" },
    headline: truncate(i.title, TITLE_MAX),
    prose: i.prose ?? [
      `Hi ${i.clientName.split(" ")[0]} — here's the work we walked through, priced out.`,
    ],
    box,
    cta: { label: "Review & accept", href: i.href },
    after: i.after ?? [
      "Anything you'd like changed? Just reply — it comes straight to us.",
    ],
    footer: orgFooter(i.org, i.ref),
  };
}

export interface ProposalAcceptedInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  total: number;
  callByDate: Date | null;
  prose?: string[];
}

/** No CTA — there is nothing for the client to do (principle 06·a). */
export function buildProposalAccepted(i: ProposalAcceptedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Job", value: truncate(i.title, TITLE_MAX) },
    { type: "anchor", label: "Agreed", value: formatUSD(i.total) },
  ];
  if (i.callByDate) {
    box.push({ type: "cond", label: "We'll call by", chip: shortDate(i.callByDate) });
  }
  return {
    subject: `Thanks for accepting — ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Confirmed", tone: "ok" },
    headline: "You're booked in",
    prose: i.prose ?? [
      `Thanks ${i.clientName.split(" ")[0]} — we've got your acceptance and we're getting the work scheduled.`,
    ],
    box,
    after: ["Nothing needed from you until then."],
    footer: orgFooter(i.org),
  };
}

export interface FollowUpInput {
  org: OrgBrand;
  title: string;
  total: number;
  validUntil: Date | null;
  href: string;
  prose?: string[];
}

/** Items are dropped — the client has already seen them. Anchor + condition only. */
export function buildFollowUp(i: FollowUpInput): EmailDoc {
  const box: BoxRow[] = [{ type: "anchor", label: "Total", value: formatUSD(i.total) }];
  if (i.validUntil) {
    const days = Math.ceil((i.validUntil.getTime() - Date.now()) / 86_400_000);
    // A follow-up rule can legitimately fire after validUntil has passed —
    // "0 days" would misreport an already-expired quote as still live.
    if (days <= 0) {
      box.push({ type: "cond", label: "Expires in", chip: "Expired", tone: "bad" });
    } else {
      box.push({
        type: "cond",
        label: "Expires in",
        chip: days === 1 ? "1 day" : `${days} days`,
        tone: days <= 3 ? "warn" : "neutral",
      });
    }
  }
  return {
    subject: `Still holding your price — ${truncate(i.title, 40)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Reminder" },
    headline: "Still holding your price",
    prose: i.prose ?? ["No rush, but the quote runs out soon and I didn't want it to lapse quietly."],
    box,
    cta: { label: "Review & accept", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface ChangeOrderInput {
  org: OrgBrand;
  clientName: string;
  contextTitle: string;
  coTitle: string;
  description?: string | null;
  amount: number;
  /**
   * The contract value the change order amends. `null`/`undefined` when
   * neither the change order's own proposal nor its job's proposal resolved
   * one — in that case the "Agreed contract" row (and the "New total" delta
   * against it) is suppressed rather than printed as a lying $0.
   */
  previousTotal?: number | null;
  href: string;
  // ── Itemized change orders (2026-09-13). When `lines` is present the box
  // reads original → approved changes → this change → new total, with tax,
  // and `previousTotal` means the contract value BEFORE this change (the
  // original plus every change already approved). Absent = the legacy
  // single-amount layout above. ──
  number?: number | null;
  lines?: Array<{ name: string; quantity: number; unit: string; unitPrice: number; total: number }>;
  originalTotal?: number | null;
  approvedChangesTotal?: number | null;
  taxTotal?: number | null;
  /** Tax-inclusive amount of this change. */
  total?: number | null;
  photoCount?: number;
}

export function buildChangeOrder(i: ChangeOrderInput): EmailDoc {
  const itemized = Array.isArray(i.lines) && i.lines.length > 0 && i.total != null;
  const delta = itemized ? i.total! : i.amount;
  const signed = `${delta >= 0 ? "+" : "−"}${formatUSD(Math.abs(delta))}`;
  const hasPrevious = i.previousTotal != null;
  const box: BoxRow[] = [];
  if (itemized) {
    if (i.originalTotal != null) box.push({ type: "item", name: "Original contract", amount: formatUSD(i.originalTotal) });
    if (i.approvedChangesTotal != null && Math.abs(i.approvedChangesTotal) >= 0.005) {
      box.push({ type: "item", name: "Approved changes so far", amount: `${i.approvedChangesTotal >= 0 ? "+" : "−"}${formatUSD(Math.abs(i.approvedChangesTotal))}` });
    }
    const shown = i.lines!.slice(0, 6);
    for (const l of shown) {
      const qty = Number.isInteger(l.quantity) ? String(l.quantity) : l.quantity.toFixed(1);
      box.push({ type: "item", name: truncate(`${l.name} · ${qty} ${l.unit} × ${formatUSD(l.unitPrice)}`, ITEM_NAME_MAX), amount: formatUSD(l.total) });
    }
    if (i.lines!.length > shown.length) box.push({ type: "field", label: "And", value: `${i.lines!.length - shown.length} more line${i.lines!.length - shown.length === 1 ? "" : "s"}` });
    if (i.taxTotal != null && i.taxTotal > 0) box.push({ type: "item", name: "Sales tax", amount: formatUSD(i.taxTotal) });
    if (i.photoCount) box.push({ type: "field", label: "Photos", value: `${i.photoCount} of the damage, on the approval page` });
    box.push({
      type: "anchor",
      label: hasPrevious ? "New total" : "This change",
      value: hasPrevious ? formatUSD(i.previousTotal! + delta) : signed,
    });
  } else {
    if (hasPrevious) {
      box.push({ type: "item", name: "Agreed contract", amount: formatUSD(i.previousTotal!) });
    }
    box.push({ type: "item", name: truncate(i.coTitle, ITEM_NAME_MAX), amount: signed });
    box.push({
      type: "anchor",
      label: hasPrevious ? "New total" : "Change amount",
      value: hasPrevious ? formatUSD(i.previousTotal! + i.amount) : signed,
    });
  }
  box.push({ type: "cond", label: "Work paused until", chip: "Approved", tone: "bad" });

  return {
    subject: `Change order${i.number ? ` #${i.number}` : ""} for ${i.contextTitle}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Change order" },
    headline: itemized ? `${truncate(i.coTitle, 60)} needs your ok` : "One change needs your ok",
    prose: [
      `Hi ${i.clientName.split(" ")[0]} — ${i.description?.trim() || `we have a change to the contract on "${i.contextTitle}".`}`,
    ],
    box,
    cta: { label: "Review & approve", href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface InvoiceInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  /** The stage being invoiced — "Deposit", "Change order #2 · Plywood replacement", "Remaining balance". */
  label: string;
  amount: number;
  dueDate: Date | null;
  agreedTotal: number;
  paidToDate: number;
  /** The portal link, carrying the chosen rail (?pay=…&method=…). */
  href: string;
  /** card: the hosted pay page; bank: the office's transfer instructions; any: the client picks on the portal. */
  method: "card" | "bank" | "any";
  bankInstructions?: string | null;
}

/** An invoice for one stage, on the rail the office chose. Bank transfer
 *  carries the instructions in the mail itself and links, not buttons. */
export function buildInvoice(i: InvoiceInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "item", name: "Agreed total", amount: formatUSD(i.agreedTotal) },
    { type: "item", name: "Paid to date", amount: formatUSD(i.paidToDate) },
    { type: "anchor", label: "Amount due", value: formatUSD(i.amount) },
  ];
  if (i.dueDate) box.push({ type: "cond", label: "Due", chip: shortDate(i.dueDate), tone: "warn" });
  const first = i.clientName.split(" ")[0];
  const prose =
    i.method === "bank"
      ? [
          `Hi ${first} — here is the invoice for ${i.label.toLowerCase()} on ${i.title}. Please pay by bank transfer using the details below; reply to this email once it is sent.`,
          ...(i.bankInstructions ? i.bankInstructions.split(/\n{2,}/).map((p) => p.replace(/\n/g, " · ").trim()).filter(Boolean) : []),
        ]
      : i.method === "card"
        ? [`Hi ${first} — here is the invoice for ${i.label.toLowerCase()} on ${i.title}. Pay by card online in a minute using the button below.`]
        : [`Hi ${first} — here is the invoice for ${i.label.toLowerCase()} on ${i.title}. Pay online, or see the other ways to pay on the page below.`];
  return {
    subject: `Invoice — ${i.label} for ${truncate(i.title, 40)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Invoice" },
    headline: `${i.label}: ${formatUSD(i.amount)} due`,
    prose,
    box,
    ...(i.method === "bank" ? { link: { label: "View the invoice online", href: i.href } } : { cta: { label: i.method === "card" ? "Pay by card" : "Pay online", href: i.href } }),
    footer: orgFooter(i.org),
  };
}

export interface PaymentReminderInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  agreedTotal: number;
  paidToDate: number;
  dueNow: number;
  dueLabel: string;
  dueDate: Date | null;
  href: string;
}

export function buildPaymentReminder(i: PaymentReminderInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "item", name: "Agreed total", amount: formatUSD(i.agreedTotal) },
    // Zero here is the POINT — it explains the balance. Principle 03 bans
    // empty rows, not zero values.
    { type: "item", name: "Paid to date", amount: formatUSD(i.paidToDate) },
    { type: "anchor", label: "Due now", value: formatUSD(i.dueNow) },
  ];
  if (i.dueDate) {
    box.push({ type: "cond", label: "Due", chip: shortDate(i.dueDate), tone: "warn" });
  }
  return {
    subject: `Payment reminder — ${i.dueLabel} for ${truncate(i.title, 40)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Payment" },
    headline: `${i.dueLabel} is due`,
    prose: [`Hi ${i.clientName.split(" ")[0]} — the ${i.dueLabel.toLowerCase()} on ${i.title} is due.`],
    box,
    cta: { label: `Pay ${i.dueLabel.toLowerCase()}`, href: i.href },
    footer: orgFooter(i.org),
  };
}

export interface ReviewRequestInput {
  org: OrgBrand;
  clientName: string;
  jobTitle: string;
  href: string;
}

/** No box — nothing worth anchoring (principle 12·a). */
export function buildReviewRequest(i: ReviewRequestInput): EmailDoc {
  return {
    subject: `How did we do? — ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "One favour" },
    headline: "How did we do?",
    prose: [
      `Hi ${i.clientName.split(" ")[0]} — hope everything's holding up nicely after the ${i.jobTitle.toLowerCase()}.`,
      "If you've got thirty seconds, a short review genuinely helps a small shop like ours.",
    ],
    cta: { label: "Leave a review", href: i.href },
    after: ["And if anything isn't right, reply here first — we'd rather fix it than read about it."],
    footer: orgFooter(i.org),
  };
}

/** The one follow-up, a week later. Same link, softer ask, no box. */
export function buildReviewReminder(i: ReviewRequestInput): EmailDoc {
  return {
    subject: `Still happy with the ${truncate(i.jobTitle, TITLE_MAX).toLowerCase()}? — ${i.org.name}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Quick reminder" },
    headline: "A minute for a review?",
    prose: [
      `Hi ${i.clientName.split(" ")[0]} — we sent a note last week and know how these get buried.`,
      "Stars, a line or two, a photo if you like — it takes a minute and it means a lot to us.",
    ],
    cta: { label: "Leave a review", href: i.href },
    after: ["This is the only reminder we'll send. If something isn't right, reply here and we'll sort it out."],
    footer: orgFooter(i.org),
  };
}

export interface PaymentReceiptInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  stageLabel: string;
  amount: number;
  method: string; // "card" | "bank account" | "bank transfer" | "check" …
  paidAt: Date;
  paidToDate: number;
  remaining: number;
  href: string;
  ref: string;
}

/** Receipt for a stage payment (any provider, or a manual mark). */
export function buildPaymentReceipt(i: PaymentReceiptInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "item", name: i.stageLabel, amount: formatUSD(i.amount) },
    { type: "item", name: "Paid to date", amount: formatUSD(i.paidToDate) },
    { type: "anchor", label: "Remaining", value: formatUSD(i.remaining) },
  ];
  if (i.remaining <= 0) box.push({ type: "cond", label: "Proposal", chip: "Paid in full", tone: "ok" });
  return {
    subject: `Receipt — ${formatUSD(i.amount)} for ${truncate(i.title, 40)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Receipt", tone: "ok" },
    headline: `Thank you, ${i.clientName.split(" ")[0]}`,
    prose: [
      `We received your ${i.method} payment of ${formatUSD(i.amount)} toward ${i.title} on ${shortDate(i.paidAt)}.`,
    ],
    box,
    link: { label: "View proposal", href: i.href },
    fine: `Ref ${i.ref}`,
    footer: orgFooter(i.org, i.ref),
  };
}

export interface OrderNoticeInput {
  org: OrgBrand;
  clientName: string;
  title: string;
  /** The office's own line ("Delivery is about three weeks out."), or none. */
  note: string | null;
  paidToDate: number;
  remaining: number;
  href: string;
  ref: string;
}

/** "Your order is placed" (2026-11-09, the ProSmart gaps plan, part 3): the materials for the job are ordered — the
 *  letter a client waits for after the deposit. Sent from the Payments panel, or by itself on the first payment when
 *  the company switches that on (Settings → Payments). */
export function buildOrderNotice(i: OrderNoticeInput): EmailDoc {
  const first = i.clientName.split(" ")[0] || "there";
  const prose = [`We've placed the order for ${i.title}. Thank you for your deposit — your job is now in production.`];
  if (i.note?.trim()) prose.push(i.note.trim());
  prose.push("We'll be in touch to set the install day. Reply to this email with any question.");
  return {
    subject: `Your order is placed — ${truncate(i.title, 48)}`,
    lockup: orgLockup(i.org),
    kicker: { text: "Order placed", tone: "ok" },
    headline: `Good news, ${first}`,
    prose,
    box: [
      { type: "item", name: "Paid to date", amount: formatUSD(i.paidToDate) },
      { type: "anchor", label: "Remaining", value: formatUSD(i.remaining) },
    ],
    link: { label: "View your proposal", href: i.href },
    fine: `Ref ${i.ref}`,
    footer: orgFooter(i.org, i.ref),
  };
}
