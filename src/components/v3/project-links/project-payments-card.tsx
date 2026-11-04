"use client";

// PROJECT PAYMENTS (owner, 2026-11-04: "in the projects get the payments as well, where you can send to the client,
// like for deposits or for that job done, request a payment"). One card for the desktop and the handheld project
// page: each sold proposal's schedule, what is paid, what is owed, and the next thing to collect.
//
// Every write is one the Proposals page already makes — sendInstallmentInvoice, notifyPaymentReminder,
// markInstallmentPaid / recordRemainingPayment — plus addPaymentRequest, which puts a new stage (a deposit, a progress
// payment, the final) next in line and is invoiced at once. A synthetic stage (the implicit "Full payment", the
// "Balance" row) has no row of its own, so it is invoiced, reminded and marked paid as the remaining balance.
// Owners and managers only, as those actions are; everyone else reads the card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPaymentRequest } from "@/actions/proposals";
import { notifyPaymentReminder, sendInstallmentInvoice } from "@/actions/notify";
import { markInstallmentPaid, recordRemainingPayment } from "@/actions/installments";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdPayments, PdPayStage } from "@/components/v3/project-detail-blueprint/project-detail-data";
import s from "./project-hub.module.css";

const exact = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const money = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** What a stage's line says about it. */
function stageState(st: PdPayStage): { text: string; cls: string } {
  if (st.status === "PAID") return { text: st.paidAt ? `Paid ${day(st.paidAt)}` : "Paid", cls: s.paid };
  if (st.status === "WAIVED") return { text: "Closed out", cls: "" };
  if (st.status === "PENDING") return { text: "Client is paying now", cls: s.sent };
  if (st.invoiceSentAt)
    return { text: `Invoice sent ${day(st.invoiceSentAt)}${st.remindedAt ? ` · reminded ${day(st.remindedAt)}` : ""}`, cls: s.sent };
  if (st.payable) return { text: "Next to collect", cls: s.next };
  return { text: "Later", cls: "" };
}

const KINDS: Array<[string, string]> = [
  ["Deposit", "Deposit"],
  ["Progress payment", "Progress"],
  ["Final payment", "Final"],
];
const METHODS: Array<[string, string]> = [
  ["BANK_TRANSFER", "Bank transfer"],
  ["CHECK", "Check"],
  ["CASH", "Cash"],
  ["OTHER", "Other"],
];

type Paying = { proposalId: string; title: string; stage: PdPayStage };

export function ProjectPaymentsCard({ payments, canManage }: { payments: PdPayments; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Request a payment
  const [asking, setAsking] = useState(false);
  const [askFor, setAskFor] = useState(payments.find((p) => p.remaining > 0)?.proposalId ?? "");
  const [kind, setKind] = useState("Deposit");
  const [custom, setCustom] = useState("");
  const [unit, setUnit] = useState<"pct" | "usd">("pct");
  const [amount, setAmount] = useState("30");
  const [sendNow, setSendNow] = useState(true);
  const [askErr, setAskErr] = useState<string | null>(null);

  // Mark paid
  const [paying, setPaying] = useState<Paying | null>(null);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [paidAmt, setPaidAmt] = useState("");
  const [paidOn, setPaidOn] = useState(todayISO());
  const [payErr, setPayErr] = useState<string | null>(null);

  const billed = payments.reduce((n, p) => n + p.billed, 0);
  const paid = payments.reduce((n, p) => n + p.paid, 0);
  const owed = payments.reduce((n, p) => n + p.remaining, 0);
  const owing = payments.filter((p) => p.remaining > 0);

  const refresh = () => startTransition(() => router.refresh());

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      const msg = await fn();
      if (msg) setNote(msg);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through — try again.");
    } finally {
      setBusy(null);
    }
  }

  const invoice = (proposalId: string, st: PdPayStage) =>
    run(`inv:${st.id}`, async () => {
      const r = await sendInstallmentInvoice(proposalId, st.synthetic ? null : st.id, "any");
      if (!r.ok) throw new Error(r.error ?? "The invoice was not sent");
      const where = [r.email === "sent" ? "email" : null, r.sms === "sent" ? "text" : null].filter(Boolean).join(" and ");
      return `Invoice${r.number ? ` ${r.number}` : ""} for ${exact(r.amount)} sent${where ? ` by ${where}` : ""}.`;
    });

  const remind = (proposalId: string, st: PdPayStage) =>
    run(`rem:${st.id}`, async () => {
      const r = await notifyPaymentReminder({ proposalId, installmentId: st.synthetic ? "" : st.id });
      if (r.skipped) {
        throw new Error(
          r.reason === "no-client-email" ? "The client has no email on file." : r.reason === "nothing-owed" ? "Nothing is owed on it." : "Not allowed.",
        );
      }
      return r.delivery === "sent" ? "Reminder sent." : "Reminders are off for this company (Settings → Payments).";
    });

  function openPaid(p: PdPayments[number], st: PdPayStage) {
    setPaying({ proposalId: p.proposalId, title: p.title, stage: st });
    setMethod("BANK_TRANSFER");
    setPaidAmt(String(st.amount));
    setPaidOn(todayISO());
    setPayErr(null);
  }

  async function savePaid() {
    if (!paying) return;
    const amt = money(paidAmt);
    if (amt <= 0) {
      setPayErr("Enter the amount received");
      return;
    }
    setBusy("paid");
    setPayErr(null);
    try {
      const at = new Date(`${paidOn}T12:00:00`).toISOString();
      if (paying.stage.synthetic) {
        await recordRemainingPayment({ proposalId: paying.proposalId, method, amount: amt, paidAt: at });
      } else {
        await markInstallmentPaid({ installmentId: paying.stage.id, method, amount: amt, paidAt: at });
      }
      setPaying(null);
      setNote(`${exact(amt)} recorded on ${paying.title}.`);
      refresh();
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Could not record the payment");
    } finally {
      setBusy(null);
    }
  }

  function openAsk() {
    setAsking(true);
    setAskFor(owing[0]?.proposalId ?? "");
    setKind("Deposit");
    setCustom("");
    setUnit("pct");
    setAmount("30");
    setSendNow(true);
    setAskErr(null);
  }

  async function saveAsk() {
    const label = (kind === "custom" ? custom : kind).trim();
    const amt = money(amount);
    if (!askFor) return setAskErr("Pick the proposal to bill");
    if (!label) return setAskErr("Name the payment");
    if (amt <= 0) return setAskErr("Enter how much to ask for");
    setBusy("ask");
    setAskErr(null);
    try {
      const { installmentId } = await addPaymentRequest({ proposalId: askFor, label, amount: amt, isPercent: unit === "pct" });
      let msg = `${label} added to ${payments.find((p) => p.proposalId === askFor)?.title ?? "the proposal"}.`;
      if (sendNow) {
        const r = await sendInstallmentInvoice(askFor, installmentId, "any");
        msg = r.ok ? `${label} — invoice for ${exact(r.amount)} sent to the client.` : `${label} added, but the invoice was not sent: ${r.error}`;
      }
      setAsking(false);
      setNote(msg);
      refresh();
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : "Could not add the payment");
    } finally {
      setBusy(null);
    }
  }

  const askTarget = payments.find((p) => p.proposalId === askFor);
  const pctBase = askTarget ? askTarget.base : 0;
  const preview = unit === "pct" ? (pctBase * money(amount)) / 100 : money(amount);

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Payments" data-project-payments>
        <div className={s.head}>
          <h2 className={s.title}>Payments</h2>
          {payments.length ? (
            <span className={s.headSub}>
              Collected <b>{exact(paid)}</b> of {exact(billed)} · <b>{exact(owed)}</b> owed
            </span>
          ) : null}
          {canManage && owing.length ? (
            <div className={s.acts}>
              <button type="button" className={s.btnPrimary} onClick={openAsk} data-pay-request>
                + Request a payment
              </button>
            </div>
          ) : null}
        </div>

        {payments.length ? (
          <div className={s.bar} aria-hidden="true">
            <i style={{ width: `${billed > 0 ? Math.min(100, (paid / billed) * 100) : 0}%` }} />
          </div>
        ) : (
          <div className={s.empty}>
            Payments start when a proposal is accepted. Then you ask for a deposit, progress payments and the final from here,
            and the client pays from the link in the invoice.
          </div>
        )}

        {note ? <div className={s.note} role="status">{note}</div> : null}
        {error ? <div className={s.err} role="alert">{error}</div> : null}

        {payments.map((p) => (
          <div className={s.prop} key={p.proposalId}>
            <div className={s.propHead}>
              <span className={s.propName}>{p.title}</span>
              <span className={s.propMeta}>
                {exact(p.paid)} paid of {exact(p.billed)}
                {p.remaining > 0 ? ` · ${exact(p.remaining)} owed` : " · paid in full"}
              </span>
            </div>
            {p.stages.map((st) => {
              const state = stageState(st);
              const open = st.status === "UNPAID" && st.payable && st.amount > 0;
              return (
                <div className={`${s.stage} ${st.status === "PAID" ? s.isPaid : ""}`} key={st.id} data-pay-stage={st.label}>
                  <span className={s.stageName}>{st.label}</span>
                  <span className={s.stageAmt}>{exact(st.amount)}</span>
                  <span className={`${s.stageState} ${state.cls}`}>{state.text}</span>
                  <span className={s.stageActs}>
                    {canManage && open ? (
                      <>
                        {st.invoiceSentAt ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => remind(p.proposalId, st)}>
                            {busy === `rem:${st.id}` ? "Sending…" : "Remind"}
                          </button>
                        ) : (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => invoice(p.proposalId, st)}>
                            {busy === `inv:${st.id}` ? "Sending…" : "Send invoice"}
                          </button>
                        )}
                        <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => openPaid(p, st)}>
                          Mark paid
                        </button>
                      </>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </section>

      <BlueprintSheet
        open={asking}
        onClose={() => busy !== "ask" && setAsking(false)}
        title="Request a payment"
        description="It goes next in line on the proposal's schedule; the last stage shrinks by the same amount."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setAsking(false)} disabled={busy === "ask"}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={saveAsk} disabled={busy === "ask"} data-pay-request-save>
              {busy === "ask" ? "Saving…" : sendNow ? "Add & send invoice" : "Add payment"}
            </button>
          </>
        }
      >
        <div className="bps-form">
          {owing.length > 1 ? (
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Bill which proposal</span>
              <select className="bps-in" value={askFor} onChange={(e) => setAskFor(e.target.value)}>
                {owing.map((p) => (
                  <option key={p.proposalId} value={p.proposalId}>
                    {p.title} — {exact(p.remaining)} owed
                  </option>
                ))}
              </select>
            </label>
          ) : askTarget ? (
            <p className="bps-note">
              {askTarget.title} — {exact(askTarget.remaining)} still owed.
            </p>
          ) : null}
          <div className="bps-fld bps-fld--wide">
            <span className="bps-lbl">What for</span>
            <div className="bps-chips">
              {KINDS.map(([v, l]) => (
                <button key={v} type="button" className={`bps-chip${kind === v ? " is-on" : ""}`} onClick={() => setKind(v)}>
                  {l}
                </button>
              ))}
              <button type="button" className={`bps-chip${kind === "custom" ? " is-on" : ""}`} onClick={() => setKind("custom")}>
                Other…
              </button>
            </div>
          </div>
          {kind === "custom" ? (
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Name it</span>
              <input className="bps-in" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Cabinets delivered" maxLength={60} />
            </label>
          ) : null}
          <label className="bps-fld">
            <span className="bps-lbl">How much</span>
            <input className="bps-in" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <div className="bps-fld">
            <span className="bps-lbl">As</span>
            <div className="bps-seg">
              <button type="button" className={unit === "pct" ? "is-on" : ""} onClick={() => setUnit("pct")}>
                % of proposal
              </button>
              <button type="button" className={unit === "usd" ? "is-on" : ""} onClick={() => setUnit("usd")}>
                Dollars
              </button>
            </div>
          </div>
          {askTarget && preview > 0 ? <p className="bps-hint bps-fld--wide">That is {exact(Math.round(preview * 100) / 100)}.</p> : null}
          <label className={`bps-fld bps-fld--wide ${s.check}`}>
            <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
            <span className="bps-note">Send the invoice to the client now (email and text, they pay from the link)</span>
          </label>
          {askErr ? <div className="bps-err bps-fld--wide">{askErr}</div> : null}
        </div>
      </BlueprintSheet>

      <BlueprintSheet
        open={paying !== null}
        onClose={() => busy !== "paid" && setPaying(null)}
        title="Mark paid"
        description={paying ? `${paying.title} · ${paying.stage.label}` : undefined}
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setPaying(null)} disabled={busy === "paid"}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" onClick={savePaid} disabled={busy === "paid"} data-pay-mark-save>
              {busy === "paid" ? "Saving…" : "Record payment"}
            </button>
          </>
        }
      >
        <div className="bps-form">
          <div className="bps-fld bps-fld--wide">
            <span className="bps-lbl">How it was paid</span>
            <div className="bps-chips">
              {METHODS.map(([v, l]) => (
                <button key={v} type="button" className={`bps-chip${method === v ? " is-on" : ""}`} onClick={() => setMethod(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="bps-fld">
            <span className="bps-lbl">Amount received</span>
            <input className="bps-in" inputMode="decimal" value={paidAmt} onChange={(e) => setPaidAmt(e.target.value)} />
          </label>
          <label className="bps-fld">
            <span className="bps-lbl">Paid on</span>
            <input className="bps-in" type="date" value={paidOn} max={todayISO()} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <p className="bps-hint bps-fld--wide">For money that came in outside JobFlex. Card and bank payments through the client&apos;s link record themselves.</p>
          {payErr ? <div className="bps-err bps-fld--wide">{payErr}</div> : null}
        </div>
      </BlueprintSheet>
    </div>
  );
}
