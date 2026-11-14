"use client";
// THE SIGNUP LEDGER (2026-10-01): every account made in the span, who made
// it, where the landing says they came from, and what the subscription is
// now. The live list holds half an hour and the day line holds a day; an
// account older than that had nowhere left to be seen, which is how a signup
// the owner watched arrive became one he could not find again. Nothing new is
// stored for it — these are Organization rows with the landing's tags on them
// and the Subscription beside them, read over a span he picks.
import { useCallback, useEffect, useRef, useState } from "react";
import { EyeOff, Info, Megaphone, RefreshCw } from "lucide-react";
import { getSignupLedger, setSignupHidden } from "@/actions/trafficDashboard";
import type { SignupLedger, SignupRecord, SignupState } from "@/lib/traffic-live";
import { signupToolsLine } from "@/lib/toolPlans/numbers";
import { TIER_CHANCE, TIER_LABEL, TRIAL_TIERS, dollars, trialChance, type TrialProjection } from "@/lib/trialProjection";
import { EmailContractorButton } from "@/components/v3/admin-mail/contractor-mail";
import s from "./traffic.module.css";

const SPANS: Array<[number, string]> = [[1, "Today"], [7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "A year"]];
const STATE_LABEL: Record<SignupState, string> = {
  trial: "on trial", paying: "paying", lapsed: "lapsed", free: "free plan", unknown: "no plan row",
};

export function SignupLedgerPanel({ initial, timezone, fullHistory = false, title = "Signups", intro }: { initial: SignupLedger; timezone: string; fullHistory?: boolean; title?: string; intro?: string }) {
  const [ledger, setLedger] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (days: number) => {
    setPending(true);
    try {
      setLedger(await getSignupLedger({ days, fullHistory }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the signups.");
    } finally {
      setPending(false);
    }
  }, [fullHistory]);
  // A new server read (a page refresh) replaces the list — adjusted while
  // rendering, the React way, instead of a second pass from an effect.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setLedger(initial);
  }
  // "Show full history" switched: the same span, counted again.
  const firstWindow = useRef(true);
  useEffect(() => {
    if (firstWindow.current) { firstWindow.current = false; return; }
    void load(ledger.days);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the window switch reloads here
  }, [fullHistory]);

  // Take an account out of every statistic, or put it back (lib/statsHidden, 2026-10-05).
  const hide = async (orgId: string, hidden: boolean) => {
    setPending(true);
    try {
      const res = await setSignupHidden({ orgId, hidden });
      if (!res.ok) setError(res.error);
    } catch {
      setError("The change could not be saved. Try again.");
    }
    await load(ledger.days);
  };
  const when = (iso: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
    } catch { return ""; }
  };
  const sum = ledger.summary;
  const proj = ledger.projection ?? null;
  return (
    <section className={s.ledger} aria-label="Every signup" aria-busy={pending}>
      <div className={s.ledgerHead}>
        <div>
          <h2>{title}</h2>
          <span className={s.micro}>{intro ?? "Every account made in the span, and what it is now — this list keeps them; the live view above only holds the last half hour."}</span>
        </div>
        <div className={s.ledgerTools}>
          <div className={s.dimensionTabs} style={{ margin: 0 }}>
            {SPANS.map(([d, label]) => (
              <button key={d} type="button" aria-pressed={ledger.days === d} onClick={() => void load(d)} disabled={pending}>{label}</button>
            ))}
          </div>
          <button type="button" className={s.iconButton} aria-label="Refresh the signups" onClick={() => void load(ledger.days)} disabled={pending}>
            <RefreshCw size={16} className={pending ? s.spin : ""}/>
          </button>
        </div>
      </div>

      <div className={s.ledgerSummary}>
        <div><span>Signups</span><strong>{sum.total.toLocaleString("en-US")}</strong><small>{sum.fromAds > 0 ? `${sum.fromAds} from ads` : "none from ads"}</small></div>
        <div data-state="trial"><span>On trial</span><strong>{sum.trial}</strong><small>still deciding</small></div>
        <div data-state="paying"><span>Paying</span><strong>{sum.paying}</strong><small>{proj && proj.paying > 0 ? `${dollars(proj.payingCents)}/mo at list price` : "subscription active"}</small></div>
        <div data-state="lapsed"><span>Lapsed</span><strong>{sum.lapsed}</strong><small>canceled, expired or failed</small></div>
        <div data-state="free"><span>Free plan</span><strong>{sum.free + sum.unknown}</strong><small>{sum.unknown > 0 ? `${sum.unknown} with no plan row` : "never upgraded"}</small></div>
      </div>

      {/* THE TRIALS IN DOLLARS (owner, 2026-10-05: "show the total revenue on
          trial in big numbers"): what every trial adds up to per month, what
          they are likely to bring, and what already pays — side by side. */}
      {proj && <TrialRevenue p={proj}/>}
      {proj && proj.trials > 0 && <ProjectionHow p={proj}/>}

      {error && <div className={s.notice} role="status"><Info size={16}/><div><strong>{error}</strong></div></div>}

      {ledger.records.length === 0 ? (
        <div className={s.liveEmpty}>No accounts were made in this span.</div>
      ) : (
        <ol className={s.ledgerList}>
          {ledger.records.map((r) => <LedgerRow key={r.orgId} r={r} when={when} onHide={() => void hide(r.orgId, true)} pending={pending}/>)}
        </ol>
      )}
      {ledger.hidden && ledger.hidden.length > 0 && (
        <details className={s.ledgerHidden}>
          <summary>Hidden from statistics · {ledger.hidden.length}</summary>
          <p>These accounts are in no count, no figure and no list on the admin pages. They still sign in, and they are still in Users and in billing.</p>
          <ol>
            {ledger.hidden.map((r) => (
              <li key={r.orgId}>
                <span><b>{r.orgName}</b> · {r.ownerEmail || "no owner"} · {r.planLabel}</span>
                <button type="button" className={s.ledgerHide} onClick={() => void hide(r.orgId, false)} disabled={pending}>Count again</button>
              </li>
            ))}
          </ol>
        </details>
      )}
      {ledger.truncated && <p className={s.footnote}>Showing the newest 400 of this span. Choose a shorter one to see them all.</p>}
    </section>
  );
}

function LedgerRow({ r, when, onHide, pending }: { r: SignupRecord; when: (iso: string) => string; onHide: () => void; pending: boolean }) {
  return (
    <li className={s.ledgerRow} data-state={r.state}>
      <div className={s.ledgerMark} aria-hidden="true"/>
      <div className={s.ledgerWho}>
        <b>{r.orgName}</b>
        <span>{r.ownerName ? `${r.ownerName} · ` : ""}{r.ownerEmail || "no owner yet"}</span>
      </div>
      <div className={s.ledgerFrom}>
        <b>{r.fromAd && <em className={s.liveAd}><Megaphone size={11}/>Ad</em>}{r.source}</b>
        <span>{[r.campaign, r.content].filter(Boolean).join(" · ") || "no campaign tag"}{r.industry && r.industry !== "default" ? ` · ${r.industry} landing` : ""}</span>
      </div>
      <div className={s.ledgerPlan}>
        <b className={s.livePlan} data-state={r.state}>{r.planLabel}</b>
        <span>{STATE_LABEL[r.state]}{worth(r)}</span>
        {/* The new plans: the tools this sign-up picked (owner, 2026-11-12). */}
        {r.tools && <span data-signup-tools="">Tools picked: {signupToolsLine(r.tools)}</span>}
        {r.lapse && <span className={s.ledgerWhy}><b>Why:</b> {r.lapse.reason}{r.lapse.at ? ` · ${when(r.lapse.at)}` : ""}</span>}
      </div>
      <div className={s.ledgerWhen}>
        <b>{when(r.createdAt)}</b>
        {/* Write to them from here (2026-10-08): the console's composer, on this account. */}
        {r.ownerEmail && <EmailContractorButton spaced orgId={r.orgId} seed={{ business: r.orgName, ownerName: r.ownerName, ownerEmail: r.ownerEmail }} />}
        <button type="button" className={s.ledgerHide} onClick={onHide} disabled={pending} title="Take this account out of every statistic on the admin pages">
          <EyeOff size={12} aria-hidden="true"/>Hide from stats
        </button>
      </div>
    </li>
  );
}

/** "· $79/mo · 45% likely" for a trial, "· $79/mo" for a paying account. */
function worth(r: SignupRecord): string {
  const v = r.value;
  if (!v) return "";
  const price = v.monthlyCents === null ? "price unknown" : `${dollars(v.monthlyCents)}/mo`;
  if (r.state !== "trial" || !v.tier) return v.monthlyCents === null ? "" : ` · ${price}`;
  return ` · ${price} · ${Math.round((v.chance ?? 0) * 100)}% likely`;
}

/** How the projection is figured: each tier with its count and its share, and the shop's own record. */
function ProjectionHow({ p }: { p: TrialProjection }) {
  const c = p.calibration;
  const record = c.finished === 0
    ? "No trial has finished yet, so these are the starting chances."
    : `Your finished trials: ${Math.round((c.observedRate ?? 0) * c.finished)} of ${c.finished} paid. ${c.factor === 1 ? "That matches the starting chances." : `The middle groups are scaled ×${c.factor.toFixed(2)} to match (pulled toward a 20% start until more trials finish).`}`;
  return (
    <details className={s.ledgerHow}>
      <summary>How the {dollars(p.expectedCents)} is figured</summary>
      <p>Each trial counts at its plan&apos;s monthly price (a yearly plan as a twelfth, a custom plan by its pages, at list price) times its chance of paying, read from what the account has done:</p>
      <ul>
        {TRIAL_TIERS.filter((t) => p.byTier[t].count > 0).map((t) => (
          <li key={t}>
            <b>{TIER_LABEL[t]}</b> · {p.byTier[t].count} {p.byTier[t].count === 1 ? "trial" : "trials"} · {Math.round(trialChance(t, c.factor) * 100)}%{trialChance(t, c.factor) !== TIER_CHANCE[t] ? ` (starts at ${Math.round(TIER_CHANCE[t] * 100)}%)` : ""} · {dollars(p.byTier[t].expectedCents)}/mo
          </li>
        ))}
      </ul>
      <p>{record}{p.unpriced > 0 ? ` ${p.unpriced} ${p.unpriced === 1 ? "trial has" : "trials have"} no price on record and ${p.unpriced === 1 ? "is" : "are"} left out.` : ""}</p>
    </details>
  );
}

/** The band under the counts: trial revenue per month, in big numbers. */
function TrialRevenue({ p }: { p: TrialProjection }) {
  const trials = `${p.trials} ${p.trials === 1 ? "trial" : "trials"}`;
  return (
    <div className={s.trialRevenue} aria-label="Trial revenue per month" data-total-cents={p.maxCents} data-projected-cents={p.expectedCents}>
      <span className={s.trialRevenueLabel}>Trial revenue per month</span>
      <div className={s.trialRevenueFigures}>
        <div data-figure="total">
          <strong>{dollars(p.maxCents)}</strong>
          <small>{p.trials === 0 ? "no trials in this span" : `on trial · if all ${trials} pay`}{p.unpriced > 0 ? ` · ${p.unpriced} without a price` : ""}</small>
        </div>
        <div data-figure="likely">
          <strong>{dollars(p.expectedCents)}</strong>
          <small>likely to pay{p.maxCents > 0 ? ` · ${Math.round((p.expectedCents / p.maxCents) * 100)}% of it` : ""}</small>
        </div>
        <div data-figure="paying">
          <strong>{dollars(p.payingCents)}</strong>
          <small>paying now · {p.paying} {p.paying === 1 ? "account" : "accounts"}</small>
        </div>
      </div>
    </div>
  );
}
