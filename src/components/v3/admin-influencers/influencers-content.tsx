"use client";

// ADMIN INFLUENCERS — BLUEPRINT
// /admin/influencers
//
// Rollup strip → partner ledger (+ top codes aside) → three hand-rolled
// sheets: set up an account, the partner record (a right drawer), and the
// code sheet (add a code / edit its terms). All writes go to the existing
// actions in src/actions/influencers.ts and influencer-auth.ts; the page is a
// server component reading the rows it changes, so `router.refresh()` IS the
// update — there is no local copy of the ledger to keep in step.
//
// Each sheet owns its form state and exposes ONE imperative `open(...)` through
// a handle ref (the cd-dialogs pattern): the seed runs inside `open`, before
// the motion, so no effect ever has to set state in response to a prop.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { underField } from "@/lib/actionResult";
import { money, relative, shortDate } from "@/lib/format";
import {
  createInfluencer,
  createPromoCode,
  replacePromoDiscount,
  setInfluencerStatus,
  setPromoActive,
  updateInfluencerProfile,
  updatePromoCommission,
} from "@/actions/influencers";
import { sendInfluencerInvite } from "@/actions/influencer-auth";
import {
  Chip,
  CopyRow,
  Empty,
  Ic,
  KpiStrip,
  Meta,
  Seg,
  Sheet,
  type Tone,
  actionError,
  cx,
  useMdl,
  useReveal,
} from "./admin-ui";
import {
  DISCOUNT_MONTHS_MAX,
  DISCOUNT_MONTHS_MIN,
  DISCOUNT_MONTHS_PICKS,
  YEAR_DISCOUNT_MONTHS_CAP,
  baseCode,
  discountMonthsProblem,
  discountPhrase,
  discountSummary,
} from "@/lib/promoDiscount";
import ui from "./admin-ui.module.css";
import styles from "./influencers.module.css";
import {
  DEFAULT_MODEL,
  STATUS_LABEL,
  describeDiscount,
  describeEarning,
  describeModel,
  modelToInput,
  promoToModel,
  shortDiscount,
  shortModel,
  type CommissionBasis,
  type CommissionType,
  type DurationType,
  type EarningModel,
  type InfluencerDTO,
  type InfluencerRollup,
  type PromoDTO,
} from "./influencers-data";

const PAYOUTS_ROUTE = "/admin/payouts" as Route;

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  PENDING: "wait",
  SUSPENDED: "mute",
  TERMINATED: "bad",
};

type Filter = "ALL" | "ACTIVE" | "PENDING" | "SUSPENDED" | "TERMINATED";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "PENDING", label: "Pending" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "TERMINATED", label: "Terminated" },
];

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

type CreateHandle = { open: () => void };
type DetailHandle = { open: () => void };
type CodeTarget =
  | { mode: "add"; influencerId: string; name: string }
  | { mode: "edit"; promo: PromoDTO; name: string }
  | { mode: "replace"; promo: PromoDTO; name: string; model: EarningModel };
type CodeHandle = { open: (target: CodeTarget) => void };

/* ============================================================
   PAGE
   ============================================================ */

export function AdminInfluencersContent({
  influencers,
  rollup,
}: {
  influencers: InfluencerDTO[];
  rollup: InfluencerRollup;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Derived, never stored: after a router.refresh the fresh row is what shows.
  const selected = useMemo(
    () => (selectedId ? (influencers.find((i) => i.id === selectedId) ?? null) : null),
    [influencers, selectedId],
  );

  const rows = useMemo(
    () => (filter === "ALL" ? influencers : influencers.filter((i) => i.status === filter)),
    [influencers, filter],
  );
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: influencers.length, ACTIVE: 0, PENDING: 0, SUSPENDED: 0, TERMINATED: 0 };
    for (const i of influencers) if (i.status in c) c[i.status as Filter] += 1;
    return c;
  }, [influencers]);

  const createRef = useRef<CreateHandle | null>(null);
  const detailRef = useRef<DetailHandle | null>(null);
  const codeRef = useRef<CodeHandle | null>(null);

  const openDetail = useCallback((id: string) => {
    setSelectedId(id);
    detailRef.current?.open();
  }, []);
  const openAddCode = useCallback((inf: InfluencerDTO) => {
    codeRef.current?.open({ mode: "add", influencerId: inf.id, name: inf.displayName });
  }, []);
  const openEditCode = useCallback((inf: InfluencerDTO, promo: PromoDTO) => {
    codeRef.current?.open({ mode: "edit", promo, name: inf.displayName });
  }, []);
  const openReplaceCode = useCallback((inf: InfluencerDTO, promo: PromoDTO) => {
    codeRef.current?.open({ mode: "replace", promo, name: inf.displayName, model: promoToModel(promo) });
  }, []);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Partners</div>
          <h1 className="page-title">Influencers</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" type="button" onClick={() => createRef.current?.open()}>
            <Ic name="userplus" />
            Set up an account
          </button>
        </div>
      </div>

      <KpiStrip
        cells={[
          { label: "Partners", value: String(rollup.total) },
          { label: "Active", value: String(rollup.active), tone: rollup.active > 0 ? "ok" : undefined },
          { label: "Pending invite", value: String(rollup.pending), tone: rollup.pending > 0 ? "warn" : undefined },
          { label: "Suspended", value: String(rollup.suspended + rollup.terminated) },
        ]}
      />
      <KpiStrip
        cells={[
          { label: "Promo clicks", value: rollup.clicks.toLocaleString("en-US") },
          { label: "Conversions", value: rollup.conversions.toLocaleString("en-US"), accent: true },
          { label: "Commission owed", value: money(rollup.owedCents / 100), accent: true },
          { label: "Paid out", value: money(rollup.paidOutCents / 100), tone: "ok" },
        ]}
      />

      <div className={cx(ui.grid21, "rv")}>
        <section className="card">
          <div className={cx("card-head", ui.cardHead)}>
            <div className="card-titles">
              <div className="card-title">Partners</div>
            </div>
            <div className={ui.filters} role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={cx(ui.filter, filter === f.key && ui.filterOn)}
                  aria-pressed={filter === f.key}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  <i>{counts[f.key]}</i>
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <Empty>
              {influencers.length === 0
                ? "No partners yet."
                : `No ${filter.toLowerCase()} partners.`}
            </Empty>
          ) : (
            <div className={ui.tbl} role="table" aria-label="Partners">
              <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                <span>Partner</span>
                <span>Status</span>
                <span>Codes</span>
                <span className={ui.thR}>Clicks</span>
                <span className={ui.thR}>Conv.</span>
                <span className={ui.thR}>Owed</span>
                <span className={ui.thR}>Last payout</span>
              </div>
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={cx(ui.tr, ui.trBtn, styles.cols)}
                  onClick={() => openDetail(r.id)}
                  aria-label={`Open ${r.displayName}`}
                >
                  <span className={ui.tdWide}>
                    <span className={ui.tdName} title={r.displayName}>
                      {r.displayName}
                    </span>
                    <span className={ui.tdSub} title={r.email}>
                      {r.email}
                      {!r.hasPassword ? " · no password yet" : ""}
                    </span>
                  </span>
                  <span>
                    <span className={ui.tdLbl}>Status</span>
                    <Chip tone={STATUS_TONE[r.status] ?? "mute"}>{STATUS_LABEL[r.status] ?? r.status}</Chip>
                  </span>
                  <span className={ui.tdWide}>
                    <span className={ui.tdLbl}>Codes</span>
                    <span className={ui.tags}>
                      {r.promoCodes.length === 0 ? (
                        <span className={ui.meta}>—</span>
                      ) : (
                        r.promoCodes.map((p) => (
                          <span
                            key={p.id}
                            className={cx(ui.tag, !p.active && ui.tagOff, p.aboveLimit && styles.tagOver)}
                            title={`${baseCode(p.code)} · subscriber discount ${shortDiscount(p)}${p.replaced ? " (replaced)" : p.aboveLimit ? " — above the commission limit" : p.active ? "" : " (off)"}`}
                          >
                            {baseCode(p.code)}
                            {p.aboveLimit ? <span className={styles.tagOverMark} aria-label="above the limit">!</span> : null}
                          </span>
                        ))
                      )}
                    </span>
                  </span>
                  <span className={ui.tdNum}>
                    <span className={ui.tdLbl}>Clicks</span>
                    {r.clicks.toLocaleString("en-US")}
                  </span>
                  <span className={ui.tdNum}>
                    <span className={ui.tdLbl}>Conversions</span>
                    {r.conversions.toLocaleString("en-US")}
                  </span>
                  <span className={cx(ui.tdAmt, r.balances.balanceCents > 0 && ui.tdAmtBp)}>
                    <span className={ui.tdLbl}>Owed</span>
                    {money(r.balances.balanceCents / 100)}
                  </span>
                  <span className={cx(ui.tdNum, !r.lastPayoutAt && ui.tdNumMute)}>
                    <span className={ui.tdLbl}>Last payout</span>
                    {r.lastPayoutAt
                      ? `${money((r.lastPayoutCents ?? 0) / 100)} · ${shortDate(r.lastPayoutAt)}`
                      : "none"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="card">
          <div className="card-head">
            <div className="card-titles">
              <div className="card-title">Top codes</div>
              <div className="card-sub">by conversions</div>
            </div>
          </div>
          {rollup.topCodes.length === 0 ? (
            <Empty>No code has converted yet.</Empty>
          ) : (
            <ol className={styles.rank}>
              {rollup.topCodes.map((c, i) => (
                <li key={c.promoId} className={styles.rankRow}>
                  <span className={styles.rankN}>{String(i + 1).padStart(2, "0")}</span>
                  <button type="button" className={styles.rankWho} onClick={() => openDetail(c.influencerId)}>
                    <span className={cx(ui.tag, !c.active && ui.tagOff)}>{baseCode(c.code)}</span>
                    <span className={ui.tdSub} title={c.influencerName}>
                      {c.influencerName}
                    </span>
                  </button>
                  <span className={styles.rankVal}>
                    <b>{c.conversions}</b>
                    <Meta>{plural(c.clicks, "click")}</Meta>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>

      <CreateSheet handleRef={createRef} />
      <DetailSheet
        handleRef={detailRef}
        influencer={selected}
        onAddCode={openAddCode}
        onEditCode={openEditCode}
        onReplaceCode={openReplaceCode}
      />
      <CodeSheet handleRef={codeRef} />
    </div>
  );
}

/* ============================================================
   EARNING MODEL FIELDS — shared by the create and code sheets
   ============================================================ */

/** Which half of the terms a sheet edits: a new code sets both; "Edit
 *  commission" the partner's half; "Replace discount" the subscriber's. */
type ModelPart = "all" | "commission" | "discount";

/** The months field's complaint: what is wrong with the typed value, else what the server said. */
function monthsComplaint(model: EarningModel, serverSaid: string | null): string | null {
  return discountMonthsProblem(model.customerDiscountMonths) ?? serverSaid;
}

function ModelFields({
  model,
  onChange,
  part,
  fixed,
  idp,
  monthsError,
  monthsRef,
}: {
  model: EarningModel;
  onChange: (m: EarningModel) => void;
  part: ModelPart;
  /** Editing the commission: the code whose (immutable) discount is read out. */
  fixed?: PromoDTO;
  idp: string;
  /** The server's word on the months, when it refused them. */
  monthsError?: string | null;
  monthsRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const set = (patch: Partial<EarningModel>) => onChange({ ...model, ...patch });
  const num = (v: string) => (v === "" ? 0 : Number(v));
  const showDiscount = part !== "commission";
  const showCommission = part !== "discount";
  const monthsErr = showDiscount ? monthsComplaint(model, monthsError ?? null) : null;
  const months = monthsErr ? null : Number(model.customerDiscountMonths);
  return (
    <>
      <div className={ui.secL}>Subscriber discount</div>
      {showDiscount ? (
        <>
          <div className={ui.row2}>
            <div className="mf">
              <label className="mf-lbl" htmlFor={`${idp}Disc`}>
                Customer discount (%)
              </label>
              <input
                className="mf-in"
                id={`${idp}Disc`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                value={model.customerPercentOff}
                onChange={(e) => set({ customerPercentOff: num(e.target.value) })}
              />
            </div>
            <div className="mf">
              <label className="mf-lbl" htmlFor={`${idp}DiscMo`}>
                Discount lasts (months)
              </label>
              <input
                className={cx("mf-in", styles.monthsIn)}
                id={`${idp}DiscMo`}
                ref={monthsRef}
                type="number"
                inputMode="numeric"
                min={DISCOUNT_MONTHS_MIN}
                max={DISCOUNT_MONTHS_MAX}
                step={1}
                value={model.customerDiscountMonths}
                aria-invalid={monthsErr ? true : undefined}
                aria-describedby={monthsErr ? `${idp}DiscMoErr` : undefined}
                onChange={(e) => set({ customerDiscountMonths: e.target.value })}
              />
              {monthsErr ? (
                <div className={cx("mf-err", styles.fieldErr)} id={`${idp}DiscMoErr`} role="alert">
                  {monthsErr}
                </div>
              ) : null}
              <div className={styles.picks}>
                <Seg<string>
                  label="Quick pick: months"
                  value={model.customerDiscountMonths.trim()}
                  onChange={(v) => set({ customerDiscountMonths: v })}
                  options={DISCOUNT_MONTHS_PICKS.map((n) => ({ value: String(n), label: String(n) }))}
                />
              </div>
            </div>
          </div>
          <div className={styles.preview} aria-live="polite" data-discount-summary>
            <Ic name="bulb" />
            <span>
              {months === null
                ? "Set how many months the discount lasts — 1 to 24."
                : discountSummary(model.customerPercentOff, months)}
            </span>
          </div>
          {months !== null && months > YEAR_DISCOUNT_MONTHS_CAP ? (
            <div className={cx(ui.hint, styles.hintTop)} data-year-hint>
              On a yearly plan the discount is one amount off the single yearly bill, so {months} months count as{" "}
              {YEAR_DISCOUNT_MONTHS_CAP} — a whole year&apos;s worth of the percent.
            </div>
          ) : null}
          <div className={cx(ui.hint, styles.hintTop)}>
            Written to the Stripe coupon and fixed for the life of the code. Replace discount changes it for new
            subscribers only.
          </div>
        </>
      ) : (
        <div className={cx(ui.hint, styles.hintTop)}>
          {fixed ? describeDiscount(fixed) : null} The discount lives on the Stripe coupon and cannot change here — use
          Replace discount on the code to change it for new subscribers.
        </div>
      )}

      {showCommission ? (
        <>
          <div className={ui.secL}>Partner commission</div>
          <div className={ui.mfSeg}>
            <span className="mf-lbl">Commission</span>
            <Seg<CommissionType>
              label="Commission type"
              value={model.commissionType}
              onChange={(v) => set({ commissionType: v, commissionValue: v === "FLAT" ? 15 : 20 })}
              options={[
                { value: "PERCENT", label: "% of subscription" },
                { value: "FLAT", label: "Flat dollars" },
              ]}
            />
          </div>

          <div className={ui.row2}>
            <div className="mf">
              <label className="mf-lbl" htmlFor={`${idp}Val`}>
                {model.commissionType === "PERCENT" ? "Rate (%)" : "Amount ($)"}
              </label>
              <input
                className="mf-in"
                id={`${idp}Val`}
                type="number"
                inputMode="decimal"
                min={0}
                step={model.commissionType === "PERCENT" ? 0.5 : 1}
                value={model.commissionValue}
                onChange={(e) => set({ commissionValue: num(e.target.value) })}
              />
            </div>
            <div className="mf">
              <span className="mf-lbl">Basis</span>
              <Seg<CommissionBasis>
                label="Commission basis"
                value={model.commissionBasis}
                onChange={(v) => set({ commissionBasis: v })}
                options={[
                  { value: "NET", label: "Net" },
                  { value: "GROSS", label: "Gross" },
                ]}
              />
            </div>
          </div>
          <div className={ui.hint}>
            Net pays on what Stripe actually collected after the discount; gross pays on the plan price.
          </div>

          <div className={ui.mfSeg}>
            <span className="mf-lbl">Commission duration</span>
            <Seg<DurationType>
              label="Commission duration"
              value={model.durationType}
              onChange={(v) => set({ durationType: v })}
              options={[
                { value: "ONCE", label: "Once" },
                { value: "REPEATING", label: "N months" },
                { value: "FOREVER", label: "Forever" },
              ]}
            />
          </div>
          {model.durationType === "REPEATING" ? (
            <div className="mf">
              <label className="mf-lbl" htmlFor={`${idp}Mo`}>
                Commission months
              </label>
              <input
                className="mf-in"
                id={`${idp}Mo`}
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                value={model.durationMonths}
                onChange={(e) => set({ durationMonths: Math.max(1, Math.round(num(e.target.value))) })}
              />
            </div>
          ) : null}
          <div className={ui.hint}>How long the partner earns on each subscriber — separate from the discount.</div>

          <div className={styles.preview} aria-live="polite">
            <Ic name="bulb" />
            <span>{describeModel(model)}</span>
          </div>
        </>
      ) : null}
    </>
  );
}

/* ============================================================
   CREATE — "Set up an account"
   ============================================================ */

type CreateValues = { email: string; displayName: string; code: string; password: string };
const BLANK_CREATE: CreateValues = { email: "", displayName: "", code: "", password: "" };

function CreateSheet({ handleRef }: { handleRef: React.RefObject<CreateHandle | null> }) {
  const router = useRouter();
  const [values, setValues] = useState<CreateValues>(BLANK_CREATE);
  const [model, setModel] = useState<EarningModel>(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ code: string; inviteUrl: string | null; email: string } | null>(null);
  const [monthsError, setMonthsError] = useState<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const monthsRef = useRef<HTMLInputElement>(null);

  // Seeded on open rather than reset on close, so the fields never blank while
  // the box is still on screen playing its exit.
  const seed = useCallback(() => {
    setValues(BLANK_CREATE);
    setModel(DEFAULT_MODEL);
    setMonthsError(null);
    setError(null);
    setResult(null);
    setBusy(false);
    requestAnimationFrame(() => requestAnimationFrame(() => firstRef.current?.focus()));
  }, []);
  const { ref: mdlRef, open, close } = useMdl(seed);
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  const set = (k: keyof CreateValues) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value }));

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    if (!values.displayName.trim() || !values.email.trim() || !values.code.trim()) {
      setError("Name, email and a promo code are required.");
      return;
    }
    if (values.password && values.password.length < 8) {
      setError("Password must be at least 8 characters — or leave it blank to send an invite.");
      return;
    }
    // The months field says what is wrong under itself; the form does not go.
    if (discountMonthsProblem(model.customerDiscountMonths)) {
      setError(null);
      monthsRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setMonthsError(null);
    try {
      const res = await createInfluencer({
        email: values.email.trim(),
        displayName: values.displayName.trim(),
        code: values.code.trim(),
        password: values.password ? values.password : undefined,
        ...modelToInput(model),
      });
      if (!res.ok) {
        if (res.field === "customerDiscountMonths") setMonthsError(underField(res));
        else setError(res.error);
        return;
      }
      setResult({ code: res.code, inviteUrl: res.inviteUrl, email: values.email.trim() });
      toast.success(
        "Partner account created",
        res.inviteUrl ? `Invite emailed to ${values.email.trim()}.` : undefined,
      );
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      mdlRef={mdlRef}
      title={result ? "Account ready" : "Set up an account"}
      titleId="infCreateTitle"
      size="lg"
      onClose={close}
      error={error}
      foot={
        result ? (
          <button className="btn btn-primary" type="button" onClick={close}>
            <Ic name="check" />
            Done
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" type="button" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button
              className={cx("btn btn-primary", busy && ui.btnBusy)}
              type="button"
              onClick={() => submit()}
              disabled={busy}
            >
              <Ic name="userplus" />
              {busy ? "Creating…" : "Create account"}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div>
          <CopyRow label="Promo code" value={result.code} />
          {result.inviteUrl ? <CopyRow label="Invite link · 7 days" value={result.inviteUrl} /> : null}
          <div className={cx(ui.hint, styles.hintTop)}>
            {result.inviteUrl
              ? `The same link went to ${result.email}. It lets them set a password; then they sign in at /influencer/login.`
              : "You set the password yourself — no invite needed. They sign in at /influencer/login."}
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className={ui.secL}>Account</div>
          <div className={ui.row2}>
            <div className="mf">
              <label className="mf-lbl" htmlFor="infName">
                Display name
              </label>
              <input
                className="mf-in"
                id="infName"
                ref={firstRef}
                value={values.displayName}
                onChange={set("displayName")}
                placeholder="Jamie Rivera"
                autoComplete="off"
              />
            </div>
            <div className="mf">
              <label className="mf-lbl" htmlFor="infEmail">
                Email
              </label>
              <input
                className="mf-in"
                id="infEmail"
                type="email"
                value={values.email}
                onChange={set("email")}
                placeholder="jamie@example.com"
                autoComplete="off"
              />
            </div>
          </div>
          <div className={ui.row2}>
            <div className="mf">
              <label className="mf-lbl" htmlFor="infCode">
                Promo code
              </label>
              <input
                className={cx("mf-in", styles.codeIn)}
                id="infCode"
                value={values.code}
                onChange={set("code")}
                placeholder="JAMIE20"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="mf">
              <label className="mf-lbl" htmlFor="infPass">
                Password (optional)
              </label>
              <input
                className="mf-in"
                id="infPass"
                type="password"
                value={values.password}
                onChange={set("password")}
                placeholder="Blank = email an invite"
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className={ui.hint}>
            Letters, numbers, - and _ — what customers type at checkout. Without a password they get an invite link to
            set their own.
          </div>

          <ModelFields
            model={model}
            onChange={(m) => {
              setModel(m);
              setMonthsError(null);
            }}
            part="all"
            idp="infC"
            monthsError={monthsError}
            monthsRef={monthsRef}
          />
        </form>
      )}
    </Sheet>
  );
}

/* ============================================================
   DETAIL — the partner record (right drawer / bottom sheet)
   ============================================================ */

function DetailSheet({
  handleRef,
  influencer,
  onAddCode,
  onEditCode,
  onReplaceCode,
}: {
  handleRef: React.RefObject<DetailHandle | null>;
  influencer: InfluencerDTO | null;
  onAddCode: (inf: InfluencerDTO) => void;
  onEditCode: (inf: InfluencerDTO, promo: PromoDTO) => void;
  onReplaceCode: (inf: InfluencerDTO, promo: PromoDTO) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ displayName: "", minPayout: 25, holdDays: 30, notes: "" });

  const seed = useCallback(() => {
    setEditing(false);
    setInviteUrl(null);
    setError(null);
    setBusy(null);
  }, []);
  const { ref: mdlRef, open, close } = useMdl(seed);
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  const inf = influencer;

  // Every action answers with an envelope (lib/actionResult); a refusal is
  // shown in the sheet and the toast stays quiet. The catch is for the
  // network, and for what is still thrown (auth).
  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return false;
      }
      toast.success(ok);
      router.refresh();
      return true;
    } catch (err) {
      setError(actionError(err));
      return false;
    } finally {
      setBusy(null);
    }
  }

  function startEdit() {
    if (!inf) return;
    setDraft({
      displayName: inf.displayName,
      minPayout: inf.minPayoutCents / 100,
      holdDays: inf.holdDays,
      notes: inf.notes ?? "",
    });
    setEditing(true);
  }

  return (
    <Sheet
      mdlRef={mdlRef}
      title={inf?.displayName ?? "Partner"}
      titleId="infDetailTitle"
      size="drawer"
      onClose={close}
      error={error}
      foot={
        <button className="btn btn-ghost" type="button" onClick={close}>
          Done
        </button>
      }
    >
      {!inf ? null : (
        <div>
          <div className={styles.who}>
            <Chip tone={STATUS_TONE[inf.status] ?? "mute"}>{STATUS_LABEL[inf.status] ?? inf.status}</Chip>
            <Meta>
              {inf.email} · since {shortDate(inf.createdAt)}
              {!inf.hasPassword ? " · no password yet" : ""}
            </Meta>
          </div>

          <div className={cx(ui.facts, ui.facts4)}>
            <div className={ui.fact}>
              <div className={ui.factL}>Owed</div>
              <div className={cx(ui.factV, inf.balances.balanceCents > 0 && ui.factBp)}>
                {money(inf.balances.balanceCents / 100)}
              </div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Cleared</div>
              <div className={ui.factV}>{money(inf.balances.clearedCents / 100)}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>In hold</div>
              <div className={ui.factV}>{money(inf.balances.pendingCents / 100)}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Paid out</div>
              <div className={cx(ui.factV, inf.balances.paidOutCents > 0 && ui.factOk)}>
                {money(inf.balances.paidOutCents / 100)}
              </div>
            </div>
          </div>
          <Meta className={styles.whoMeta}>
            {plural(inf.clicks, "click")} · {plural(inf.conversions, "conversion")} · payouts{" "}
            {inf.payoutsEnabled ? "enabled" : "not set up"}
          </Meta>

          {/* STATUS */}
          <div className={ui.secL}>Status</div>
          <Seg<string>
            label="Account status"
            value={inf.status}
            onChange={(v) => {
              if (v === inf.status) return;
              void run(
                "status",
                () => setInfluencerStatus(inf.id, v),
                `Marked ${STATUS_LABEL[v]?.toLowerCase() ?? v}`,
              );
            }}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "PENDING", label: "Pending" },
              { value: "SUSPENDED", label: "Suspended" },
              { value: "TERMINATED", label: "Terminated" },
            ]}
          />
          <div className={cx(ui.hint, styles.hintTop)}>
            Suspended and terminated partners cannot sign in; their codes keep working until disabled below.
          </div>

          {/* INVITE */}
          <div className={ui.secL}>
            Sign-in
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                run(
                  "invite",
                  async () => {
                    const res = await sendInfluencerInvite(inf.id);
                    if (res.ok) setInviteUrl(res.inviteUrl);
                    return res;
                  },
                  "Invite sent",
                )
              }
            >
              {busy === "invite" ? "Sending…" : inf.hasPassword ? "Resend invite" : "Send invite"}
            </button>
          </div>
          {inviteUrl ? (
            <CopyRow label="Invite link · 7 days" value={inviteUrl} />
          ) : (
            <Meta>
              {inf.hasPassword
                ? "Has a password. A resent invite lets them set a new one."
                : "No password yet — the invite link sets one."}
            </Meta>
          )}

          {/* PROFILE */}
          <div className={ui.secL}>
            Profile & payout terms
            <button type="button" onClick={() => (editing ? setEditing(false) : startEdit())}>
              {editing ? "Cancel" : "Edit"}
            </button>
          </div>
          {editing ? (
            <div>
              <div className="mf">
                <label className="mf-lbl" htmlFor="infDName">
                  Display name
                </label>
                <input
                  className="mf-in"
                  id="infDName"
                  value={draft.displayName}
                  onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                />
              </div>
              <div className={ui.row2}>
                <div className="mf">
                  <label className="mf-lbl" htmlFor="infDMin">
                    Min payout ($)
                  </label>
                  <input
                    className="mf-in"
                    id="infDMin"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={draft.minPayout}
                    onChange={(e) => setDraft({ ...draft, minPayout: Number(e.target.value) })}
                  />
                </div>
                <div className="mf">
                  <label className="mf-lbl" htmlFor="infDHold">
                    Hold days
                  </label>
                  <input
                    className="mf-in"
                    id="infDHold"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={180}
                    value={draft.holdDays}
                    onChange={(e) => setDraft({ ...draft, holdDays: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="mf">
                <label className="mf-lbl" htmlFor="infDNotes">
                  Notes
                </label>
                <textarea
                  className={cx("mf-in", ui.area)}
                  id="infDNotes"
                  rows={3}
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                />
              </div>
              <button
                className={cx("btn btn-primary", ui.btnSm, busy === "profile" && ui.btnBusy)}
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    "profile",
                    () =>
                      updateInfluencerProfile({
                        id: inf.id,
                        displayName: draft.displayName.trim() || undefined,
                        minPayoutCents: Math.max(0, Math.round(draft.minPayout * 100)),
                        holdDays: Math.max(0, Math.round(draft.holdDays)),
                        notes: draft.notes.trim() || null,
                      }),
                    "Profile saved",
                  ).then((saved) => saved && setEditing(false))
                }
              >
                <Ic name="check" />
                {busy === "profile" ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <div className={styles.terms}>
              <div>
                Min payout <b>{money(inf.minPayoutCents / 100)}</b> · <b>{inf.holdDays}</b>-day hold before commission
                clears
              </div>
              {inf.notes ? <div className={styles.notes}>{inf.notes}</div> : null}
            </div>
          )}

          {/* CODES */}
          <div className={ui.secL}>
            Promo codes
            <button type="button" onClick={() => onAddCode(inf)}>
              + Add code
            </button>
          </div>
          {inf.promoCodes.length === 0 ? (
            <Empty>No codes.</Empty>
          ) : (
            <ul className={styles.codes}>
              {inf.promoCodes.map((p) => {
                const m = promoToModel(p);
                return (
                  <li key={p.id} className={cx(styles.code, !p.active && styles.codeOff)} data-code={p.code}>
                    <div className={styles.codeHead}>
                      <span className={cx(ui.tag, styles.codeTag, !p.active && ui.tagOff)}>{baseCode(p.code)}</span>
                      <Chip tone={p.replaced ? "mute" : p.active ? "ok" : "mute"}>
                        {p.replaced ? "Replaced" : p.active ? "Active" : "Off"}
                      </Chip>
                      {p.aboveLimit ? <Chip tone="bad">Above limit</Chip> : null}
                      {p.couponForever ? <Chip tone="wait">Discount: forever (legacy)</Chip> : null}
                    </div>
                    <dl className={styles.codeTerms}>
                      <div>
                        <dt>Subscriber discount</dt>
                        <dd data-discount-short>{shortDiscount(p)}</dd>
                      </div>
                      <div>
                        <dt>Commission</dt>
                        <dd>{shortModel(m)}</dd>
                      </div>
                    </dl>
                    <div className={styles.codeDesc}>
                      <span>{describeDiscount(p)}</span> <span>Partner {describeEarning(m)}.</span>
                    </div>
                    <Meta>
                      {plural(p.clicks, "click")} · {plural(p.conversions, "conversion")}
                    </Meta>
                    {p.replaced ? (
                      <p className={styles.codeNote}>
                        The terms this code had before its discount was replaced.{" "}
                        {p.conversions > 0
                          ? `Kept for the ${plural(p.conversions, "subscriber")} who joined with them: their discount stays as it was, and the partner keeps earning on them.`
                          : "Nobody joined with them; kept as the code's history."}
                      </p>
                    ) : p.couponForever ? (
                      <p className={styles.codeNote}>
                        Its Stripe coupon was minted before the first-month rule and takes the percent off every
                        payment, for good. Replace discount to give new subscribers a set number of months — those who
                        already joined keep theirs.
                      </p>
                    ) : null}
                    {p.aboveLimit ? (
                      <p className={styles.codeOver}>
                        Above the limit — at most 50% for a percentage code, the cheapest plan&apos;s price for a
                        flat one. Written before the rule; editing the commission has to bring it under.
                      </p>
                    ) : null}
                    <div className={styles.codeAct}>
                      <button
                        className={cx("btn", ui.btnGhost, ui.btnSm)}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => onEditCode(inf, p)}
                      >
                        <Ic name="pen" />
                        Edit commission
                      </button>
                      {p.replaced ? null : (
                        <>
                          <button
                            className={cx("btn", ui.btnGhost, ui.btnSm)}
                            type="button"
                            disabled={busy !== null}
                            onClick={() => onReplaceCode(inf, p)}
                          >
                            <Ic name="undo" />
                            Replace discount
                          </button>
                          <button
                            className={cx(
                              "btn",
                              p.active ? ui.btnBad : ui.btnOk,
                              ui.btnSm,
                              busy === `code:${p.id}` && ui.btnBusy,
                            )}
                            type="button"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                `code:${p.id}`,
                                () => setPromoActive(p.id, !p.active),
                                p.active ? "Code disabled" : "Code enabled",
                              )
                            }
                          >
                            <Ic name={p.active ? "ban" : "check"} />
                            {p.active ? "Disable" : "Enable"}
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* PAYOUTS */}
          <div className={ui.secL}>
            Payouts
            <Link href={PAYOUTS_ROUTE} className={styles.secLink}>
              Open queue
            </Link>
          </div>
          <div className={styles.terms}>
            {inf.pendingRequests > 0 ? (
              <div>
                <b>{plural(inf.pendingRequests, "request")}</b> waiting for approval.
              </div>
            ) : null}
            <div>
              Last payout:{" "}
              {inf.lastPayoutAt ? (
                <b>
                  {money((inf.lastPayoutCents ?? 0) / 100)} · {relative(inf.lastPayoutAt)}
                </b>
              ) : (
                <b>none yet</b>
              )}
            </div>
            {inf.pendingRequests === 0 && inf.balances.clearedCents > 0 ? (
              <Meta>
                {money(inf.balances.clearedCents / 100)} cleared and available — the partner requests a payout from
                their own dashboard.
              </Meta>
            ) : null}
          </div>
        </div>
      )}
    </Sheet>
  );
}

/* ============================================================
   CODE — add a code, or edit an existing code's terms
   ============================================================ */

function CodeSheet({ handleRef }: { handleRef: React.RefObject<CodeHandle | null> }) {
  const router = useRouter();
  const [target, setTarget] = useState<CodeTarget | null>(null);
  const [codeValue, setCodeValue] = useState("");
  const [model, setModel] = useState<EarningModel>(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthsError, setMonthsError] = useState<string | null>(null);
  /** Replace discount asks before it writes: what changes, and for whom. */
  const [confirming, setConfirming] = useState(false);
  const monthsRef = useRef<HTMLInputElement>(null);

  const { ref: mdlRef, open: openMdlDialog, close } = useMdl();
  const open = useCallback(
    (t: CodeTarget) => {
      setTarget(t);
      setModel(t.mode === "edit" ? promoToModel(t.promo) : t.mode === "replace" ? t.model : DEFAULT_MODEL);
      setCodeValue("");
      setError(null);
      setMonthsError(null);
      setConfirming(false);
      setBusy(false);
      openMdlDialog();
    },
    [openMdlDialog],
  );
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  /** The discount fields are sound — else the months field says why and takes the focus. */
  function discountReady(): boolean {
    if (discountMonthsProblem(model.customerDiscountMonths)) {
      monthsRef.current?.focus();
      return false;
    }
    return true;
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !target) return;
    if (target.mode !== "edit" && !discountReady()) return;
    if (target.mode === "replace" && !confirming) {
      if (!(model.customerPercentOff > 0)) {
        setError("A discount is a percent above 0.");
        return;
      }
      setError(null);
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMonthsError(null);
    try {
      if (target.mode === "add") {
        if (!codeValue.trim()) throw new Error("A promo code is required.");
        const res = await createPromoCode({ influencerId: target.influencerId, code: codeValue.trim(), ...modelToInput(model) });
        if (!res.ok) {
          if (res.field === "customerDiscountMonths") setMonthsError(underField(res));
          else setError(res.error);
          return;
        }
        toast.success("Code added", `${codeValue.trim().toUpperCase()} is live for ${target.name}.`);
      } else if (target.mode === "replace") {
        const res = await replacePromoDiscount({
          promoId: target.promo.id,
          customerPercentOff: model.customerPercentOff,
          customerDiscountMonths: Number(model.customerDiscountMonths),
        });
        if (!res.ok) {
          setConfirming(false);
          if (res.field === "customerDiscountMonths") setMonthsError(underField(res));
          else setError(res.error);
          return;
        }
        toast.success(
          "Discount replaced",
          `New subscribers on ${res.code} get ${discountPhrase(model.customerPercentOff, Number(model.customerDiscountMonths))}.`,
        );
      } else {
        const res = await updatePromoCommission({ promoId: target.promo.id, ...modelToInput(model) });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast.success("Commission updated");
      }
      close();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  const title = !target
    ? "Promo code"
    : target.mode === "add"
      ? `New code · ${target.name}`
      : target.mode === "replace"
        ? `${baseCode(target.promo.code)} · replace discount`
        : `${baseCode(target.promo.code)} · commission`;

  const primary =
    target?.mode === "add"
      ? busy
        ? "Saving…"
        : "Add code"
      : target?.mode === "replace"
        ? busy
          ? "Replacing…"
          : confirming
            ? "Yes, replace"
            : "Replace discount…"
        : busy
          ? "Saving…"
          : "Save commission";

  return (
    <Sheet
      mdlRef={mdlRef}
      title={title}
      titleId="infCodeTitle"
      size="lg"
      onClose={close}
      error={error}
      foot={
        <>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={confirming ? () => setConfirming(false) : close}
            disabled={busy}
          >
            {confirming ? "Back" : "Cancel"}
          </button>
          <button
            className={cx("btn btn-primary", busy && ui.btnBusy)}
            type="button"
            onClick={() => submit()}
            disabled={busy || !target}
            data-primary
          >
            <Ic name={target?.mode === "replace" ? "undo" : "check"} />
            {primary}
          </button>
        </>
      }
    >
      {!target ? null : target.mode === "replace" && confirming ? (
        <ReplaceConfirm promo={target.promo} name={target.name} model={model} />
      ) : (
        <form onSubmit={submit} noValidate>
          {target.mode === "add" ? (
            <div className="mf">
              <label className="mf-lbl" htmlFor="infNewCode">
                Promo code
              </label>
              <input
                className={cx("mf-in", styles.codeIn)}
                id="infNewCode"
                value={codeValue}
                onChange={(e) => setCodeValue(e.target.value.toUpperCase())}
                placeholder="JAMIE-SPRING"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          ) : null}
          {target.mode === "replace" ? (
            <div className={cx(ui.hint, styles.hintTop)}>
              Now: {describeDiscount(target.promo)} The new discount goes on a new Stripe coupon under the same code,
              for people who subscribe from now on.
            </div>
          ) : null}
          <ModelFields
            model={model}
            onChange={(m) => {
              setModel(m);
              setMonthsError(null);
            }}
            part={target.mode === "add" ? "all" : target.mode === "replace" ? "discount" : "commission"}
            fixed={target.mode === "edit" ? target.promo : undefined}
            idp={target.mode === "add" ? "infA" : target.mode === "replace" ? "infR" : "infE"}
            monthsError={monthsError}
            monthsRef={monthsRef}
          />
        </form>
      )}
    </Sheet>
  );
}

/** What Replace discount will do, said before it does it. */
function ReplaceConfirm({ promo, name, model }: { promo: PromoDTO; name: string; model: EarningModel }) {
  const code = baseCode(promo.code);
  const months = Number(model.customerDiscountMonths);
  const was = (promo.customerPercentOff ?? 0) > 0 ? shortDiscount(promo) : "no discount";
  return (
    <div className={styles.confirm} data-replace-confirm>
      <div className={styles.confirmTitle}>Replace the discount on {code}?</div>
      <ul className={styles.confirmList}>
        <li>
          <b>New subscribers</b> who use {code} from now on get{" "}
          <b>{discountPhrase(model.customerPercentOff, months)}</b>.
          {months > YEAR_DISCOUNT_MONTHS_CAP
            ? ` On a yearly plan that counts as ${YEAR_DISCOUNT_MONTHS_CAP} months.`
            : ""}
        </li>
        <li>
          {promo.conversions > 0 ? (
            <>
              <b>The {plural(promo.conversions, "subscriber")}</b> who already joined {promo.conversions === 1 ? "keeps" : "keep"} what they signed up with (
              {was}). Stripe leaves their discount exactly as it is.
            </>
          ) : (
            <>Nobody has subscribed with {code} yet, so no one is on the old terms ({was}).</>
          )}
        </li>
        <li>
          <b>Commission</b> stays as it is and keeps going to {name}: partner {describeEarning(promoToModel(promo))}.
        </li>
        <li>The old terms stay on the record, switched off, so every subscriber still finds their partner.</li>
      </ul>
    </div>
  );
}
