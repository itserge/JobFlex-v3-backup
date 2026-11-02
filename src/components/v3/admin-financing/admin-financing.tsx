"use client";

// Admin · Financing (Wisetack, owner 2026-10-28). JobFlex's switch — off for everyone until launch, a pilot list of
// companies, then everyone — and the board: who applied and where Wisetack's decision stands, the clients' loans,
// what Wisetack paid out (measured) and JobFlex's share at the agreement's rate.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setFinancingSwitch } from "@/actions/adminFinancing";
import type { FinancingBoard } from "@/lib/financing/admin";
import type { FinancingSwitch } from "@/lib/financing/state";
import { Chip, Empty, KpiStrip, type Tone, actionError, cx, useReveal } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import styles from "./admin-financing.module.css";

const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");
const MODES: Array<{ mode: FinancingSwitch["mode"]; label: string; sub: string }> = [
  { mode: "off", label: "Off", sub: "Nobody sees financing." },
  { mode: "pilot", label: "Pilot", sub: "Only the companies listed below." },
  { mode: "all", label: "Everyone", sub: "Every company sees Settings → Integrations / Payments → Financing." },
];
const MERCHANT_TONE: Record<string, Tone> = { approved: "ok", started: "wait", review: "wait", needs_info: "wait", declined: "bad", paused: "bad", none: "mute" };
const MERCHANT_WORD: Record<string, string> = { approved: "Approved", started: "Started", review: "In review", needs_info: "Needs info", declined: "Declined", paused: "Paused", none: "—" };

export function AdminFinancingContent({ board }: { board: FinancingBoard }) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const [mode, setMode] = useState<FinancingSwitch["mode"]>(board.sw.mode);
  const [text, setText] = useState(board.pilot.map((p) => p.email ?? "").filter(Boolean).join("\n"));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const s = board.summary;

  async function save() {
    setBusy(true);
    setSaid("");
    try {
      const r = await setFinancingSwitch(mode, text);
      setSaid(r.missing.length ? `Saved. No company owner found for: ${r.missing.join(", ")}` : "Saved.");
      router.refresh();
    } catch (err) {
      setSaid(actionError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={rootRef} className={styles.root} data-admin-financing>
      <div className="page-head rv">
        <div>
          <div className="kicker">Manage · Financing</div>
          <h1 className="page-title">Financing · Wisetack</h1>
        </div>
      </div>

      {!board.connected ? (
        <section className={cx("card rv", styles.warn)} data-fin-not-connected>
          <div className="card-title">Wisetack is not connected on this deployment</div>
          <p className={styles.p}>Financing stays hidden everywhere until WISETACK_API_BASE, WISETACK_API_KEY and WISETACK_WEBHOOK_SECRET are set — they come with the partner agreement.</p>
        </section>
      ) : null}

      <section className="card rv">
        <div className="card-title">Who sees financing</div>
        <div className={styles.modes} role="radiogroup" aria-label="Who sees financing">
          {MODES.map((m) => (
            <button key={m.mode} type="button" role="radio" aria-checked={mode === m.mode} className={cx("btn", mode === m.mode ? "btn-primary" : "btn-ghost")} onClick={() => setMode(m.mode)} data-fin-mode={m.mode}>
              {m.label}
            </button>
          ))}
        </div>
        <p className={styles.p}>{MODES.find((m) => m.mode === mode)?.sub}</p>
        {mode === "pilot" ? (
          <label className={styles.field}>
            <span className={styles.lbl}>Pilot companies — their owners&rsquo; emails, one per line</span>
            <textarea className={styles.in} rows={4} value={text} onChange={(e) => setText(e.target.value)} data-fin-pilot />
          </label>
        ) : null}
        <div className={styles.acts}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()} data-fin-save>
            {busy ? "Saving…" : "Save"}
          </button>
          {said ? <span className={styles.p} role="status">{said}</span> : null}
        </div>
      </section>

      <KpiStrip
        cols={5}
        cells={[
          { label: "Approved companies", value: String(s.byState.approved) },
          { label: "Waiting on Wisetack", value: String(s.byState.started + s.byState.review + s.byState.needs_info) },
          { label: "Loans open", value: String(s.loansByState.sent + s.loansByState.started + s.loansByState.needs_action + s.loansByState.approved + s.loansByState.accepted + s.loansByState.done_asked) },
          { label: "Paid out by Wisetack", value: usd(s.paidCents), accent: true },
          { label: "JobFlex share", value: s.shareCents === null ? "Rate not set" : usd(s.shareCents) },
        ]}
      />
      {!board.shareSet ? <p className={cx("rv", styles.p)}>The share appears once WISETACK_PARTNER_SHARE_BPS is set from the Wisetack agreement. Paid out counts real payouts only ({board.paidCount}).</p> : null}

      <section className="card rv">
        <div className="card-title">Companies</div>
        {board.contractors.length === 0 ? (
          <Empty>No company has applied yet.</Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Companies">
            <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
              <span>Company</span>
              <span>Wisetack</span>
              <span>Applied</span>
              <span>Decided</span>
            </div>
            {board.contractors.map((c) => (
              <div key={c.orgId} className={cx(ui.tr, styles.cols)} role="row" data-fin-company={c.state}>
                <span className={ui.tdName}>{c.name}</span>
                <span>
                  <Chip tone={MERCHANT_TONE[c.state] ?? "mute"}>{MERCHANT_WORD[c.state] ?? c.state}</Chip>
                </span>
                <span>{day(c.appliedAt)}</span>
                <span>{day(c.decidedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card rv">
        <div className="card-title">Clients&rsquo; loans</div>
        {board.loans.length === 0 ? (
          <Empty>No client has applied yet.</Empty>
        ) : (
          <div className={ui.tbl} role="table" aria-label="Loans">
            <div className={cx(ui.tr, ui.th, styles.cols)} role="row">
              <span>Proposal</span>
              <span>Company</span>
              <span>Amount</span>
              <span>Where it stands</span>
            </div>
            {board.loans.map((l) => (
              <div key={l.proposalId} className={cx(ui.tr, styles.cols)} role="row" data-fin-loan={l.state}>
                <span className={ui.tdWide}>
                  <span className={ui.tdName}>{l.title}</span>
                  <span className={ui.tdSub}>{l.client}</span>
                </span>
                <span>{l.company}</span>
                <span>{l.amount}</span>
                <span>{l.line}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
