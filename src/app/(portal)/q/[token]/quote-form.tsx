"use client";
// THE CONTRACTOR'S HALF of /q/[token] (2026-11-07; grown 2026-11-08 by part 1 of the subcontractors plan): the
// request — its number, the scope, the details, the dates, the files to open — then one of the states: open (your
// estimate as a PDF or a picture, your price, a note, Send, or Pass), a revision asked (the office's note, a new
// price), awarded (the invoice: an amount and a link to the document, Send), paid (a thank-you), closed. Every
// price sent is kept as a version and listed. Styled by the buyer's ../../buy/[token]/buy.css (root `.jf-buy`) and
// ./quote.css; the server page renders the frame. The file goes to the private store first (lib/subDocs/client,
// through this page's own token), then the price is saved with it (actions/projectSubs quoteSave).

import { useRef, useState } from "react";
import { invoiceSave, quoteSave } from "@/actions/projectSubs";
import type { QuoteView } from "@/lib/projectSubs/server";
import { DOC_ACCEPT, docSize } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument } from "@/lib/subDocs/client";

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function QuoteForm({ token, view }: { token: string; view: QuoteView }) {
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [invoice, setInvoice] = useState(view.invoiceAmount != null ? String(view.invoiceAmount) : "");
  const [invoiceUrl, setInvoiceUrl] = useState(view.invoiceUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: "quoted" | "passed" | "invoiced"; version: number | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [head, ...lines] = view.scope.split("\n");
  const asking = view.canQuote;
  const awarded = view.canInvoice;

  async function sendPrice(decline: boolean) {
    setBusy(true);
    setErr(null);
    try {
      const n = price.trim() ? Number(price.replace(/[^\d.]/g, "")) : null;
      if (!decline && (n == null || !Number.isFinite(n)) && !file) throw new Error("Type your price, or attach your estimate.");
      let uploaded: { url: string; name: string; contentType: string; bytes: number } | null = null;
      if (!decline && file) {
        setPct(1);
        uploaded = await uploadSubDocument({ kind: "token", token }, file, setPct);
      }
      const r = await quoteSave(token, { amount: decline ? null : n != null && Number.isFinite(n) ? n : null, note: note.trim() || null, decline, reason: decline ? note.trim() || null : null, file: uploaded });
      if (!r.ok) throw new Error(r.error);
      setDone({ kind: decline ? "passed" : "quoted", version: r.version });
    } catch (e) {
      setErr(e instanceof DocUploadError || e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
      setPct(null);
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
      setDone({ kind: "invoiced", version: null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't send — try again.");
    } finally {
      setBusy(false);
    }
  }

  const dates = [view.startsAt ? `starts about ${shortDay(view.startsAt)}` : null, view.endsAt ? `done by ${shortDay(view.endsAt)}` : null].filter(Boolean).join(" · ");

  return (
    <div className="by-card" data-quote-page data-quote-status={view.status}>
      <div className="by-head">
        <p className="by-kicker">
          {view.company} · {view.project}
          {view.requestNo ? ` · ${view.requestNo}` : ""}
        </p>
        <h1 className="by-title">
          {awarded ? `${view.contractor}, you've got the work` : view.paid ? "Paid — thank you" : view.closed ? "This request is closed" : view.status === "REVISION" ? `${view.contractor}, a revised price, please` : `${view.contractor}, could you quote this?`}
        </h1>
        <p className="by-sub">
          {asking && view.status !== "REVISION" ? `${view.replyBy ? `Please reply by ${longDay(view.replyBy)}. ` : ""}Your price, all in, with your estimate attached if you have one, and a note if something needs saying. No sign-in needed.` : null}
          {asking && view.status === "REVISION" ? "Your earlier price stays on file; the new one is a new version." : null}
          {awarded ? "When the work is done, send your invoice here: the amount and a link to the document if you have one." : null}
          {view.paid ? `${view.company} has marked your invoice paid.` : null}
          {view.closed && !view.paid ? (view.status === "DECLINED" ? "Thank you for your reply." : view.status === "CANCELLED" ? `${view.company} withdrew this request.` : "This request has closed.") : null}
        </p>
      </div>

      {view.revisionNote ? (
        <p className="by-note" data-quote-revision>
          <b>{view.company} asks:</b> {view.revisionNote}
        </p>
      ) : null}

      <ul className="qt-scope">
        <li className="qt-head">{view.title && view.title !== head ? view.title : head}</li>
        {view.stage && view.stage !== head && view.stage !== view.title ? <li className="qt-sub">{view.stage}</li> : null}
        {view.title && view.title !== head ? <li className="qt-sub">{head}</li> : null}
        {lines.map((l, i) => (
          <li key={i} data-quote-scope-line>
            {l.replace(/^-\s*/, "")}
          </li>
        ))}
      </ul>

      {view.description || view.materials || view.labor || dates || view.instructions ? (
        <dl className="qt-meta" data-quote-details>
          {view.description ? (
            <>
              <dt>Details</dt>
              <dd>{view.description}</dd>
            </>
          ) : null}
          {view.materials ? (
            <>
              <dt>Materials</dt>
              <dd>{view.materials}</dd>
            </>
          ) : null}
          {view.labor ? (
            <>
              <dt>Labor</dt>
              <dd>{view.labor}</dd>
            </>
          ) : null}
          {dates ? (
            <>
              <dt>When</dt>
              <dd>{dates}</dd>
            </>
          ) : null}
          {view.instructions ? (
            <>
              <dt>How to quote</dt>
              <dd>{view.instructions}</dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {view.attachments.length ? (
        <div className="qt-files" data-quote-files>
          <p className="by-lab">Files</p>
          <ul>
            {view.attachments.map((a) => (
              <li key={a.id}>
                <a href={a.href} target="_blank" rel="noreferrer" data-quote-file>
                  {a.name}
                </a>
                <span>{a.kind}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.versions.length ? (
        <div className="qt-versions" data-quote-versions>
          <p className="by-lab">Your prices so far</p>
          <ul>
            {view.versions.map((v) => (
              <li key={v.version} data-quote-version>
                <b>V{v.version}</b>
                {v.amount != null ? ` · ${money(v.amount)}` : ""} · {shortDay(v.submittedAt)}
                {v.document ? (
                  <>
                    {" · "}
                    <a href={v.document.href} target="_blank" rel="noreferrer">
                      {v.document.name}
                    </a>
                  </>
                ) : null}
                {v.note ? <span className="qt-vnote">{v.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {done?.kind === "quoted" ? (
        <p className="by-closed" data-quote-done>
          Sent — {view.company} has your price{price.trim() ? ` of ${money(Number(price.replace(/[^\d.]/g, "")))}` : ""}
          {file ? ` and ${file.name}` : ""}
          {done.version ? ` (version ${done.version})` : ""}. They will be in touch.
        </p>
      ) : done?.kind === "passed" ? (
        <p className="by-closed" data-quote-done>
          Noted — thank you for letting {view.company} know.
        </p>
      ) : done?.kind === "invoiced" ? (
        <p className="by-closed" data-quote-done>
          Sent — {view.company} has your invoice{invoice.trim() ? ` for ${money(Number(invoice.replace(/[^\d.]/g, "")))}` : ""}.
        </p>
      ) : asking ? (
        <>
          {view.status === "QUOTED" && view.amount != null ? <p className="by-count">You quoted {money(view.amount)}. A new price is kept as a new version.</p> : null}
          <div className="by-field">
            <span className="by-lab">Your estimate (a PDF or a picture, up to 25 MB)</span>
            <input ref={fileRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-quote-file-input />
            <button type="button" className="qt-file" onClick={() => fileRef.current?.click()} disabled={busy} data-quote-file-pick>
              {file ? `${file.name}${file.size ? ` · ${docSize(file.size)}` : ""} — change` : "Attach your estimate"}
            </button>
            {pct != null ? (
              <div className="qt-progress" aria-label="Uploading">
                <i style={{ width: `${pct}%` }} />
              </div>
            ) : null}
          </div>
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
            {busy ? (pct != null ? `Uploading… ${pct}%` : "Sending…") : "Send my price"}
          </button>
          <p className="by-foot">
            Not for you this time?{" "}
            <button type="button" className="qt-pass" onClick={() => void sendPrice(true)} disabled={busy} data-quote-pass>
              Pass on it
            </button>
            {view.phone ? ` · Questions: ${view.phone}` : ""}
          </p>
        </>
      ) : awarded && view.contractLink ? (
        // Part 5a: with a signed subcontract, invoices go on its page — the payment they bill, the PDF, the waivers.
        <p className="by-closed" data-quote-contract-link>
          Your subcontract is signed — send your invoices from its page, where each one is tied to a payment of the schedule:{" "}
          <a href={view.contractLink} style={{ fontWeight: 700, textDecoration: "underline" }}>
            open your subcontract
          </a>
          .
        </p>
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
