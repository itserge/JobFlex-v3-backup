"use client";
// THE INVOICES AND PAYMENTS TABS (2026-11-09, the subcontractors plan, part 5a). Invoices: the figures (billed, approved,
// paid, retainage held, owed now), each signed contract's money with "Release retainage", then every invoice — SI-1001,
// the sub, their number, the payment of the schedule it bills, the amount, its state and the rules' flags — and one
// BlueprintSheet per invoice: the document in the viewer with "What the AI read" beside it (Use these, Not right, Read
// again), the figures to correct, Approve (a second press when there are flags), Question it (the sub is told why),
// Void, the payment form (what was paid, the retainage kept, how, the reference, the day, the sub's lien waiver), Pay
// with Ramp when Ramp is connected, and the payments already on it. "+ Invoice" enters one the office received.
// Payments: every payment with its waiver (or "waiver missing"), Void, + Waiver. Every write is actions/projectSubs.

import { useMemo, useRef, useState } from "react";
import {
  approveSubInvoice,
  disputeSubInvoice,
  editSubInvoice,
  enterSubInvoice,
  keepSubWaiver,
  readSubInvoiceNow,
  recordSubPayment,
  releaseSubRetainage,
  sendSubInvoiceToRamp,
  setAsideSubInvoiceRead,
  adoptSubInvoiceRead,
  voidSubInvoice,
  voidSubPayment,
} from "@/actions/projectSubs";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { DocViewer, type ViewerDoc } from "@/components/v3/docs/doc-viewer";
import type { QuoteRow } from "@/lib/projectSubs/server";
import type { ContractRow } from "@/lib/subContracts/server";
import { contractNo, milestoneAmounts } from "@/lib/subContracts/shared";
import type { InvoiceRow, InvoicesRead, PaymentRow } from "@/lib/subInvoices/server";
import { INVOICE_LABEL, MANUAL_METHODS, METHOD_LABEL, WAIVER_KINDS, WAIVER_LABEL, invoiceNo, invoiceReadSummary, invoiceStatusOf, usd, waiverKindFor, type PayMethod, type WaiverKind } from "@/lib/subInvoices/shared";
import { REVIEW_LABEL, reviewStatusOf } from "@/lib/subQuotes/shared";
import { DOC_ACCEPT, docSize } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument, type UploadedFile } from "@/lib/subDocs/client";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "./subs.module.css";

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const todayIso = () => new Date().toISOString().slice(0, 10);
const num = (v: string) => Number(v.replace(/[^\d.-]/g, ""));
const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

function tone(status: string): string {
  const st = invoiceStatusOf(status);
  return st === "PAID" ? s.pillIn : st === "APPROVED" ? s.pillIn : st === "DISPUTED" || st === "VOID" ? s.pillLate : s.pillWait;
}

type Props = { read: InvoicesRead; quotes: QuoteRow[]; contracts: ContractRow[]; canManage: boolean; ramp: boolean; projectId: string; onNote: (w: string | null) => void; refresh: () => void };

/** One file picked and sent through the office's door, with a progress number. */
function useOfficeUpload(projectId: string) {
  const [pct, setPct] = useState<number | null>(null);
  async function up(file: File): Promise<UploadedFile> {
    try {
      setPct(1);
      return await uploadSubDocument({ kind: "office", projectId }, file, setPct);
    } finally {
      setPct(null);
    }
  }
  return { pct, up };
}

export function SubsInvoices({ read, quotes, contracts, canManage, ramp, projectId, onNote, refresh }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [releasing, setReleasing] = useState<{ contractId: string; amount: string; method: PayMethod; reference: string; paidAt: string; key: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = read.invoices.find((x) => x.id === openId) ?? null;
  const t = read.totals;

  async function act(k: string, fn: () => Promise<string | null | void>) {
    setBusy(k);
    onNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") onNote(words);
      refresh();
    } catch (err) {
      onNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className={s.tiles} data-subs-invoice-tiles>
        <Tile label="Billed" value={usd(t.billed)} sub={`${read.invoices.filter((x) => x.status !== "VOID").length} invoice${read.invoices.length === 1 ? "" : "s"}`} />
        <Tile label="To review" value={String(t.toReview)} sub="received, not approved" warn={t.toReview > 0} />
        <Tile label="Owed now" value={usd(t.owed)} sub="approved, not yet paid" warn={t.owed > 0} />
        <Tile label="Paid" value={usd(t.paid)} sub="recorded payments" />
        <Tile label="Retainage held" value={usd(t.held)} sub="still owed, paid with the last" />
      </div>

      {read.contracts.length ? (
        <section className={h.card} aria-label="Contracts' money" data-subs-contract-money>
          <div className={h.head}>
            <h3 className={h.title}>By contract</h3>
            <span className={h.headSub}>billed, paid and held against each signed contract</span>
          </div>
          <div className={s.table}>
            {read.contracts.map((c) => (
              <div key={c.id} className={`${s.row} ${s.waitRow}`} data-subs-contract-money-row data-subs-contract-money-no={c.number}>
                <div className={s.name}>
                  {contractNo(c.number)} · {c.contractorName}
                  <div className={s.mono}>
                    {c.stageName ?? "The project"}
                    {c.retainagePct ? ` · ${c.retainagePct}% retainage` : " · no retainage"}
                  </div>
                </div>
                <div className={s.muted} style={{ fontSize: 13 }}>
                  {usd(c.money.total)} · billed {usd(c.money.billed)} · paid {usd(c.money.paid)}
                  {c.money.held ? ` · held ${usd(c.money.held)}` : ""}
                  <br />
                  {c.money.left > 0 ? `${usd(c.money.left)} left to bill` : "billed in full"}
                  {c.money.owed > 0 ? ` · ${usd(c.money.owed)} owed now` : ""}
                </div>
                <div className={h.stageActs}>
                  {canManage && c.money.held > 0 ? (
                    <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => setReleasing({ contractId: c.id, amount: String(c.money.held), method: "CHECK", reference: "", paidAt: todayIso(), key: newKey() })} data-subs-release-open>
                      Release retainage
                    </button>
                  ) : null}
                </div>
                {releasing?.contractId === c.id ? (
                  <div className={h.form} style={{ gridColumn: "1 / -1", marginTop: 6 }} data-subs-release-form>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
                      <input className={h.input} inputMode="decimal" value={releasing.amount} onChange={(e) => setReleasing({ ...releasing, amount: e.target.value })} aria-label="Amount released" data-subs-release-amount />
                      <select className={h.input} value={releasing.method} onChange={(e) => setReleasing({ ...releasing, method: e.target.value as PayMethod })} aria-label="How">
                        {MANUAL_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {METHOD_LABEL[m]}
                          </option>
                        ))}
                      </select>
                      <input className={h.input} value={releasing.reference} maxLength={60} onChange={(e) => setReleasing({ ...releasing, reference: e.target.value })} placeholder="Check # or reference" aria-label="Reference" />
                      <input className={h.input} type="date" value={releasing.paidAt} onChange={(e) => setReleasing({ ...releasing, paidAt: e.target.value })} aria-label="Paid on" />
                    </div>
                    <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                      <button
                        type="button"
                        className="bps-btn bps-btn--primary"
                        disabled={busy !== null}
                        onClick={() =>
                          void act("release", async () => {
                            const r = await releaseSubRetainage({ contractId: c.id, amount: num(releasing.amount) || null, method: releasing.method, reference: releasing.reference.trim() || null, paidAt: releasing.paidAt, key: releasing.key });
                            setReleasing(null);
                            return `${r.payment.words} — ${c.contractorName}.`;
                          })
                        }
                        data-subs-release-send
                      >
                        {busy === "release" ? "Recording…" : "Record the release"}
                      </button>
                      <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setReleasing(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className={h.card} aria-label="Invoices" data-subs-invoices>
        <div className={h.head}>
          <h3 className={h.title}>Invoices</h3>
          <span className={h.headSub}>
            <b>{t.toReview}</b> to review · {usd(t.owed)} approved and unpaid
          </span>
          {canManage ? (
            <div className={h.acts}>
              <button type="button" className={h.btnSm} onClick={() => setEntering(true)} disabled={!quotes.some((q) => q.status === "AWARDED" || q.status === "INVOICED")} data-subs-invoice-enter>
                + Invoice
              </button>
            </div>
          ) : null}
        </div>
        {read.invoices.length ? (
          <div className={s.table}>
            {read.invoices.map((x) => (
              <div key={x.id} className={`${s.row} ${s.contractRow}`} data-subs-invoice data-subs-invoice-no={x.number} data-subs-invoice-status={x.status}>
                <div className={s.name}>
                  <button type="button" className={s.linkBtn} onClick={() => setOpenId(x.id)} data-subs-invoice-open>
                    {invoiceNo(x.number)} · {x.contractorName}
                  </button>
                  <div className={s.mono}>
                    {x.invoiceNumber ? `#${x.invoiceNumber} · ` : ""}
                    {x.milestoneName ?? x.stageName ?? "the work"} · {shortDay(x.receivedAt)}
                    {x.source === "EMAIL" ? " · by email" : x.source === "OFFICE" ? " · entered by the office" : ""}
                  </div>
                </div>
                <div className={s.amt}>
                  {x.amount != null ? usd(x.amount) : "amount to confirm"}
                  {x.paid || x.held ? <div className={s.mono}>{usd(x.paid)} paid{x.held ? ` · ${usd(x.held)} held` : ""}</div> : null}
                </div>
                <div>
                  <span className={`${s.pill} ${tone(x.status)}`}>{INVOICE_LABEL[invoiceStatusOf(x.status)]}</span>
                  {x.flags.length && (x.status === "RECEIVED" || x.status === "APPROVED") ? (
                    <span className={`${s.pill} ${s.pillLate}`} data-subs-invoice-flagcount>
                      {x.flags.length} to check
                    </span>
                  ) : null}
                  {x.document && x.reviewStatus !== "NONE" && x.status === "RECEIVED" ? <div className={s.muted} style={{ fontSize: 12.5, marginTop: 2 }}>{REVIEW_LABEL[reviewStatusOf(x.reviewStatus)]}</div> : null}
                </div>
                <div className={h.stageActs}>
                  <button type="button" className={h.btnSm} onClick={() => setOpenId(x.id)} data-subs-invoice-open-btn>
                    Open
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className={h.empty}>No invoices yet — subs send them from their signed contract&apos;s page, by email, or you enter one with + Invoice.</p>
        )}
      </section>

      <InvoiceSheet key={open ? `${open.id}:${open.status}` : "none"} invoice={open} contracts={contracts} canManage={canManage} ramp={ramp} projectId={projectId} onClose={() => setOpenId(null)} onNote={onNote} refresh={refresh} />
      <EnterSheet open={entering} quotes={quotes} contracts={contracts} projectId={projectId} onClose={() => setEntering(false)} onDone={(row) => { setEntering(false); setOpenId(row.id); onNote(`${invoiceNo(row.number)} entered — check it, then approve it.`); refresh(); }} />
    </>
  );
}

function InvoiceSheet({ invoice, contracts, canManage, ramp, projectId, onClose, onNote, refresh }: { invoice: InvoiceRow | null; contracts: ContractRow[]; canManage: boolean; ramp: boolean; projectId: string; onClose: () => void; onNote: (w: string | null) => void; refresh: () => void }) {
  const x = invoice;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ViewerDoc | null>(null);
  const [edit, setEdit] = useState(() => ({ amount: x?.amount != null ? String(x.amount) : "", invoiceNumber: x?.invoiceNumber ?? "", milestone: x?.milestone != null ? String(x.milestone) : "", issuedAt: x?.issuedAt ?? "", dueAt: x?.dueAt ?? "" }));
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [pay, setPay] = useState(() => ({ amount: x?.suggest ? String(x.suggest.amount) : "", held: x?.suggest ? String(x.suggest.held) : "0", method: "CHECK" as PayMethod, reference: "", paidAt: todayIso(), waiverKind: waiverKindFor(false) as WaiverKind, waiver: null as File | null, key: newKey() }));
  const up = useOfficeUpload(projectId);
  const waiverRef = useRef<HTMLInputElement | null>(null);
  const contract = x?.contractId ? (contracts.find((c) => c.id === x.contractId) ?? null) : null;
  const msRows = useMemo(() => (contract ? milestoneAmounts(contract.amount, contract.milestones) : []), [contract]);

  async function act(k: string, fn: () => Promise<string | null | void>) {
    setBusy(k);
    setErr(null);
    try {
      const words = await fn();
      if (typeof words === "string") onNote(words);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  if (!x) return <BlueprintSheet open={false} onClose={onClose} />;
  const st = invoiceStatusOf(x.status);
  const editable = canManage && (st === "RECEIVED" || st === "APPROVED") && !x.payments.some((p) => p.status === "RECORDED");
  const doc: ViewerDoc | null = x.document ? { id: x.document.id, name: x.document.name, href: `/api/subs/doc/${x.document.id}`, contentType: x.document.contentType, downloadHref: `/api/subs/doc/${x.document.id}?download=1`, meta: `${x.contractorName} · ${invoiceNo(x.number)}${x.document.bytes ? ` · ${docSize(x.document.bytes)}` : ""}` } : null;
  const paidFull = st === "PAID";

  return (
    <>
      <BlueprintSheet open onClose={() => busy === null && onClose()} title={`${invoiceNo(x.number)} · ${x.contractorName}`} description={`${x.invoiceNumber ? `Their #${x.invoiceNumber} · ` : ""}${x.milestoneName ?? x.stageName ?? "the work"} · ${INVOICE_LABEL[st]}`} width="min(640px, 100%)">
        <div className={h.w}>
          <div className={h.form} data-subs-invoice-sheet data-subs-invoice-sheet-status={x.status}>
            <dl className={s.facts} data-subs-invoice-facts>
              <Fact label="Amount" value={x.amount != null ? usd(x.amount) : "to confirm"} />
              <Fact label="Paid" value={`${usd(x.paid)}${x.held ? ` · ${usd(x.held)} retainage held` : ""}${x.left != null && x.left > 0 && st !== "RECEIVED" ? ` · ${usd(x.left)} left` : ""}`} />
              <Fact label="Received" value={`${shortDay(x.receivedAt)}${x.source === "EMAIL" ? " by email" : x.source === "OFFICE" ? ", entered by the office" : " from their page"}`} />
              {x.dueAt ? <Fact label="Due" value={shortDay(x.dueAt)} /> : null}
              {x.contractNumber ? <Fact label="Contract" value={`${contractNo(x.contractNumber)}${x.retainagePct ? ` · ${x.retainagePct}% retainage` : ""}`} /> : null}
              {x.disputeReason ? <Fact label="Questioned" value={x.disputeReason} /> : null}
              {x.note ? <Fact label="Note" value={x.note} /> : null}
            </dl>
            {x.flags.length && (st === "RECEIVED" || st === "APPROVED") ? (
              <div className={h.field} data-subs-invoice-flags>
                <span className={h.lab}>To check</span>
                {x.flags.map((f, i) => (
                  <p key={i} className={s.words} style={{ borderLeftColor: "var(--amber, #b7791f)" }} data-subs-invoice-flag={f.kind}>
                    {f.text}
                  </p>
                ))}
              </div>
            ) : null}
            {doc ? (
              <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setViewing(doc)} data-subs-invoice-doc>
                  Open the invoice{x.read ? " and what the AI read" : ""}
                </button>
                <span className={s.muted} style={{ fontSize: 12.5 }}>
                  {REVIEW_LABEL[reviewStatusOf(x.reviewStatus)]}
                  {x.read ? ` · ${invoiceReadSummary(x.read.read)}` : ""}
                </span>
              </div>
            ) : null}

            {editable ? (
              <div className={h.field} data-subs-invoice-edit>
                <span className={h.lab}>The figures</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  <input className={h.input} inputMode="decimal" value={edit.amount} onChange={(e) => setEdit({ ...edit, amount: e.target.value })} placeholder="Amount $" aria-label="Amount" data-subs-invoice-amount />
                  <input className={h.input} value={edit.invoiceNumber} maxLength={60} onChange={(e) => setEdit({ ...edit, invoiceNumber: e.target.value })} placeholder="Their invoice #" aria-label="Their invoice number" data-subs-invoice-number />
                  <input className={h.input} type="date" value={edit.issuedAt} onChange={(e) => setEdit({ ...edit, issuedAt: e.target.value })} aria-label="Invoice date" />
                  <input className={h.input} type="date" value={edit.dueAt} onChange={(e) => setEdit({ ...edit, dueAt: e.target.value })} aria-label="Due" data-subs-invoice-due />
                </div>
                {msRows.length ? (
                  <select className={h.input} value={edit.milestone} onChange={(e) => setEdit({ ...edit, milestone: e.target.value })} aria-label="Payment of the schedule" data-subs-invoice-milestone>
                    <option value="">Not one payment of the schedule</option>
                    {msRows.map((m, i) => (
                      <option key={i} value={String(i)}>
                        {m.name} · {m.pct}% · {usd(m.amount)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    className="bps-btn bps-btn--ghost"
                    disabled={busy !== null}
                    onClick={() =>
                      void act("save", async () => {
                        await editSubInvoice({ invoiceId: x.id, amount: edit.amount.trim() ? num(edit.amount) : null, invoiceNumber: edit.invoiceNumber.trim() || null, milestone: edit.milestone === "" ? null : Number(edit.milestone), issuedAt: edit.issuedAt || null, dueAt: edit.dueAt || null });
                        return `${invoiceNo(x.number)} saved.`;
                      })
                    }
                    data-subs-invoice-save
                  >
                    {busy === "save" ? "Saving…" : "Save the figures"}
                  </button>
                </div>
              </div>
            ) : null}

            {err ? (
              <p className={h.err} data-subs-invoice-err>
                {err}
              </p>
            ) : null}

            {canManage && st === "RECEIVED" ? (
              <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="bps-btn bps-btn--primary"
                  disabled={busy !== null || x.amount == null}
                  title={x.amount == null ? "Confirm the amount first — use the AI's read, or type it." : undefined}
                  onClick={() => {
                    // Flags show first; with any, Approve asks once more.
                    if (x.flags.length && !confirmApprove) {
                      setConfirmApprove(true);
                      return;
                    }
                    void act("approve", async () => {
                      await approveSubInvoice(x.id);
                      return `${invoiceNo(x.number)} approved — ${x.amount != null ? usd(x.amount) : ""} to pay.`;
                    });
                  }}
                  data-subs-invoice-approve
                >
                  {busy === "approve" ? "Approving…" : x.flags.length && confirmApprove ? "Approve anyway" : "Approve"}
                </button>
                <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setDisputing("")} data-subs-invoice-dispute>
                  Question it
                </button>
                <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("void", async () => { await voidSubInvoice({ invoiceId: x.id, reason: null }); onClose(); return `${invoiceNo(x.number)} voided.`; })} data-subs-invoice-void>
                  Void
                </button>
              </div>
            ) : null}
            {disputing !== null ? (
              <div className={h.form} data-subs-invoice-dispute-form>
                <textarea className={h.input} rows={2} maxLength={500} value={disputing} onChange={(e) => setDisputing(e.target.value)} placeholder="What is wrong — the sub reads it (the rough-in is not done yet; the amount is above the payment)." data-subs-invoice-dispute-reason />
                <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                  <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !disputing.trim()} onClick={() => void act("dispute", async () => { await disputeSubInvoice({ invoiceId: x.id, reason: disputing.trim() }); setDisputing(null); return `${x.contractorName} was told what is wrong with ${invoiceNo(x.number)}.`; })} data-subs-invoice-dispute-send>
                    Send to the sub
                  </button>
                  <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setDisputing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {canManage && st === "APPROVED" ? (
              <div className={h.field} data-subs-pay-form>
                <span className={h.lab}>Record a payment</span>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                  <label className={h.field}>
                    <span className={h.lab}>Paid $</span>
                    <input className={h.input} inputMode="decimal" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} data-subs-pay-amount />
                  </label>
                  <label className={h.field}>
                    <span className={h.lab}>Retainage kept $</span>
                    <input className={h.input} inputMode="decimal" value={pay.held} onChange={(e) => setPay({ ...pay, held: e.target.value })} data-subs-pay-held />
                  </label>
                  <label className={h.field}>
                    <span className={h.lab}>How</span>
                    <select className={h.input} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as PayMethod })} data-subs-pay-method>
                      {MANUAL_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {METHOD_LABEL[m]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={h.field}>
                    <span className={h.lab}>Check # / reference</span>
                    <input className={h.input} value={pay.reference} maxLength={60} onChange={(e) => setPay({ ...pay, reference: e.target.value })} data-subs-pay-reference />
                  </label>
                  <label className={h.field}>
                    <span className={h.lab}>Paid on</span>
                    <input className={h.input} type="date" value={pay.paidAt} onChange={(e) => setPay({ ...pay, paidAt: e.target.value })} data-subs-pay-date />
                  </label>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 8, alignItems: "end" }}>
                  <label className={h.field}>
                    <span className={h.lab}>Their lien waiver (optional)</span>
                    <select className={h.input} value={pay.waiverKind} onChange={(e) => setPay({ ...pay, waiverKind: e.target.value as WaiverKind })} aria-label="Kind of waiver">
                      {WAIVER_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {WAIVER_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <input ref={waiverRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => setPay({ ...pay, waiver: e.target.files?.[0] ?? null })} data-subs-pay-waiver-input />
                    <button type="button" className="bps-btn bps-btn--ghost" style={{ width: "100%" }} onClick={() => waiverRef.current?.click()} data-subs-pay-waiver-pick>
                      {pay.waiver ? `${pay.waiver.name} — change` : "+ Attach the waiver"}
                    </button>
                  </div>
                </div>
                <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="bps-btn bps-btn--primary"
                    disabled={busy !== null}
                    onClick={() =>
                      void act("pay", async () => {
                        const waiverFile = pay.waiver ? await up.up(pay.waiver) : null;
                        const r = await recordSubPayment({ invoiceId: x.id, amount: num(pay.amount) || 0, held: num(pay.held) || 0, method: pay.method, reference: pay.reference.trim() || null, paidAt: pay.paidAt, waiverKind: waiverFile ? pay.waiverKind : null, waiverFile, note: null, key: pay.key });
                        setPay((cur) => ({ ...cur, key: newKey(), waiver: null }));
                        return r.duplicate ? "That payment was recorded already." : `${r.payment.words} — ${x.contractorName}${r.email === "sent" ? ", who was told" : ""}.`;
                      })
                    }
                    data-subs-pay-send
                  >
                    {busy === "pay" ? (up.pct != null ? `Uploading… ${up.pct}%` : "Recording…") : "Record the payment"}
                  </button>
                  {ramp && !x.rampBillId ? (
                    <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("ramp", async () => { const r = await sendSubInvoiceToRamp(x.id); if (!r.ok) throw new Error(r.error); return `${invoiceNo(x.number)} is in Ramp's Bill Pay — the payment is recorded here when Ramp pays.${r.warning ? ` ${r.warning}` : ""}`; })} data-subs-pay-ramp>
                      {busy === "ramp" ? "Sending…" : "Pay with Ramp"}
                    </button>
                  ) : null}
                  {x.rampBillId ? <span className={`${s.pill} ${s.pillWait}`} data-subs-pay-ramp-sent>In Ramp — recorded when Ramp pays</span> : null}
                </div>
              </div>
            ) : null}

            {x.payments.length ? (
              <div className={h.field} data-subs-invoice-payments>
                <span className={h.lab}>Payments on it</span>
                {x.payments.map((p) => (
                  <PaymentLine key={p.id} p={p} canManage={canManage} projectId={projectId} busy={busy} act={act} />
                ))}
              </div>
            ) : null}
            {paidFull ? (
              <p className={h.note} style={{ margin: 0 }} data-subs-invoice-paid>
                Paid in full{x.held ? ` — ${usd(x.held)} retainage is held and paid with the last payment` : ""}.
              </p>
            ) : null}
          </div>
        </div>
      </BlueprintSheet>
      <DocViewer doc={viewing} onClose={() => setViewing(null)} side={x.read ? <InvoiceReadPanel invoice={x} canManage={canManage} busy={busy} act={act} /> : undefined} />
    </>
  );
}

function InvoiceReadPanel({ invoice, canManage, busy, act }: { invoice: InvoiceRow; canManage: boolean; busy: string | null; act: (k: string, fn: () => Promise<string | null | void>) => Promise<void> }) {
  const r = invoice.read!.read;
  const fig = (label: string, f: { value: number | null; source: string | null }) => (
    <div className={s.fact}>
      <dt className={s.factLbl}>{label}</dt>
      <dd className={s.factVal}>
        {f.value != null ? usd(f.value) : "—"}
        {f.source ? <div className={s.muted} style={{ fontSize: 11.5, fontWeight: 400 }}>“{f.source}”</div> : null}
      </dd>
    </div>
  );
  return (
    <div className={h.w}>
      <div className={h.form} data-invoice-read>
        <span className={h.lab}>What the AI read · {REVIEW_LABEL[reviewStatusOf(invoice.reviewStatus)]}</span>
        <p className={s.muted} style={{ margin: 0, fontSize: 13 }}>{r.about}</p>
        <dl className={s.facts}>
          {fig("Amount due", r.amountDue)}
          {r.subtotal.value != null ? fig("Subtotal", r.subtotal) : null}
          {r.retainage.value != null ? fig("Retainage", r.retainage) : null}
          {r.previouslyPaid.value != null ? fig("Paid before", r.previouslyPaid) : null}
          <div className={s.fact}>
            <dt className={s.factLbl}>Number · dates</dt>
            <dd className={s.factVal}>
              {r.invoiceNumber ? `#${r.invoiceNumber.replace(/^#/, "")}` : "—"}
              {r.date ? ` · ${r.date}` : ""}
              {r.dueDate ? ` · due ${r.dueDate}` : ""}
            </dd>
          </div>
          {r.period ? (
            <div className={s.fact}>
              <dt className={s.factLbl}>Bills</dt>
              <dd className={s.factVal}>{r.period}</dd>
            </div>
          ) : null}
        </dl>
        {r.flags.length ? (
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} data-invoice-read-flags>
            {r.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        ) : null}
        {canManage && invoice.status === "RECEIVED" ? (
          <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || r.amountDue.value == null} onClick={() => void act("use", async () => { await adoptSubInvoiceRead(invoice.id); return `The AI's figures are on ${invoiceNo(invoice.number)}.`; })} data-invoice-read-use>
              Use these
            </button>
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("reject", async () => { await setAsideSubInvoiceRead(invoice.id); return "The read is set aside — type the figures."; })} data-invoice-read-reject>
              Not right
            </button>
            <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("reread", async () => { const o = await readSubInvoiceNow(invoice.id); return o.ok ? "Read again." : (o.error ?? "It could not be read."); })} data-invoice-read-again>
              Read again
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaymentLine({ p, canManage, projectId, busy, act }: { p: PaymentRow; canManage: boolean; projectId: string; busy: string | null; act: (k: string, fn: () => Promise<string | null | void>) => Promise<void> }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const up = useOfficeUpload(projectId);
  return (
    <div className={s.row} style={{ gridTemplateColumns: "1fr", padding: "8px 0" }} data-subs-payment data-subs-payment-status={p.status}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <span>
          {p.words}
          {p.invoiceNo ? <span className={s.muted}> · {p.invoiceNo}</span> : null}
          {p.status === "VOID" && p.voidReason ? <span className={s.muted}> — {p.voidReason}</span> : null}
        </span>
        {p.status === "RECORDED" && p.amount > 0 ? (
          p.waiver ? (
            <a className={`${s.pill} ${s.pillIn}`} href={`/api/subs/doc/${p.waiver.id}`} target="_blank" rel="noreferrer" data-subs-payment-waiver>
              Waiver{p.waiverKind ? ` · ${WAIVER_LABEL[p.waiverKind].split(",")[0].toLowerCase()}` : ""}
            </a>
          ) : (
            <span className={`${s.pill} ${s.pillWait}`} data-subs-payment-waiver-missing>
              Waiver missing
            </span>
          )
        ) : null}
      </div>
      {canManage && p.status === "RECORDED" ? (
        <div className={h.stageActs} style={{ justifyContent: "flex-start", marginTop: 4 }}>
          {!p.waiver && p.amount > 0 ? (
            <>
              <input ref={ref} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void act(`waiver:${p.id}`, async () => { const file = await up.up(f); await keepSubWaiver({ paymentId: p.id, kind: p.retainageRelease ? "UNCONDITIONAL_FINAL" : "UNCONDITIONAL_PROGRESS", file }); return "The waiver is kept on the payment."; }); }} data-subs-payment-waiver-input />
              <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => ref.current?.click()} data-subs-payment-waiver-add>
                {busy === `waiver:${p.id}` ? (up.pct != null ? `Uploading… ${up.pct}%` : "Keeping…") : "+ Waiver"}
              </button>
            </>
          ) : null}
          {p.method !== "RAMP" ? (
            <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => void act(`voidpay:${p.id}`, async () => { await voidSubPayment({ paymentId: p.id, reason: null }); return "The payment is voided; its expense is off the project."; })} data-subs-payment-void>
              Void
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function EnterSheet({ open, quotes, contracts, projectId, onClose, onDone }: { open: boolean; quotes: QuoteRow[]; contracts: ContractRow[]; projectId: string; onClose: () => void; onDone: (row: InvoiceRow) => void }) {
  const billable = quotes.filter((q) => q.status === "AWARDED" || q.status === "INVOICED");
  const [d, setD] = useState({ quoteId: billable[0]?.id ?? "", amount: "", invoiceNumber: "", milestone: "", issuedAt: todayIso(), file: null as File | null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | null>(null);
  const up = useOfficeUpload(projectId);
  const q = billable.find((x) => x.id === d.quoteId) ?? billable[0] ?? null;
  const contract = q?.contract?.status === "EXECUTED" ? (contracts.find((c) => c.id === q.contract!.id) ?? null) : null;
  const ms = contract ? milestoneAmounts(contract.amount, contract.milestones) : [];

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      if (!q) throw new Error("Pick the work it bills.");
      const file = d.file ? await up.up(d.file) : null;
      if (!file && !d.amount.trim()) throw new Error("Type the amount, or attach the invoice for the AI to read.");
      const row = await enterSubInvoice({ quoteId: q.id, amount: d.amount.trim() ? num(d.amount) : null, invoiceNumber: d.invoiceNumber.trim() || null, milestone: d.milestone === "" ? null : Number(d.milestone), issuedAt: d.issuedAt || null, dueAt: null, note: null, file });
      setD({ ...d, amount: "", invoiceNumber: "", milestone: "", file: null });
      onDone(row);
    } catch (e) {
      setErr(e instanceof DocUploadError || e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <BlueprintSheet open={open} onClose={() => !busy && onClose()} title="Enter an invoice" description="One a sub gave you on paper or by email: the work it bills, the amount (or the PDF for the AI to read), their number.">
      {open ? (
        <div className={h.w}>
          <div className={h.form} data-subs-enter-sheet>
            <label className={h.field}>
              <span className={h.lab}>The work</span>
              <select className={h.input} value={q?.id ?? ""} onChange={(e) => setD({ ...d, quoteId: e.target.value, milestone: "" })} data-subs-enter-quote>
                {billable.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.contractorName} · {x.stageName ?? "the project"}
                    {x.contract?.status === "EXECUTED" ? ` · ${contractNo(x.contract.number)}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {ms.length ? (
              <label className={h.field}>
                <span className={h.lab}>The payment it bills</span>
                <select className={h.input} value={d.milestone} onChange={(e) => setD({ ...d, milestone: e.target.value, amount: e.target.value === "" ? d.amount : String(ms[Number(e.target.value)].amount) })} data-subs-enter-milestone>
                  <option value="">Not one payment of the schedule</option>
                  {ms.map((m, i) => (
                    <option key={i} value={String(i)}>
                      {m.name} · {m.pct}% · {usd(m.amount)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
              <input className={h.input} inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="Amount $" aria-label="Amount" data-subs-enter-amount />
              <input className={h.input} value={d.invoiceNumber} maxLength={60} onChange={(e) => setD({ ...d, invoiceNumber: e.target.value })} placeholder="Their invoice #" aria-label="Their invoice number" data-subs-enter-number />
              <input className={h.input} type="date" value={d.issuedAt} onChange={(e) => setD({ ...d, issuedAt: e.target.value })} aria-label="Invoice date" />
            </div>
            <input ref={ref} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => setD({ ...d, file: e.target.files?.[0] ?? null })} data-subs-enter-file />
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => ref.current?.click()} data-subs-enter-file-pick>
              {d.file ? `${d.file.name}${d.file.size ? ` · ${docSize(d.file.size)}` : ""} — change` : "+ Attach the invoice (the AI reads it)"}
            </button>
            {err ? <p className={h.err}>{err}</p> : null}
            <div className={h.stageActs}>
              <button type="button" className="bps-btn bps-btn--ghost" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="bps-btn bps-btn--primary" disabled={busy || !q} onClick={() => void save()} data-subs-enter-save>
                {busy ? (up.pct != null ? `Uploading… ${up.pct}%` : "Saving…") : "Enter the invoice"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </BlueprintSheet>
  );
}

/** The Payments tab: every payment on the project with its waiver, newest first. */
export function SubsPayments({ read, canManage, projectId, onNote, refresh }: { read: InvoicesRead; canManage: boolean; projectId: string; onNote: (w: string | null) => void; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function act(k: string, fn: () => Promise<string | null | void>) {
    setBusy(k);
    onNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") onNote(words);
      refresh();
    } catch (err) {
      onNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }
  const t = read.totals;
  return (
    <section className={h.card} aria-label="Payments" data-subs-payments>
      <div className={h.head}>
        <h3 className={h.title}>Payments</h3>
        <span className={h.headSub}>
          <b>{usd(t.paid)}</b> paid · {usd(t.held)} retainage held{t.waiversMissing ? ` · ${t.waiversMissing} waiver${t.waiversMissing === 1 ? "" : "s"} missing` : ""}
        </span>
      </div>
      {read.payments.length ? (
        <div className={s.table} style={{ padding: "0 12px" }}>
          {read.payments.map((p) => (
            <div key={p.id}>
              <div className={s.mono} style={{ paddingTop: 8 }}>{p.contractorName}</div>
              <PaymentLine p={p} canManage={canManage} projectId={projectId} busy={busy} act={act} />
            </div>
          ))}
        </div>
      ) : (
        <p className={h.empty}>No payments yet — approve an invoice, then record what you paid on it.</p>
      )}
    </section>
  );
}

function Tile({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`${s.tile} ${warn ? s.tileWarn : ""}`} data-subs-tile={label}>
      <div className={s.tileLbl}>{label}</div>
      <div className={s.tileVal}>{value}</div>
      {sub ? <div className={s.tileSub}>{sub}</div> : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.fact}>
      <dt className={s.factLbl}>{label}</dt>
      <dd className={s.factVal}>{value}</dd>
    </div>
  );
}
