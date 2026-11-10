"use client";

// ADMIN TRIAL REQUESTS — BLUEPRINT
// /admin/trial-requests (owner, 2026-10-20)
//
// Owners on a trial (or at most 14 days past it) who asked for more days from
// the cancel questions (lib/trialExtension; screen C1 of lib/cancelTree). The table lists every request, newest
// first; a row opens the drawer: the request, what the company did between
// the trial's start and its end (read on open — actions/trialExtension
// trialRequestUsage), and while it is pending the two decisions — Approve
// with 7 or 14 days, Deny with a short reason the owner reads. Both email the
// owner. The page is a server component, so `router.refresh()` is the update.
// Furniture: the partner-money kit (admin-influencers/admin-ui).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { longDate, relative, shortDate } from "@/lib/format";
import { approveTrialExtension, denyTrialExtension, trialRequestUsage } from "@/actions/trialExtension";
import { DENY_REASON_MAX, EXTENSION_DAYS, extendedTrialEnd, extensionBase, type ExtensionDays } from "@/lib/trialExtension";
import type { TrialUsage } from "@/lib/trialExtensionServer";
import { Chip, Empty, Ic, KpiStrip, Meta, Seg, Sheet, type Tone, actionError, cx, useMdl, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./trial-requests.module.css";

export interface TrialRequestDTO {
  id: string;
  organizationId: string;
  orgName: string;
  ownerEmail: string;
  ownerName: string | null;
  planName: string;
  /** The subscription's status now. */
  subStatus: string | null;
  /** The plan has a Stripe subscription — Approve moves Stripe's trial_end. */
  stripe: boolean;
  /** As they stood when it was asked. */
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  /** The mirror's trial end and period end now — what Approve adds the days
   *  to (lib/trialExtension extensionBase). */
  currentTrialEndsAt: string | null;
  currentPeriodEnd: string | null;
  requestedDays: number;
  note: string | null;
  /** Asked from the cancel questions (2026-11-09, lib/cancelTree B1): what got
   *  in the way and what they would try first; null for an older request. */
  answers: { inTheWay: string; tryFirst: string } | null;
  status: string;
  grantedDays: number | null;
  extendedUntil: string | null;
  localOnly: boolean;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

const TONE: Record<string, Tone> = { PENDING: "wait", APPROVED: "ok", DENIED: "bad" };
const LABEL: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", DENIED: "Denied" };

type Filter = "ALL" | "PENDING" | "APPROVED" | "DENIED";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "DENIED", label: "Denied" },
];

/** "Oct 13 → Oct 20", the end marked when it has passed. */
function trialSpan(r: Pick<TrialRequestDTO, "trialStartedAt" | "trialEndsAt">): string {
  const start = r.trialStartedAt ? shortDate(r.trialStartedAt) : "—";
  const end = r.trialEndsAt ? shortDate(r.trialEndsAt) : "—";
  return `${start} → ${end}`;
}
const trialEnded = (iso: string | null) => Boolean(iso && Date.parse(iso) <= Date.now());

type DetailHandle = { open: (r: TrialRequestDTO) => void };

export function AdminTrialRequestsContent({ rows, openId }: { rows: TrialRequestDTO[] | null; openId: string | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [filter, setFilter] = useState<Filter>("PENDING");
  const detailRef = useRef<DetailHandle | null>(null);
  const list = useMemo(() => rows ?? [], [rows]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { ALL: list.length, PENDING: 0, APPROVED: 0, DENIED: 0 };
    for (const r of list) if (r.status in c) c[r.status as Filter] += 1;
    return c;
  }, [list]);
  const shown = useMemo(() => (filter === "ALL" ? list : list.filter((r) => r.status === filter)), [list, filter]);
  const granted = useMemo(() => list.reduce((n, r) => n + (r.status === "APPROVED" ? (r.grantedDays ?? 0) : 0), 0), [list]);

  // ?request=<id> (the admins' email) opens that one, whatever its status.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !openId) return;
    const hit = list.find((r) => r.id === openId);
    if (!hit) return;
    opened.current = true;
    const id = requestAnimationFrame(() => detailRef.current?.open(hit));
    return () => cancelAnimationFrame(id);
  }, [openId, list]);

  return (
    <div ref={rootRef} className={styles.root}>
      <div className="page-head rv">
        <div>
          <div className="kicker">Platform · Trials</div>
          <h1 className="page-title">Trial requests</h1>
        </div>
      </div>

      {rows === null ? (
        <section className="card rv">
          <Empty>Trial requests are not set up in this database yet — apply prisma/sql/prod-2026-10-20-cancel-feedback-trial-requests.sql.</Empty>
        </section>
      ) : (
        <>
          <KpiStrip
            cells={[
              { label: "Pending", value: String(counts.PENDING), tone: counts.PENDING > 0 ? "warn" : undefined },
              { label: "Approved", value: String(counts.APPROVED), tone: "ok" },
              { label: "Denied", value: String(counts.DENIED) },
              { label: "Days granted", value: String(granted), accent: true },
            ]}
          />

          <section className="card rv">
            <div className={cx("card-head", ui.cardHead)}>
              <div className="card-titles">
                <div className="card-title">Requests</div>
                <div className="card-sub">Asked from the cancel questions on the way to cancelling. Open one to see what the trial was used for.</div>
              </div>
              <div className={ui.filters} role="group" aria-label="Filter requests">
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

            {shown.length === 0 ? (
              <Empty>{list.length === 0 ? "No trial requests yet." : `No ${filter.toLowerCase()} requests.`}</Empty>
            ) : (
              <div className={ui.tbl} role="table" aria-label="Trial requests">
                <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
                  <span>Asked</span>
                  <span>Company</span>
                  <span>Owner</span>
                  <span>Plan</span>
                  <span>Trial</span>
                  <span className={ui.thR}>Days</span>
                  <span>Note</span>
                  <span>Status</span>
                </div>
                {shown.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={cx(ui.tr, ui.trBtn, styles.cols)}
                    data-trial-request={r.id}
                    onClick={() => detailRef.current?.open(r)}
                    aria-label={`Open the request from ${r.orgName}`}
                  >
                    <span className={ui.tdNum + " " + styles.left}>
                      <span className={ui.tdLbl}>Asked</span>
                      <span title={longDate(r.createdAt)}>{shortDate(r.createdAt)}</span>
                    </span>
                    <span className={ui.tdWide}>
                      <span className={ui.tdName} title={r.orgName}>
                        {r.orgName}
                      </span>
                    </span>
                    <span className={ui.tdWide}>
                      <span className={ui.tdLbl}>Owner</span>
                      <span className={styles.mail} title={r.ownerEmail}>
                        {r.ownerEmail}
                      </span>
                    </span>
                    <span className={styles.cell}>
                      <span className={ui.tdLbl}>Plan</span>
                      {r.planName}
                    </span>
                    <span>
                      <span className={ui.tdLbl}>Trial</span>
                      <span className={styles.span}>{trialSpan(r)}</span>
                      {trialEnded(r.trialEndsAt) ? <Meta>ended</Meta> : null}
                    </span>
                    <span className={ui.tdNum}>
                      <span className={ui.tdLbl}>Days</span>
                      {r.requestedDays}
                    </span>
                    <span className={ui.tdWide}>
                      <span className={ui.tdLbl}>Note</span>
                      <span className={styles.note} title={r.note ?? r.answers?.tryFirst ?? undefined}>
                        {r.note || (r.answers ? r.answers.tryFirst || r.answers.inTheWay : "—")}
                      </span>
                    </span>
                    <span>
                      <span className={ui.tdLbl}>Status</span>
                      <Chip tone={TONE[r.status] ?? "mute"}>{LABEL[r.status] ?? r.status}</Chip>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <DetailSheet handleRef={detailRef} />
    </div>
  );
}

/* ============================================================
   THE REQUEST — the trial's use, then the decision
   ============================================================ */

function DetailSheet({ handleRef }: { handleRef: React.RefObject<DetailHandle | null> }) {
  const router = useRouter();
  const [req, setReq] = useState<TrialRequestDTO | null>(null);
  const [usage, setUsage] = useState<TrialUsage | null | "loading" | "failed">("loading");
  const [days, setDays] = useState<ExtensionDays>(7);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const { ref: mdlRef, open: openMdlDialog, close } = useMdl();
  const open = useCallback(
    (r: TrialRequestDTO) => {
      setReq(r);
      setDays(r.requestedDays === 14 ? 14 : 7);
      setReason("");
      setError(null);
      setBusy(null);
      setUsage("loading");
      openMdlDialog();
      const n = ++seq.current;
      trialRequestUsage(r.id).then(
        (u) => n === seq.current && setUsage(u ?? "failed"),
        () => n === seq.current && setUsage("failed"),
      );
    },
    [openMdlDialog],
  );
  useEffect(() => {
    handleRef.current = { open };
  }, [handleRef, open]);

  async function approve() {
    if (!req || busy) return;
    setBusy("approve");
    setError(null);
    try {
      const res = await approveTrialExtension({ id: req.id, days });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(
        `Trial extended until ${res.until ? longDate(res.until) : "the new date"}`,
        res.localOnly ? "No Stripe subscription — only the local date moved. The owner is emailed." : "Stripe's trial end moved. The owner is emailed.",
      );
      close();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(null);
    }
  }

  async function deny() {
    if (!req || busy) return;
    setBusy("deny");
    setError(null);
    try {
      const res = await denyTrialExtension({ id: req.id, reason: reason.trim() });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Request denied", "The owner is emailed with your reason.");
      close();
      router.refresh();
    } catch (err) {
      setError(actionError(err));
    } finally {
      setBusy(null);
    }
  }

  const pending = req?.status === "PENDING";
  const asDate = (iso: string | null) => (iso ? new Date(iso) : null);
  const paying = req?.subStatus === "ACTIVE";
  const newEnd = req
    ? extendedTrialEnd(extensionBase({ status: req.subStatus ?? "", trialEndsAt: asDate(req.currentTrialEndsAt), currentPeriodEnd: asDate(req.currentPeriodEnd) }), days)
    : null;

  return (
    <Sheet
      mdlRef={mdlRef}
      title={req?.orgName ?? "Trial request"}
      titleId="trialReqTitle"
      size="drawer"
      onClose={close}
      error={error}
      foot={
        <button className="btn btn-ghost" type="button" onClick={close} disabled={busy !== null}>
          Done
        </button>
      }
    >
      {!req ? null : (
        <div data-trial-request-sheet={req.id}>
          <div className={styles.who}>
            <Chip tone={TONE[req.status] ?? "mute"}>{LABEL[req.status] ?? req.status}</Chip>
            <Meta>
              {req.ownerEmail} · {req.planName} · asked {relative(req.createdAt)}
            </Meta>
          </div>

          <div className={cx(ui.facts, ui.facts4)}>
            <div className={ui.fact}>
              <div className={ui.factL}>Asked for</div>
              <div className={cx(ui.factV, ui.factBp)}>{`${req.requestedDays} days`}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Trial started</div>
              <div className={ui.factV}>{shortDate(req.trialStartedAt)}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>{trialEnded(req.trialEndsAt) ? "Trial ended" : "Trial ends"}</div>
              <div className={ui.factV}>{shortDate(req.trialEndsAt)}</div>
            </div>
            <div className={ui.fact}>
              <div className={ui.factL}>Plan now</div>
              <div className={ui.factV}>{req.subStatus ? req.subStatus.charAt(0) + req.subStatus.slice(1).toLowerCase().replace("_", " ") : "—"}</div>
            </div>
          </div>

          <div className={ui.secL}>What they still want to try</div>
          {req.answers ? (
            <div className={styles.quote} data-trial-answers="">
              <p>{`In the way: ${req.answers.inTheWay}`}</p>
              <p>{`Would try first: ${req.answers.tryFirst || "—"}`}</p>
            </div>
          ) : null}
          {req.note || !req.answers ? <p className={styles.quote}>{req.note ? `“${req.note}”` : "No note."}</p> : null}

          <Usage usage={usage} />

          <div className={ui.secL}>Decision</div>
          {pending ? (
            <div className={styles.decide}>
              <div className={styles.block}>
                <div className={styles.blockH}>Approve</div>
                <Seg<`${ExtensionDays}`>
                  label="Days to add"
                  value={`${days}` as `${ExtensionDays}`}
                  onChange={(v) => setDays(Number(v) as ExtensionDays)}
                  options={EXTENSION_DAYS.map((d) => ({ value: `${d}` as `${ExtensionDays}`, label: `${d} days` }))}
                />
                <p className={styles.blockP}>
                  {`The trial will end on `}
                  <b>{newEnd ? longDate(newEnd) : "—"}</b>
                  {paying
                    ? `. They already pay: the days go after the period paid for (to ${longDate(req.currentPeriodEnd)}), so the next charge moves back and nothing is charged twice.`
                    : ""}
                  {req.stripe
                    ? " Stripe's trial end moves (no proration); the owner gets “Your trial is extended”."
                    : " This plan has no Stripe subscription — only the local date moves. The owner gets “Your trial is extended”."}
                </p>
                <button
                  className={cx("btn", ui.btnOk, busy === "approve" && ui.btnBusy)}
                  type="button"
                  data-trial-approve=""
                  disabled={busy !== null}
                  onClick={() => void approve()}
                >
                  <Ic name="check" />
                  {busy === "approve" ? "Approving…" : `Approve ${days} days`}
                </button>
              </div>
              <div className={styles.block}>
                <div className={styles.blockH}>Deny</div>
                <div className="mf">
                  <label className="mf-lbl" htmlFor="trialDenyReason">
                    Reason (the owner reads this)
                  </label>
                  <textarea
                    className={cx("mf-in", ui.area)}
                    id="trialDenyReason"
                    rows={3}
                    maxLength={DENY_REASON_MAX}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Your account already had an extension this month."
                  />
                </div>
                <button
                  className={cx("btn", ui.btnBad, busy === "deny" && ui.btnBusy)}
                  type="button"
                  data-trial-deny=""
                  disabled={busy !== null || reason.trim().length < 3}
                  title={reason.trim().length < 3 ? "Write a short reason first" : undefined}
                  onClick={() => void deny()}
                >
                  <Ic name="ban" />
                  {busy === "deny" ? "Denying…" : "Deny"}
                </button>
              </div>
            </div>
          ) : (
            <p className={styles.outcome}>
              {req.status === "APPROVED"
                ? `Approved ${req.grantedDays ?? "?"} days${req.extendedUntil ? ` — the trial now ends ${longDate(req.extendedUntil)}` : ""}${req.localOnly ? " (local date only — no Stripe subscription)" : ""}.`
                : `Denied${req.decisionNote ? `: “${req.decisionNote}”` : "."}`}
              {req.decidedBy || req.decidedAt ? (
                <Meta>
                  {req.decidedBy ?? "An admin"}
                  {req.decidedAt ? ` · ${longDate(req.decidedAt)}` : ""}
                </Meta>
              ) : null}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function Usage({ usage }: { usage: TrialUsage | null | "loading" | "failed" }) {
  if (usage === "loading" || usage === null) {
    return (
      <>
        <div className={ui.secL}>During the trial</div>
        <Meta>Counting what they did…</Meta>
      </>
    );
  }
  if (usage === "failed") {
    return (
      <>
        <div className={ui.secL}>During the trial</div>
        <Meta>The usage could not be read. Close and open the request again.</Meta>
      </>
    );
  }
  const facts = [
    { key: "days", label: "Active days", count: usage.activity.activeDays },
    { key: "visits", label: "Visits", count: usage.activity.visits },
    ...usage.numbers,
  ];
  return (
    <div className={styles.usage} data-trial-usage="">
      <div className={ui.secL}>
        <span>{`During the trial · ${shortDate(usage.from)} – ${shortDate(usage.to)}${usage.ongoing ? " (so far)" : ""}`}</span>
      </div>
      <div className={cx(ui.facts, styles.facts3)}>
        {facts.map((f) => (
          <div key={f.key} className={cx(ui.fact, f.count === 0 && styles.zero)} data-usage={f.key}>
            <div className={ui.factL}>{f.label}</div>
            <div className={ui.factV}>{f.count.toLocaleString("en-US")}</div>
          </div>
        ))}
      </div>
      <Meta className={styles.fine}>
        {usage.activity.available
          ? "Sign-ins are not recorded; an active day is a day with a screen opened. Visits are sittings with under 30 minutes between screens."
          : "Screen views are not in this database, so active days and visits read 0. Sign-ins are not recorded."}
      </Meta>

      <div className={ui.secL}>Estimates by tool</div>
      <div className={cx(ui.facts, styles.facts3)}>
        {usage.estimators.map((e) => (
          <div key={e.key} className={cx(ui.fact, e.count === 0 && styles.zero)} data-usage={`est-${e.key}`}>
            <div className={ui.factL}>{e.label}</div>
            <div className={ui.factV}>{e.count}</div>
          </div>
        ))}
      </div>
      {usage.proposalsBy.length ? (
        <Meta className={styles.fine}>{`Proposals by source: ${usage.proposalsBy.map((p) => `${p.label} ${p.count}`).join(" · ")}`}</Meta>
      ) : null}

      <div className={ui.secL}>What they used</div>
      {usage.used.length ? (
        <ul className={styles.used}>
          {usage.used.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
      ) : (
        <Meta>Nothing yet — no estimates, proposals or screens in the trial&rsquo;s dates.</Meta>
      )}
    </div>
  );
}
