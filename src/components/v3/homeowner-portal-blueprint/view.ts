// What the homeowner portal says about a project (2026-10-30) — plain words,
// worked out once from the views lib/home/portal and lib/requestPortal
// already build. No database, no new rule about who may see what: every href
// below is one the old dashboard already linked.
//
// The words are for a homeowner, not a contractor: "quote", never
// "proposal"; "contractor", never "pro"; no "matched"/"routing" in a button.
import type { Route } from "next";
import type { HomeDashboard } from "@/lib/home/portal";
import type { PortalProposal, RequestPortalView } from "@/lib/requestPortal";

export const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const usdCents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export const homeHref = (key: string) => `/home/${encodeURIComponent(key)}` as Route;
export const projectHref = (key: string, token: string) => `${homeHref(key)}/project/${encodeURIComponent(token)}` as Route;
export const newProjectHref = (key: string, q: { plan?: string; with?: string } = {}) => {
  const sp = new URLSearchParams();
  if (q.plan) sp.set("plan", q.plan);
  if (q.with) sp.set("with", q.with);
  const s = sp.toString();
  return `${homeHref(key)}/new${s ? `?${s}` : ""}` as Route;
};
export const quoteHref = (publicId: string) => `/portal/q/${encodeURIComponent(publicId)}`;
export const quotePdfHref = (publicId: string) => `/api/public-quote/${encodeURIComponent(publicId)}/pdf`;

/** The six steps every project walks, in the homeowner's words. */
export const STEPS = ["Sent", "Contractor matched", "Quote received", "Approved", "Scheduled", "Done"] as const;

/** How far along the project is: the index of the last step reached. */
export function stageOf(p: RequestPortalView): number {
  if (p.status2 === "DONE") return 5;
  if (p.status2 === "HIRED") return p.visits.length > 0 ? 4 : 3;
  if (p.status2 === "PROPOSAL") return 2;
  if (p.status2 === "MATCHED") return 1;
  return 0;
}

export const isOpenQuote = (q: PortalProposal) => q.current && (q.stage === "NEW" || q.stage === "OPENED");
export const isWonQuote = (q: PortalProposal) => q.current && (q.stage === "ACCEPTED" || q.stage === "PAID" || q.stage === "COMPLETED");

/** The quote the project is about right now: an open one, else the approved one, else the latest from the current contractor. */
export function mainQuote(p: RequestPortalView): PortalProposal | null {
  return p.proposals.find(isOpenQuote) ?? p.proposals.find(isWonQuote) ?? p.proposals.find((q) => q.current) ?? null;
}

export const QUOTE_STAGE: Record<PortalProposal["stage"], { label: string; tone: "accent" | "emerald" | "rose" | "muted" }> = {
  NEW: { label: "New quote", tone: "accent" },
  OPENED: { label: "Waiting for you", tone: "accent" },
  ACCEPTED: { label: "Approved", tone: "emerald" },
  DECLINED: { label: "Turned down", tone: "rose" },
  PAID: { label: "Paid", tone: "emerald" },
  COMPLETED: { label: "Work done", tone: "emerald" },
};

export function projectTitle(p: RequestPortalView): string {
  return p.trade ?? "Your project";
}

/** A sentence from the project's history, in the portal's words. */
export function plainEvent(text: string): string {
  return text
    .replace(/^Matched with (.+)$/, "$1 took your project")
    .replace(/proposal/g, "quote")
    .replace(/^You sent your (.+) request$/, "You sent your $1 project")
    .replace(/(hvac)/g, "HVAC");
}

export type NextAction = { label: string; href: string; primary: boolean; external?: boolean };
export type NextStep = {
  /** What happens next, one line. A visit's date is filled in by the page. */
  text: string;
  visit: RequestPortalView["visits"][number] | null;
  tone: "accent" | "amber" | "emerald";
  action: NextAction | null;
};

/** The one line "What happens next" and the one main action for a project. */
export function nextStep(p: RequestPortalView, h: Pick<HomeDashboard, "key" | "folders" | "needs">): NextStep {
  const page = projectHref(h.key, p.token);
  const org = p.current?.org.name ?? null;
  const open = p.proposals.find(isOpenQuote) ?? null;
  const won = p.proposals.find(isWonQuote) ?? null;
  const asks = (h.folders[p.token]?.requests ?? []).filter((r) => !r.fulfilledAt);
  const message: NextAction | null = org ? { label: "Message contractor", href: `${page}#message`, primary: false } : null;

  if (org && p.changeOrders.length > 0) {
    const c = p.changeOrders[0];
    return { text: `${org} sent a change to the job: ${c.title}. Approve it or say no.`, visit: null, tone: "amber", action: { label: "Approve change", href: `/co/${encodeURIComponent(c.token)}`, primary: true } };
  }
  if (open) {
    return { text: `Read ${open.orgName}'s quote for ${usd.format(open.total)}. If it works for you, approve it on the quote.`, visit: null, tone: "accent", action: { label: "Open quote", href: quoteHref(open.publicId), primary: true } };
  }
  if (won && won.nextDue && won.remaining > 0 && won.payOnline) {
    return { text: `${won.nextDue.label} of ${usd.format(won.nextDue.amount)} is due to ${won.orgName}.`, visit: null, tone: "amber", action: { label: `Pay ${usd.format(won.nextDue.amount)}`, href: quoteHref(won.publicId), primary: true } };
  }
  if (asks.length > 0) {
    const a = asks[0];
    return { text: `${a.orgName} asked for photos${a.note ? `: “${a.note}”` : ""}.`, visit: null, tone: "amber", action: { label: "Add photos", href: `${page}#files`, primary: false } };
  }

  const stage = stageOf(p);
  if (stage === 5) {
    const review = org ? h.needs.find((n) => n.kind === "review" && n.text.startsWith(org)) : null;
    return {
      text: "The work is done. This project stays here as part of your home's record.",
      visit: null,
      tone: "emerald",
      action: review ? { label: "Leave a review", href: review.href, primary: true } : null,
    };
  }
  if (stage === 4) {
    const due = won && won.nextDue && won.remaining > 0 && !won.payOnline ? ` Next payment: ${won.nextDue.label.toLowerCase()}, ${usd.format(won.nextDue.amount)} — ${won.orgName} will tell you how to pay.` : "";
    return { text: `${p.visits[0].title} with ${p.visits[0].orgName}.${due}`, visit: p.visits[0], tone: "accent", action: message };
  }
  if (stage === 3) {
    const due = won && won.nextDue && won.remaining > 0 ? ` Next payment: ${won.nextDue.label.toLowerCase()}, ${usd.format(won.nextDue.amount)}${won.payOnline ? "" : ` — ${won.orgName} will tell you how to pay`}.` : "";
    return { text: `You approved the quote. ${org ?? "Your contractor"} will get in touch to set a date for the work.${due}`, visit: null, tone: "emerald", action: message };
  }
  if (stage === 2) {
    // Only a turned-down quote from the current contractor is left.
    return { text: `You turned down ${org ?? "the contractor"}'s quote. They may send a new one — or you can ask for a different contractor.`, visit: null, tone: "accent", action: message };
  }
  if (stage === 1) {
    return { text: `${org} has your details and will get in touch to look at the job and send you a quote.`, visit: null, tone: "accent", action: message };
  }
  const lastLeft = p.previous[p.previous.length - 1]?.org.name ?? null;
  const text = lastLeft && p.status !== "MATCHED"
    ? `We're finding you a different contractor. We'll email you when one takes the project.`
    : p.status === "OFFERED"
      ? "A local contractor is looking at your project now — they have up to 24 hours to take it. We'll email you."
      : "We're finding a contractor near you. We'll email you as soon as one takes the project.";
  return { text, visit: null, tone: "accent", action: { label: "Add photos", href: `${page}#files`, primary: false } };
}

/** "8123 Juanita Dr NE, Kirkland, WA 98034" — the street line often carries the city and the ZIP already; say each once. */
export function houseLine(h: Pick<HomeDashboard, "details" | "place" | "address">): string {
  const addr = h.details.address;
  if (!addr) return h.address ?? h.place ?? "Your home";
  const place = h.place && !addr.toLowerCase().includes(h.place.toLowerCase()) ? `, ${h.place}` : "";
  const zip = h.details.zip && !addr.includes(h.details.zip) && !(h.place ?? "").includes(h.details.zip) ? ` ${h.details.zip}` : "";
  return `${addr}${place}${zip}`;
}

/** "(425) 772-6587" for a ten-digit number, the typed string otherwise. */
export function phoneShown(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith("1")) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

/** "Oct 29" in the home's zone — server-rendered words, not a live clock. */
export function shortDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: tz }).format(new Date(iso));
}

/** "AP" — the contractor's initials for its square. */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 &]/g, " ").split(/\s+/).filter((w) => w && w !== "&");
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** Where a project stands, as the homeowner would say it — the phrase beside the title and its dot's tone. */
export function statusOf(p: RequestPortalView): { text: string; tone: "muted" | "accent" | "amber" | "emerald" } {
  const stage = stageOf(p);
  const org = p.current?.org.name ?? null;
  if (stage === 5) return { text: "Done", tone: "emerald" };
  if (stage === 4) return { text: `Scheduled for ${shortDate(p.visits[0].startsAt, p.visits[0].timeZone)}`, tone: "accent" };
  if (stage === 3) return { text: "Approved — scheduling", tone: "emerald" };
  if (stage === 2) {
    const open = p.proposals.find(isOpenQuote);
    return open ? { text: `Quote ready — ${usd.format(open.total)}`, tone: "amber" } : { text: "Quote turned down", tone: "muted" };
  }
  if (stage === 1) return { text: `${org ?? "A contractor"} is on it`, tone: "accent" };
  return { text: "Waiting for a contractor", tone: "muted" };
}

/** The words under the progress bar: "Step 2 of 6 · contractor matched Oct 29". */
export function stepCaption(p: RequestPortalView, tz: string): string {
  const stage = stageOf(p);
  const lastEvent = p.events.length ? p.events[p.events.length - 1].at : null;
  const latestQuote = p.proposals.filter((q) => q.current && q.sentAt).map((q) => q.sentAt!).sort().pop() ?? null;
  const when: Array<{ words: string; at: string | null }> = [
    { words: "sent", at: p.submittedAt },
    { words: "contractor matched", at: p.current?.matchedAt ?? lastEvent },
    { words: "quote received", at: latestQuote ?? lastEvent },
    { words: "quote approved", at: lastEvent },
    { words: "work scheduled for", at: p.visits[0]?.startsAt ?? null },
    { words: "work done", at: lastEvent },
  ];
  const w = when[stage];
  return `Step ${stage + 1} of 6 · ${w.words}${w.at ? ` ${shortDate(w.at, tz)}` : ""}`;
}

/** What the homeowner has to do on a project, if anything — a plain sentence and the one button for "Needs you". */
export function needOf(p: RequestPortalView, h: Pick<HomeDashboard, "key" | "folders" | "needs">): { text: string; label: string; href: string } | null {
  const page = projectHref(h.key, p.token);
  const org = p.current?.org.name ?? null;
  const open = p.proposals.find(isOpenQuote) ?? null;
  const won = p.proposals.find(isWonQuote) ?? null;
  const asks = (h.folders[p.token]?.requests ?? []).filter((r) => !r.fulfilledAt);
  const what = projectTitle(p).toLowerCase();
  if (org && p.changeOrders.length > 0) return { text: `A change to your ${what} quote needs your OK`, label: "Review change", href: `/co/${encodeURIComponent(p.changeOrders[0].token)}` };
  if (open) return { text: `${open.orgName} sent a quote for ${usd.format(open.total)}`, label: "Open quote", href: quoteHref(open.publicId) };
  if (won && won.nextDue && won.remaining > 0 && won.payOnline) return { text: `${won.nextDue.label} of ${usd.format(won.nextDue.amount)} is due to ${won.orgName}`, label: `Pay ${usd.format(won.nextDue.amount)}`, href: quoteHref(won.publicId) };
  if (asks.length > 0) return { text: `${asks[0].orgName} asked for photos${asks[0].note ? ` — “${asks[0].note}”` : ` of your ${what} project`}`, label: "Add photos", href: `${page}#files` };
  if (stageOf(p) === 5 && org) {
    const review = h.needs.find((n) => n.kind === "review" && n.text.startsWith(org));
    if (review) return { text: `How did ${org} do on your ${what}? Tell the next homeowner`, label: "Leave a review", href: review.href };
  }
  return null;
}
