"use client";

import { GmailConnection } from "@/components/v3/settings-blueprint/panes/gmail-connection";
import { ProcessorSubpane } from "@/components/v3/settings-blueprint/panes/processor-subpane";
import { StaxSubpane } from "@/components/v3/settings-blueprint/panes/stax-subpane";
import { FinancingSubpane } from "@/components/v3/settings-blueprint/panes/financing-subpane";
import { MetaConnection } from "@/components/v3/settings-blueprint/meta-connection";
import { RampConnection } from "@/components/v3/settings-blueprint/panes/ramp-connection";

// SETTINGS · HANDHELD — /dashboard/settings on a phone, and the standalone
// preview at /mobile-settings-v1.
//
// The live URL reaches this through app/dashboard/settings/settings-responsive.tsx,
// a media-query switch listed in the shell's PAGE_OWNED_STATIC; both entry
// points render THIS module with the same server-loaded props.
//
// Stands beside the desktop hub (src/components/v3/settings-blueprint/*, which
// is untouched) and carries the SAME five sections, the SAME copy and the SAME
// real data: both surfaces call src/lib/settings/loadSettingsData.ts and both
// write through the actions that already existed — accountSettings.ts,
// settings.ts, paymentConnections.ts, notifications.ts. Nothing here is mocked,
// nothing here is a second endpoint, and no string on this page was rewritten:
// every label, sub-line and option list is imported from settings-data.ts.
//
// WHAT CHANGES IS THE COMPOSITION.
//   · The desktop's left rail becomes ONE sticky dropdown under the page head:
//     a full-width blueprint-filled trigger naming the section you are on, and
//     a panel listing all five (owner's call, 2026-09-03 — as a scrolling chip
//     strip two of the five sat off-screen at 390px). Its Integrations sub-rail
//     is still a strip: four short labels do fit.
//   · Two-column field grids restack to one column; the Security card's three
//     columns become stacked rows with full-width actions.
//   · The notification MATRIX becomes a ledger of events, each carrying its two
//     channels as labelled 44px chips. A 3-column table of checkboxes does not
//     survive 320px, and a checkbox with its channel name written beside it is
//     what a thumb can actually aim at.
//   · Every card's save bar is `position: sticky; bottom: 0` INSIDE its own
//     card, so the action stays in the thumb zone while a long section is being
//     filled and never floats over content that is not its own.
//   · Log out is the last thing on the page, red, at any section (owner's call,
//     2026-09-03) — and it is the same `logOutEverywhere` the desktop Account
//     pane and the shell footer call.
//
// ALL FIVE PANES STAY MOUNTED and are shown/hidden by a class, exactly as the
// desktop does, because the inputs hold unsaved text: switching sections must
// not blank a half-typed address. The same is true of the four Integrations
// subpanes.
//
// DEEP LINKS: `?tab=` (+ `&sub=`) and the legacy `?pane=` are honoured with
// `tab` winning, matching settings-content.tsx. Stripe and Square OAuth
// callbacks land on `?tab=payments&sub=stripe`.
//
// MOTION: the reveal cascade is applied ONCE, at mount, to the content's own
// children. Never through a MutationObserver — this page re-renders on every
// keystroke and an observer would replay the entrance each time a digit lands.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { logOutEverywhere } from "@/components/v3/blueprint-shell/sign-out";
import { updateBusiness, updateNotificationPrefs, updateProfile } from "@/actions/accountSettings";
import {
  updatePaymentSettings,
} from "@/actions/settings";
import {
  disconnectSquare,
  disconnectStax,
  disconnectStripeConnect,
  saveBankTransferSettings,
  setStripeAchEnabled,
} from "@/actions/paymentConnections";
import { sendTestNotification } from "@/actions/notifications";
import type { PaymentConnectionStatusView } from "@/lib/payments/connections";
import type {
  Badge,
  CardHead,
  IconName,
  KeyProvider,
  MatrixAction,
  OAuthNotice,
  PrefKey,
  Processor,
  RailKey,
  SettingsData,
  SubTabKey,
} from "@/components/v3/settings-blueprint/settings-data";
import {
  BANK_TRANSFER_LABELS,
  BILLING_CONTACT_CARD,
  BILLING_CONTACT_LABELS,
  BUSINESS_CARD,
  BUSINESS_LABELS,
  CONNECT_ACTION,
  CURRENCY_SELECT,
  DEFAULT_RAIL,
  railKeyFor,
  isVisibleSubTab,
  integrationSubTabs,
  DISCONNECT_ACTION,
  EMAIL_COLUMN_INDEX,
  EMAIL_UNAVAILABLE_TAG,
  EMAIL_UNAVAILABLE_TITLE,
  INAPP_UNAVAILABLE_TAG,
  INAPP_UNAVAILABLE_TITLE,
  FEE_NOTE_KICKER,
  MANAGE_ACTION,
  NOTIFICATIONS_CARD,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_COLUMN_LABEL,
  NOTIFICATION_EVENT_COLUMN,
  NOTIFICATION_FOOTER_ACTIONS,
  NOTIFICATION_ICONS,
  PAGE_TITLE,
  PAYMENT_AUTOMATIONS,
  PAYMENT_AUTOMATIONS_CARD,
  PAYMENT_DEFAULTS_CARD,
  PAYMENT_DEFAULT_LABELS,
  PAYOUT_NOTE,
  PAYOUT_NOTE_KICKER,
  PLAN_ASK_OWNER,
  PLAN_CARD,
  PLAN_CARD_NOTE,
  PLAN_CARD_SUB_FREE,
  PLAN_CARD_SUB_SWITCHING,
  PLAN_META_PREFIX,
  PLAN_PRIMARY_ACTION,
  PREF_EVENTS,
  PROCESSORS,
  PROCESSORS_CARD,
  PROCESSOR_OAUTH_NOTICE,
  PROCESSOR_STATE_COPY,
  PROCESSOR_UNAVAILABLE_BADGE,
  PROFILE_CARD,
  PROFILE_LABELS,
  RAIL_ITEMS,
  RAIL_NEW_BADGE,
  RECONNECT_ACTION,
  SECURITY_CARD,
  SECURITY_ITEMS,
  SIGN_OUT_LABEL,
  KEY_FORMS,
  STRIPE_ACH_TOGGLE,
  STRIPE_KEY_ACTION,
  TEST_RESULT_COPY,
  currencyCodeFor,
  currencyOptionFor,
  platformFeeLine,
  squareConnLine,
  staxConnLine,
  stripeConnLine,
} from "@/components/v3/settings-blueprint/settings-data";
import { ProviderKeyForm } from "@/components/v3/settings-blueprint/panes/stripe-key-form";
import { MobileSettingsSprite } from "./sprite";
import { PasswordControl } from "@/components/account-password/password-control";
import { FreeSwitchNotice, ManageSubscription } from "@/components/billing/FreeSwitch";
import "./mobile-settings.css";
import { isRefusal } from "@/lib/actionResult";
import { CompanyPricingForm } from "@/components/v3/company-pricing/company-pricing-form";
import { WebEstimatorForm } from "@/components/v3/web-estimator/web-estimator-form";
import { SmartBookSettingsForm } from "@/components/v3/smartbook/smartbook-settings";

/* ══════════════════════════ small shared bits ══════════════════════════ */

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Server actions reject with a message written for the user. Show that text;
 *  fall back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

function Ic({ name, brand }: { name: string; brand?: boolean }) {
  return (
    <svg className={brand ? "mst-ic mst-ic--brand" : "mst-ic"} aria-hidden="true">
      <use href={`#${name}`} />
    </svg>
  );
}

function Badge2({ badge }: { badge: Badge }) {
  return (
    <span className={`mst-badge ${badge.tone}`}>
      <i />
      {badge.label}
    </span>
  );
}

function CardHeader({ card, badge }: { card: CardHead; badge?: Badge | null }) {
  const shown = badge ?? card.badge;
  return (
    <div className="mst-cardH">
      <div className="mst-cardHt">
        <div className="mst-cardT">{card.title}</div>
        <div className="mst-cardS">{card.sub}</div>
      </div>
      {shown ? <Badge2 badge={shown} /> : null}
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  disabled,
  onChange,
  inputMode,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  /** Omitted on the one read-only field (Email), which the account row owns. */
  onChange?: (next: string) => void;
  inputMode?: "text" | "decimal" | "tel" | "email" | "url";
}) {
  return (
    <label className="mst-fld">
      <span className="mst-fldL">{label}</span>
      <input
        className="mst-in"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={!onChange}
        inputMode={inputMode}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  placeholder,
  rows = 4,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  onChange: (next: string) => void;
}) {
  return (
    <label className="mst-fld">
      <span className="mst-fldL">{label}</span>
      <textarea
        className="mst-in mst-area"
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** The desktop's `.tg`: green on, red off — the colour carries the state. */
function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      className="mst-tg"
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    />
  );
}

/**
 * The card's write, pinned to the bottom of its own card. `inFlight` is the
 * desktop's double-submit guard: `disabled={busy}` alone leaves a gap, because
 * two taps landing in the same tick both run before React re-renders the
 * disabled state. The ref closes it without a render.
 */
function SaveBar({
  onSave,
  disabled,
  extra,
}: {
  onSave: () => Promise<unknown>;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const save = useCallback(async () => {
    if (inFlight.current) return;
    if (timer.current) clearTimeout(timer.current);
    setError("");
    inFlight.current = true;
    setBusy(true);
    try {
      // A refusal (lib/actionResult) is an answer, not a save: its words go in
      // the message slot and "Saved" never shows.
      const res = await onSave();
      if (isRefusal(res)) {
        setSaved(false);
        setError(res.error);
        return;
      }
      setSaved(true);
      timer.current = setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setSaved(false);
      setError(actionError(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [onSave]);

  return (
    <div className="mst-save">
      <div className="mst-saveRow">
        <button
          className="mst-btn mst-btn--primary"
          type="button"
          disabled={busy || disabled}
          onClick={() => void save()}
        >
          <Ic name="i-check" />
          {busy ? "Saving…" : "Save changes"}
        </button>
        {extra}
      </div>
      {/* One message slot, two states: the desktop's green "Saved", or the
          action's own failure text in the danger tone. */}
      {error ? (
        <span className="mst-saveMsg is-bad" role="status">
          {error}
        </span>
      ) : saved ? (
        <span className="mst-saveMsg is-ok" role="status">
          Saved
        </span>
      ) : null}
    </div>
  );
}

/* ─────────────────────────── the option picker ─────────────────────────── */

export interface PickerSpec {
  label: string;
  value: string;
  options: readonly string[];
  onPick: (next: string) => void;
}

/** The trigger. A native <select> renders the OS chevron and OS metrics, which
 *  do not belong to the drawing; the menu itself is a bottom sheet, never a
 *  centred dialog (CLAUDE.md), so the options land under the thumb. */
function SelectField({
  label,
  value,
  options,
  onPick,
  openPicker,
}: PickerSpec & { openPicker: (p: PickerSpec) => void }) {
  return (
    <div className="mst-fld">
      <span className="mst-fldL">{label}</span>
      <button
        className="mst-sel"
        type="button"
        aria-haspopup="listbox"
        aria-label={label}
        onClick={() => openPicker({ label, value, options, onPick })}
      >
        <span className="mst-selV">{value}</span>
        <Ic name="i-chev" />
      </button>
    </div>
  );
}

/* ══════════════════════════════ ACCOUNT ══════════════════════════════ */

function AccountPane({ data }: { data: SettingsData }) {
  const a = data.account;
  const [name, setName] = useState(a.name);
  const [phone, setPhone] = useState(a.phone);
  const [bizName, setBizName] = useState(a.business.name);
  const [bizAddress, setBizAddress] = useState(a.business.address);
  const [bizWebsite, setBizWebsite] = useState(a.business.website);
  const [bizPhone, setBizPhone] = useState(a.business.phone);
  const [signingOutAll, setSigningOutAll] = useState(false);

  // The account's own password, added or changed here (2026-10-10).
  const [hasPw, setHasPw] = useState(a.hasPassword);
  const securityDesc: Record<string, string> = {
    password: hasPw ? "Set. Sign in with it, with a code from email or with Google." : "Not set. You sign in with a code from email or with Google.",
    sessions: a.security.sessionsDesc,
  };

  async function signOutAll() {
    setSigningOutAll(true);
    try {
      await logOutEverywhere("/auth/login");
    } catch {
      setSigningOutAll(false);
    }
  }

  return (
    <>
      <section className="mst-card">
        <CardHeader card={PROFILE_CARD} badge={{ label: a.roleBadge, tone: "bg-live" }} />
        <div className="mst-cardB">
          <Field label={PROFILE_LABELS.name} value={name} onChange={setName} />
          <Field label={PROFILE_LABELS.email} value={a.email} disabled />
          <Field label={PROFILE_LABELS.phone} value={phone} onChange={setPhone} inputMode="tel" />
        </div>
        <SaveBar onSave={() => updateProfile({ name, phone })} />
      </section>

      <section className="mst-card">
        <CardHeader card={BUSINESS_CARD} />
        <div className="mst-cardB">
          <Field label={BUSINESS_LABELS.name} value={bizName} onChange={setBizName} disabled={!a.canEditBusiness} />
          <Field label={BUSINESS_LABELS.address} value={bizAddress} onChange={setBizAddress} disabled={!a.canEditBusiness} />
          <Field label={BUSINESS_LABELS.website} value={bizWebsite} onChange={setBizWebsite} disabled={!a.canEditBusiness} inputMode="url" />
          <Field label={BUSINESS_LABELS.phone} value={bizPhone} onChange={setBizPhone} disabled={!a.canEditBusiness} inputMode="tel" />
        </div>
        <SaveBar
          disabled={!a.canEditBusiness}
          onSave={() =>
            updateBusiness({ name: bizName, address: bizAddress, website: bizWebsite, phone: bizPhone })
          }
        />
      </section>

      <section className="mst-card">
        <CardHeader card={SECURITY_CARD} />
        <div className="mst-cardB mst-cardB--rows">
          {SECURITY_ITEMS.map((item) => (
            <div className="mst-sec" key={item.key} id={item.key === "password" ? "password" : undefined}>
              <span className="mst-rowIc">
                <Ic name={item.icon} />
              </span>
              <span className="mst-rowB">
                <span className="mst-rowN">{item.name}</span>
                <span className="mst-rowD">{securityDesc[item.key]}</span>
              </span>
              {item.key === "password" ? (
                <span className="mst-secAct">
                  <PasswordControl hasPassword={hasPw} email={a.email} buttonClassName="mst-btn mst-btn--ghost mst-secAct" onSaved={setHasPw} />
                </span>
              ) : (
                <button
                  className="mst-btn mst-btn--ghost mst-secAct"
                  type="button"
                  disabled={signingOutAll}
                  onClick={() => void signOutAll()}
                >
                  {signingOutAll ? "Logging out…" : item.action}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* ══════════════════════════════ PAYMENTS ══════════════════════════════ */

type ProcState =
  | PaymentConnectionStatusView["stripe"]["state"]
  | PaymentConnectionStatusView["square"]["state"];

/** Stripe has two ways in — `connectHref` (OAuth, null when the platform
 *  can't offer it) and `onUseKey` (paste a key, null when it can't). A row
 *  joined by key can also authorize OAuth without disconnecting first. */
function ProcessorRow({
  row,
  state,
  connLine,
  connectHref,
  onUseKey = null,
  useKeyLabel = STRIPE_KEY_ACTION.label,
  viaKey = false,
  busy,
  onManage,
  onDisconnect,
}: {
  row: Processor;
  state: ProcState;
  connLine: string;
  connectHref: string | null;
  onUseKey?: (() => void) | null;
  useKeyLabel?: string;
  viaKey?: boolean;
  busy: boolean;
  /** Absent = no deep view under Integrations (Stax). */
  onManage?: () => void;
  onDisconnect: () => void;
}) {
  const connected = state === "connected";
  const unavailable = state === "not_configured";
  const hasRow = !unavailable && state !== "disconnected";
  const reconnectByKey = viaKey || !connectHref;
  return (
    <div className={`mst-row${unavailable ? " is-off" : ""}`}>
      <div className="mst-rowTop">
        <span className="mst-rowIc">
          <Ic name={row.icon} />
        </span>
        <span className="mst-rowB">
          <span className="mst-rowN">{row.name}</span>
          <span className="mst-rowD">{row.desc}</span>
          {hasRow ? (
            <span className={`mst-rowConn${connected ? " is-ok" : " is-warn"}`}>
              {connected ? connLine : PROCESSOR_STATE_COPY[state]}
            </span>
          ) : null}
        </span>
        {unavailable ? <Badge2 badge={PROCESSOR_UNAVAILABLE_BADGE} /> : null}
      </div>
      {unavailable ? null : (
        <div className="mst-rowAct">
          {(state === "disconnected" || viaKey) && connectHref ? (
            <a className={`mst-btn mst-btn--ghost ${CONNECT_ACTION.state}`} href={connectHref}>
              <Ic name="i-plus" />
              Connect with {row.name}
            </a>
          ) : null}
          {state === "disconnected" && onUseKey ? (
            <button className={`mst-btn mst-btn--ghost ${STRIPE_KEY_ACTION.state}`} type="button" onClick={onUseKey}>
              <Ic name={STRIPE_KEY_ACTION.icon ?? "i-card"} />
              {useKeyLabel}
            </button>
          ) : null}
          {hasRow && !connected ? (
            reconnectByKey ? (
              onUseKey ? (
                <button className={`mst-btn mst-btn--ghost ${RECONNECT_ACTION.state}`} type="button" onClick={onUseKey}>
                  {RECONNECT_ACTION.label}
                </button>
              ) : null
            ) : (
              <a className={`mst-btn mst-btn--ghost ${RECONNECT_ACTION.state}`} href={connectHref ?? "#"}>
                {RECONNECT_ACTION.label}
              </a>
            )
          ) : null}
          {hasRow && onManage ? (
            <button className="mst-btn mst-btn--ghost" type="button" onClick={onManage}>
              {MANAGE_ACTION.label}
            </button>
          ) : null}
          {hasRow ? (
            <button
              className={`mst-btn mst-btn--ghost ${DISCONNECT_ACTION.state}`}
              type="button"
              disabled={busy}
              onClick={onDisconnect}
            >
              {DISCONNECT_ACTION.label}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function PaymentsPane({
  data,
  navigate,
  openPicker,
  notice,
}: {
  data: SettingsData;
  navigate: (rail: RailKey, sub?: SubTabKey) => void;
  openPicker: (p: PickerSpec) => void;
  notice?: OAuthNotice;
}) {
  const p = data.payments;
  const c = p.connections;
  const router = useRouter();

  const [currency, setCurrency] = useState<string>(currencyOptionFor(p.currency));
  const [depositPct, setDepositPct] = useState<string>(p.depositPct);
  const [receipts, setReceipts] = useState(p.receiptsOnPayment);
  const [ach, setAch] = useState(c.stripe.achEnabled);
  const [bankOn, setBankOn] = useState(c.bankTransfer.enabled);
  const [bankText, setBankText] = useState(c.bankTransfer.instructions);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  // "Use API key" / "Use access token" opens the paste form under that row.
  const [keyOpen, setKeyOpen] = useState<KeyProvider | null>(null);
  const toggleKey = (p: KeyProvider) => () => setKeyOpen((v) => (v === p ? null : p));

  const saveDefaults = () =>
    updatePaymentSettings({
      currency: currencyCodeFor(currency),
      depositPct: Math.min(100, Math.max(0, Number.parseFloat(depositPct) || 0)),
      receiptsOnPayment: receipts,
    });

  async function disconnect(which: KeyProvider) {
    setBusy(which);
    setErr("");
    try {
      if (which === "stripe") await disconnectStripeConnect();
      else if (which === "square") await disconnectSquare();
      else await disconnectStax();
      router.refresh();
    } catch (e) {
      setErr(actionError(e));
    } finally {
      setBusy(null);
    }
  }

  const [stripeRow, squareRow, bankRow, staxRow] = PROCESSORS;
  const staxHasRow = c.stax.state !== "disconnected" && c.stax.state !== "not_configured";
  const feeOnInvoice = [
    c.stripe.auth === "key" ? "Stripe" : null,
    c.square.auth === "token" ? "Square" : null,
    staxHasRow ? "Stax" : null,
  ].filter((n): n is string => n !== null);

  return (
    <>
      {/* ── Get paid ── */}
      <section className="mst-card">
        <CardHeader card={PROCESSORS_CARD} />
        <div className="mst-cardB mst-cardB--rows">
          <div className="mst-grp">
            <ProcessorRow
              row={stripeRow}
              state={c.stripe.state}
              connLine={stripeConnLine(c.stripe)}
              connectHref={c.stripe.oauthOffered ? c.connectHref.stripe : null}
              onUseKey={c.stripe.keyOffered ? toggleKey("stripe") : null}
              viaKey={c.stripe.auth === "key"}
              busy={busy !== null}
              onManage={() => navigate("integrations", "stripe")}
              onDisconnect={() => void disconnect("stripe")}
            />
            {keyOpen === "stripe" && c.stripe.state !== "connected" ? (
              <div className="mst-grpSub">
                <ProviderKeyForm
                  provider="stripe"
                  variant="mobile"
                  feePct={p.platformFeePct}
                  onCancel={() => setKeyOpen(null)}
                  onDone={(r) => {
                    if (r.webhook) setKeyOpen(null); // else the form shows the webhook note
                  }}
                />
              </div>
            ) : null}
            {c.stripe.state === "connected" ? (
              <div className="mst-grpSub">
                <div className="mst-trow">
                  <span className="mst-trowB">
                    <span className="mst-trowN">{STRIPE_ACH_TOGGLE.name}</span>
                    <span className="mst-trowD">{STRIPE_ACH_TOGGLE.desc}</span>
                  </span>
                  <Toggle
                    checked={ach}
                    onChange={(next) => {
                      setAch(next);
                      void setStripeAchEnabled(next).catch((e) => setErr(actionError(e)));
                    }}
                    ariaLabel={STRIPE_ACH_TOGGLE.name}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="mst-grp">
            <ProcessorRow
              row={squareRow}
              state={c.square.state}
              connLine={squareConnLine(c.square)}
              connectHref={c.square.oauthOffered ? c.connectHref.square : null}
              onUseKey={c.square.keyOffered ? toggleKey("square") : null}
              useKeyLabel={KEY_FORMS.square.action.label}
              viaKey={c.square.auth === "token"}
              busy={busy !== null}
              onManage={() => navigate("integrations", "square")}
              onDisconnect={() => void disconnect("square")}
            />
            {keyOpen === "square" && c.square.state !== "connected" ? (
              <div className="mst-grpSub">
                <ProviderKeyForm
                  provider="square"
                  variant="mobile"
                  feePct={p.platformFeePct}
                  onCancel={() => setKeyOpen(null)}
                  onDone={(r) => {
                    if (r.webhook) setKeyOpen(null);
                  }}
                />
              </div>
            ) : null}
          </div>

          {/* Stax — key only; held off the page until the rail is proven live
              (lib/payments/rails); an existing row stays so it can be disconnected. */}
          {c.stax.keyOffered || staxHasRow ? (
          <div className="mst-grp">
            <ProcessorRow
              row={staxRow}
              state={c.stax.state}
              connLine={staxConnLine(c.stax)}
              connectHref={null}
              onUseKey={c.stax.keyOffered ? toggleKey("stax") : null}
              useKeyLabel={KEY_FORMS.stax.action.label}
              viaKey
              busy={busy !== null}
              onDisconnect={() => void disconnect("stax")}
            />
            {keyOpen === "stax" && c.stax.state !== "connected" ? (
              <div className="mst-grpSub">
                <ProviderKeyForm
                  provider="stax"
                  variant="mobile"
                  feePct={p.platformFeePct}
                  onCancel={() => setKeyOpen(null)}
                  onDone={(r) => {
                    if (r.webhook) setKeyOpen(null);
                  }}
                />
              </div>
            ) : null}
          </div>
          ) : null}

          <div className="mst-grp">
            <div className="mst-row">
              <div className="mst-rowTop">
                <span className="mst-rowIc">
                  <Ic name={bankRow.icon} />
                </span>
                <span className="mst-rowB">
                  <span className="mst-rowN">{bankRow.name}</span>
                  <span className="mst-rowD">{bankRow.desc}</span>
                </span>
                <Toggle
                  checked={bankOn}
                  onChange={setBankOn}
                  ariaLabel={BANK_TRANSFER_LABELS.enabled}
                />
              </div>
            </div>
            {bankOn ? (
              <div className="mst-grpSub">
                <TextArea
                  label={BANK_TRANSFER_LABELS.instructions}
                  value={bankText}
                  placeholder={BANK_TRANSFER_LABELS.placeholder}
                  maxLength={1000}
                  rows={3}
                  onChange={setBankText}
                />
              </div>
            ) : null}
          </div>

          {/* Footnote band — two drawing annotations, kicker + line. */}
          <div className="mst-note">
            <span className="mst-noteK">{PAYOUT_NOTE_KICKER}</span>
            <span>{PAYOUT_NOTE}</span>
            <span className="mst-noteK">{FEE_NOTE_KICKER}</span>
            <span>{platformFeeLine(p.platformFeePct, feeOnInvoice)}</span>
            {err ? (
              <>
                <span className="mst-noteK is-warn">Error</span>
                <span className="is-warn">{err}</span>
              </>
            ) : null}
          </div>
        </div>
        <SaveBar onSave={() => saveBankTransferSettings({ enabled: bankOn, instructions: bankText })} />
      </section>

      {/* ── Financing (Wisetack, 2026-10-28) — only once JobFlex lets the account in ── */}
      {p.financing ? (
        <section className="mst-card" id="financing">
          <FinancingSubpane d={p.financing} mobile returned={notice?.financing === "back"} />
        </section>
      ) : null}

      {/* ── Defaults ── */}
      <section className="mst-card">
        <CardHeader card={PAYMENT_DEFAULTS_CARD} />
        <div className="mst-cardB">
          <SelectField
            label={CURRENCY_SELECT.label}
            value={currency}
            options={CURRENCY_SELECT.options}
            onPick={setCurrency}
            openPicker={openPicker}
          />
          <Field
            label={PAYMENT_DEFAULT_LABELS.depositPct}
            value={depositPct}
            onChange={setDepositPct}
            inputMode="decimal"
          />
        </div>
      </section>

      {/* ── Automations ── */}
      <section className="mst-card">
        <CardHeader card={PAYMENT_AUTOMATIONS_CARD} />
        <div className="mst-cardB mst-cardB--rows">
          {PAYMENT_AUTOMATIONS.map((row) => (
            <div className="mst-trow" key={row.key}>
              <span className="mst-trowB">
                <span className="mst-trowN">{row.name}</span>
                <span className="mst-trowD">{row.desc}</span>
              </span>
              <Toggle checked={receipts} onChange={setReceipts} ariaLabel={row.name} />
            </div>
          ))}
        </div>
        {/* One save bar for Defaults + Automations: both live in
            paymentSettingsJson, exactly as on the desktop. */}
        <SaveBar onSave={saveDefaults} />
      </section>
    </>
  );
}

/* ══════════════════════════════ BILLING ══════════════════════════════ */

function BillingPane({ data, shown }: { data: SettingsData; shown: boolean }) {
  const b = data.billing;
  const [billingEmail, setBillingEmail] = useState(b.billingEmail);

  return (
    <>
      <section className="mst-card">
        <CardHeader
          card={b.onFree ? { ...PLAN_CARD, sub: PLAN_CARD_SUB_FREE } : b.freeSwitch ? { ...PLAN_CARD, sub: PLAN_CARD_SUB_SWITCHING } : PLAN_CARD}
          badge={b.planBadge}
        />
        <div className="mst-cardB">
          <div className="mst-planBig">{b.planName}</div>
          <div className="mst-planMeta">
            {b.nextBill ? <span>{`${PLAN_META_PREFIX.nextBill}${b.nextBill}`}</span> : null}
            <span>{`${PLAN_META_PREFIX.seats}${b.seats}`}</span>
          </div>
          {b.isOwner && b.manage ? (
            <ManageSubscription
              className="mst-btn mst-btn--primary mst-btn--wide"
              planName={b.planName}
              status={b.planBadge}
              view={b.manage}
              offer={b.cancel}
              freeSwitch={b.freeSwitch}
              changeHref={b.subscriptionHref}
              shown={shown}
            >
              {PLAN_PRIMARY_ACTION.icon ? <Ic name={PLAN_PRIMARY_ACTION.icon} /> : null}
              {PLAN_PRIMARY_ACTION.label}
            </ManageSubscription>
          ) : (
            <button
              className="mst-btn mst-btn--ghost mst-btn--wide"
              type="button"
              disabled
              title={PLAN_ASK_OWNER.desc}
            >
              {PLAN_ASK_OWNER.label}
            </button>
          )}
          <div className="mst-rowD mst-planNote">
            {b.isOwner ? PLAN_CARD_NOTE : PLAN_ASK_OWNER.desc}
          </div>
        </div>
      </section>

      <section className="mst-card">
        <CardHeader card={BILLING_CONTACT_CARD} />
        <div className="mst-cardB">
          <Field
            label={BILLING_CONTACT_LABELS.billingEmail}
            value={billingEmail}
            onChange={setBillingEmail}
            disabled={!b.canEditBilling}
            inputMode="email"
          />
        </div>
        <SaveBar disabled={!b.canEditBilling} onSave={() => updateBusiness({ billingEmail })} />
      </section>

      {/* The way back (lib/freePlan) — the desktop pane's foot. The way out
          is in the manage window only (owner, 2026-10-17). */}
      {b.freeSwitch ? (
        <FreeSwitchNotice planName={b.freeSwitch.planName} at={b.freeSwitch.at} canKeep={b.isOwner} className="mst-freeSwitch" />
      ) : null}
    </>
  );
}

/* ════════════════════════════ INTEGRATIONS ════════════════════════════ */

/** The phone's first Integrations / Payments tab: the Get paid summary, bank transfer and the payment defaults. */
const GET_PAID_TAB = { key: "getpaid", label: "Get paid" } as const;

function IntegrationsPane({
  data,
  sub: wanted,
  notice,
  openPicker,
}: {
  data: SettingsData;
  sub?: SubTabKey;
  notice?: OAuthNotice;
  openPicker: (p: PickerSpec) => void;
}) {
  const { gmail, meta, ramp, stripe, square, connections } = data.integrations;

  // Payments joined Integrations on 2026-10-30 (owner): Get paid leads, then
  // Gmail — only for viewers it is switched on for, once connected, or while a
  // dropped grant is waiting to be reconnected — Meta, Ramp and the processors.
  const tabs = [GET_PAID_TAB, ...integrationSubTabs({ gmail: !gmail.comingSoon || gmail.connected || Boolean(gmail.revokedAt) })];
  const returnedFrom: SubTabKey = notice?.square ? "square" : notice?.stripe ? "stripe" : "getpaid";
  const [sub, setSub] = useState<SubTabKey>(isVisibleSubTab(wanted, tabs) ? (wanted as SubTabKey) : returnedFrom);
  // The page can steer the subtab (Payments → Manage, or ?sub= after OAuth):
  // derive from the prop when it changes, without an effect.
  const [seenWanted, setSeenWanted] = useState(wanted);
  if (wanted !== seenWanted) {
    setSeenWanted(wanted);
    if (wanted) setSub(wanted);
  }

  const oauth = notice?.stripe
    ? { name: "Stripe", ...PROCESSOR_OAUTH_NOTICE[notice.stripe] }
    : notice?.square
      ? { name: "Square", ...PROCESSOR_OAUTH_NOTICE[notice.square] }
      : null;

  return (
    <>
      {oauth && oauth.title ? (
        <div className="mst-note" role="status">
          <span className={oauth.tone === "ok" ? "mst-noteK" : "mst-noteK is-warn"}>{`${oauth.name} — ${oauth.title}`}</span>
          <span>{oauth.sub}</span>
        </div>
      ) : null}
      <div className="mst-subrail" data-tour="payments:processors">
        <div className="mst-subrailIn">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={t.key === sub ? "mst-subtab is-on" : "mst-subtab"}
              type="button"
              aria-pressed={t.key === sub}
              onClick={() => setSub(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Get paid — "Manage" on a processor row opens its tab ── */}
      <div className={sub === "getpaid" ? "mst-subpane is-on" : "mst-subpane"}>
        <PaymentsPane data={data} navigate={(_rail, next) => next && setSub(next)} openPicker={openPicker} notice={notice} />
      </div>

      {/* ── Gmail ── */}
      <div className={sub === "gmail" ? "mst-subpane is-on" : "mst-subpane"}>
        <GmailConnection data={gmail} notice={notice?.gmail} mobile />
      </div>

      {/* ── Meta business ── */}
      <div className={sub === "meta" ? "mst-subpane is-on" : "mst-subpane"}>
        <MetaConnection data={meta} mobile />
      </div>

      {/* ── Ramp cards ── */}
      <div className={sub === "ramp" ? "mst-subpane is-on" : "mst-subpane"}>
        <RampConnection data={ramp} mobile />
      </div>

      {/* ── Stripe / Square ── */}
      <div className={sub === "stripe" ? "mst-subpane is-on" : "mst-subpane"}>
        <ProcessorSubpane d={stripe} conns={connections} mobile />
      </div>
      <div className={sub === "square" ? "mst-subpane is-on" : "mst-subpane"}>
        <ProcessorSubpane d={square} conns={connections} mobile />
      </div>
      <div className={sub === "stax" ? "mst-subpane is-on" : "mst-subpane"}>
        <StaxSubpane conns={connections} mobile />
      </div>
    </>
  );
}

/* ═══════════════════════════ NOTIFICATIONS ═══════════════════════════ */

type Pair = [boolean, boolean];

/** The columns this pane draws: In-app and Email — the two cells a Pair holds. Texts are set on Settings → Texting
 *  (the desktop pane hides the Text column too); drawn here, the Text chip read a cell the Pair never carries and
 *  always showed off. The save sends pairs, so the stored Text cell is kept as it is. */
const PAIR_CHANNELS = NOTIFICATION_CHANNELS.slice(0, 2);

/** One channel cell. On a phone the checkbox carries its channel name, because
 *  a bare box under a distant column header cannot be read one-handed. */
function ChannelChip({
  label,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      className={checked ? "mst-chip is-on" : "mst-chip"}
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
    >
      <span className="mst-chipBox">
        <svg className="mst-chipIc" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      {label}
    </button>
  );
}

function NotificationsPane({ data }: { data: SettingsData }) {
  const { prefs } = data.notifications;
  const router = useRouter();

  const [matrix, setMatrix] = useState<Pair[]>(() =>
    PREF_EVENTS.map((event) => {
      const stored = prefs.matrix[event.key];
      return stored ? ([stored[0], stored[1]] as Pair) : ([event.seed[0], event.seed[1]] as Pair);
    }),
  );

  const available = (ri: number, ci: number) =>
    ci === EMAIL_COLUMN_INDEX ? PREF_EVENTS[ri].emailAvailable : ci !== 0 || PREF_EVENTS[ri].inAppAvailable !== false;

  const setCell = (row: number, col: number, next: boolean) => {
    if (!available(row, col)) return;
    setMatrix((prev) =>
      prev.map((cells, ri) =>
        ri === row ? (cells.map((on, ci) => (ci === col ? next : on)) as Pair) : cells,
      ),
    );
  };
  const setColumn = (col: number, next: boolean) => {
    setMatrix((prev) =>
      prev.map(
        (cells, ri) =>
          cells.map((on, ci) => (ci === col ? (available(ri, ci) ? next : false) : on)) as Pair,
      ),
    );
  };
  const columnAllOn = (col: number) =>
    matrix.every((cells, ri) => !available(ri, col) || cells[col] === true);

  const enableAll = () =>
    setMatrix((prev) => prev.map((cells, ri) => cells.map((_, ci) => available(ri, ci)) as Pair));
  const emailOnly = () =>
    setMatrix((prev) =>
      prev.map(
        (cells, ri) =>
          cells.map((_, ci) => ci === EMAIL_COLUMN_INDEX && available(ri, ci)) as Pair,
      ),
    );

  const [testNote, setTestNote] = useState("");
  const [testing, setTesting] = useState(false);
  async function test() {
    setTesting(true);
    setTestNote("");
    try {
      const res = await sendTestNotification();
      setTestNote(TEST_RESULT_COPY[res.email]);
      router.refresh();
    } catch (e) {
      setTestNote(actionError(e));
    } finally {
      setTesting(false);
    }
  }

  const footerHandler = (action: MatrixAction): (() => void) => {
    if (action === "enable-all") return enableAll;
    if (action === "email-only") return emailOnly;
    return () => void test();
  };

  const save = () => {
    const next: Record<string, Pair> = {};
    PREF_EVENTS.forEach((event, ri) => {
      next[event.key] = matrix[ri] ?? ([event.seed[0], event.seed[1]] as Pair);
    });
    return updateNotificationPrefs({ matrix: next });
  };

  return (
    <section className="mst-card">
      <CardHeader card={NOTIFICATIONS_CARD} />

      {/* The column masters. On the desktop they sit in the table header above
          each channel; here they are one band above the ledger. */}
      <div className="mst-nHead">
        <span className="mst-nHeadL">{NOTIFICATION_EVENT_COLUMN}</span>
        <div className="mst-chips">
          {PAIR_CHANNELS.map((channel, ci) => (
            <ChannelChip
              key={channel}
              label={`${NOTIFICATION_COLUMN_LABEL} ${channel}`}
              checked={columnAllOn(ci)}
              onChange={(next) => setColumn(ci, next)}
              ariaLabel={`${NOTIFICATION_COLUMN_LABEL} ${channel}`}
            />
          ))}
        </div>
      </div>

      <div className="mst-nList">
        {PREF_EVENTS.map((event, ri) => (
          <div className="mst-nRow" key={event.key}>
            <div className="mst-nTop">
              <span className="mst-rowIc">
                <Ic name={NOTIFICATION_ICONS[event.key as PrefKey]} />
              </span>
              <span className="mst-rowB">
                <span className="mst-nEv">{event.name}</span>
                <span className="mst-nSub">{event.sub}</span>
              </span>
            </div>
            <div className="mst-chips">
              {PAIR_CHANNELS.map((channel, ci) =>
                available(ri, ci) ? (
                  <ChannelChip
                    key={channel}
                    label={channel}
                    checked={matrix[ri]?.[ci] ?? false}
                    onChange={(next) => setCell(ri, ci, next)}
                    ariaLabel={`${channel} — ${event.name}`}
                  />
                ) : (
                  <span className="mst-chipOff" key={channel} title={ci === 0 ? INAPP_UNAVAILABLE_TITLE : EMAIL_UNAVAILABLE_TITLE}>
                    {ci === 0 ? INAPP_UNAVAILABLE_TAG : EMAIL_UNAVAILABLE_TAG}
                  </span>
                ),
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mst-nFoot">
        {NOTIFICATION_FOOTER_ACTIONS.map((action) => (
          <button
            key={action.action}
            className="mst-btn mst-btn--ghost"
            type="button"
            disabled={action.action === "test" && testing}
            onClick={footerHandler(action.action)}
          >
            <Ic name={action.icon} />
            {action.label}
          </button>
        ))}
        {testNote ? (
          <span className="mst-nFootNote" role="status">
            {testNote}
          </span>
        ) : null}
      </div>

      <SaveBar onSave={save} />
    </section>
  );
}

/** Settings → Estimating on the phone (2026-10-16): the same form as the desk pane, in this page's card. */
function EstimatingPaneMobile() {
  const item = RAIL_ITEMS.find((r) => r.key === "estimating");
  return (
    <section className="mst-card" id="estimating">
      <CardHeader card={{ title: "Your estimating method", sub: item?.sub ?? "" }} />
      <div className="mst-cardB">
        <CompanyPricingForm />
      </div>
    </section>
  );
}

/** Settings → Website estimators on the phone (2026-10-27): the same form as the desk pane. */
function WebsitePaneMobile() {
  const item = RAIL_ITEMS.find((r) => r.key === "website");
  return (
    <section className="mst-card" id="website">
      <CardHeader card={{ title: "Your estimators on your website", sub: item?.sub ?? "" }} />
      <div className="mst-cardB">
        <WebEstimatorForm />
      </div>
    </section>
  );
}

/* ═════════════════════════════ THE PAGE ═════════════════════════════ */

const SUB_KEYS = new Set<string>(["getpaid", "gmail", "meta", "ramp", "stripe", "square", "stax"]);

const RAIL_ICON: Record<RailKey, IconName> = {
  account: "i-users",
  billing: "i-receipt",
  integrations: "i-globe",
  notifications: "i-bell",
  desk: "i-phone",
  estimating: "i-hardhat",
  website: "i-globe",
  smartbook: "i-cal",
};

export function MobileSettings({
  data,
  initialPane,
}: {
  data: SettingsData;
  /** `?pane=` deep link, resolved on the server. `?tab=` wins over it. */
  initialPane?: RailKey;
}) {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const subParam = params.get("sub");
  const notice: OAuthNotice = {
    gmail: params.get("gmail") ?? undefined,
    stripe: params.get("stripe") ?? undefined,
    square: params.get("square") ?? undefined,
    financing: params.get("financing") ?? undefined,
  };

  // A sub-tab (?sub=stripe|gmail|…) always means Integrations / Payments; ?tab=payments is its old name.
  const [active, setActive] = useState<RailKey>(
    subParam && SUB_KEYS.has(subParam) ? "integrations" : (railKeyFor(tabParam) ?? initialPane ?? DEFAULT_RAIL),
  );
  const [sub, setSub] = useState<SubTabKey | undefined>(
    subParam && SUB_KEYS.has(subParam) ? (subParam as SubTabKey) : undefined,
  );
  const [picker, setPicker] = useState<PickerSpec | null>(null);

  const [railOpen, setRailOpen] = useState(false);

  const scrollRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const secRef = useRef<HTMLElement | null>(null);

  // Not memoized: the React compiler cannot preserve a manual `useCallback`
  // whose inferred dependency (`setActive`) is absent from an empty dep list,
  // and a fresh identity per render costs nothing here.
  const navigate = (rail: RailKey, next?: SubTabKey) => {
    setActive(rail);
    if (next) setSub(next);
    // A jump made from inside a pane (Payments → "Manage" → Integrations) must
    // not leave the section dropdown standing open over the section it just
    // moved to. Closed here rather than in an effect on `active`: setState in
    // an effect body is a cascading render, and this is the only other path
    // that changes the section.
    setRailOpen(false);
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openPicker = useCallback((p: PickerSpec) => setPicker(p), []);

  const activeLabel = RAIL_ITEMS.find((item) => item.key === active)?.label ?? PAGE_TITLE;

  /* ---- Escape closes the picker ---- */
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPicker(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [picker]);

  /* ---- The section dropdown closes on Escape and on any press outside it.
          Both listeners are armed only while it is open, so the page carries
          no idle document handlers. `pointerdown` rather than `click`: a tap
          that starts outside should dismiss even if it ends on a scroll. ---- */
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const host = secRef.current;
      if (host && !host.contains(e.target as Node)) setRailOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [railOpen]);

  /* ---- Motion: reveal on load, applied ONCE at mount ---- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const content = contentRef.current;
    if (!content) return;
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add("mst-rv");
      el.style.transitionDelay = `${i * 60}ms`;
    });
    const raf = requestAnimationFrame(() => {
      blocks.forEach((el) => el.classList.add("mst-rv-in"));
    });
    const done = window.setTimeout(
      () => {
        blocks.forEach((el) => {
          el.style.transitionDelay = "";
        });
      },
      60 * blocks.length + 460,
    );
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, []);

  /* ---- Motion: graph-paper parallax ---- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---- Motion: press stamp, delegated from the root ---- */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".mst-btn, .mst-swBtn, .mst-swOpt, .mst-subtab, .mst-chip, .mst-tg",
    );
    if (!el) return;
    el.classList.remove("mst-pressed");
    void el.offsetWidth;
    el.classList.add("mst-pressed");
  }, []);
  const onRootAnimEnd = useCallback((e: React.AnimationEvent) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains("mst-pressed")) el.classList.remove("mst-pressed");
  }, []);

  return (
    <div className="jf-mobile-settings" onClick={onRootClick} onAnimationEnd={onRootAnimEnd}>
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite.
          It owns its own state and reads its token contract off this root. */}
      <MobileNav />
      <MobileSettingsSprite />

      <main className="mst-scroll" ref={scrollRef}>
        <div className="mst-content" ref={contentRef}>
          <div className="mst-head">
            <div className="mst-kick">{activeLabel}</div>
            <h1 className="mst-title">{PAGE_TITLE}</h1>
          </div>

          {/* The desktop's left rail, collapsed into ONE control (owner's call,
              2026-09-03). The five sections used to be a horizontally scrolling
              chip row: on a 390px viewport only two and a half fitted, so two
              of the five were off-screen behind a scroll gesture nothing
              advertised. A dropdown shows where you are at full width and puts
              every destination one tap away.

              Pinned to the top of the scroller so the switch is never scrolled
              off. The panel is anchored under the trigger rather than sent to
              a bottom sheet: it is a five-item menu, not a long option list,
              and the owner asked for a drop-down specifically. */}
          <nav className="mst-sw" aria-label="Settings sections" ref={secRef}>
            <button
              className={railOpen ? "mst-swBtn is-open" : "mst-swBtn"}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={railOpen}
              onClick={() => setRailOpen((v) => !v)}
            >
              <Ic name={RAIL_ICON[active]} />
              <span className="mst-swV">{activeLabel}</span>
              {RAIL_ITEMS.find((i) => i.key === active)?.isNew ? (
                <span className="mst-new">{RAIL_NEW_BADGE}</span>
              ) : null}
              <Ic name="i-chev" />
            </button>

            <div
              className={railOpen ? "mst-swMenu is-open" : "mst-swMenu"}
              role="listbox"
              aria-label="Settings sections"
              // Closed it holds no tab stops and cannot be reached, the same
              // arrangement the option sheet uses.
              hidden={!railOpen}
            >
              {RAIL_ITEMS.filter((item) => item.key !== "website" || data.website?.visible).map((item) => (
                <button
                  key={item.key}
                  className={item.key === active ? "mst-swOpt is-on" : "mst-swOpt"}
                  type="button"
                  role="option"
                  aria-selected={item.key === active}
                  onClick={() => {
                    setActive(item.key);
                    setRailOpen(false);
                    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                >
                  <Ic name={RAIL_ICON[item.key]} />
                  <span className="mst-swOptV">{item.label}</span>
                  {item.isNew ? <span className="mst-new">{RAIL_NEW_BADGE}</span> : null}
                  {item.key === active ? <Ic name="i-check" /> : null}
                </button>
              ))}
            </div>
          </nav>

          {/* Every pane stays MOUNTED — a half-typed address must survive a trip
              through another section, exactly as on the desktop. */}
          <div className="mst-panes">
            <div className={active === "account" ? "mst-pane is-on" : "mst-pane"}>
              <AccountPane data={data} />
            </div>
            <div className={active === "billing" ? "mst-pane is-on" : "mst-pane"}>
              <BillingPane data={data} shown={active === "billing"} />
            </div>
            <div className={active === "integrations" ? "mst-pane is-on" : "mst-pane"}>
              <IntegrationsPane data={data} sub={sub} notice={notice} openPicker={openPicker} />
            </div>
            <div className={active === "notifications" ? "mst-pane is-on" : "mst-pane"}>
              <NotificationsPane data={data} />
            </div>
            <div className={active === "estimating" ? "mst-pane is-on" : "mst-pane"}>
              <EstimatingPaneMobile />
            </div>
            {data.website?.visible ? (
              <div className={active === "website" ? "mst-pane is-on" : "mst-pane"}>
                <WebsitePaneMobile />
              </div>
            ) : null}
            {/* SmartBook (2026-10-31): the desk pane's own form, a phone's width. */}
            <div className={active === "smartbook" ? "mst-pane is-on" : "mst-pane"} id="smartbook">
              <SmartBookSettingsForm mobile onOpen={(where) => (where === "meta" ? navigate("integrations", "meta") : navigate("notifications"))} />
            </div>
          </div>

          {/* Log out — the last thing on the page, in every section. Same
              mechanism as the desktop Account pane: the credential epoch is
              bumped, then this browser signs out. */}
          <div className="mst-logout">
            <button
              className="mst-btn mst-btn--danger mst-btn--wide"
              type="button"
              onClick={() => void logOutEverywhere("/")}
            >
              <Ic name="i-out" />
              {SIGN_OUT_LABEL}
            </button>
          </div>
        </div>
      </main>

      {/* ── The option picker: a bottom sheet, never a centred dialog ── */}
      <div
        className={picker ? "mst-scrim is-on" : "mst-scrim"}
        onClick={() => setPicker(null)}
        aria-hidden={picker ? undefined : true}
      />
      <div
        className={picker ? "mst-sheet is-on" : "mst-sheet"}
        role="dialog"
        aria-modal="true"
        aria-label={picker?.label ?? "Options"}
      >
        <div className="mst-sheetGrab" />
        <div className="mst-sheetHead">{picker?.label}</div>
        <div className="mst-sheetBody" role="listbox">
          {(picker?.options ?? []).map((o) => (
            <button
              key={o}
              className={o === picker?.value ? "mst-sheetOpt is-sel" : "mst-sheetOpt"}
              type="button"
              role="option"
              aria-selected={o === picker?.value}
              onClick={() => {
                picker?.onPick(o);
                setPicker(null);
              }}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
