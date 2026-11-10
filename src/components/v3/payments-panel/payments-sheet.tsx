"use client";
// THE PAYMENTS PANEL (2026-11-09, the ProSmart gaps plan, part 3). Mounted once in the shell (blueprint-shell,
// mobile-nav) and opened from anywhere with `document.dispatchEvent(new CustomEvent("jf:payments", { detail }))`,
// detail { proposalId } or { jobId } — a sold proposal's card, a job page. Office only.
//
// ProSmart's Payments drawer, adopted: the contract, paid and left, "N late"; every payment with its state and the
// things to do to it — mark paid (cash, check, bank transfer, other), invoice (card / bank / the client's choice),
// remind, a receipt to preview, send or resend, undo one entered by mistake, a due date, remove an open one — then
// add a payment, the reminders (what went out, the next one, on or off for this proposal), the "order placed" notice
// (preview, send, or by itself on the first payment), and the log. Each change re-reads the panel, and the page
// behind is told (`jf:payments-changed`) so its cards show it.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { markInstallmentPaid, recordRemainingPayment, unmarkInstallmentPaid } from "@/actions/installments";
import { getInvoiceOptions, notifyPaymentReminder, sendInstallmentInvoice, setProposalReminders } from "@/actions/notify";
import {
  addPayment,
  getPaymentsPanel,
  previewPaymentLetter,
  proposalOfJob,
  removePayment,
  sendOrderPlacedNotice,
  sendPaymentReceipt,
  setOrderNoticeOnFirstPayment,
  setPaymentDue,
} from "@/actions/paymentsPanel";
import type { PanelStage, PaymentsPanel } from "@/lib/paymentsPanel/server";
import "./payments-sheet.css";

export type PaymentsOpenDetail = { proposalId?: string; jobId?: string };

export function openPaymentsPanel(detail: PaymentsOpenDetail): void {
  document.dispatchEvent(new CustomEvent("jf:payments", { detail }));
}

type Method = "CASH" | "CHECK" | "BANK_TRANSFER" | "OTHER";
const METHODS: Array<[Method, string]> = [
  ["CASH", "Cash"],
  ["CHECK", "Check"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["OTHER", "Other"],
];
type Preview = { subject: string; html: string; to: string | null; kind: "receipt" | "order"; paymentId?: string };

let listener: symbol | null = null;

const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: Math.round(n * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (s: string) => {
  const v = Number.parseFloat(s.replace(/[$,%\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : null;
};

export function PaymentsSheet() {
  const router = useRouter();
  const [proposalId, setProposalId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PaymentsPanel | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const [rails, setRails] = useState<{ card: boolean; bank: boolean } | null>(null);
  // the open forms
  const [paying, setPaying] = useState<{ id: string; method: Method; amount: string; date: string } | null>(null);
  const [invoicing, setInvoicing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "undo" | "remove"; id: string } | null>(null);
  const [dueEdit, setDueEdit] = useState<{ id: string; day: string } | null>(null);
  const [adding, setAdding] = useState<{ label: string; amount: string; pct: boolean; due: string } | null>(null);
  const [orderNote, setOrderNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      setPanel(await getPaymentsPanel(id));
      setLoadErr(null);
    } catch (x) {
      setLoadErr(x instanceof Error && /manager/i.test(x.message) ? "Payments are the office's — the owner or a manager." : "The payments couldn't load. Try again.");
    }
  }, []);

  useEffect(() => {
    const me = Symbol("payments-sheet");
    if (listener) return;
    listener = me;
    async function onOpen(e: Event) {
      const d = ((e as CustomEvent<PaymentsOpenDetail | undefined>).detail ?? {}) as PaymentsOpenDetail;
      setPanel(null);
      setLoadErr(null);
      setNote(null);
      setChanged(false);
      setPaying(null);
      setInvoicing(null);
      setConfirm(null);
      setDueEdit(null);
      setAdding(null);
      setOrderNote("");
      setPreview(null);
      setOpen(true);
      let id = d.proposalId ?? null;
      if (!id && d.jobId) id = await proposalOfJob(d.jobId).catch(() => null);
      if (!id) {
        setLoadErr("This job has no proposal, so there are no payments to show.");
        return;
      }
      setProposalId(id);
      void load(id);
      getInvoiceOptions()
        .then((o) => setRails({ card: o.card, bank: o.bank }))
        .catch(() => setRails({ card: false, bank: false }));
    }
    document.addEventListener("jf:payments", onOpen);
    return () => {
      document.removeEventListener("jf:payments", onOpen);
      if (listener === me) listener = null;
    };
  }, [load]);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    if (changed) {
      document.dispatchEvent(new CustomEvent("jf:payments-changed", { detail: { proposalId } }));
      router.refresh();
    }
  }, [busy, changed, proposalId, router]);

  /** Run one write, say how it went, and re-read the panel. */
  async function act(key: string, fn: () => Promise<string | { bad: string } | void>) {
    if (!proposalId) return;
    setBusy(key);
    setNote(null);
    try {
      const r = await fn();
      setChanged(true);
      // The figures first, then the words — so "recorded" never sits beside the old numbers.
      await load(proposalId);
      if (r && typeof r === "object") setNote({ tone: "bad", text: r.bad });
      else if (typeof r === "string") setNote({ tone: "ok", text: r });
    } catch (x) {
      setNote({ tone: "bad", text: x instanceof Error ? x.message : "That didn't go through." });
    } finally {
      setBusy(null);
    }
  }

  const p = panel;
  const title = p ? `Payments — ${p.title}` : "Payments";
  const sub = p ? [p.client.name, p.client.email ?? "no email on file"].filter(Boolean).join(" · ") : undefined;

  function stageRow(s: PanelStage) {
    const state = s.status === "PAID" ? "paid" : s.status === "WAIVED" ? "closed" : s.late ? "late" : s.next ? "next" : "later";
    const facts: string[] = [];
    if (s.paid) {
      facts.push(`Paid ${s.paid.on} · ${s.paid.how}`);
      facts.push(s.paid.receiptSent ? `receipt sent ${s.paid.receiptSent}` : "no receipt sent yet");
    } else if (s.status === "WAIVED") facts.push("Closed when the proposal was paid in full");
    else {
      facts.push(s.dueWords ? `Due ${s.dueWords}` : "No due date");
      if (s.lateWords) facts.push(s.lateWords);
      if (s.status === "PENDING") facts.push("the client has it open to pay");
      if (s.invoiced) facts.push(`invoiced ${s.invoiced}`);
      if (s.reminders) facts.push(`${s.reminders} reminder${s.reminders === 1 ? "" : "s"}`);
    }
    const open = s.status === "UNPAID" || s.status === "PENDING";
    const stageId = s.synthetic ? null : s.id;
    return (
      <li key={s.id} className={`pps-st pps-st--${state}`} data-pay-stage={s.id} data-state={state}>
        <div className="pps-st-top">
          <span className="pps-st-mark" aria-hidden="true" />
          <span className="pps-st-name">
            {s.label}
            {s.pct ? <em>{s.pct}%</em> : null}
            {s.changeOrder ? <i className="pps-tag">change order</i> : null}
          </span>
          <span className="pps-st-amt">{money(s.paid?.amount ?? s.amount)}</span>
        </div>
        <div className="pps-st-facts">{facts.join(" · ")}</div>
        <div className="pps-st-acts">
          {open && p ? (
            <>
              <button type="button" className="bps-btn bps-btn--sm bps-btn--primary" disabled={!!busy} onClick={() => setPaying({ id: s.id, method: "CHECK", amount: String(s.amount), date: p.today })} data-pay-mark>
                Mark paid
              </button>
              <button type="button" className="bps-btn bps-btn--sm" disabled={!!busy} onClick={() => setInvoicing(invoicing === s.id ? null : s.id)} data-pay-invoice>
                Invoice
              </button>
              <button
                type="button"
                className="bps-btn bps-btn--sm"
                disabled={!!busy}
                onClick={() =>
                  void act(`remind-${s.id}`, async () => {
                    const r = await notifyPaymentReminder({ proposalId: p.proposalId, installmentId: stageId ?? "" });
                    if (r.skipped) return { bad: r.reason === "no-client-email" ? "The client has no email on file." : r.reason === "nothing-owed" ? "Nothing is owed." : "Not found." };
                    return `Reminder ${r.email === "sent" ? "emailed" : "not emailed"}${r.sms === "sent" ? " and texted" : ""} to the client.`;
                  })
                }
                data-pay-remind
              >
                Remind
              </button>
              {s.rights.editDue ? (
                <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" disabled={!!busy} onClick={() => setDueEdit({ id: s.id, day: s.due ?? p.today })} data-pay-due>
                  Due date
                </button>
              ) : null}
              {s.rights.remove ? (
                <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost pps-del" disabled={!!busy} onClick={() => setConfirm({ kind: "remove", id: s.id })} data-pay-remove>
                  Remove
                </button>
              ) : null}
            </>
          ) : null}
          {s.paid ? (
            <>
              <button
                type="button"
                className="bps-btn bps-btn--sm"
                disabled={!!busy}
                onClick={() =>
                  void (async () => {
                    setBusy(`prev-${s.id}`);
                    try {
                      const r = await previewPaymentLetter({ kind: "receipt", paymentId: s.paid!.paymentId });
                      setPreview({ ...r, kind: "receipt", paymentId: s.paid!.paymentId });
                    } catch {
                      setNote({ tone: "bad", text: "The receipt couldn't be drawn." });
                    } finally {
                      setBusy(null);
                    }
                  })()
                }
                data-pay-receipt
              >
                Receipt
              </button>
              <button
                type="button"
                className="bps-btn bps-btn--sm"
                disabled={!!busy || !p?.client.email}
                title={p?.client.email ? `Email it to ${p.client.email}` : "No email on the client's record"}
                onClick={() =>
                  void act(`rec-${s.id}`, async () => {
                    const r = await sendPaymentReceipt(s.paid!.paymentId);
                    return r.sent ? `Receipt emailed to ${r.to}.` : { bad: r.why ?? "The receipt didn't go out." };
                  })
                }
                data-pay-receipt-send
              >
                {s.paid.receiptSent ? "Resend receipt" : "Send receipt"}
              </button>
              {s.rights.undo ? (
                <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost pps-del" disabled={!!busy} onClick={() => setConfirm({ kind: "undo", id: s.id })} data-pay-undo>
                  Undo
                </button>
              ) : (
                <span className="pps-hint">{s.paid.manual ? "" : "Paid online — refund it in that dashboard."}</span>
              )}
            </>
          ) : null}
        </div>

        {paying?.id === s.id ? (
          <div className="pps-form" data-pay-form>
            <div className="bps-chips">
              {METHODS.map(([k, label]) => (
                <button key={k} type="button" className={`bps-chip${paying.method === k ? " is-on" : ""}`} aria-pressed={paying.method === k} onClick={() => setPaying({ ...paying, method: k })} data-pay-method={k}>
                  {label}
                </button>
              ))}
            </div>
            <div className="pps-row">
              <label className="pps-inline">
                <span>Amount</span>
                <input className="bps-in" inputMode="decimal" value={paying.amount} onChange={(e) => setPaying({ ...paying, amount: e.target.value })} data-pay-amount />
              </label>
              <label className="pps-inline">
                <span>Paid on</span>
                <input className="bps-in" type="date" max={p?.today} value={paying.date} onChange={(e) => setPaying({ ...paying, date: e.target.value })} data-pay-date />
              </label>
            </div>
            <div className="pps-row pps-row--end">
              <span className="bps-hint">{p?.receiptsAuto ? "A receipt is emailed to the client." : "No receipt goes out (Settings → Payments) — send one after."}</span>
              <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setPaying(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="bps-btn bps-btn--sm bps-btn--primary"
                disabled={!!busy || !num(paying.amount)}
                onClick={() =>
                  void act(`pay-${s.id}`, async () => {
                    const amount = num(paying.amount)!;
                    const paidAt = `${paying.date}T12:00:00`;
                    // The "Balance" row has no stage of its own: the payment goes against what's left.
                    if (s.synthetic && p) await recordRemainingPayment({ proposalId: p.proposalId, method: paying.method, amount, paidAt });
                    else await markInstallmentPaid({ installmentId: s.id, method: paying.method, amount, paidAt });
                    setPaying(null);
                    return `${money(amount)} recorded for ${s.label}.`;
                  })
                }
                data-pay-save
              >
                {busy === `pay-${s.id}` ? "Recording…" : "Record payment"}
              </button>
            </div>
          </div>
        ) : null}

        {invoicing === s.id && p ? (
          <div className="pps-form" data-pay-invoice-form>
            <span className="bps-hint">How should the client pay {s.label}?</span>
            <div className="bps-chips">
              {(
                [
                  ["any", "Their choice", !!(rails?.card || rails?.bank)],
                  ["card", "Card", !!rails?.card],
                  ["bank", "Bank transfer", !!rails?.bank],
                ] as const
              ).map(([m, label, ok]) => (
                <button
                  key={m}
                  type="button"
                  className="bps-chip"
                  disabled={!!busy || !ok}
                  title={ok ? undefined : m === "bank" ? "Add bank details in Settings → Payments" : "Connect Stripe, Square or Stax in Settings → Payments"}
                  onClick={() =>
                    void act(`inv-${s.id}`, async () => {
                      const r = await sendInstallmentInvoice(p.proposalId, stageId, m);
                      setInvoicing(null);
                      if (!r.ok) return { bad: r.error ?? "The invoice didn't go out." };
                      return `Invoice ${r.number ? `${r.number} ` : ""}for ${money(r.amount)} — email ${r.email}, text ${r.sms}.`;
                    })
                  }
                  data-pay-invoice-rail={m}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {dueEdit?.id === s.id ? (
          <div className="pps-form pps-row" data-pay-due-form>
            <input className="bps-in" type="date" value={dueEdit.day} onChange={(e) => setDueEdit({ ...dueEdit, day: e.target.value })} aria-label="Due date" data-pay-due-day />
            <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setDueEdit(null)}>
              Cancel
            </button>
            {s.due ? (
              <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" disabled={!!busy} onClick={() => void act(`due-${s.id}`, async () => (await setPaymentDue(s.id, null), setDueEdit(null), "Due date cleared."))}>
                Clear
              </button>
            ) : null}
            <button type="button" className="bps-btn bps-btn--sm bps-btn--primary" disabled={!!busy || !dueEdit.day} onClick={() => void act(`due-${s.id}`, async () => (await setPaymentDue(s.id, dueEdit.day), setDueEdit(null), `Due ${dueEdit.day} — the reminders count from it.`))} data-pay-due-save>
              Save
            </button>
          </div>
        ) : null}

        {confirm?.id === s.id ? (
          <div className="pps-form pps-confirm" data-pay-confirm>
            <span>{confirm.kind === "undo" ? `Undo the ${money(s.paid?.amount ?? 0)} payment? ${s.label} goes back to owed.` : `Remove ${s.label} (${money(s.amount)}) from the schedule?`}</span>
            <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setConfirm(null)}>
              Keep
            </button>
            <button
              type="button"
              className="bps-btn bps-btn--sm pps-del-solid"
              disabled={!!busy}
              onClick={() =>
                void act(`${confirm.kind}-${s.id}`, async () => {
                  setConfirm(null);
                  if (confirm.kind === "undo") {
                    const r = await unmarkInstallmentPaid(s.id);
                    return r.ok ? `${s.label} is owed again.` : { bad: r.message };
                  }
                  await removePayment(s.id);
                  return `${s.label} removed.`;
                })
              }
              data-pay-confirm-yes
            >
              {confirm.kind === "undo" ? "Undo payment" : "Remove"}
            </button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <BlueprintSheet open={open} onClose={close} title={title} description={sub} width="min(720px, 100%)">
      <div className="pps" data-payments-sheet>
        {loadErr ? <p className="bps-err">{loadErr}</p> : null}
        {!p && !loadErr ? <p className="bps-note">Opening…</p> : null}

        {p && preview ? (
          <div className="pps-preview" data-pay-preview>
            <div className="pps-prev-head">
              <div>
                <div className="pps-k">{preview.kind === "receipt" ? "Receipt" : "Order placed"} · preview</div>
                <div className="pps-prev-subj">{preview.subject}</div>
                <div className="bps-hint">To: {preview.to ?? "no email on the client's record"}</div>
              </div>
              <div className="pps-row">
                <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setPreview(null)} data-pay-preview-close>
                  Back
                </button>
                <button
                  type="button"
                  className="bps-btn bps-btn--sm bps-btn--primary"
                  disabled={!!busy || !preview.to}
                  onClick={() =>
                    void act("prev-send", async () => {
                      const r = preview.kind === "receipt" ? await sendPaymentReceipt(preview.paymentId!) : await sendOrderPlacedNotice({ proposalId: p.proposalId, note: orderNote.trim() || null });
                      setPreview(null);
                      return r.sent ? `Emailed to ${r.to}.` : { bad: r.why ?? "It didn't go out." };
                    })
                  }
                  data-pay-preview-send
                >
                  Send it
                </button>
              </div>
            </div>
            <iframe className="pps-frame" title="Email preview" srcDoc={preview.html} sandbox="" />
          </div>
        ) : p ? (
          <>
            <div className="pps-sum" data-pay-sum>
              <div className="pps-fig">
                <span>Contract</span>
                <b>{money(p.contract)}</b>
              </div>
              <div className="pps-fig">
                <span>Paid</span>
                <b className="pps-ok">{money(p.paid)}</b>
              </div>
              <div className="pps-fig">
                <span>Left</span>
                <b>{money(p.left)}</b>
              </div>
              {p.late.count ? (
                <span className="pps-late" data-pay-late>
                  {p.late.count} late · {money(p.late.amount)}
                </span>
              ) : null}
              <div className="pps-bar" aria-hidden="true">
                <span style={{ width: `${p.contract > 0 ? Math.min(100, Math.round((p.paid / p.contract) * 100)) : 0}%` }} />
              </div>
            </div>
            {!p.sold ? <p className="bps-note">Not signed yet — payments are collected once the client accepts.</p> : null}

            <ol className="pps-stages">{p.stages.map(stageRow)}</ol>
            <p className={`pps-cover pps-cover--${p.coverage.tone}`} data-pay-coverage>
              {p.coverage.words}
            </p>

            {adding ? (
              <div className="pps-form pps-add" data-pay-add-form>
                <div className="pps-row">
                  <input className="bps-in" placeholder="What it's for — Materials, Final" value={adding.label} maxLength={80} onChange={(e) => setAdding({ ...adding, label: e.target.value })} aria-label="Payment name" data-pay-add-label />
                  <input className="bps-in pps-amt" inputMode="decimal" placeholder={adding.pct ? "30" : "1,500"} value={adding.amount} onChange={(e) => setAdding({ ...adding, amount: e.target.value })} aria-label="Amount" data-pay-add-amount />
                  <div className="bps-seg">
                    <button type="button" className={!adding.pct ? "is-on" : ""} onClick={() => setAdding({ ...adding, pct: false })}>
                      $
                    </button>
                    <button type="button" className={adding.pct ? "is-on" : ""} onClick={() => setAdding({ ...adding, pct: true })} data-pay-add-pct>
                      %
                    </button>
                  </div>
                  <input className="bps-in" type="date" value={adding.due} onChange={(e) => setAdding({ ...adding, due: e.target.value })} aria-label="Due date" data-pay-add-due />
                </div>
                <div className="pps-row pps-row--end">
                  <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setAdding(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="bps-btn bps-btn--sm bps-btn--primary"
                    disabled={!!busy || !num(adding.amount)}
                    onClick={() =>
                      void act("add", async () => {
                        await addPayment({ proposalId: p.proposalId, label: adding.label, amount: num(adding.amount)!, isPercent: adding.pct, due: adding.due || null });
                        setAdding(null);
                        return "Payment added.";
                      })
                    }
                    data-pay-add-save
                  >
                    Add payment
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost pps-add-btn" disabled={!!busy} onClick={() => setAdding({ label: "", amount: "", pct: false, due: "" })} data-pay-add>
                + Add a payment
              </button>
            )}

            {note ? (
              <p className={note.tone === "bad" ? "bps-err" : "pps-ok-note"} role="status" data-pay-note>
                {note.text}
              </p>
            ) : null}

            <section className="pps-sec" data-pay-reminders>
              <div className="pps-k">Reminders</div>
              <p>{p.reminders.words}</p>
              <div className="bps-seg" role="group" aria-label="Reminders for this proposal">
                {(
                  [
                    [null, "Company setting"],
                    [true, "On"],
                    [false, "Off"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={p.reminders.proposalOn === v ? "is-on" : ""}
                    disabled={!!busy}
                    onClick={() => void act(`rem-${label}`, async () => (await setProposalReminders(p.proposalId, v), `Reminders for this proposal: ${label.toLowerCase()}.`))}
                    data-pay-reminders-mode={String(v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="pps-sec" data-pay-order>
              <div className="pps-k">Order placed</div>
              <p>{p.orderNotice.sent ? `Sent ${p.orderNotice.sent}.` : "Not sent yet."} Tells the client their order is in and the job is in production, with what's paid and what's left.</p>
              <textarea className="bps-in" rows={2} maxLength={600} placeholder="Add a line (optional) — Delivery is about three weeks out." value={orderNote} onChange={(e) => setOrderNote(e.target.value)} data-pay-order-note />
              <div className="pps-row">
                <button
                  type="button"
                  className="bps-btn bps-btn--sm"
                  disabled={!!busy}
                  onClick={() =>
                    void (async () => {
                      setBusy("order-prev");
                      try {
                        const r = await previewPaymentLetter({ kind: "order", proposalId: p.proposalId, note: orderNote.trim() || null });
                        setPreview({ ...r, kind: "order" });
                      } catch {
                        setNote({ tone: "bad", text: "The notice couldn't be drawn." });
                      } finally {
                        setBusy(null);
                      }
                    })()
                  }
                  data-pay-order-preview
                >
                  Preview
                </button>
                <button
                  type="button"
                  className="bps-btn bps-btn--sm bps-btn--primary"
                  disabled={!!busy || !p.client.email}
                  onClick={() =>
                    void act("order-send", async () => {
                      const r = await sendOrderPlacedNotice({ proposalId: p.proposalId, note: orderNote.trim() || null });
                      return r.sent ? `"Order placed" emailed to ${r.to}.` : { bad: r.why ?? "It didn't go out." };
                    })
                  }
                  data-pay-order-send
                >
                  {p.orderNotice.sent ? "Send again" : "Send"}
                </button>
              </div>
              <label className="pps-check">
                <input
                  type="checkbox"
                  checked={p.orderNotice.auto}
                  disabled={!!busy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    // Ticks at once; the re-read after the save confirms it (or puts it back).
                    setPanel((cur) => (cur ? { ...cur, orderNotice: { ...cur.orderNotice, auto: on } } : cur));
                    void act("order-auto", async () => (await setOrderNoticeOnFirstPayment(on), on ? "It will go out by itself when a proposal's first payment lands." : "It goes out only when you press Send."));
                  }}
                  data-pay-order-auto
                />
                <span>Send it by itself when the first payment lands (every proposal)</span>
              </label>
            </section>

            <section className="pps-sec" data-pay-log>
              <div className="pps-k">What went out</div>
              {p.log.length ? (
                <ul className="pps-log">
                  {p.log.map((l) => (
                    <li key={l.at + l.what}>
                      <span className="pps-log-when">{l.when}</span>
                      <span>
                        {l.what}
                        {l.who ? <i> — {l.who}</i> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bps-hint">Nothing yet — receipts, reminders, invoices and notices show here.</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </BlueprintSheet>
  );
}
