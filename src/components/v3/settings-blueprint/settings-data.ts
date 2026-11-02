/**
 * COPY + SHAPES for the Settings blueprint page.
 *
 * Every label, card title, sub-line and option list below is transcribed
 * VERBATIM from the donor file `jobflex-settings-blueprint (6).html`, lines
 * 2004-2131. HTML entities are stored as their real characters (¢ – — • & £ € ✓).
 *
 * What this file no longer holds is DATA. The donor's fixture values (the
 * "Ivan Petrov" profile, the two invented cards, the fake plan and payment
 * history, the imaginary Gmail/Meta connection, the notification matrix) were
 * replaced by the `SettingsData` object at the bottom of this file, which
 * src/app/dashboard/settings/page.tsx builds from the database and threads down
 * to each pane. The types and the copy are unchanged — only the values moved.
 *
 * No server imports here: this module is read by the server page AND by the
 * five "use client" panes, so it must stay free of Prisma and "use server".
 */

import type { FreeLoss, FreeTally } from "@/lib/freePlan";
import type { TrialExtensionOffer } from "@/lib/trialExtension";

/* ------------------------------------------------------------------ */
/* Shared primitive types                                              */
/* ------------------------------------------------------------------ */

/** Every sprite symbol id used by the settings page. */
import type { PaymentConnectionStatusView } from '@/lib/payments/connections';
import type { OrgFinancing, ReadinessItem } from '@/lib/financing/state';
import type { NotificationPrefs, PrefKey } from '@/lib/notificationPrefsShared';
import type { SmsRegistrationView } from '@/lib/sms/registrationShared';
import type { CompanyFacts, DeskProfile } from '@/lib/aiDesk/profile';
import type { DeskReviewItem } from '@/lib/aiDesk/tradePresets';
import type { ForwardCheck } from '@/lib/aiDesk/forwardCheck';
import type { CallsGo, DeskBalance, DeskForwarding, DeskMode, DeskPackRecord, DeskUse, DeskVoice } from '@/lib/aiDesk/shared';

export type IconName =
  | 'i-arrow'
  | 'i-bank'
  | 'i-bell'
  | 'i-board'
  | 'i-box'
  | 'i-cal'
  | 'i-card'
  | 'i-check'
  | 'i-clock'
  | 'i-download'
  | 'i-ext'
  | 'i-eye-off'
  | 'i-file'
  | 'i-globe'
  | 'i-google'
  | 'i-grid'
  | 'i-hardhat'
  | 'i-hourglass'
  | 'i-mail'
  | 'i-pen'
  | 'i-phone'
  | 'i-plus'
  | 'i-receipt'
  | 'i-send'
  | 'i-target'
  | 'i-thumb'
  | 'i-trash'
  | 'i-undo'
  | 'i-users'
  | 'i-x';

/** Donor `.badge2` tone classes. */
export type BadgeTone = 'bg-live' | 'bg-ok' | 'bg-off' | 'bg-bad' | 'bg-warn';

export interface Badge {
  readonly label: string;
  readonly tone: BadgeTone;
}

/** Donor `.sc-h` card header. */
export interface CardHead {
  readonly title: string;
  readonly sub: string;
  readonly badge?: Badge;
}

/** Donor `.fld > .fin` text input. */
export interface FieldSpec {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

/** Donor `.trow` — a labelled row whose only control is a `.tg` switch. */
export interface ToggleRow {
  readonly name: string;
  readonly desc: string;
  readonly on: boolean;
}

/** A `.btn` inside a row / card. */
export interface ActionSpec {
  readonly label: string;
  readonly icon?: IconName;
  /** Donor `.btn-ghost` state modifier: `is-on` (blueprint) / `is-off` (bad). */
  readonly state?: 'is-on' | 'is-off';
}

/** A custom `Sel` dropdown: donor `<option>` list + the `selected` one. */
export interface SelectSpec {
  readonly label: string;
  readonly options: readonly string[];
  readonly defaultValue: string;
}

/* ------------------------------------------------------------------ */
/* Page chrome                                                         */
/* ------------------------------------------------------------------ */

export const PAGE_TITLE = 'Settings' as const;

/** `.pane-k` eyebrow above every pane title. */
export const PANE_KICKER = 'Settings' as const;

export const SAVE_LABEL = 'Save changes' as const;
export const SAVED_LABEL = 'Saved' as const;
export const COPY_LABEL = 'Copy' as const;
export const COPIED_LABEL = 'Copied' as const;

/* ------------------------------------------------------------------ */
/* Rail                                                                */
/* ------------------------------------------------------------------ */

export type RailKey =
  | 'account'
  | 'billing'
  | 'integrations'
  | 'notifications'
  | 'desk'
  | 'estimating'
  | 'website'
  | 'smartbook';

export interface RailItem {
  readonly key: RailKey;
  readonly label: string;
  readonly icon: IconName;
  /** Renders the `.rail-new` NEW badge. The `.kicker` still reads `label`. */
  readonly isNew?: boolean;
  /** One line under the pane's title saying what the pane is for (2026-10-14: Texting and the AI desk sit
   *  one above the other in the scroll, and the owner read the team's texts as part of the desk). */
  readonly sub?: string;
}

export const RAIL_ITEMS: readonly RailItem[] = [
  { key: 'account', label: 'Account', icon: 'i-users' },
  { key: 'billing', label: 'Billing', icon: 'i-receipt' },
  // Payments joined Integrations on 2026-10-30 (owner): one section, the processors are its Stripe / Square / Stax tabs.
  { key: 'integrations', label: 'Integrations / Payments', icon: 'i-globe' },
  { key: 'notifications', label: 'Notifications', icon: 'i-bell' },
  // SmartBook (2026-10-31): new leads — Facebook, the website estimators, Lead Center, the AI desk — get open times
  // from the calendar by text and email and book themselves; a time they name comes to the company to confirm.
  { key: 'smartbook', label: 'SmartBook', icon: 'i-cal', isNew: true, sub: 'New leads get open times from your calendar by text and email and book themselves. A time they name comes to you first.' },
  // Texting left Settings on 2026-10-16 for its own page, /dashboard/texting (sidebar → Automation, under AI desk);
  // ?pane=texting and ?tab=texting redirect there (app/dashboard/settings/page.tsx).
  // Estimating (2026-10-16): the company's own estimating method — labor by the crew-hour or person-hour, its markup,
  // overhead, profit and sales-tax rule — for Smart Proposal and the video estimator. Off until the company turns it on.
  { key: 'estimating', label: 'Estimating', icon: 'i-hardhat', isNew: true, sub: 'Your own labor rate, markup and sales-tax rule for Smart Proposal and video estimates.' },
  // Website estimators (2026-10-27): the shop's estimators on its own website — a link, a button or a frame; the
  // homeowner's price in the shop's prices, their request on My leads. In preview (platform admins) until the owner
  // opens it: settings-content hides the rail item when data.website.visible is false.
  { key: 'website', label: 'Website estimators', icon: 'i-globe', isNew: true, sub: 'Put your roof, HVAC, fence or deck estimator on your own website — the price in your prices, the request on My leads.' },
];

export const RAIL_NEW_BADGE = 'NEW' as const;

/** A ?tab= / ?pane= value as a rail key. `payments` is the section's old name — the OAuth returns, emails and
 *  guides still link to it — and opens Integrations / Payments. */
export function railKeyFor(raw: string | null | undefined): RailKey | undefined {
  if (raw === 'payments') return 'integrations';
  return RAIL_ITEMS.some((r) => r.key === raw) ? (raw as RailKey) : undefined;
}

/** Donor default `.kicker` text (matches the initially active rail item). */
export const DEFAULT_RAIL: RailKey = 'account';

/* ------------------------------------------------------------------ */
/* Account pane                                                        */
/* ------------------------------------------------------------------ */

export const PROFILE_CARD: CardHead = {
  title: 'Profile',
  sub: 'Visible to your team and on outgoing emails.',
};

/** Donor field labels. The values come from the signed-in User row. */
export const PROFILE_LABELS = {
  name: 'Full name',
  email: 'Email',
  phone: 'Phone',
} as const;

export const BUSINESS_CARD: CardHead = {
  title: 'Business',
  sub: 'Shown on proposals, invoices and your public portal.',
};

/**
 * Donor field labels. The donor's fourth field was "License №", which has no
 * column on Organization — it is replaced by Phone, which does (and which
 * `updateBusiness` writes alongside the other three).
 */
export const BUSINESS_LABELS = {
  name: 'Business name',
  address: 'Address',
  website: 'Website',
  phone: 'Phone',
} as const;

export const SECURITY_CARD: CardHead = {
  title: 'Security',
  sub: 'Password and where you are signed in.',
};

export type SecurityKey = 'password' | 'sessions';

/** F1 renders these three as one row of three `.seccol` columns. */
export interface SecurityItem {
  readonly key: SecurityKey;
  readonly icon: IconName;
  readonly name: string;
  readonly action: string;
  readonly badge?: Badge;
}

export const SECURITY_ITEMS: readonly SecurityItem[] = [
  { key: 'password', icon: 'i-eye-off', name: 'Password', action: 'Change' },
  { key: 'sessions', icon: 'i-users', name: 'Active sessions', action: 'Log out everywhere' },
];

export const SIGN_OUT_LABEL = 'Log out' as const;

/** Delete account — a launch-time debugging aid (owner's call, 2026-09-03):
 *  HARD delete of the signed-in user and any company they alone belong to,
 *  so the same address can be registered again. Slated for removal at launch. */
export const DELETE_ACCOUNT_CARD: CardHead = {
  title: 'Delete account',
  sub: 'Removes you and any company you are the only owner of. Immediate, no undo.',
  badge: { label: 'Testing', tone: 'bg-warn' },
};
export const DELETE_ACCOUNT_ROW = {
  name: 'Delete my account',
  action: { label: 'Delete', icon: 'i-trash' } as ActionSpec,
} as const;
export const DELETE_ACCOUNT_MODAL = {
  title: 'Delete account',
  sub: 'Type your email address exactly to confirm.',
  inputLabel: 'Email address',
  confirmLabel: 'Delete my account',
  cancelLabel: 'Keep it',
  mismatch: "That doesn't match your email address.",
} as const;
export function deleteAccountDesc(email: string, orgName: string): string {
  return `Deletes ${email} for good. If nobody else owns ${orgName}, the company goes too — its subscription is cancelled at once, and its proposals, leads, jobs and payment history are deleted (right away when you are its only member, after 30 days when it has a team). You can register the same address again afterwards.`;
}

/* ------------------------------------------------------------------ */
/* Payments pane — processors                                          */
/* ------------------------------------------------------------------ */

export const PROCESSORS_CARD: CardHead = {
  title: 'Get paid',
  sub: 'Connect your own Stripe or Square — clients pay each stage of an accepted proposal straight to you.',
};

/** Which row this is. Stripe / Square join by OAuth or a pasted key; Stax by
 *  a pasted key only; bank is manual. */
export type ProcessorKey = 'stripe' | 'square' | 'stax' | 'bank';
/** The providers with a paste-a-key way in. */
export type KeyProvider = 'stripe' | 'square' | 'stax';

export interface Processor {
  readonly key: ProcessorKey;
  readonly icon: IconName;
  readonly name: string;
  readonly desc: string;
}

export const PROCESSORS: readonly Processor[] = [
  {
    key: 'stripe',
    icon: 'i-card',
    name: 'Stripe',
    desc: 'Cards, Apple Pay, Google Pay — and ACH bank debits if you switch them on.',
  },
  {
    key: 'square',
    icon: 'i-grid',
    name: 'Square',
    desc: 'Square-hosted checkout on your Square account.',
  },
  {
    key: 'bank',
    icon: 'i-bank',
    name: 'Bank transfer',
    desc: 'Show your bank details on accepted proposals; you mark each stage paid when it lands.',
  },
  {
    key: 'stax',
    icon: 'i-card',
    name: 'Stax',
    desc: 'Stax Pay hosted invoice on your own Stax merchant account.',
  },
];

/** A processor the platform has not enabled yet — the row's action slot
 *  carries this instead of an empty column, so every row ends at the same
 *  right edge. */
export const PROCESSOR_UNAVAILABLE_BADGE: Badge = { label: 'Unavailable', tone: 'bg-off' };

export const CONNECT_ACTION: ActionSpec = { label: 'Connect', icon: 'i-plus', state: 'is-on' };
export const DISCONNECT_ACTION: ActionSpec = { label: 'Disconnect', icon: 'i-x', state: 'is-off' };
export const MANAGE_ACTION: ActionSpec = { label: 'Manage', icon: 'i-arrow' };
export const RECONNECT_ACTION: ActionSpec = { label: 'Reconnect', icon: 'i-undo', state: 'is-on' };

/** Sub-line under a connected row. */
export function stripeConnLine(s: {
  accountId: string | null;
  livemode: boolean | null;
  chargesEnabled: boolean;
  auth?: 'oauth' | 'key' | null;
  keyLast4?: string | null;
}): string {
  const id =
    s.auth === 'key'
      ? `API key ····${s.keyLast4 ?? ''}`
      : s.accountId
        ? s.accountId.slice(0, 12) + '…'
        : 'connected';
  return `${id} · ${s.livemode === false ? 'Test mode' : 'Live'} · ${s.chargesEnabled ? 'charges enabled' : 'charges paused'}`;
}

/** The paste-a-key way in (2026-09-12/13): the contractor pastes their own
 *  credential instead of going through OAuth — a Stripe secret / restricted
 *  key, a Square personal access token, a Stax merchant API key. Same
 *  portal, same settle pipeline; the platform fee is billed on their JobFlex
 *  invoice because none of these can split a payment without a platform app. */
export interface KeyFormCopy {
  readonly title: string;
  readonly desc: string;
  readonly label: string;
  readonly placeholder: string;
  readonly show: string;
  readonly submit: string;
  readonly busy: string;
  readonly cancel: string;
  readonly or: string;
  /** Sandbox / test-mode caveat. */
  readonly note: string;
  readonly feeNote: (pct: number) => string;
  readonly webhookMissing: string;
  readonly action: ActionSpec;
}
export const KEY_FORMS: Record<KeyProvider, KeyFormCopy> = {
  stripe: {
    title: 'Paste a Stripe API key',
    desc: 'Stripe Dashboard → Developers → API keys → Create restricted key. Enable Accounts Read, Checkout Sessions Write, Webhook Endpoints Write, and Read for PaymentIntents, Charges and Refunds. Stored encrypted; never shown again.',
    label: 'Restricted or secret key',
    placeholder: 'rk_live_…',
    show: 'Show key',
    submit: 'Connect with this key',
    busy: 'Checking with Stripe…',
    cancel: 'Cancel',
    or: 'or',
    note: 'A test key (rk_test_… or sk_test_…) connects in test mode — real cards will not work.',
    feeNote: (pct) =>
      `With a pasted key the ${pct}% platform fee can't come out of the payment — it's added to your JobFlex invoice instead.`,
    webhookMissing:
      'Connected, but the webhook could not be registered on your Stripe account — payments still confirm when the client returns to the proposal and on the reconcile check; refunds made in Stripe won’t sync. Disconnect and reconnect to retry.',
    action: { label: 'Use API key', icon: 'i-card', state: 'is-on' },
  },
  square: {
    title: 'Paste a Square access token',
    desc: 'developer.squareup.com → your application (create one if you have none) → Credentials → Production access token. Stored encrypted; never shown again.',
    label: 'Access token',
    placeholder: 'EAAA…',
    show: 'Show token',
    submit: 'Connect with this token',
    busy: 'Checking with Square…',
    cancel: 'Cancel',
    or: 'or',
    note: 'A sandbox token connects your sandbox — real cards will not work.',
    feeNote: (pct) =>
      `With a pasted token the ${pct}% platform fee can't come out of the payment — it's added to your JobFlex invoice instead.`,
    webhookMissing:
      'Connected, but the webhook subscription could not be registered on your Square app — payments still confirm when the client returns to the proposal and on the reconcile check; refunds made in Square won’t sync. Disconnect and reconnect to retry.',
    action: { label: 'Use access token', icon: 'i-card', state: 'is-on' },
  },
  stax: {
    title: 'Paste a Stax API key',
    desc: 'Stax Pay → Apps → API Keys → New Key. Stored encrypted; never shown again. Clients pay each stage on Stax’s hosted bill page.',
    label: 'API key',
    placeholder: 'eyJ…',
    show: 'Show key',
    submit: 'Connect with this key',
    busy: 'Checking with Stax…',
    cancel: 'Cancel',
    or: 'or',
    note: 'A sandbox merchant’s key connects your sandbox — real cards will not work.',
    feeNote: (pct) =>
      `Stax takes nothing for JobFlex inside the payment — the ${pct}% platform fee is added to your JobFlex invoice instead.`,
    webhookMissing:
      'Connected, but the webhooks could not be registered on your Stax account — payments confirm on the reconcile check; refunds made in Stax won’t sync. Disconnect and reconnect to retry.',
    action: { label: 'Use API key', icon: 'i-card', state: 'is-on' },
  },
};
export const STRIPE_KEY_FORM = KEY_FORMS.stripe;
export const STRIPE_KEY_ACTION: ActionSpec = KEY_FORMS.stripe.action;
export const KEY_WEBHOOK_REGISTERED = 'Registered on your account by JobFlex when you connected.' as const;
export const STRIPE_WEBHOOK_REGISTERED = KEY_WEBHOOK_REGISTERED;
export const STRIPE_KEY_PERMISSIONS_CARD: CardHead = {
  title: 'Permissions',
  sub: 'What the key must be allowed to do. A full secret key has all of it; build a restricted key with exactly these.',
};
export const SQUARE_TOKEN_PERMISSIONS_CARD: CardHead = {
  title: 'Permissions',
  sub: 'What the token is used for. A personal access token carries every permission of the app it belongs to.',
};
export function squareConnLine(s: {
  merchantId: string | null;
  locationName: string | null;
  env: string;
  auth?: 'oauth' | 'token' | null;
  tokenLast4?: string | null;
}): string {
  const head = s.auth === 'token' ? `Access token ····${s.tokenLast4 ?? ''} · ` : '';
  return `${head}${s.locationName ?? s.merchantId ?? 'connected'} · ${s.env === 'sandbox' ? 'Sandbox' : 'Production'}`;
}
export function staxConnLine(s: { merchantId: string | null; merchantName: string | null; keyLast4: string | null }): string {
  return `API key ····${s.keyLast4 ?? ''} · ${s.merchantName ?? s.merchantId ?? 'connected'}`;
}

/** One line of copy per non-healthy state. */
export const PROCESSOR_STATE_COPY = {
  not_configured: 'Not available on this platform yet.',
  disconnected: 'Not connected.',
  restricted: 'Connected, but the account cannot take payments right now — check your provider dashboard.',
  mode_mismatch: 'Connected in a different mode than the platform is running. Reconnect to fix.',
  revoked: 'Access was removed from the provider dashboard. Reconnect to take payments again.',
  token_expired: 'The connection expired. Reconnect to take payments again.',
  connected: '',
} as const;

export const STRIPE_ACH_TOGGLE = {
  name: 'Accept ACH bank debits',
  desc: 'Adds "US bank account" to your Stripe checkout. Clears in 1–3 business days.',
} as const;

export const BANK_TRANSFER_LABELS = {
  enabled: 'Offer bank transfer',
  enabledDesc: 'Shown to clients on accepted proposals, next to the card buttons.',
  instructions: 'Bank details shown to clients',
  placeholder: 'Bank name · Account name · Routing / Account number · Reference: proposal number',
} as const;

/** Card footnote — two annotations, not a paragraph. */
export const PAYOUT_NOTE_KICKER = 'Payouts' as const;
export const PAYOUT_NOTE = 'Land in your own Stripe or Square account on their normal schedule.' as const;
export const FEE_NOTE_KICKER = 'Platform fee' as const;
/** `onInvoice`: providers joined with a pasted key / token, whose fee is
 *  billed on the JobFlex invoice instead of inside the payment. */
export function platformFeeLine(pct: number, onInvoice: readonly string[] = []): string {
  const base = `${pct}% of payments collected through Stripe, Square or Stax. Bank transfers carry no fee.`;
  if (!onInvoice.length) return base;
  const names = onInvoice.length === 1 ? onInvoice[0] : `${onInvoice.slice(0, -1).join(', ')} and ${onInvoice[onInvoice.length - 1]}`;
  return `${base} ${names} ${onInvoice.length === 1 ? 'is' : 'are'} joined with your own key, so that fee is added to your JobFlex invoice.`;
}

/* ------------------------------------------------------------------ */
/* Payments pane — defaults                                            */
/* ------------------------------------------------------------------ */

export const PAYMENT_DEFAULTS_CARD: CardHead = {
  title: 'Defaults',
  sub: 'Seeded into every new proposal.',
};

export const CURRENCY_OPTIONS: readonly string[] = [
  'USD · $',
  'CAD · $',
  'GBP · £',
  'EUR · €',
];
export const CURRENCY_DEFAULT = 'USD · $' as const;

export const NET_TERMS_OPTIONS: readonly string[] = [
  'Due on receipt',
  'Net 7',
  'Net 14',
  'Net 30',
];
export const NET_TERMS_DEFAULT = 'Net 14' as const;

/** Deposit % is the first stage of a new proposal's payment schedule. */
export const PAYMENT_DEFAULT_LABELS = {
  depositPct: 'Default deposit %',
} as const;

/** `paymentSettingsJson.currency` is stored bare ("USD"); the donor's dropdown
 *  shows it with its symbol ("USD · $"). These two keep the pair in step. */
export function currencyOptionFor(code: string): string {
  const match = CURRENCY_OPTIONS.find((o) => o.split(' ')[0] === code);
  return match ?? CURRENCY_DEFAULT;
}
export function currencyCodeFor(option: string): string {
  return option.split(' ')[0] ?? 'USD';
}

/* ------------------------------------------------------------------ */
/* Payments pane — automations + compliance                            */
/* ------------------------------------------------------------------ */

export const PAYMENT_AUTOMATIONS_CARD: CardHead = {
  title: 'Automations',
  sub: 'What happens on its own when money lands.',
};

/** Keys into `PaymentSettings`. */
export type PaymentAutomationKey = 'receiptsOnPayment';

export interface PaymentAutomationRow {
  readonly key: PaymentAutomationKey;
  readonly name: string;
  readonly desc: string;
}

export const PAYMENT_AUTOMATIONS: readonly PaymentAutomationRow[] = [
  {
    key: 'receiptsOnPayment',
    name: 'Receipts on payment',
    desc: 'Emails the client a receipt the moment a stage is paid — card, Square or recorded by hand.',
  },
];

/* ------------------------------------------------------------------ */
/* Billing pane                                                        */
/* ------------------------------------------------------------------ */

export const PLAN_CARD: CardHead = {
  title: 'Your plan',
  sub: 'Active subscription',
};

/** Donor `.plan-meta` prefixes. The figures after them are read from the
 *  Subscription row and the plan's own seat limit. */
export const PLAN_META_PREFIX = {
  nextBill: 'Next bill · ',
  seats: 'Seats used · ',
} as const;

export const PLAN_PRIMARY_ACTION: ActionSpec = { label: 'Manage subscription', icon: 'i-arrow' };
export const PLAN_ASK_OWNER = {
  label: 'Ask your owner',
  desc: 'Only the organization owner can change the plan or billing.',
} as const;
export const PLAN_CARD_NOTE = 'Plans, payment method and invoices live on the subscription page.' as const;
/** The card's sub-line once the company is on Free, or is moving there. */
export const PLAN_CARD_SUB_FREE = 'Free plan · nothing is billed';
export const PLAN_CARD_SUB_SWITCHING = 'Switches to Free at the end of the cycle';

export const BILLING_CONTACT_CARD: CardHead = {
  title: 'Billing contact',
  sub: 'Where invoices and dunning notices go.',
};

/** The donor's second field, "Tax ID", has no column and no processor hand-off,
 *  so it is not rendered — a text box that saves nowhere is worse than none. */
export const BILLING_CONTACT_LABELS = { billingEmail: 'Billing email' } as const;

/* ------------------------------------------------------------------ */
/* Integrations pane — subtabs                                         */
/* ------------------------------------------------------------------ */

/** `getpaid` is the phone's Get paid tab (processor summary, bank transfer, defaults); the desktop has no such tab. */
export type SubTabKey = 'getpaid' | 'gmail' | 'meta' | 'ramp' | 'stripe' | 'square' | 'stax' | 'financing';

export interface SubTab {
  readonly key: SubTabKey;
  readonly label: string;
}

/** An integration the PLATFORM has not switched on yet. The person can still
 *  read the tab (and an operator with access can still connect), but the badge
 *  says plainly that it is not open to everyone yet. It clears itself the
 *  moment the platform credentials are in place — see loadSettingsData. */
export const COMING_SOON_BADGE: Badge = { label: 'Coming soon', tone: 'bg-off' };
export const COMING_SOON_TAB = 'Soon' as const;

/** The line above a not-yet-live integration's cards. */
export function comingSoonNote(name: string): string {
  return `${name} isn't switched on for everyone yet. We're finishing the setup — you'll be able to connect it here as soon as it goes live.`;
}

/* Meta is discoverable for every workspace. Connection and import controls
   retain the server-provided availability and manager permissions. Gmail
   remains visible only for enabled or previously connected accounts. */
export const INTEGRATION_SUBTABS: readonly SubTab[] = [
  { key: 'meta', label: 'Meta business' },
  { key: 'ramp', label: 'Ramp cards' },
  { key: 'stripe', label: 'Stripe' },
  { key: 'square', label: 'Square' },
  { key: 'stax', label: 'Stax' },
];

/** Add Gmail for viewers who can use or reconnect it, and Financing (Wisetack, 2026-10-28) once JobFlex lets the account in. */
export function integrationSubTabs(show: { gmail: boolean; financing?: boolean }): readonly SubTab[] {
  const lead: SubTab[] = [];
  if (show.gmail) lead.push({ key: 'gmail', label: 'Gmail' });
  const tail: SubTab[] = show.financing ? [{ key: 'financing', label: 'Financing' }] : [];
  return [...lead, ...INTEGRATION_SUBTABS, ...tail];
}

export function isVisibleSubTab(key: SubTabKey | undefined, tabs: readonly SubTab[] = INTEGRATION_SUBTABS): boolean {
  return !!key && tabs.some((t) => t.key === key);
}

/* ------------------------------------------------------------------ */
/* Integrations — Gmail                                                */
/* ------------------------------------------------------------------ */

export const GMAIL_CONNECTION_CARD: CardHead = {
  title: 'Connection',
  sub: 'Send proposals and follow-ups from your own address.',
};

/** Donor badge pair — which one shows is decided by `gmailTokensJson`. */
export const CONNECTED_BADGE: Badge = { label: 'Connected', tone: 'bg-ok' };
export const NOT_CONNECTED_BADGE: Badge = { label: 'Not connected', tone: 'bg-off' };

export const GMAIL_CONNECT_ACTION: ActionSpec = {
  label: 'Connect Gmail',
  icon: 'i-google',
};

export const GMAIL_FROM_CARD: CardHead = {
  title: 'From address',
  sub: 'How outbound mail is signed.',
};

/** Donor field labels. The placeholders are the org's own name and the signed-in
 *  user's own email, not the donor's invented pair. */
export const GMAIL_FROM_LABELS = {
  displayName: 'Display name',
  replyTo: 'Reply-to address',
} as const;

export const GMAIL_BEHAVIOR_CARD: CardHead = {
  title: 'Behavior',
  sub: 'Quietly improve every send.',
};

/** Keys into `GmailSettings` — the flag each row reads and writes. */
export type GmailToggleKey = 'sendFromUser';

export interface GmailToggleRow {
  readonly key: GmailToggleKey;
  readonly name: string;
  readonly desc: string;
}

/** One toggle. "Track opens" and "Two-way thread sync" were rows with
 *  nothing behind them (sync would need a restricted read scope the app does
 *  not ask for) and left on 2026-09-20. */
export const GMAIL_BEHAVIOR_TOGGLES: readonly GmailToggleRow[] = [
  {
    key: 'sendFromUser',
    name: 'Send from my Gmail',
    desc: 'Outbound mail leaves from your connected address.',
  },
];

export const GMAIL_PERMISSIONS_CARD: CardHead = {
  title: 'Permissions',
  sub: 'Granted scopes. Disconnect revokes them at Google.',
};

/** Donor `&#10003;` inside each `.scope > i`. */
export const SCOPE_CHECK = '✓' as const;

/** Shown only once a connection exists; the list itself comes from
 *  `GMAIL_SCOPES` in src/lib/sdk/gmail.ts (two scopes, not the donor's four). */
export const GMAIL_SCOPES_EMPTY = 'No scopes granted — Gmail is not connected.' as const;

/* ------------------------------------------------------------------ */
/* Integrations — Meta business                                        */
/* ------------------------------------------------------------------ */

export const META_CONNECTION_CARD: CardHead = {
  title: 'Connection',
  sub: 'Pull Facebook and Instagram leads straight into JobFlex.',
};

/** The row's name is the org's own name; the sub-line states the real rule.
 *  The donor's "App ID 8842… · connected Feb 12, 2026." was invented, and its
 *  "Test event" button had nothing behind it, so neither survives. */
export const META_CONNECTION_ICON: IconName = 'i-globe';
export const META_CONNECTED_DESC =
  'Lead forms on your pages create leads in your pipeline.' as const;
export const META_CONNECT_ACTION: ActionSpec = { label: 'Connect Meta Business account' };
export const META_DISCONNECT_ACTION: ActionSpec = { label: 'Disconnect', state: 'is-off' };

/* ------------------------------------------------------------------ */
/* Integrations — Stripe / Square (the deep view of a payment link)     */
/* ------------------------------------------------------------------ */

export const PROCESSOR_CONNECTION_CARD: CardHead = {
  title: 'Connection',
  sub: 'Your own account — joined by OAuth, or with an API key you paste (kept encrypted, never shown again).',
};
export const PROCESSOR_BEHAVIOR_CARD: CardHead = {
  title: 'Behavior',
  sub: 'What the checkout offers.',
};
export const PROCESSOR_PERMISSIONS_CARD: CardHead = {
  title: 'Permissions',
  sub: 'Granted scopes — revoke any time from the provider dashboard.',
};
export const PROCESSOR_WEBHOOK_CARD: CardHead = {
  title: 'Webhook',
  sub: 'Where the provider reports payments. Set up for you; nothing to configure.',
};
export const PROCESSOR_SCOPES_EMPTY = 'No scopes granted — not connected.' as const;
export const PROCESSOR_LAST_EVENT_PREFIX = 'Last event received · ' as const;
export const PROCESSOR_NO_EVENTS = 'No events yet.' as const;
export const OPEN_DASHBOARD_LABEL = { stripe: 'Open Stripe dashboard', square: 'Open Square dashboard' } as const;
export const DASHBOARD_HREF = {
  stripe: 'https://dashboard.stripe.com',
  square: 'https://squareup.com/dashboard',
} as const;
export const OFFER_TOGGLE = {
  name: 'Offer at checkout',
  desc: 'Show this option to clients on accepted proposals.',
} as const;

/* ------------------------------------------------------------------ */
/* Notifications pane                                                  */
/* ------------------------------------------------------------------ */

export const NOTIFICATIONS_CARD: CardHead = {
  title: 'What reaches you',
  sub: 'Pick a channel per event. The bell always keeps a copy.',
};

/** Column order is load-bearing: index 1 is the "Email only" column, index 2
 *  the Text column (2026-09-24). */
export const NOTIFICATION_CHANNELS: readonly string[] = ['In-app', 'Email', 'Text'];

/** F17: the per-column `.colt` badge becomes a real `.colw` toggle. */
export const NOTIFICATION_COLUMN_LABEL = 'All' as const;

export const NOTIFICATION_EVENT_COLUMN = 'Event' as const;

/** F16 icon per event key (src/lib/notificationPrefsShared.ts owns the list). */
export const NOTIFICATION_ICONS: Record<PrefKey, IconName> = {
  'lead-assigned': 'i-target',
  'proposal-viewed': 'i-file',
  'proposal-accepted': 'i-check',
  'proposal-declined': 'i-x',
  'payment-received': 'i-bank',
  financing: 'i-bank',
  'billing-problems': 'i-card',
  'change-order': 'i-pen',
  'job-scheduled': 'i-cal',
  'job-started': 'i-clock',
  'job-completed': 'i-box',
  'job-photos': 'i-file',
  'expense-submitted': 'i-bank',
  'worker-responded': 'i-hardhat',
  'review-received': 'i-thumb',
  'trade-reply': 'i-board',
  'appointment-booked': 'i-cal',
  'booking-online': 'i-cal',
  'smartbook-request': 'i-cal',
  'appointment-moved': 'i-clock',
  'service-reminder': 'i-check',
  // Text-only crew events (never in the matrix) — listed so the map is total.
  'crew-assigned': 'i-hardhat',
  'crew-moved': 'i-clock',
  'crew-tomorrow': 'i-cal',
  'crew-today': 'i-cal',
};

export const EMAIL_UNAVAILABLE_TITLE = 'In-app only — nothing in the app emails this yet.' as const;
/** Drawn IN the cell instead of a ghost checkbox, so it cannot be mistaken
 *  for an unchecked box. */
export const EMAIL_UNAVAILABLE_TAG = 'In-app only' as const;

/** The In-app cell of an event the bell never carries (billing problems: the payment banner is the in-app notice). */
export const INAPP_UNAVAILABLE_TITLE = 'Shown as the payment banner in the app — always on.' as const;
export const INAPP_UNAVAILABLE_TAG = 'Banner' as const;

export type MatrixAction = 'enable-all' | 'email-only' | 'test';

export interface MatrixFooterAction {
  readonly label: string;
  readonly icon: IconName;
  readonly action: MatrixAction;
}

export const NOTIFICATION_FOOTER_ACTIONS: readonly MatrixFooterAction[] = [
  { label: 'Enable all', icon: 'i-check', action: 'enable-all' },
  { label: 'Email only', icon: 'i-mail', action: 'email-only' },
  { label: 'Send test notification', icon: 'i-send', action: 'test' },
];

/** "Email only" turns on this column index and clears the rest. */
export const EMAIL_COLUMN_INDEX = 1 as const;
/** The Text column (2026-09-24). */
export const SMS_COLUMN_INDEX = 2 as const;
export const SMS_UNAVAILABLE_TITLE = 'Nothing in the app texts this event.' as const;
export const SMS_UNAVAILABLE_TAG = 'No text' as const;

/* ------------------------------------------------------------------ */
/* Text messages card (2026-09-24) — User.smsPhone + NotificationPhone */
/* ------------------------------------------------------------------ */

export const TEXTS_CARD: CardHead = {
  title: 'Text messages',
  sub: 'Verify your mobile and tick Text on the events above. Texts wait for the morning; a new lead never waits.',
};

export const TEXTS_COPY = {
  mobileLabel: 'Your mobile',
  mobilePlaceholder: '(206) 555-0100',
  sendCode: 'Text me a code',
  // What a person agrees to at the moment they ask for the code (2026-10-02,
  // the carriers' opt-in rules for JobFlex's toll-free number).
  consent: 'By tapping Text me a code you agree to get texts at this number: your JobFlex code, and the job alerts you turn on, sent from your company’s texting number. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
  terms: 'Terms',
  privacy: 'Privacy Policy',
  codeLabel: 'The six digits',
  // Where the code went, and what to do when nothing comes (owner, 2026-10-14: "code didn't show up" — typed 424…, the row below had 425…).
  sentTo: (n: string) => `We texted ${n}.`,
  notYours: 'Not your number? Change it',
  sendAgain: 'Send again',
  codeHint: 'The code comes from a Twilio number, not your company’s. Nothing within a minute? Check the area code above, then Send again.',
  verify: 'Verify',
  change: 'Change',
  remove: 'Stop texting me',
  verified: 'Verified',
  noPhone: 'No mobile yet — nothing is texted to you.',
  extrasTitle: 'Also text',
  extrasSub: 'Extra office numbers get every office event — the dispatcher, whoever runs the books.',
  extraName: 'Name',
  extraPhone: 'Mobile',
  addExtra: 'Add number',
  pause: 'Pause',
  resume: 'Resume',
  removeExtra: 'Remove',
  quietTitle: 'Quiet hours',
  quietSub: 'Texts that land in this window wait, folded into one message at the end of it.',
  quietFrom: 'From',
  quietTo: 'Until',
  testText: 'Send me a test text',
  usage: (n: number, allowance: number) => `${n} of ${allowance} texts this month`,
  // A soft stop, nothing billed (owner, 2026-10-26 — lib/sms/send).
  allowanceNote: 'At the allowance, texts stop until next month — upgrade for more.',
  clientsTitle: 'Text clients',
  clientsSub: 'The proposal link the moment it is sent, and a reminder the evening before a visit — signed with your company name, with the STOP line.',
  clientsOn: 'On',
  clientsOff: 'Off',
  // JobFlex's own lead texts to the company phone (2026-10-02): the opt-in the JobFlex number is registered on.
  leadTitle: 'Lead texts from JobFlex',
  leadSub: 'When JobFlex reserves a homeowner lead for you, or one is about to pass to the next shop, we text the company phone.',
  leadConsent: 'By turning this on you agree to get texts from JobFlex at the company phone about your leads. Message frequency varies with your leads. Msg & data rates may apply. Reply STOP to opt out, HELP for help.',
  leadNoPhone: 'Add the company phone in Company settings first.',
  ownTitle: 'Your own number',
  ownSub: 'A local number in your area code that your texts show and clients can reply to. It stays on the JobFlex account, registered with the carriers.',
  ownGet: 'Get my own number',
  ownRelease: 'Release it',
  ownCost: 'Billed through at cost.',
  notConfigured: 'Texting is not set up on this server yet — numbers are kept, nothing is sent.',
  stopped: 'replied STOP',
} as const;

export interface ExtraPhoneData {
  id: string;
  name: string;
  /** Pretty, for the eye: "(206) 555-0100". */
  phone: string;
  active: boolean;
  /** The number replied STOP — texts to it are blocked until it texts START. */
  stopped: boolean;
}

export interface SmsSettingsData {
  /** The platform has a Twilio number configured. */
  configured: boolean;
  /** The member's verified mobile, pretty, or null. */
  phone: string | null;
  verifiedAt: string | null;
  stopped: boolean;
  extras: ExtraPhoneData[];
  /** Texts the company sent this month, and the plan's monthly allowance. */
  monthCount: number;
  allowance: number;
  canManage: boolean;
  /** Client-facing texts (the proposal link, a reminder before a visit). */
  clientsOn: boolean;
  /** The company's own number, pretty, when it claimed one. */
  ownNumber: string | null;
  /** The company's own texting number, registered in its name (2026-10-02); managers only. */
  registration: SmsRegistrationView | null;
  /** JobFlex's lead texts to the company phone (2026-10-02): on only after the company turns them on. */
  leadTexts: { on: boolean; phone: string | null };
  /** Who gets texted (2026-09-27): the office members with their verified
   *  mobile (pretty, or null) and the three group switches. */
  roster: SmsRosterRow[];
  /** Your own texts (2026-09-29): the company's rules, oldest first. */
  rules: TextRuleRow[];
  /** The company's name, as its texts are signed. */
  companyName: string;
}

export interface TextRuleRow {
  id: string;
  name: string;
  trigger: string;
  offset: number | null;
  toClient: boolean;
  toOffice: boolean;
  toRep: boolean;
  toCrew: boolean;
  toUserIds: string[];
  body: string;
  active: boolean;
}

export interface SmsRosterRow {
  userId: string;
  name: string;
  role: string;
  /** The roster the member sits on (2026-09-29): office, sales or crew. */
  audience: 'office' | 'sales' | 'crew';
  /** The mobile texts go to, pretty — null when nothing is texted to them. */
  phone: string | null;
  /** A number on file that is not being texted (a worker with texting off). */
  phoneOnFile: string | null;
  /** Verified by them with a code, or typed in by the office. */
  phoneBy: 'self' | 'office' | null;
  /** The number replied STOP. */
  stopped: boolean;
  /** A mobile is on file but texts to them are switched off (2026-10-13). */
  paused: boolean;
  isMe: boolean;
  /** Their Text switch per event of their roster. */
  cells: Record<string, boolean>;
  /** The three office switches (the handheld page still shows them). */
  groups: Record<'crew' | 'sales' | 'money', boolean>;
}

export const TEXTING_COPY = {
  rosterTitle: 'Who gets texted',
  rosterSub: 'The office, by event. A member is texted only after they verify a mobile on their own account.',
  peopleTitle: 'Your team — who gets texts',
  peopleSub: 'Your own mobile: tap Add mobile on your row and verify it with a six-digit code. Anyone else: type their mobile in and they get a welcome text with the STOP line. Flip texts on or off per person — the mobile and the choices are kept — and tap the texts under a name to choose what they get.',
  sections: {
    office: { title: 'Office', sub: 'Owner, managers, admin and accounting — the whole company.' },
    sales: { title: 'Sales & estimators', sub: 'Their own leads, visits and deals — nobody else’s.' },
    crew: { title: 'Crew', sub: 'Their own days: the jobs they are put on, changes, and the daily list.' },
  },
  addMobile: 'Add mobile',
  changeMobile: 'Change',
  saveMobile: 'Save',
  cancel: 'Cancel',
  stopTexts: 'Stop texts',
  turnOn: 'Text this number',
  theirMobile: (name: string) => `${name.split(' ')[0]}’s mobile`,
  typedInNote: 'They get a welcome text with the STOP line the moment you save — that text is their notice.',
  all: 'All',
  none: 'None',
  byOffice: 'added by the office',
  bySelf: 'verified',
  noMobileLong: 'No mobile — nothing is texted',
  onFileOff: 'texts off — number kept',
  switchOn: 'Texts on',
  switchOff: 'Texts off',
  switchOnHelp: 'Texts go to this person. Tap to stop them — the mobile and choices are kept.',
  switchOffHelp: 'Nothing is texted to this person. Tap to turn their texts back on.',
  switchNoMobile: 'Add their mobile first.',
  stoppedHelp: 'They replied STOP. Only they can restart texts, by texting START back.',
  examplesTitle: 'What the texts say',
  emptySection: 'Nobody here yet — invite them from Company or Workers.',
  // The inside of Your team (2026-10-18): what a person gets, in labelled clusters, and why it is idle.
  picksTitle: 'What they get',
  picksIdleNone: 'Kept for later — nothing is texted until they have a mobile.',
  picksIdleOff: 'Kept for later — nothing is texted while their texts are off.',
  picksIdleStop: 'Kept — they replied STOP, so nothing is texted.',
  peopleCount: (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`,
  clusters: { leads: 'Leads & proposals', money: 'Money', visits: 'Visits & schedule', job: 'On the job', crewJobs: 'Their jobs', crewDaily: 'Daily list', other: 'Other' },
  clientsStateOn: 'Clients who asked get texts.',
  clientsStateOff: 'Nothing is texted to clients.',
  whoMe: 'you',
  noMobile: 'no mobile yet',
  mineTitle: 'Your mobile',
  mineSub: 'The number your texts go to. A six-digit code proves it is yours.',
  companyTitle: 'The company',
  companySub: 'Your own texting number, texts to clients, and the numbers outside the team that hear about everything. Every text goes out from your own registered number.',
  rulesTitle: 'Your own texts',
  rulesSub: 'Write a text for any moment — when it goes out, who gets it, what it says. {Fields} fill in from the job; clients always get your company name and the STOP line. They go out once your company has its own registered texting number.',
  notConfiguredLong: 'Texting is not switched on for this server yet. Everything here is kept and nothing is sent until it is.',
  // The steps at the top of the page (2026-10-13): what is needed, and what happens now.
  overviewTitle: 'Texting',
  overviewSub: 'Get your number, pick who on your team gets texts, decide about clients — and add texts of your own if you like.',
  stepNumber: 'Your number',
  stepTeam: 'Your team',
  stepClients: 'Texts to clients',
  stepRules: 'Your own texts',
  numberNone: 'Not requested yet — JobFlex prepares a number in your company’s name for you, files it with the carriers and pays for it. It takes calls right away; texting starts once the carriers approve.',
  numberPaidOnly: 'Comes with a paid plan.',
  numberPending: 'Your number already answers calls. Twilio is checking your business for texting — usually within 3 business days; texts start on their own once approved.',
  numberApproved: (n: string) => `Approved — texts go out from ${n}, and it answers calls.`,
  numberRejected: 'Twilio sent it back — fix what it asks and send it again.',
  numberFailed: 'It did not reach Twilio — open it and send again.',
  numberGo: 'Get your number',
  // A line JobFlex lent for calls (2026-10-14): the AI desk answers it; texts need a number in the company's name.
  numberLent: (n: string) => `Calls come to ${n} — a line JobFlex lent you; the AI desk answers it. Texts need a number registered in your company’s name: JobFlex gets you one and pays for it.`,
  numberLentRegistrable: (n: string) => `Calls come to ${n}. Register that same number in your company’s name and texts go out from it too — no new number.`,
  numberGoOwn: 'Get your own number',
  numberGoRegister: 'Register it',
  numberOpen: 'Open',
  teamLine: (on: number, off: number, none: number) => [`${on} getting texts`, off ? `${off} switched off` : '', none ? `${none} without a mobile` : ''].filter(Boolean).join(' · '),
  teamGo: 'Choose who',
  clientsLine: 'Visit reminders and the link to their proposal — only to clients who ticked “Text me…” when they booked online.',
  rulesLine: (n: number) => (n ? `${n} of your own set up` : 'None yet — write a text for any moment'),
  rulesGo: 'Set up',
  rulesCount: (n: number) => `${n} ${n === 1 ? 'text' : 'texts'} of your own`,
  rulesIdeas: 'Start from an idea',
  rulesNew: '+ New text',
  rulesEmpty: 'No texts of your own yet. Start from an idea, or write one.',
  ruleEditNew: 'New text',
  ruleEditOld: 'Edit text',
  statusWaiting: 'Nothing is texted yet — your texting number is not approved. Until it is, everyone gets the same alerts by email and in the app.',
  statusLive: (n: string, people: number, clients: boolean) => `Texting is on from ${n}: ${people} ${people === 1 ? 'person' : 'people'} on your team${clients ? ', and clients who asked for texts' : ''}.`,
} as const;

/** Settings → AI desk (2026-10-13). */
export const DESK_COPY = {
  title: 'AI desk',
  sub: 'Your number, answered: the desk picks up, gives callers what they ask, books visits and takes messages — or your phone rings first and the desk takes what you miss.',
  managersOnly: 'Owners and managers set up the AI desk.',
  noNumber: 'No number yet — the desk answers your company\u2019s own number.',
  getNumber: 'Get your number',
  changeNumber: 'Change',
  // The desk answers a line JobFlex lent (2026-10-14); texting is set up under Texting, on a number in the company's name.
  lentLine: 'A line JobFlex lent you for calls. Texts need a number registered in your company\u2019s name — Texting → Your number sets that up; calls keep coming here meanwhile.',
  lentGo: 'Texting',
  lentLineHouse: 'JobFlex\u2019s own line — this company is JobFlex\u2019s, so it carries your calls and your texts. Who gets texted is set under',
  callsDesk: 'answered by the desk',
  callsPhone: (phone: string) => `rings ${phone || 'your company phone'} first; the desk takes what nobody picks up`,
  callsNone: 'add your company phone in Company settings, or turn the desk on',
  callsOff: 'not taking calls yet',
  notOnPlan: 'Your plan does not include AI phone answering, so calls ring your company phone. The desk picks up once the Phone page is on your plan.',
  whoAnswers: 'Who answers',
  modeAnswer: 'The desk answers every call',
  modeAnswerSub: 'Callers get answers, visits booked and messages taken, around the clock. It hands the call to you when they ask.',
  modeForward: 'Ring my phone first',
  modeForwardSub: (phone: string) => `${phone ? `${phone} rings` : 'Your company phone rings'} for 25 seconds; the desk takes the calls nobody picks up.`,
  setupTitle: 'What the desk knows and says',
  setupSub: 'Tell it about your company the way you would brief a new receptionist — type it, or say it. JobFlex turns that into the desk\u2019s instructions, which you can edit line by line.',
  briefTitle: '1 · Tell us about your company',
  briefTitleShort: 'In your own words',
  briefSub: 'Any order, your own words: what you do, where, your hours, how you price, what you never promise, what counts as an emergency. What JobFlex already knows is filled in for you.',
  knownAlready: 'What JobFlex already knows',
  briefPlaceholder: 'We do roofs and gutters on the Eastside. Free estimates; leak calls are $149. Open 7 to 5 weekdays. Licensed and insured, 10-year workmanship warranty. A leak during rain is an emergency — book the first slot…',
  speak: 'Say it instead',
  compose: 'Write the desk\u2019s instructions',
  recompose: 'Write them again from this',
  composing: 'Writing…',
  aiOff: 'The AI service is not set up on this workspace — the instructions can be edited by hand below.',
  questionsTitle: 'The desk still doesn\u2019t know',
  profileTitle: 'The desk\u2019s instructions',
  profileTitleDraft: 'The desk\u2019s instructions — a first draft from what JobFlex knows',
  profileSub: 'Written from what you said. Change anything; the desk follows these on every call.',
  profileSubDraft: 'Nothing written yet: this is what the desk would say from your company settings alone. Describe your company above, or edit these and save.',
  addFaq: 'Add a question',
  save: 'Save the instructions',
  saving: 'Saving…',
  unsaved: 'Unsaved changes',
  tryTitle: 'Try it by text',
  trySub: 'Ask something a caller would. The desk answers from the instructions as saved.',
  tryPlaceholder: 'Do you do free estimates? Can someone come today?',
  ask: 'Ask',
  asking: 'Asking…',
  answerTag: 'what the desk would say',
  // the setup, in four steps (2026-10-14)
  stepsKicker: 'Set up in four steps',
  // the redesigned desk: overview + tabs (2026-10-14)
  overviewLabel: 'Your AI desk at a glance',
  tabsLabel: 'Set up the AI desk',
  tabNumbers: 'Phone & forwarding',
  tabNumbersShort: 'Phone',
  tabBusinessShort: 'Business',
  subnavLabel: 'Parts of your business setup',
  navKind: 'Kind of business',
  navDescribe: 'Describe it',
  navKnow: 'What it knows',
  navInstructions: 'Instructions',
  tabBusiness: 'Your business',
  tabBooking: 'Booking',
  tabVoice: 'Voice & test',
  noNumberShort: 'No number yet',
  copy: 'Copy',
  copied: 'Copied',
  statNumber: 'Desk number',
  statMinutes: 'Minutes left',
  statOut: 'Out',
  statCalls: 'Calls this month',
  statVoice: 'Voice',
  progressWords: (n: number) => `${n} of 4 set up`,
  // the setup as a checklist (owner, 2026-10-16): every step a row that says it opens
  checklistTitle: 'Set up the desk',
  stepOpen: 'Open',
  stepClose: 'Close',
  continueTo: (t: string) => `Continue: ${t}`,
  callTheDesk: 'Call the desk to test it',
  reachNone: 'Get the desk a number first — then customers can call it.',
  reachDirect: 'Customers call this number. Your own phone keeps working as before.',
  reachMissed: (phone: string) => `Calls you miss on ${phone || 'your phone'} forward here.`,
  reachAll: (phone: string) => `Every call to ${phone || 'your phone'} forwards here.`,
  reachRingFirst: (phone: string) => `${phone || 'Your phone'} rings first; the desk takes the calls nobody picks up.`,
  stepDone: 'Done',
  stepTodo: 'To do',
  step1: 'Your numbers',
  step1Sub: 'The number the desk answers, the phone customers already know, and who picks up. Texts go out from this same number — who gets them is set under Texting.',
  deskNumberTitle: 'The desk\u2019s number',
  businessTitle: 'Your business phone',
  businessSub: 'The number customers call you on today. The desk rings it when a caller asks for a person — or first, if you choose "ring my phone first".',
  businessPlaceholder: '(425) 555-0100',
  businessSave: 'Save',
  forwardTitle: 'How do customers reach the desk?',
  forwardNone: 'They call the desk\u2019s number',
  forwardNoneSub: (n: string) => `You give out ${n} — site, truck, cards. Your own phone keeps working as before.`,
  forwardMissed: 'My number forwards the calls I miss',
  forwardMissedSub: (n: string) => `Your phone carrier sends the calls you don\u2019t pick up to ${n}. JobFlex can\u2019t switch this on for you — you turn it on once, with your carrier\u2019s code below. The desk takes what you miss and can still hand a call back to you.`,
  forwardAll: 'My number forwards every call',
  forwardAllSub: (n: string) => `Your phone carrier sends every call to ${n}. JobFlex can\u2019t switch this on for you — you turn it on once, with your carrier\u2019s code below. The desk answers everything and takes messages instead of transferring — a transfer would ring itself.`,
  // is it really forwarding? (2026-10-14)
  fwdTitle: 'Is your number forwarding?',
  fwdNeedPhone: 'Add your business phone above — the test calls it.',
  fwdUnknown: (phone: string) => `Not checked yet. Calls to ${phone} reach the desk only after you turn on forwarding at your carrier — JobFlex can\u2019t do it for you. Dial the code below, then test it.`,
  fwdTest: 'Test my forwarding',
  fwdTestAgain: 'Test again',
  fwdCallingAll: (phone: string) => `Calling ${phone} from the desk… If your phone rings, forwarding isn\u2019t on yet — answer it to hear what to do.`,
  fwdCallingMissed: (phone: string) => `Calling ${phone} from the desk… Let it ring — don\u2019t answer. In about 30 seconds it should forward to the desk.`,
  fwdWorks: (how: string, when: string) => `Forwarding works — ${how === 'call' ? 'a customer\u2019s call came through it' : how === 'manual' ? 'you checked it' : 'the test call came back to the desk'}, ${when}.`,
  fwdRang: 'Your phone answered instead of the desk — forwarding isn\u2019t on yet. Dial your carrier\u2019s code below, wait for the confirmation, then test again.',
  fwdNoAnswerAll: 'The test call rang your phone and never came to the desk — forwarding isn\u2019t on yet. Dial your carrier\u2019s code below, then test again.',
  fwdNoAnswerMissed: 'Nobody answered and the call never reached the desk — forwarding of missed calls isn\u2019t on yet. On an iPhone, Live Voicemail can catch it first: turn it off, then test again.',
  fwdFailed: (err: string) => `The test call couldn\u2019t be placed — ${err} Check it yourself instead: call your number from another phone.`,
  fwdManualAsk: 'Or check it yourself — call your number from another phone:',
  fwdManualYes: 'The desk answered',
  fwdManualNo: 'My phone rang',
  fwdShowCodes: 'Show the codes again',
  fwdHideCodes: 'Hide the codes',
  fwdBanner: (phone: string) => `Calls to ${phone || 'your number'} won\u2019t reach the desk until forwarding is on at your phone carrier — JobFlex can\u2019t switch it on for you.`,
  fwdBannerBtn: 'Show me how',
  fwdChip: 'Forwarding to check',
  // turning forwarding on at the carrier (2026-10-14: *72 is Verizon's only)
  codesTitle: 'Turn it on at your carrier',
  codesHow: (phone: string) => `JobFlex can\u2019t forward your calls — your phone carrier does. From the phone${phone ? ` with ${phone}` : ''}, dial the code for your carrier and press call, then wait for the tone or the message that it\u2019s on.`,
  codesOn: 'Turn on',
  codesOff: 'Turn off',
  codesCopy: 'Copy',
  codesCopied: 'Copied',
  codesOther: (n: string) => `Another carrier, a landline or an office phone system: turn on Call forwarding in your carrier\u2019s app or account, to ${n}.`,
  codesIphone: 'iPhone on AT&T or T-Mobile: Settings → Phone → Call Forwarding does the same.',
  codesLiveVoicemail: 'iPhone: turn off Live Voicemail (Settings → Phone → Live Voicemail), or it answers your missed calls before they can forward.',
  codesTest: (phone: string) => `Test it: call ${phone || 'your number'} from another phone — the desk should answer.`,
  codesTrouble: 'Still rings only your phone? The code didn\u2019t take — dial it again and wait for the confirmation. Some plans need call forwarding added first (ask your carrier), and some carriers won\u2019t forward to a toll-free number; if yours won\u2019t, contact JobFlex support.',
  forwardNeedsNumber: 'Forwarding needs the desk\u2019s number first.',
  modeForwardOff: 'Not with every call forwarded — your phone would forward straight back to the desk.',
  step2: 'Tell the desk about your company',
  step2Sub: 'Type what kind of business you are for a head start, then describe it in your own words — typed or spoken. JobFlex writes it up professionally and the desk answers every caller from it.',
  // describe the business → the professional write-up (2026-10-14)
  describeTitle: 'Describe your business',
  describeSub: 'Talk or type the way you\u2019d brief a new office manager — what you do, how you work, your area, prices, warranty, what makes you different. JobFlex corrects it and writes it up professionally; the desk answers callers\u2019 questions from it.',
  coverageTitle: 'Covered so far',
  writePro: 'Write it professionally',
  rewritePro: 'Write it again from this',
  writing: 'Writing…',
  knowTitle: 'What the desk knows about your business',
  knowHint: 'The desk answers every caller\u2019s question from this. Edit anything.',
  knowEmpty: 'Nothing written yet — describe your business above, then press Write it professionally.',
  samplesTitle: 'Callers might ask — and the desk would say',
  answerIt: 'Answer it',
  // preset for the trade, the sensitive parts highlighted (2026-10-14)
  kindTitle: 'What kind of business are you?',
  kindPlaceholder: 'Roofing, gutters — or remodeling, tile, painting, anything',
  kindHint: 'Type what you do. JobFlex presets everything callers ask that kind of company, using your company details — then check the highlighted parts and correct anything that\u2019s different about your business.',
  kindMatched: 'Preset for',
  kindAi: 'No ready preset — the AI writes one for this business',
  kindAiShort: 'AI writes it',
  kindGeneric: 'No preset — the general one, with your company details',
  kindGenericShort: 'general preset',
  kindSuggest: 'Add a trade',
  preset: 'Preset the desk',
  presetAgain: 'Preset again',
  presetting: 'Presetting…',
  replaceWarn: 'This replaces the desk\u2019s current instructions with a new preset — changes you made to them will be gone.',
  replaceYes: 'Replace them',
  cancel: 'Cancel',
  toCheck: (n: number) => `${n} to check`,
  toCheckSub: '— highlighted below. Each says why: fix it in one click, edit it, or mark it right.',
  nextToCheck: 'Show the next',
  checkThis: 'Check this',
  looksRight: 'Looks right',
  profileSubCheck: 'Preset from your trade and your company details. The highlighted parts are what callers will hear as promises — check each one, then save.',
  saveChecked: 'Save the instructions',
  moreTitle: 'Anything else the desk should know?',
  moreSub: 'Optional — your prices, your warranty, what you never do. Say it or type it; the AI works it in and highlights what it changed.',
  workItIn: 'Work it into the instructions',
  showDetails: 'Read and edit the instructions',
  hideDetails: 'Hide the instructions',
  step3: 'When it can book visits',
  step3Sub: 'The desk offers the same open times as your online booking page — your hours, your visits, around what is already on the calendar.',
  tzTitle: 'Your time zone',
  tzSub: 'The clock the desk tells callers and books by.',
  bookingOn: 'Online booking is on — the desk books from this calendar.',
  bookingOff: 'Online booking is off — the desk takes messages instead of booking. Turn it on and set your hours on the Online booking page.',
  bookingHours: 'Hours',
  bookingServices: 'Visits it can book',
  bookingEdit: 'Change hours and visits',
  previewTitle: 'The next times it would offer a caller',
  previewLoad: 'Show the next open times',
  previewLoading: 'Looking…',
  previewNone: 'Nothing open in the next 7 days.',
  step4: 'Voice and a test',
  step4Sub: 'Pick the voice, ask it something by text, then call it from this browser.',
  // a number customers already know: forwarded at the carrier, not in JobFlex
  forwardTip: (number: string) => `Have a number customers already know? Forward it to ${number} at your phone carrier and the desk answers that one too — Verizon: dial *72 then the number (*73 turns it off); AT&T and T-Mobile: dial **21*, the number, then # (##21# turns it off). Your own phone keeps working as before.`,
  // the voice, and the month's minutes (step 4)
  voiceTitle: 'The desk\u2019s voice',
  hear: 'Hear it',
  hearing: 'One moment…',
  playing: 'Playing…',
  minutes: (min: number, calls: number, tests: number) =>
    `${min} min this month — ${calls} call${calls === 1 ? '' : 's'}${tests ? `, ${tests} test${tests === 1 ? '' : 's'}` : ''}.`,
  minutesNone: 'No minutes used this month.',
  // test it here (step 4)
  testTitle: 'Test it here, by voice',
  testSub: 'Call the desk from this browser and talk to it the way a customer would — the saved instructions, the voice you chose, the real open times on your calendar. On a test, visits and messages are not saved: the desk only says what it would do.',
  testStart: 'Call the desk',
  testMic: 'Allow the microphone…',
  testConnecting: 'Connecting…',
  testLive: 'On the line',
  testHangUp: 'Hang up',
  testEnding: 'Hanging up…',
  testUnsupported: 'This browser can\u2019t make a call here. Chrome, Safari or Edge on a phone or computer can.',
  testNoMic: 'The microphone is off for this page. Allow it in the address bar and try again.',
  testFailed: 'The call could not be connected. Try again in a minute.',
  testYou: 'You',
  testDesk: 'Desk',
  // minutes and packs (step 5)
  minutesTitle: 'Minutes',
  minutesSub: 'Your plan includes minutes each month; past them the desk runs on packs, which don\u2019t expire. Out of both, calls ring your company phone or take a message until you add minutes.',
  included: (n: number) => `${n} min included this month`,
  usedWords: (n: number) => `${n} min used`,
  packsWords: (n: number) => `${n} min in packs`,
  buyPack: (min: number, price: string) => `Add ${min} minutes — ${price}`,
  buying: 'One moment…',
  confirmCharge: (price: string, brand: string, last4: string) => `Charge ${price} to ${brand} \u2022${last4}?`,
  charge: 'Charge it',
  notNow: 'Not now',
  added: (min: number) => `${min} minutes added.`,
  autoTitle: 'Auto top-up',
  autoSub: (min: number, price: string, brand: string, last4: string) => `When the desk runs out, add ${min} minutes (${price}) to ${brand} \u2022${last4} without asking. You get an email each time.`,
  autoNoCard: 'Auto top-up needs a card on file — add one on the Billing page.',
  autoFailed: 'The last auto top-up couldn\u2019t charge your card. Update it on the Billing page; the desk tries again a day later.',
  historyTitle: 'Packs bought',
  historyNone: 'No packs yet.',
  via: { 'card-on-file': 'card on file', checkout: 'Stripe', auto: 'auto top-up', admin: 'JobFlex' } as Record<string, string>,
  outBanner: 'Out of minutes — calls ring your company phone, or take a message, until you add minutes.',
  lowBanner: 'Running low — the desk stops answering when the minutes are gone.',
  noBilling: 'Billing is not set up on this workspace, so packs can\u2019t be bought here.',
  packFailed: 'The purchase could not go through. Try again in a minute.',
  checkoutCancelled: 'Nothing was charged.',
  checkoutPending: 'Stripe is confirming the payment — the minutes land in a moment.',
  checkoutInvalid: 'That payment could not be matched to your company. If you were charged, write to support.',
} as const;

export const TEST_RESULT_COPY = {
  sent: 'Sent to the bell and to your email.',
  off: 'Sent to the bell — every Email cell is off.',
  disabled: 'Sent to the bell — email is not configured on this platform.',
  'no-address': 'Sent to the bell — your account has no email address.',
} as const;

/* ------------------------------------------------------------------ */
/* F10 — every donor <select> as a custom Sel dropdown                 */
/* ------------------------------------------------------------------ */

export const CURRENCY_SELECT: SelectSpec = {
  label: 'Currency',
  options: CURRENCY_OPTIONS,
  defaultValue: CURRENCY_DEFAULT,
};

export const NET_TERMS_SELECT: SelectSpec = {
  label: 'Net terms',
  options: NET_TERMS_OPTIONS,
  defaultValue: NET_TERMS_DEFAULT,
};

/* ------------------------------------------------------------------ */
/* Notification preferences — User.notificationPrefsJson               */
/* ------------------------------------------------------------------ */

// The blob's shape, parser and event list live in the pure half of the prefs
// module so the bell feed and the mail senders read the same thing this page
// writes. Re-exported here so the panes keep one import.
export {
  PREF_EVENTS,
  defaultNotificationPrefs,
  parseNotificationPrefs,
} from '@/lib/notificationPrefsShared';
export type { NotificationPrefs, PrefKey } from '@/lib/notificationPrefsShared';

/* ------------------------------------------------------------------ */
/* SettingsData — everything the server page reads and threads down    */
/* ------------------------------------------------------------------ */

export interface AccountData {
  /** The signed-in user. `email` and `role` are read-only on the page. */
  name: string;
  email: string;
  phone: string;
  role: string;
  /** Membership role, title-cased, shown as the Profile card's `.badge2`. */
  roleBadge: string;
  /** True for OWNER / ADMIN / MANAGER — the only roles that may edit the org. */
  canEditBusiness: boolean;
  /** Strictly OWNER — delete organization. */
  isOwner: boolean;
  business: { name: string; address: string; website: string; phone: string };
  security: { passwordDesc: string; sessionsDesc: string };
  /** The account has a password (Add password / Change password, 2026-10-10). */
  hasPassword: boolean;
  /** Where the Security card's password "Change" button goes. */
  forgotHref: string;
}

export interface PaymentsData {
  connections: PaymentConnectionStatusView;
  currency: string;
  depositPct: string;
  receiptsOnPayment: boolean;
  /** PLATFORM_FEE_BPS / 100. */
  platformFeePct: number;
  /** Wisetack financing (lib/financing) — null while JobFlex's switch keeps this account out or Wisetack is not connected. */
  financing: FinancingSettingsData | null;
}

export interface FinancingSettingsData {
  rec: OrgFinancing;
  readiness: { items: ReadinessItem[]; ready: number; total: number };
  /** Owner / manager — the only ones who apply or change the default. */
  canManage: boolean;
  /** The AI desk's financing answer: the Wisetack line ("ours"), the contractor's own ("theirs"), none yet. */
  deskAnswer: 'ours' | 'theirs' | 'none';
}

export interface BillingData {
  planName: string;
  planBadge: Badge | null;
  /** Already prefixed, or "" when there is nothing to show. */
  nextBill: string;
  seats: string;
  billingEmail: string;
  isOwner: boolean;
  canEditBilling: boolean;
  /** The real subscription page (owner-only). */
  subscriptionHref: string;
  /** The company is on the Free plan (its subscription ended — lib/freePlan). */
  onFree: boolean;
  /** The switch to Free is booked (lib/freePlan): "Your plan switches to
   *  Free on <date>" and "Keep <plan>" stand where the cancel link was. */
  freeSwitch: { at: string | null; planName: string } | null;
  /** The owner's "Cancel subscription" link and what its two windows say —
   *  present only for the owner of a live, paid (not granted) subscription
   *  with nothing booked yet. Null for every other role and state. */
  cancel: {
    planName: string;
    /** ISO end of the paid cycle (or trial): what the plan is kept until. */
    keepsUntil: string | null;
    losses: FreeLoss[];
    /** The company's own numbers (lib/freePlan freeTallyTiles draws them). */
    tally: FreeTally;
    /** Access already lapsed to Free while the Stripe subscription still renews. */
    accessAlreadyFree?: boolean;
    /** "Request a trial extension" on Before you go — present only on the
     *  trial or within 14 days after it (lib/trialExtension). */
    extension?: TrialExtensionOffer | null;
  } | null;
  /** The owner's manage window (owner, 2026-10-17 — the one place a plan is
   *  cancelled): the plan's price, its date, the card and why there is no
   *  cancel button when there is none. Null for every other role. */
  manage: {
    /** Stripe was asked for the card (the page opened on Billing). False:
     *  the window shows what the database has, and the pane asks again. */
    live: boolean;
    /** "$95 / mo", or null when the price cannot be told. */
    price: string | null;
    /** "Next bill" · "Trial ends" · "Switches to Free" · …, or null. */
    date: { label: string; value: string } | null;
    /** "Visa ···· 4242" / "None yet" (a card-less trial, with where to add one). */
    card: { value: string; addHref: string | null } | null;
    /** The existing Stripe card form (/api/billing/update-card) applies. */
    canUpdateCard: boolean;
    /** One line on why there is nothing to cancel; null when `cancel` or
     *  `freeSwitch` is there. */
    noCancel: string | null;
  } | null;
}

export interface GmailData {
  connected: boolean;
  /** Google app still in Testing (or unconfigured) — only test users can
   *  connect, so everyone else sees "Coming soon". */
  comingSoon: boolean;
  connectedEmail: string;
  displayName: string;
  replyTo: string;
  sendFromUser: boolean;
  /** Google refused the grant and the tokens were dropped (lib/email/orgSend):
   *  ISO date or "". The card says so and offers Reconnect. */
  revokedAt: string;
  revokedReason: string;
  /** Placeholders for the two From-address inputs. */
  displayNamePlaceholder: string;
  replyToPlaceholder: string;
  /** Scopes actually requested by the OAuth route, short form. */
  scopes: readonly string[];
  connectHref: string;
}

export interface MetaData {
  connected: boolean;
  comingSoon: boolean;
  orgName: string;
  defaultPage: string;
  formCategory: string;
  pageId: string;
  pageName: string;
  pages: { id: string; name: string }[];
  canManage: boolean;
  canResume: boolean;
  lastImportAt: string | null;
  /** New Facebook leads come into Leads by themselves (lib/meta/autoImport, the cron every 5 minutes). */
  autoImport: boolean;
}

/** The deep view of one payment link (Integrations → Stripe / Square). */
export interface ProcessorIntegrationData {
  key: 'stripe' | 'square';
  /** Platform credentials missing — the tab is marked "Coming soon". */
  comingSoon: boolean;
  webhookUrl: string;
  /** Formatted, or null when no event has ever arrived. */
  lastEventAt: string | null;
}

/** Ramp cards (2026-10-29): the company's Ramp business, connected or not, and what the card is allowed to do. */
export interface RampData {
  enabled: boolean;
  connected: boolean;
  businessName: string;
  connectedAt: string | null;
  lastSyncAt: string | null;
  lastSyncCount: number;
  lastError: string | null;
  fieldReady: boolean;
  webhookReady: boolean;
  askByText: boolean;
  requireJob: boolean;
  billsApproved: boolean;
  connectHref: string;
  canManage: boolean;
}

export interface IntegrationsData {
  gmail: GmailData;
  meta: MetaData;
  ramp: RampData;
  stripe: ProcessorIntegrationData;
  square: ProcessorIntegrationData;
  connections: PaymentConnectionStatusView;
}

export interface NotificationsData {
  prefs: NotificationPrefs;
  sms: SmsSettingsData;
}

/** The AI desk (2026-10-13, lib/aiDesk): who answers, and what the desk knows and says. */
export interface DeskSettingsData {
  canManage: boolean;
  /** The AI service is set up (the profile can be written and tried). */
  aiConfigured: boolean;
  /** The Phone page is on the plan: the desk answers; otherwise calls ring the company phone. */
  assistantOnPlan: boolean;
  mode: DeskMode;
  /** The voice the live desk speaks with (lib/aiDesk/shared VOICES). */
  voice: DeskVoice;
  /** How the company's own phone reaches the desk (set at the carrier). */
  forwarding: DeskForwarding;
  /** The number customers call the company on (Organization.phone), as typed. */
  businessPhone: string | null;
  timezone: string;
  /** The online-booking calendar the desk books from. */
  booking: { enabled: boolean; hoursWords: string; services: string[]; url: string };
  /** Which of the four setup steps are done. */
  steps: { number: boolean; profile: boolean; booking: boolean; tested: boolean };
  /** This month's minutes: the desk's calls and the owner's browser tests. */
  use: DeskUse;
  /** Where the company stands on minutes, and the packs (lib/aiDesk/minutes, packs). */
  minutes: DeskMinutesData;
  /** A line JobFlex assigned to this company on /admin/health — its number for calls when it bought none. */
  assigned: { number: string; go: CallsGo; phone: string | null } | null;
  brief: string;
  profile: DeskProfile | null;
  profileUpdatedAt: string | null;
  questions: string[];
  /** What the desk was preset for, as typed — or the trades on file before anything was typed. */
  business: string;
  /** The parts still to check, highlighted (lib/aiDesk/tradePresets). */
  review: DeskReviewItem[];
  /** Whether the business phone really forwards to the desk, for the forwarding chosen (lib/aiDesk/forwardCheck). */
  forwardCheck: ForwardCheck | null;
  facts: CompanyFacts;
  /** Call new leads (2026-10-31, lib/aiDesk/leadCalls): the switch, the wait, and whether the desk could dial now —
   *  `why` says what is missing when it could not. */
  leadCalls: { on: boolean; afterMinutes: number; ready: boolean; why: string | null };
}

export interface DeskMinutesData {
  balance: DeskBalance;
  history: DeskPackRecord[];
  pack: { minutes: number; cents: number };
  /** The card the subscription bills, for the one-click buy and auto top-up; null → Stripe Checkout. */
  card: { brand: string; last4: string } | null;
  /** The last time auto top-up could not charge the card. */
  autoFailedAt: string | null;
  /** Billing is set up on this workspace (Stripe, or its stand-in). */
  billingOn: boolean;
}

export interface SettingsData {
  account: AccountData;
  payments: PaymentsData;
  billing: BillingData;
  integrations: IntegrationsData;
  notifications: NotificationsData;
  desk: DeskSettingsData;
  /** Website estimators: shown while the feature is open to every account, or to a platform admin in the preview. */
  website: { visible: boolean };
}

/** Every pane takes exactly this. `navigate` jumps rails (and subtabs). */
export interface PaneProps {
  data: SettingsData;
  navigate: (rail: RailKey, sub?: SubTabKey) => void;
  /** Integrations only: the subtab the page wants open. */
  sub?: SubTabKey;
  /** What an OAuth round trip came back with (?gmail= / ?stripe= / ?square=),
   *  shown once as a note on the tab it concerns. */
  notice?: OAuthNotice;
  /** This pane is the one on screen — every pane stays mounted, the others hidden. */
  shown: boolean;
}

/** The status words the OAuth routes redirect back with. */
export interface OAuthNotice {
  gmail?: string;
  stripe?: string;
  square?: string;
  /** "back" — returned from Wisetack's application page. */
  financing?: string;
}

/** One line per outcome of the Gmail round trip, in the user's words. */
export const GMAIL_OAUTH_NOTICE: Record<string, { title: string; sub: string; tone: 'ok' | 'warn' }> = {
  connected: { title: 'Gmail connected', sub: 'Proposals and follow-ups now leave from your address.', tone: 'ok' },
  denied: { title: 'Gmail was not connected', sub: 'Google reported that access was declined. Nothing changed.', tone: 'warn' },
  badstate: { title: 'Gmail was not connected', sub: 'The sign-in took too long or was opened from another tab. Try again from this page.', tone: 'warn' },
  mismatch: { title: 'Gmail was not connected', sub: 'The sign-in was started for a different workspace. Try again from this page.', tone: 'warn' },
  norefresh: { title: 'Gmail was not connected', sub: 'Google did not hand over a lasting permission. Remove JobFlex under your Google account\'s third-party access, then connect again.', tone: 'warn' },
  unconfigured: { title: 'Gmail is not switched on here', sub: 'This deployment has no Google OAuth client configured.', tone: 'warn' },
  nobox: { title: 'Gmail cannot be stored here', sub: 'This deployment has no key for keeping connection secrets, so the grant was not saved.', tone: 'warn' },
  error: { title: 'Gmail was not connected', sub: 'Google did not complete the exchange. Try again in a minute.', tone: 'warn' },
};

/** The Stripe / Square round trips, in the user's words. Both routes redirect
 *  to ?tab=payments&stripe=… / &square=…; nothing read them before. */
export const PROCESSOR_OAUTH_NOTICE: Record<string, { title: string; sub: string; tone: 'ok' | 'warn' }> = {
  connected: { title: 'Connected', sub: 'Clients can now pay each stage of an accepted proposal straight to your account.', tone: 'ok' },
  denied: { title: 'Not connected', sub: 'The provider reported that access was declined. Nothing changed.', tone: 'warn' },
  badstate: { title: 'Not connected', sub: 'The sign-in took too long or was opened from another tab. Try again from this page.', tone: 'warn' },
  mismatch: { title: 'Not connected', sub: 'The sign-in was started for a different workspace or user. Try again from this page.', tone: 'warn' },
  unconfigured: { title: 'Not available here', sub: 'This deployment has no platform credentials for this provider.', tone: 'warn' },
  taken: { title: 'That account is already in use', sub: 'It is connected to another JobFlex workspace. Disconnect it there first, or connect a different account.', tone: 'warn' },
  country: { title: 'Not connected', sub: 'Square requires the seller and the platform to be in the same country.', tone: 'warn' },
  nolocation: { title: 'Not connected', sub: 'The Square account has no location that can take payments.', tone: 'warn' },
  error: { title: 'Not connected', sub: 'The provider did not complete the exchange. Try again in a minute.', tone: 'warn' },
};

export const GMAIL_REVOKED_NOTE = {
  title: 'Reconnect Gmail to send from your own address',
  sub: 'Google ended JobFlex’s access — usually after a Gmail password change or when access is removed in your Google account. Emails still go out from the JobFlex address meanwhile. Press Reconnect Gmail and approve; it takes a few seconds.',
} as const;
export const GMAIL_RECONNECT_ACTION: ActionSpec = { label: 'Reconnect Gmail', icon: 'i-google' };
export const GMAIL_TEST_ACTION: ActionSpec = { label: 'Send test email' };
