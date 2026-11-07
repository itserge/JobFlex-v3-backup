"use client";

// PASTE OR UPLOAD A BUDGET (owner, 2026-11-07: "someone has already preliminary budget like in a text message or in a
// notes or in a file, or it's was from the bank … make option to upload budget like with the file or paste and you
// would create the rows"). Inside the Budget card's editor: a box to paste into and a file button (CSV, Excel, PDF,
// Word, a photo); the read comes back as rows to check — each one ticked or not, its name and amount editable, a
// note on how it was found or why it is left out, the budget's own total against them. "Use these lines" puts them in
// the editor's fields; nothing is saved until Save budget (lib/projectBudgetImport, lib/projectBudgetRead).

import { useRef, useState } from "react";
import { readProjectBudget } from "@/actions/projectBudget";
import { categoryLabel, isBudgetCategory } from "@/lib/projectBudget";
import { kindFor, ticked, type BudgetRead, type ImportRow } from "@/lib/projectBudgetImport";
import { fileKind, pdfBudget, photoJpeg } from "@/lib/projectBudgetFiles";
import s from "./project-budget-card.module.css";

export type UseRows = (rows: Array<{ kind: string; amount: number }>, mode: "replace" | "add", words: string) => void;

const whole = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const parseMoney = (v: string) => {
  const n = Number(v.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const PLACEHOLDER = `Paste it here — a text message, your notes, a spreadsheet, the bank's budget…

Electrical 12,500
Plumbing 8k
Framing — $22,000
Contingency 10%`;

export function BudgetImport({ projectId, hasFigures, onUse, onClose }: { projectId: string; hasFigures: boolean; onUse: UseRows; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<(BudgetRead & { from: string }) | null>(null);
  const [rows, setRows] = useState<Array<ImportRow & { amountText: string }>>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function show(r: BudgetRead, from: string) {
    if (!r.rows.length) {
      setRead(null);
      setRows([]);
      setError(r.words);
      return;
    }
    setError(null);
    setRead({ ...r, from });
    setRows(r.rows.map((x) => ({ ...x, amountText: String(Math.round(x.amount * 100) / 100) })));
  }

  async function send(form: FormData, from: string, working: string) {
    setBusy(working);
    setError(null);
    try {
      form.set("projectId", projectId);
      form.set("from", from);
      show(await readProjectBudget(form), from);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't read that.");
    } finally {
      setBusy(null);
    }
  }

  function readText() {
    if (!text.trim()) {
      setError("Paste the budget first — or pick a file.");
      return;
    }
    const form = new FormData();
    form.set("text", text);
    void send(form, "what you pasted", "Reading…");
  }

  async function pick(file: File) {
    const form = new FormData();
    const kind = fileKind(file);
    const from = file.name.length > 48 ? `${file.name.slice(0, 45)}…` : file.name;
    try {
      if (kind === "words") {
        const words = await file.text();
        setText(words.slice(0, 60_000));
        form.set("text", words);
      } else if (kind === "office") form.set("file", file);
      else if (kind === "pdf") {
        setBusy("Opening the PDF…");
        const pdf = await pdfBudget(file);
        if (pdf.text) form.set("text", pdf.text);
        pdf.images.forEach((b, i) => form.append("image", b, `page-${i + 1}.jpg`));
      } else if (kind === "picture") {
        setBusy("Opening the photo…");
        form.append("image", await photoJpeg(file), "photo.jpg");
      } else {
        setError("JobFlex reads CSV, Excel, Word, PDF and photos. Paste the budget's words for anything else.");
        return;
      }
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Couldn't open that file.");
      return;
    }
    await send(form, from, kind === "picture" || form.has("image") ? "Reading the picture — up to half a minute…" : "Reading…");
  }

  const edit = (i: number, patch: Partial<ImportRow & { amountText: string }>) => setRows((cur) => cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const live = rows.map((r) => ({ ...r, amount: parseMoney(r.amountText) }));
  const sum = ticked(live);
  const count = live.filter((r) => r.include && r.amount > 0 && r.name.trim()).length;
  const stated = read?.statedTotal ?? null;
  const matches = stated != null && Math.abs(stated - sum) <= Math.max(1, stated * 0.001);

  function use(mode: "replace" | "add") {
    const chosen = live.filter((r) => r.include && r.amount > 0 && r.name.trim()).map((r) => ({ kind: kindFor(r.name.trim()), amount: r.amount }));
    if (!chosen.length) {
      setError("Tick at least one line.");
      return;
    }
    const words = `${count} ${count === 1 ? "line" : "lines"} from ${read?.from ?? "what you pasted"} — ${whole(sum)}${matches ? `, matching the ${whole(stated!)} total on it` : ""}. Check them, then Save budget.`;
    onUse(chosen, mode, words);
  }

  return (
    <div className={s.src} data-budget-import>
      <div className={s.srcHead}>
        <b>Paste or upload a budget</b>
        <button type="button" className={s.linkBtn} onClick={onClose}>
          Back
        </button>
      </div>
      {!read ? (
        <>
          <textarea className={s.paste} value={text} onChange={(e) => setText(e.target.value)} placeholder={PLACEHOLDER} rows={7} aria-label="The budget, pasted" data-budget-paste />
          <div className={s.srcActs}>
            <button type="button" className={s.btnPrimary} disabled={!!busy} onClick={readText} data-budget-read>
              {busy ?? "Read it"}
            </button>
            <button type="button" className={s.btn} disabled={!!busy} onClick={() => fileRef.current?.click()} data-budget-upload>
              Upload a file
            </button>
            <span className={s.srcHint}>CSV, Excel, PDF, Word or a photo of it</span>
            <input
              ref={fileRef}
              type="file"
              hidden
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.docx,.doc,.pdf,.numbers,.pages,image/*"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void pick(f);
              }}
              data-budget-file
            />
          </div>
        </>
      ) : (
        <>
          <div className={`${s.suggest} ${read.rows.some((r) => r.check) ? s.rule : ""}`} data-budget-read-words>
            {read.words}
          </div>
          <div className={s.irows} role="table" aria-label="Lines read from the budget">
            {rows.map((r, i) => (
              <div key={i} className={`${s.irow} ${r.include ? "" : s.irowOff}`} role="row" data-import-row data-include={r.include ? "" : undefined}>
                <input type="checkbox" checked={r.include} onChange={(e) => edit(i, { include: e.target.checked })} aria-label={`Use ${r.name}`} role="cell" />
                <span className={s.iname} role="cell">
                  <input value={r.name} maxLength={40} onChange={(e) => edit(i, { name: e.target.value })} aria-label="Name" />
                  {isBudgetCategory(kindFor(r.name)) && kindFor(r.name) !== r.name ? <i className={s.ikind}>→ {categoryLabel(kindFor(r.name))}</i> : null}
                  {r.note ? <small className={r.check ? s.warnText : ""}>{r.note}</small> : r.check ? <small className={s.warnText}>Not in it as written — check it.</small> : null}
                </span>
                <span className={`${s.moneyIn} ${s.iamt} ${r.check ? s.icheck : ""}`} role="cell">
                  <span aria-hidden="true">$</span>
                  <input inputMode="decimal" value={r.amountText} onChange={(e) => edit(i, { amountText: e.target.value.replace(/[^\d.,]/g, "") })} aria-label={`${r.name} amount`} />
                </span>
              </div>
            ))}
          </div>
          <div className={s.srcActs}>
            <span className={s.total}>
              {count} {count === 1 ? "line" : "lines"} · <b>{whole(sum)}</b>
              {stated != null ? <> · {matches ? <span className={s.okText}>matches the {whole(stated)} total</span> : <span className={s.warnText}>the total on it says {whole(stated)}</span>}</> : null}
            </span>
            <button type="button" className={s.btn} onClick={() => { setRead(null); setRows([]); }} disabled={!!busy}>
              Read another
            </button>
            {hasFigures ? (
              <button type="button" className={s.btn} onClick={() => use("add")} data-import-add>
                Add to the budget
              </button>
            ) : null}
            <button type="button" className={s.btnPrimary} onClick={() => use("replace")} data-import-use>
              {hasFigures ? "Replace the budget" : "Use these lines"}
            </button>
          </div>
        </>
      )}
      {error ? (
        <div className={s.err} role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
