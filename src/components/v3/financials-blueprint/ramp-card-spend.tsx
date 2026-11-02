"use client";
// CARD SPEND FROM RAMP ON THE EXPENSES TAB (2026-10-29): the swipes nobody has placed on a job yet — the office
// picks the job, the warehouse, or leaves it — and the latest ones that landed on their own. Reads through the
// server action once on mount (nothing on the page's own loader), and again after every pick; the page's own
// expense book is refreshed in place (router.refresh) so the note of what just happened stays on screen.
// Round 2: "Split…" books one swipe across jobs (and writes the split back to Ramp); "Vendor bills · Ramp" pays a
// vendor's invoice through Ramp, coded to the job, and lists what JobFlex sent with where each bill stands.
import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createRampBillAction, placeRampTransaction, readRampBillPaySetup, readRampCardSpend, refreshRampBillsAction, splitRampTransactionAction } from "@/actions/ramp";
import type { RampTxRecord } from "@/lib/ramp/sync";
import type { RampBillRecord, RampBillPaySetup } from "@/lib/ramp/bills";
import { splitPlanError } from "@/lib/ramp/shared";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
// Local calendar dates (an evening on the West Coast is not yet tomorrow).
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => ymd(new Date());
const plusDays = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));
const BILL_CATEGORIES = ["Materials", "Subcontractor", "Equipment rental", "Permits", "Disposal", "Tools", "Fuel", "Other"];

type Jobs = ReadonlyArray<{ id: string; title: string }>;
type SplitRow = { key: number; pick: string; amount: string };

export function RampCardSpend({ jobs }: { jobs: Jobs }) {
  const router = useRouter();
  const [state, setState] = useState<{ connected: boolean; needsJob: RampTxRecord[]; recent: RampTxRecord[]; bills: RampBillRecord[]; billsApproved: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");
  const [splitting, setSplitting] = useState<{ txId: string; rows: SplitRow[] } | null>(null);
  const load = useCallback(() => {
    readRampCardSpend()
      .then(setState)
      .catch(() => setState({ connected: false, needsJob: [], recent: [], bills: [], billsApproved: false }));
  }, []);
  useEffect(() => {
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load]);
  if (!state?.connected) return null;

  const place = async (txId: string, pick: string) => {
    setBusy(txId);
    setNote("");
    try {
      const r = await placeRampTransaction({ txId, jobId: pick === "stock" || pick === "none" ? null : pick, stock: pick === "stock", none: pick === "none" });
      if (!r.ok) throw new Error(r.error);
      setNote(`Placed on ${r.where}.`);
      load();
      router.refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not place it.");
    } finally {
      setBusy(null);
    }
  };

  const startSplit = (r: RampTxRecord) => {
    const half = Math.round((r.amount / 2) * 100) / 100;
    setSplitting({ txId: r.txId, rows: [{ key: 1, pick: "", amount: half.toFixed(2) }, { key: 2, pick: "", amount: (Math.round((r.amount - half) * 100) / 100).toFixed(2) }] });
  };
  const splitParts = (rows: SplitRow[]) => rows.map((row) => ({ to: row.pick === "stock" ? ({ kind: "stock" } as const) : ({ kind: "job", jobId: row.pick } as const), amount: Number(row.amount) }));
  const saveSplit = async (total: number) => {
    if (!splitting) return;
    const rows = splitting.rows;
    if (rows.some((row) => !row.pick)) {
      setNote("Every part needs a job (or stock).");
      return;
    }
    const bad = splitPlanError(total, splitParts(rows));
    if (bad) {
      setNote(bad);
      return;
    }
    setBusy(splitting.txId);
    setNote("");
    try {
      const r = await splitRampTransactionAction({ txId: splitting.txId, parts: rows.map((row) => ({ jobId: row.pick === "stock" ? null : row.pick, stock: row.pick === "stock", amount: Number(row.amount) })) });
      if (!r.ok) throw new Error(r.error);
      setNote(`Split: ${r.where}.${r.rampTook ? " Ramp has the same split." : " Ramp did not take the split — the memo there says where it went."}`);
      setSplitting(null);
      load();
      router.refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Could not split it.");
    } finally {
      setBusy(null);
    }
  };

  const openBills = state.bills.filter((b) => !b.expenseId && b.state !== "rejected" && b.state !== "archived");

  return (
    <>
      <div className="card card--table" data-ramp-spend>
        <div className="tb-head">
          <span className="kpi-lbl">Card spend · Ramp</span>
          <span className="tb-total">{state.needsJob.length ? `${state.needsJob.length} waiting for a job` : "every swipe is on a job"}</span>
        </div>
        {note ? <div className="fi-tnote" role="status">{note}</div> : null}
        {state.needsJob.length > 0 && (
          <table className="ptable fi-table" data-ramp-needs>
            <thead>
              <tr>
                <th>Date</th>
                <th>Who</th>
                <th>Where</th>
                <th className="num">Amount</th>
                <th>Put it on</th>
              </tr>
            </thead>
            <tbody>
              {state.needsJob.map((r) => {
                const partsBooked = r.parts?.length ?? 0;
                const open = partsBooked ? (r.remainder ?? 0) : r.amount;
                const editing = splitting?.txId === r.txId;
                const rows = editing && splitting ? splitting.rows : [];
                const sum = Math.round(rows.reduce((a, row) => a + (Number(row.amount) || 0), 0) * 100) / 100;
                return (
                  <Fragment key={r.txId}>
                    <tr data-ramp-tx={r.txId}>
                      <td>{day(r.at)}</td>
                      <td>{r.who || "—"}{r.askedAt ? <span className="pmuted"> · asked by text</span> : null}</td>
                      <td>{r.merchant}<span className="pmuted"> · {r.category}{partsBooked ? ` · rest of a split (${partsBooked} part${partsBooked > 1 ? "s" : ""} on jobs)` : ""}</span></td>
                      <td className="num">{money(open)}</td>
                      <td>
                        <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <select className="pselect" aria-label={`Job for ${r.merchant}`} disabled={busy === r.txId || editing} defaultValue="" onChange={(e) => { if (e.target.value) void place(r.txId, e.target.value); }} data-ramp-pick>
                            <option value="">Pick a job…</option>
                            {jobs.map((j) => (
                              <option key={j.id} value={j.id}>{j.title}</option>
                            ))}
                            <option value="stock">Stock / warehouse</option>
                            <option value="none">Leave it off the jobs</option>
                          </select>
                          {!partsBooked && !editing && (
                            <button className="btn btn-ghost btn--sm" type="button" disabled={busy === r.txId} onClick={() => startSplit(r)} data-ramp-split>Split…</button>
                          )}
                        </span>
                      </td>
                    </tr>
                    {editing && (
                      <tr data-ramp-split-editor>
                        <td colSpan={5}>
                          <div style={{ display: "grid", gap: 8, padding: "6px 0 10px" }}>
                            <div className="pmuted">Split {money(r.amount)} at {r.merchant} across jobs. Each part gets its own expense line; Ramp gets the same split.</div>
                            {rows.map((row, idx) => (
                              <div key={row.key} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <select className="pselect" aria-label={`Part ${idx + 1} job`} value={row.pick} onChange={(e) => setSplitting((s) => s && { ...s, rows: s.rows.map((x) => (x.key === row.key ? { ...x, pick: e.target.value } : x)) })} data-ramp-split-pick>
                                  <option value="">Job…</option>
                                  {jobs.map((j) => (
                                    <option key={j.id} value={j.id}>{j.title}</option>
                                  ))}
                                  <option value="stock">Stock / warehouse</option>
                                </select>
                                <input className="pinput" type="number" step="0.01" inputMode="decimal" aria-label={`Part ${idx + 1} amount`} value={row.amount} style={{ width: 120 }} onChange={(e) => setSplitting((s) => s && { ...s, rows: s.rows.map((x) => (x.key === row.key ? { ...x, amount: e.target.value } : x)) })} data-ramp-split-amount />
                                {rows.length > 2 && (
                                  <button className="btn btn-ghost btn--sm" type="button" aria-label={`Remove part ${idx + 1}`} onClick={() => setSplitting((s) => s && { ...s, rows: s.rows.filter((x) => x.key !== row.key) })}>×</button>
                                )}
                              </div>
                            ))}
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <button className="btn btn-ghost btn--sm" type="button" onClick={() => setSplitting((s) => s && { ...s, rows: [...s.rows, { key: Date.now(), pick: "", amount: Math.max(0, Math.round((r.amount - sum) * 100) / 100).toFixed(2) }] })}>Add a part</button>
                              <span className="pmuted" data-ramp-split-left>{Math.abs(r.amount - sum) < 0.005 ? "Adds up." : `${money(r.amount - sum)} left to place`}</span>
                              <span style={{ flex: 1 }} />
                              <button className="btn btn-ghost btn--sm" type="button" onClick={() => setSplitting(null)}>Cancel</button>
                              <button className="btn btn-primary btn--sm" type="button" disabled={busy === r.txId} onClick={() => void saveSplit(r.amount)} data-ramp-split-save>{busy === r.txId ? "Splitting…" : "Split it"}</button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
        {state.recent.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary className="pmuted">Latest swipes on jobs · {state.recent.length}</summary>
            <table className="ptable fi-table" data-ramp-recent>
              <tbody>
                {state.recent.slice(0, 12).map((r) => (
                  <tr key={r.txId}>
                    <td>{day(r.at)}</td>
                    <td>{r.who || "—"}</td>
                    <td>{r.merchant}</td>
                    <td>
                      {r.parts && r.parts.length > 1 ? r.parts.map((p) => `${p.stock ? "Stock" : p.jobTitle} ${money(p.amount)}`).join(" · ") : r.stock ? "Stock" : r.jobTitle}
                      {r.receiptDone ? <span className="pmuted"> · receipt</span> : null}
                    </td>
                    <td className="num">{money(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </div>
      <RampBills jobs={jobs} bills={state.bills} openCount={openBills.length} billsApproved={state.billsApproved} onChanged={() => { load(); router.refresh(); }} />
    </>
  );
}

/* ── vendor bills through Ramp ─────────────────────────────────────────── */

type BillForm = { vendorId: string; vendorName: string; vendorEmail: string; invoiceNumber: string; amount: string; issuedAt: string; dueAt: string; job: string; category: string; memo: string; file: { dataUrl: string; filename: string } | null };
const EMPTY_BILL = (): BillForm => ({ vendorId: "", vendorName: "", vendorEmail: "", invoiceNumber: "", amount: "", issuedAt: today(), dueAt: plusDays(30), job: "", category: "Materials", memo: "", file: null });

function RampBills({ jobs, bills, openCount, billsApproved, onChanged }: { jobs: Jobs; bills: RampBillRecord[]; openCount: number; billsApproved: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<RampBillPaySetup | null>(null);
  const [form, setForm] = useState<BillForm>(EMPTY_BILL);
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [note, setNote] = useState("");
  const set = <K extends keyof BillForm>(k: K, v: BillForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const openForm = () => {
    setOpen(true);
    setNote("");
    if (!setup) readRampBillPaySetup().then(setSetup).catch(() => setSetup({ ready: false, why: "Could not reach Ramp.", entityName: "", billsApproved, vendors: [] }));
  };
  const pickFile = (file: File | null) => {
    if (!file) return set("file", null);
    if (file.size > 10 * 1024 * 1024) return setNote("The invoice file is over 10 MB.");
    const reader = new FileReader();
    reader.onload = () => set("file", { dataUrl: String(reader.result ?? ""), filename: file.name });
    reader.readAsDataURL(file);
  };
  const send = async () => {
    setBusy("send");
    setNote("");
    try {
      const r = await createRampBillAction({
        vendorId: form.vendorId && form.vendorId !== "new" ? form.vendorId : null,
        vendorName: form.vendorId === "new" ? form.vendorName : null,
        vendorEmail: form.vendorId === "new" ? form.vendorEmail : null,
        invoiceNumber: form.invoiceNumber,
        amount: Number(form.amount),
        issuedAt: form.issuedAt,
        dueAt: form.dueAt,
        memo: form.memo,
        category: form.category,
        jobId: form.job && form.job !== "stock" && form.job !== "company" ? form.job : null,
        stock: form.job === "stock",
        invoice: form.file,
      });
      if (!r.ok) throw new Error(r.error);
      setNote(`${r.bill.stateWords}: ${money(r.bill.amount)} to ${r.bill.vendorName} (#${r.bill.invoiceNumber}).${r.warning ? ` ${r.warning}` : ""}`);
      setForm(EMPTY_BILL());
      setOpen(false);
      onChanged();
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Ramp did not take the bill.");
    } finally {
      setBusy(null);
    }
  };
  const check = async () => {
    setBusy("check");
    try {
      const r = await refreshRampBillsAction();
      setNote(r.paid ? `${r.paid} bill${r.paid > 1 ? "s" : ""} paid since — on the jobs now.` : "Nothing new from Ramp.");
      onChanged();
    } finally {
      setBusy(null);
    }
  };
  const vendorPicked = form.vendorId && form.vendorId !== "new";

  return (
    <div className="card card--table" data-ramp-bills>
      <div className="tb-head">
        <span className="kpi-lbl">Vendor bills · Ramp</span>
        <span className="tb-total">{openCount ? `${openCount} open` : bills.length ? "all settled" : "none sent yet"}</span>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "4px 0 8px" }}>
        {!open && <button className="btn btn-primary btn--sm" type="button" onClick={openForm} data-ramp-bill-new>Pay a vendor bill</button>}
        {bills.length > 0 && <button className="btn btn-ghost btn--sm" type="button" disabled={busy !== null} onClick={() => void check()} data-ramp-bill-check>{busy === "check" ? "Asking Ramp…" : "Check with Ramp"}</button>}
        <span className="pmuted">{billsApproved ? "Bills go in approved — Ramp pays them on the due date." : "Bills go to Ramp's inbox; someone approves there, Ramp pays."}</span>
      </div>
      {note ? <div className="fi-tnote" role="status" data-ramp-bill-note>{note}</div> : null}
      {open && (
        <div style={{ display: "grid", gap: 10, padding: "4px 0 12px" }} data-ramp-bill-form>
          {setup && !setup.ready && <div className="fi-tnote" role="alert">{setup.why}</div>}
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Vendor</span>
              <select className="pselect" value={form.vendorId} onChange={(e) => set("vendorId", e.target.value)} data-ramp-bill-vendor>
                <option value="">{setup ? "Pick a vendor…" : "Loading vendors…"}</option>
                {(setup?.vendors ?? []).map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
                <option value="new">New vendor…</option>
              </select>
            </label>
            {form.vendorId === "new" && (
              <>
                <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Vendor name</span><input className="pinput" value={form.vendorName} onChange={(e) => set("vendorName", e.target.value)} placeholder="ABC Lumber" data-ramp-bill-vendor-name /></label>
                <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Vendor email (Ramp asks them for bank details)</span><input className="pinput" type="email" value={form.vendorEmail} onChange={(e) => set("vendorEmail", e.target.value)} placeholder="ar@abclumber.com" data-ramp-bill-vendor-email /></label>
              </>
            )}
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Invoice #</span><input className="pinput" value={form.invoiceNumber} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder="INV-1042" data-ramp-bill-invoice /></label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Amount</span><input className="pinput" type="number" step="0.01" min="0" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1250.00" data-ramp-bill-amount /></label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Invoice date</span><input className="pinput" type="date" value={form.issuedAt} onChange={(e) => set("issuedAt", e.target.value)} /></label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Due</span><input className="pinput" type="date" value={form.dueAt} onChange={(e) => set("dueAt", e.target.value)} data-ramp-bill-due /></label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Job</span>
              <select className="pselect" value={form.job} onChange={(e) => set("job", e.target.value)} data-ramp-bill-job>
                <option value="">Pick a job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>{j.title}</option>
                ))}
                <option value="stock">Stock / warehouse</option>
                <option value="company">The company (no job)</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Category</span>
              <select className="pselect" value={form.category} onChange={(e) => set("category", e.target.value)}>
                {BILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}><span className="pmuted">Invoice file (PDF reaches Ramp)</span><input className="pinput" type="file" accept="application/pdf,image/*" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} data-ramp-bill-file /></label>
            <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}><span className="pmuted">Memo</span><input className="pinput" value={form.memo} onChange={(e) => set("memo", e.target.value)} placeholder="Lumber for the Lopez deck" /></label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn--sm" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" disabled={busy !== null || !setup?.ready || (!vendorPicked && form.vendorId !== "new")} onClick={() => void send()} data-ramp-bill-send>
              {busy === "send" ? "Sending to Ramp…" : billsApproved ? "Approve and pay through Ramp" : "Send to Ramp for approval"}
            </button>
          </div>
        </div>
      )}
      {bills.length > 0 && (
        <table className="ptable fi-table" data-ramp-bills-table>
          <thead>
            <tr>
              <th>Sent</th>
              <th>Vendor</th>
              <th>Invoice</th>
              <th>On</th>
              <th className="num">Amount</th>
              <th>Where it stands</th>
            </tr>
          </thead>
          <tbody>
            {bills.slice(0, 20).map((b) => (
              <tr key={b.billId} data-ramp-bill={b.billId}>
                <td>{day(b.createdAt)}</td>
                <td>{b.vendorName}</td>
                <td>#{b.invoiceNumber}<span className="pmuted"> · due {b.dueAt}</span></td>
                <td>{b.stock ? "Stock" : b.jobTitle ?? "Company"}</td>
                <td className="num">{money(b.amount)}</td>
                <td>
                  {b.stateWords}
                  {b.deepLink ? <> · <a href={b.deepLink} target="_blank" rel="noreferrer">Open in Ramp</a></> : null}
                  {b.note ? <span className="pmuted"> · {b.note}</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
