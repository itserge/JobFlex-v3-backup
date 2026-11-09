"use client";
// THE SUB'S MONEY ON A SIGNED CONTRACT — under the agreement on /s/[token] (2026-11-09, the subcontractors plan, part
// 5a): the payment schedule with what is billed against each payment, "Send an invoice" (the payment it bills, the
// amount, their number and date, the PDF or a picture, a note), their invoices with the company's word on each (received,
// approved, paid, questioned — and why), the payments with the retainage kept, and for each payment its lien waiver to
// send. The files go to the private store through this contract's token (lib/subDocs/client, door "contract"); the writes
// are actions/projectSubs contractInvoiceSave and contractWaiverSave. Styled by the buyer's and the quote page's sheets
// and ./contract.css.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { contractInvoiceSave, contractWaiverSave } from "@/actions/projectSubs";
import type { SubInvoiceView } from "@/lib/subInvoices/server";
import { INVOICE_LABEL_SUB, WAIVER_KINDS, WAIVER_LABEL, invoiceStatusOf, usd, type WaiverKind } from "@/lib/subInvoices/shared";
import { DOC_ACCEPT, docSize } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument } from "@/lib/subDocs/client";

const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function ContractMoney({ token, money, company }: { token: string; money: SubInvoiceView; company: string }) {
  const router = useRouter();
  const firstOpen = money.milestones.find((m) => m.billed + 0.005 < m.amount) ?? null;
  const [f, setF] = useState(() => ({ milestone: firstOpen ? String(firstOpen.index) : "", amount: firstOpen ? String(Math.round((firstOpen.amount - firstOpen.billed) * 100) / 100) : "", invoiceNumber: "", issuedAt: new Date().toISOString().slice(0, 10), note: "" }));
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [waiverKind, setWaiverKind] = useState<Record<string, WaiverKind>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function sendInvoice() {
    setBusy("invoice");
    setErr(null);
    try {
      const n = Number(f.amount.replace(/[^\d.]/g, ""));
      if (!f.amount.trim() || !Number.isFinite(n) || n <= 0) throw new Error("Type the amount of the invoice.");
      let uploaded = null;
      if (file) {
        setPct(1);
        uploaded = await uploadSubDocument({ kind: "contract", token }, file, setPct);
      }
      const r = await contractInvoiceSave(token, { amount: n, invoiceNumber: f.invoiceNumber.trim() || null, milestone: f.milestone === "" ? null : Number(f.milestone), issuedAt: f.issuedAt || null, note: f.note.trim() || null, file: uploaded });
      if (!r.ok) throw new Error(r.error);
      setSent(`Sent — ${company} has your invoice for ${usd(n)} (${r.number}).`);
      setFile(null);
      setF((cur) => ({ ...cur, invoiceNumber: "", note: "" }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof DocUploadError || e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(null);
      setPct(null);
    }
  }

  async function sendWaiver(paymentId: string, picked: File) {
    setBusy(`waiver:${paymentId}`);
    setErr(null);
    try {
      setPct(1);
      const uploaded = await uploadSubDocument({ kind: "contract", token }, picked, setPct);
      const final = money.payments.find((p) => p.id === paymentId)?.final ?? false;
      const r = await contractWaiverSave(token, { paymentId, kind: waiverKind[paymentId] ?? (final ? "UNCONDITIONAL_FINAL" : "UNCONDITIONAL_PROGRESS"), file: uploaded });
      if (!r.ok) throw new Error(r.error);
      router.refresh();
    } catch (e) {
      setErr(e instanceof DocUploadError || e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(null);
      setPct(null);
    }
  }

  return (
    <div className="sc-money" data-contract-money>
      <p className="by-lab">Invoices and payments</p>
      <dl className="qt-meta sc-money-figures" data-contract-money-figures>
        <dt>Contract</dt>
        <dd>{usd(money.money.total)}</dd>
        <dt>Billed</dt>
        <dd>{usd(money.money.billed)}</dd>
        <dt>Paid to you</dt>
        <dd>
          {usd(money.money.paid)}
          {money.money.held ? ` · ${usd(money.money.held)} retainage held, paid with the last payment` : ""}
        </dd>
      </dl>

      {money.milestones.length ? (
        <div className="qt-versions" data-contract-schedule>
          <ul>
            {money.milestones.map((m) => (
              <li key={m.index} data-contract-schedule-row>
                <span>
                  <b>{m.name}</b> · {m.pct}% · {usd(m.amount)}
                </span>
                <span className="qt-vnote">{m.billed + 0.005 >= m.amount ? "Billed" : m.billed ? `${usd(m.billed)} billed` : "Not billed yet"}{m.due ? ` · due ${shortDay(m.due)}` : ""}</span>
              </li>
            ))}
          </ul>
          {money.retainagePct ? <p className="sc-meta">{money.retainagePct}% of each payment is held back as retainage and paid with the final payment.</p> : null}
        </div>
      ) : null}

      {money.invoices.length ? (
        <div className="qt-versions" data-contract-invoices>
          <p className="by-lab">Your invoices</p>
          <ul>
            {money.invoices.map((i) => (
              <li key={i.id} data-contract-invoice data-contract-invoice-status={i.status}>
                <span>
                  <b>{i.invoiceNumber ? `#${i.invoiceNumber}` : i.number}</b>
                  {i.amount != null ? ` · ${usd(i.amount)}` : ""} · {INVOICE_LABEL_SUB[invoiceStatusOf(i.status)]}
                  {i.document ? (
                    <>
                      {" · "}
                      <a href={i.document.href} target="_blank" rel="noreferrer">
                        {i.document.name}
                      </a>
                    </>
                  ) : null}
                </span>
                <span className="qt-vnote">
                  {i.milestoneName ? `${i.milestoneName} · ` : ""}sent {shortDay(i.receivedAt)}
                  {i.paid ? ` · ${usd(i.paid)} paid` : ""}
                  {i.held ? ` · ${usd(i.held)} held` : ""}
                  {i.status === "DISPUTED" && i.disputeReason ? ` — ${company} asks: ${i.disputeReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {money.payments.length ? (
        <div className="qt-versions" data-contract-payments>
          <p className="by-lab">Payments to you</p>
          <ul>
            {money.payments.map((p) => (
              <li key={p.id} data-contract-payment>
                <span>{p.words}</span>
                {p.waiver ? (
                  <a href={p.waiver.href} target="_blank" rel="noreferrer" data-contract-payment-waiver>
                    Waiver sent
                  </a>
                ) : p.waiverNeeded ? (
                  <span className="sc-waiver" data-contract-payment-waiver-needed>
                    <select value={waiverKind[p.id] ?? (p.final ? "UNCONDITIONAL_FINAL" : "UNCONDITIONAL_PROGRESS")} onChange={(e) => setWaiverKind((cur) => ({ ...cur, [p.id]: e.target.value as WaiverKind }))} aria-label="Kind of waiver">
                      {WAIVER_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {WAIVER_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <label className="qt-file sc-waiver-pick">
                      {busy === `waiver:${p.id}` ? `Uploading… ${pct ?? 0}%` : "Send the signed lien waiver"}
                      <input type="file" accept={DOC_ACCEPT} style={{ display: "none" }} disabled={busy !== null} onChange={(e) => { const picked = e.target.files?.[0]; if (picked) void sendWaiver(p.id, picked); }} data-contract-waiver-input />
                    </label>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="sc-signbox" data-contract-invoice-form>
        <p className="by-lab">Send an invoice</p>
        {money.milestones.length ? (
          <label className="by-field">
            <span className="by-lab">The payment it bills</span>
            <select
              value={f.milestone}
              onChange={(e) => {
                const m = money.milestones.find((x) => String(x.index) === e.target.value);
                setF({ ...f, milestone: e.target.value, amount: m ? String(Math.max(0, Math.round((m.amount - m.billed) * 100) / 100)) : f.amount });
              }}
              data-contract-invoice-milestone
            >
              {money.milestones.map((m) => (
                <option key={m.index} value={String(m.index)}>
                  {m.name} · {usd(m.amount)}
                  {m.billed ? ` (${usd(m.billed)} billed)` : ""}
                </option>
              ))}
              <option value="">Something else (a change order, extra work)</option>
            </select>
          </label>
        ) : null}
        <label className="by-field">
          <span className="by-lab">Amount ($)</span>
          <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-contract-invoice-amount />
        </label>
        <label className="by-field">
          <span className="by-lab">Your invoice number (optional)</span>
          <input value={f.invoiceNumber} maxLength={60} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} data-contract-invoice-number />
        </label>
        <div className="by-field">
          <span className="by-lab">The invoice (a PDF or a picture, up to 25 MB)</span>
          <input ref={fileRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-contract-invoice-file />
          <button type="button" className="qt-file" onClick={() => fileRef.current?.click()} disabled={busy !== null} data-contract-invoice-file-pick>
            {file ? `${file.name}${file.size ? ` · ${docSize(file.size)}` : ""} — change` : "Attach your invoice"}
          </button>
          {pct != null && busy === "invoice" ? (
            <div className="qt-progress" aria-label="Uploading">
              <i style={{ width: `${pct}%` }} />
            </div>
          ) : null}
        </div>
        <label className="by-field">
          <span className="by-lab">A note (optional)</span>
          <textarea value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} rows={2} maxLength={1000} data-contract-invoice-note />
        </label>
        {err ? <p className="by-err">{err}</p> : null}
        {sent ? (
          <p className="by-closed" data-contract-invoice-sent>
            {sent}
          </p>
        ) : null}
        <button type="button" className="by-btn" onClick={() => void sendInvoice()} disabled={busy !== null} data-contract-invoice-send>
          {busy === "invoice" ? (pct != null ? `Uploading… ${pct}%` : "Sending…") : "Send the invoice"}
        </button>
      </div>
    </div>
  );
}
