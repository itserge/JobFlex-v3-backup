"use client";
// THE CONTRACTOR'S HALF of /q/[token]: the scope, then one of three states — asked (a price, a note, Send, or Pass),
// awarded (the invoice: an amount and a link to the document, Send), paid (a thank-you). Styled by the buyer's
// ../../buy/[token]/buy.css (root `.jf-buy`); the server page renders the frame.

import { useState } from "react";
import { invoiceSave, quoteSave } from "@/actions/projectSubs";
import type { QuoteView } from "@/lib/projectSubs/server";

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

export function QuoteForm({ token, view }: { token: string; view: QuoteView }) {
  const [price, setPrice] = useState(view.amount != null ? String(view.amount) : "");
  const [note, setNote] = useState(view.note ?? "");
  const [invoice, setInvoice] = useState(view.invoiceAmount != null ? String(view.invoiceAmount) : "");
  const [invoiceUrl, setInvoiceUrl] = useState(view.invoiceUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"quoted" | "passed" | "invoiced" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [head, ...lines] = view.scope.split("\n");
  const asking = view.status === "ASKED" || view.status === "QUOTED";
  const awarded = view.status === "AWARDED" || view.status === "INVOICED";

  async function sendPrice(decline: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const n = price.trim() ? Number(price.replace(/[^\d.]/g, "")) : null;
      if (!decline && (n == null || !Number.isFinite(n))) throw new Error("Type your price — numbers only.");
      const r = await quoteSave(token, { amount: decline ? null : n, note: note.trim() || null, decline });
      if (!r.ok) throw new Error(r.error);
      setDone(decline ? "passed" : "quoted");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function sendInvoice() {
    setBusy(true);
    setErr(null);
    try {
      const n = Number(invoice.replace(/[^\d.]/g, ""));
      if (!invoice.trim() || !Number.isFinite(n)) throw new Error("Type the invoice amount — numbers only.");
      const r = await invoiceSave(token, { amount: n, url: invoiceUrl.trim() || null });
      if (!r.ok) throw new Error(r.error);
      setDone("invoiced");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="by-card" data-quote-page data-quote-status={view.status}>
      <div className="by-head">
        <p className="by-kicker">
          {view.company} · {view.project}
        </p>
        <h1 className="by-title">{awarded ? `${view.contractor}, you've got the work` : view.paid ? "Paid — thank you" : `${view.contractor}, could you quote this?`}</h1>
        <p className="by-sub">
          {asking ? `${view.replyBy ? `Please reply by ${longDay(view.replyBy)}. ` : ""}Your price, all in, and a note if something needs saying. No sign-in needed.` : null}
          {awarded ? "When the work is done, send your invoice here: the amount and a link to the document if you have one." : null}
          {view.paid ? `${view.company} has marked your invoice paid.` : null}
          {view.status === "DECLINED" ? "This request is closed." : null}
        </p>
      </div>

      <ul className="qt-scope">
        <li className="qt-head">{head}</li>
        {view.stage && view.stage !== head ? <li className="qt-sub">{view.stage}</li> : null}
        {lines.map((l, i) => (
          <li key={i} data-quote-scope-line>
            {l.replace(/^-\s*/, "")}
          </li>
        ))}
      </ul>

      {done === "quoted" ? (
        <p className="by-closed" data-quote-done>
          Sent — {view.company} has your price{price.trim() ? ` of ${money(Number(price.replace(/[^\d.]/g, "")))}` : ""}. They will be in touch.
        </p>
      ) : done === "passed" ? (
        <p className="by-closed" data-quote-done>
          Noted — thank you for letting {view.company} know.
        </p>
      ) : done === "invoiced" ? (
        <p className="by-closed" data-quote-done>
          Sent — {view.company} has your invoice{invoice.trim() ? ` for ${money(Number(invoice.replace(/[^\d.]/g, "")))}` : ""}.
        </p>
      ) : asking ? (
        <>
          {view.status === "QUOTED" && view.amount != null ? <p className="by-count">You quoted {money(view.amount)}. A new price replaces it.</p> : null}
          <label className="by-field">
            <span className="by-lab">Your price, all in ($)</span>
            <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" data-quote-price />
          </label>
          <label className="by-field">
            <span className="by-lab">A note (optional)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} placeholder="Two weeks out; the price holds for 30 days." data-quote-note />
          </label>
          {err ? <p className="by-err">{err}</p> : null}
          <button type="button" className="by-btn" onClick={() => void sendPrice(false)} disabled={busy} data-quote-send>
            {busy ? "Sending…" : "Send my price"}
          </button>
          <p className="by-foot">
            Not for you this time?{" "}
            <button type="button" className="qt-pass" onClick={() => void sendPrice(true)} disabled={busy} data-quote-pass>
              Pass on it
            </button>
            {view.phone ? ` · Questions: ${view.phone}` : ""}
          </p>
        </>
      ) : awarded ? (
        <>
          {view.amount != null ? <p className="by-count">Your quote: {money(view.amount)}.</p> : null}
          {view.status === "INVOICED" && view.invoiceAmount != null ? <p className="by-count">Your invoice for {money(view.invoiceAmount)} is in. Sending again replaces it.</p> : null}
          <label className="by-field">
            <span className="by-lab">Invoice amount ($)</span>
            <input inputMode="decimal" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder={view.amount != null ? String(view.amount) : "0"} data-invoice-amount />
          </label>
          <label className="by-field">
            <span className="by-lab">A link to the invoice (optional)</span>
            <input inputMode="url" value={invoiceUrl} onChange={(e) => setInvoiceUrl(e.target.value)} placeholder="https://…" data-invoice-url />
          </label>
          {err ? <p className="by-err">{err}</p> : null}
          <button type="button" className="by-btn" onClick={() => void sendInvoice()} disabled={busy} data-invoice-send>
            {busy ? "Sending…" : "Send the invoice"}
          </button>
          <p className="by-foot">The office sees it on the project the moment you send it.{view.phone ? ` Questions: ${view.phone}` : ""}</p>
        </>
      ) : (
        <p className="by-closed">{view.paid ? `${view.company} has paid your invoice${view.invoiceAmount != null ? ` of ${money(view.invoiceAmount)}` : ""}. Thank you.` : "This request is closed. Thank you."}</p>
      )}
    </div>
  );
}
