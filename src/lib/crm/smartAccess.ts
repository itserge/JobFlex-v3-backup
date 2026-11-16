// SMART CRM ON THIS PLAN — what the CRM screens draw (owner, 2026-11-16: "the paid CRM and the basic CRM work
// separately, no conflicts"). Pure and client-safe; the server answer is lib/crm/smartAccessServer.
//
// The BASIC CRM is every plan's: Today's checks, the Customers book, Overview, the follow-up rules (a timer: N days
// after the proposal moves, the standard words go, stopped by a reply, a signature or a payment), the Follow-up queue,
// Leads and the client's timeline. SMART CRM is the paid part (lib/customPlan PAID_FEATURES "smart-crm"): the Inbox,
// the Pipeline, Win back, the company pulse, the Today band (follow-ups waiting for a yes, promises), the client 360
// (AI summary, what they told you, promises, the same person twice, their own page), and the follow-up agent's
// choices — "Ask me first", "Just remind me", words written for each client.
//
// Where Smart CRM is closed the screens never show its parts as if they worked: a shop on the new plans (Base + Tools)
// simply doesn't see the Inbox and Pipeline tabs — the owner's "no locks" rule, the menu already leaves them out —
// and where a part has its own place (Win back, the pulse, the client 360) one card says what it does and how to get
// it. The server refuses every Smart CRM action either way (lib/customPageAccess).

export interface SmartCrmAccess {
  /** Smart CRM is open on this plan. */
  open: boolean;
  /** Closed because the shop is on the new plans without the Smart CRM tool. */
  tools: boolean;
  /** Closed because the plan ended — the Free plan among them. */
  ended: boolean;
  /** The person looking is the account owner — the one who can add it or choose a plan. */
  owner: boolean;
}

/** Everything open — what a screen assumes when it was not told (never closes anything by mistake). */
export const SMART_CRM_OPEN: SmartCrmAccess = { open: true, tools: false, ended: false, owner: true };

/** The CRM sheet's Inbox and Pipeline tabs: drawn when Smart CRM is open, and for any shop whose plan ended (they lead
 *  to the plan-ended page, as its menu rows do — a lapsed new-plan shop is answered as a lapsed Classic one); left
 *  out for a new-plan shop that simply doesn't have the tool. */
export function smartTabsShown(a: SmartCrmAccess): boolean {
  return a.open || a.ended || !a.tools;
}

/** The follow-up rule editor offers "Who sends it" and "Words" only with Smart CRM. Without it a rule is the basic
 *  timer: on its own, the standard words — and a rule set otherwise before keeps what it was set to (the server
 *  keeps it: actions/followUps upsertFollowUpRule), so nothing the owner asked to approve is ever sent on its own. */
export function agentChoicesShown(a: SmartCrmAccess): boolean {
  return a.open;
}

/** A rule set to wait for a person, on a plan without Smart CRM: where it waits — the desk's "Follow-up queue", the
 *  phone's "Due". */
export function waitsInQueueNote(queue: "Follow-up queue" | "Due" = "Follow-up queue"): string {
  return `This rule waits for your OK ${queue === "Due" ? "on the Due tab" : "in the Follow-up queue"} — press Send there.`;
}

/** The places a closed Smart CRM part has of its own. */
export type SmartOfferPlace = "winback" | "pulse" | "client";

const WHAT: Record<SmartOfferPlace, { title: string; line: string }> = {
  winback: {
    title: "Bring clients back",
    line: "JobFlex finds past clients in your own records, writes them one email in your name, and shows what came of it.",
  },
  pulse: {
    title: "Company pulse",
    line: "New leads, first replies, proposals and wins, week by week — and the same numbers by email every Monday.",
  },
  client: {
    title: "Know this client at a glance",
    line: "An AI summary of where they stand, what they told you, promises both ways, their own page, and a warning when the same person is saved twice.",
  },
};

export interface SmartOffer {
  title: string;
  line: string;
  /** Why it is closed, when it isn't simply "not on the plan yet". */
  why: string | null;
  /** Show the tool's monthly price (a new-plan shop, the owner looking). */
  price: boolean;
  button: { label: string; href: "/dashboard/subscription#tools" | "/dashboard/subscription" } | null;
  /** For someone who can't add it. */
  note: string | null;
}

/** The card a closed Smart CRM part shows in its own place. */
export function smartOffer(a: SmartCrmAccess, place: SmartOfferPlace): SmartOffer {
  const { title, line } = WHAT[place];
  if (a.ended) {
    return {
      title,
      line,
      why: "Your plan has ended, so Smart CRM is closed.",
      price: false,
      button: a.owner ? { label: "See plans", href: "/dashboard/subscription" } : null,
      note: a.owner ? null : "Ask the account owner to choose a plan.",
    };
  }
  if (a.tools) {
    return {
      title,
      line,
      why: null,
      price: a.owner,
      button: a.owner ? { label: "See it in Upgrade your plan", href: "/dashboard/subscription#tools" } : null,
      note: a.owner ? null : "Ask the account owner to add Smart CRM.",
    };
  }
  return {
    title,
    line,
    why: "Smart CRM isn't on your plan.",
    price: false,
    button: a.owner ? { label: "See plans", href: "/dashboard/subscription" } : null,
    note: a.owner ? null : "Ask the account owner about Smart CRM.",
  };
}
