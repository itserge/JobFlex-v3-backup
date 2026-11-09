"use client";
// THE CONTRACTS TAB (2026-11-08, the subcontractors plan, part 4): the project's subcontracts as a hub card — the
// awarded quotes still without one (Draft the contract), then each contract with its number, the sub, the total and
// its state in words — and one BlueprintSheet per contract. A draft is the form: the title, the price, the scope, the
// dates, the payment schedule (name, share, due day), the files the sub sees, the terms; Save, Preview the sub's
// page, and "Sign and send" (the sender's typed name is the company's signature). A sent one shows the link, Resend
// and Cancel; a signed one both signatures, the signed PDF in the viewer, and the change orders — propose one (the
// over-the-share warning before Send), approve one in person, withdraw one. Every write is actions/projectSubs.

import { useMemo, useState } from "react";
import {
  cancelSubcontract,
  decideSubcontractChange,
  draftSubcontract,
  proposeSubcontractChange,
  rebuildSubcontractPdf,
  resendSubcontract,
  saveSubcontract,
  sendSubcontract,
} from "@/actions/projectSubs";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { DocViewer, type ViewerDoc } from "@/components/v3/docs/doc-viewer";
import type { DocRow, QuoteRow } from "@/lib/projectSubs/server";
import type { ContractRow } from "@/lib/subContracts/server";
import { CHANGE_LABEL, CONTRACT_LABEL, changeNo, changeStatusOf, contractNo, contractStatusOf, milestoneAmounts, milestonesCheck, signatureWords, signedUsd, usd, type Milestone } from "@/lib/subContracts/shared";
import { changeWarning, committedOf } from "@/lib/subQuotes/shared";
import { docSize } from "@/lib/subDocs/shared";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "./subs.module.css";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isoDay = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Draft = { title: string; amount: string; scope: string; startsAt: string; endsAt: string; milestones: Array<{ name: string; pct: string; due: string }>; retainagePct: string; terms: string; attachmentIds: Set<string>; signer: string };

function draftOf(c: ContractRow, signer: string): Draft {
  return {
    title: c.title,
    amount: String(c.amount),
    scope: c.scope,
    startsAt: c.startsAt ?? "",
    endsAt: c.endsAt ?? "",
    milestones: c.milestones.map((m) => ({ name: m.name, pct: String(m.pct), due: m.due ?? "" })),
    retainagePct: c.retainagePct ? String(c.retainagePct) : "",
    terms: c.terms,
    attachmentIds: new Set(c.attachmentIds),
    signer,
  };
}

const num = (v: string) => Number(v.replace(/[^\d.-]/g, ""));
const milestonesOf = (d: Draft): Milestone[] => d.milestones.map((m) => ({ name: m.name.trim(), pct: Math.round(num(m.pct) * 10) / 10, due: /^\d{4}-\d{2}-\d{2}$/.test(m.due) ? m.due : null }));

function tone(status: string): string {
  const st = contractStatusOf(status);
  return st === "EXECUTED" ? s.pillIn : st === "CANCELLED" ? s.pillLate : s.pillWait;
}

export function SubsContracts({ contracts, quotes, documents, canManage, signerName, initialContract, onNote, refresh }: { contracts: ContractRow[]; quotes: QuoteRow[]; documents: DocRow[]; canManage: boolean; signerName: string; initialContract: string | null; onNote: (words: string | null) => void; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialContract);
  const open = contracts.find((c) => c.id === openId) ?? null;
  const waiting = quotes.filter((q) => (q.status === "AWARDED" || q.status === "INVOICED") && !q.contract);
  const signed = contracts.filter((c) => c.status === "EXECUTED").length;
  const out = contracts.filter((c) => c.status === "SENT" || c.status === "VIEWED").length;

  async function draft(q: QuoteRow) {
    setBusy(`draft:${q.id}`);
    onNote(null);
    try {
      const row = await draftSubcontract(q.id);
      setOpenId(row.id);
      onNote(`Subcontract ${contractNo(row.number)} drafted from ${q.contractorName}'s quote — check it, then sign and send.`);
      refresh();
    } catch (err) {
      onNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={h.card} aria-label="Contracts" data-subs-contracts>
      <div className={h.head}>
        <h3 className={h.title}>Contracts</h3>
        <span className={h.headSub}>
          <b>{signed}</b> signed · {out} out for signature{waiting.length ? ` · ${waiting.length} awarded without one` : ""}
        </span>
      </div>
      {waiting.length ? (
        <div className={s.table} data-subs-contracts-waiting>
          {waiting.map((q) => (
            <div key={q.id} className={`${s.row} ${s.waitRow}`} data-subs-contract-waiting data-subs-contract-waiting-sub={q.contractorName}>
              <div className={s.name}>
                {q.contractorName}
                <div className={s.mono}>{q.stageName ?? "The project"} · awarded{q.awardedAt ? ` ${longDay(q.awardedAt)}` : ""}</div>
              </div>
              <div className={s.amt}>{q.amount != null ? usd(q.amount) : "price to confirm"}</div>
              <div className={h.stageActs}>
                {canManage ? (
                  <button type="button" className={h.btnPrimary} disabled={busy !== null || q.amount == null} onClick={() => void draft(q)} data-subs-contract-draft>
                    {busy === `draft:${q.id}` ? "Drafting…" : "Draft the contract"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {contracts.length ? (
        <div className={s.table} style={{ marginTop: waiting.length ? 10 : 0 }} data-subs-contracts-list>
          {contracts.map((c) => (
            <div key={c.id} className={`${s.row} ${s.contractRow}`} data-subs-contract data-subs-contract-no={c.number} data-subs-contract-status={c.status}>
              <div className={s.name}>
                <button type="button" className={s.linkBtn} onClick={() => setOpenId(c.id)} data-subs-contract-open>
                  {contractNo(c.number)} · {c.contractorName}
                </button>
                <div className={s.mono}>{c.title}</div>
              </div>
              <div className={s.amt}>
                {usd(c.total)}
                {c.total !== c.amount ? <div className={s.mono}>{usd(c.amount)} + changes</div> : null}
              </div>
              <div>
                <span className={`${s.pill} ${tone(c.status)}`}>{CONTRACT_LABEL[contractStatusOf(c.status)]}</span>
                <div className={s.muted} style={{ fontSize: 12.5, marginTop: 2 }}>
                  {c.words}
                </div>
              </div>
              <div className={h.stageActs}>
                <button type="button" className={h.btnSm} onClick={() => setOpenId(c.id)} data-subs-contract-open-btn>
                  Open
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : !waiting.length ? (
        <p className={h.empty}>No contracts yet — award a quote, then draft its contract here.</p>
      ) : null}
      <ContractSheet key={open ? `${open.id}:${open.status}` : "none"} contract={open} documents={documents} quotes={quotes} canManage={canManage} signerName={signerName} onClose={() => setOpenId(null)} onNote={onNote} refresh={refresh} />
    </section>
  );
}

function ContractSheet({ contract, documents, quotes, canManage, signerName, onClose, onNote, refresh }: { contract: ContractRow | null; documents: DocRow[]; quotes: QuoteRow[]; canManage: boolean; signerName: string; onClose: () => void; onNote: (w: string | null) => void; refresh: () => void }) {
  // A fresh form per contract and state: the parent keys this sheet on both, so the state starts from the props.
  const [d, setD] = useState<Draft | null>(() => (contract ? draftOf(contract, signerName) : null));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [change, setChange] = useState<{ amount: string; scope: string; reason: string; confirm: boolean }>({ amount: "", scope: "", reason: "", confirm: false });
  const [inPerson, setInPerson] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<ViewerDoc | null>(null);

  const quote = contract ? (quotes.find((q) => q.id === contract.quoteId) ?? null) : null;
  // The stage's share and what is committed on it now, for the change order's warning.
  const stageCommitted = useMemo(() => (quote ? quotes.filter((q) => q.stageId === quote.stageId).reduce((n, q) => n + committedOf(q), 0) : 0), [quote, quotes]);
  const docsForSub = contract ? documents.filter((x) => (x.kind === "QUOTE" || x.kind === "PLAN" || x.kind === "OTHER" || x.kind === "INSURANCE") && (x.contractorId === contract.contractorId || x.contractorId == null || x.kind === "PLAN")) : [];

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

  async function save(): Promise<void> {
    if (!contract || !d) return;
    const ms = milestonesOf(d);
    const why = milestonesCheck(ms);
    if (why) throw new Error(why);
    const amount = num(d.amount);
    if (!(amount > 0)) throw new Error("The price has to be above zero.");
    await saveSubcontract({
      contractId: contract.id,
      title: d.title.trim(),
      amount,
      scope: d.scope,
      startsAt: d.startsAt || null,
      endsAt: d.endsAt || null,
      depositPct: ms[0] && /deposit/i.test(ms[0].name) ? ms[0].pct : null,
      retainagePct: d.retainagePct.trim() ? Math.max(0, Math.min(50, num(d.retainagePct) || 0)) || null : null,
      milestones: ms,
      terms: d.terms,
      attachmentIds: [...d.attachmentIds],
    });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((cur) => (cur ? { ...cur, [k]: v } : cur));
  const st = contract ? contractStatusOf(contract.status) : "DRAFT";
  const editing = Boolean(contract && d && st === "DRAFT" && canManage);
  const sumPct = d ? Math.round(d.milestones.reduce((n, m) => n + (num(m.pct) || 0), 0) * 10) / 10 : 0;
  const delta = num(change.amount);
  const warn = contract && quote && Number.isFinite(delta) && delta > 0 ? changeWarning(delta, quote.line, stageCommitted, quote.stageName ?? "the work") : null;

  return (
    <>
      <BlueprintSheet open={contract !== null} onClose={() => busy === null && onClose()} title={contract ? `Subcontract ${contractNo(contract.number)}` : ""} description={contract ? `${contract.contractorName} · ${contract.stageName ?? contract.projectName} · ${CONTRACT_LABEL[st]}` : undefined} width="min(640px, 100%)">
        {contract && d ? (
          // The hub's scope inside the portalled sheet — an inner wrapper, never on the sheet's own box.
          <div className={h.w}>
            <div className={h.form} data-subs-contract-sheet data-subs-contract-sheet-status={contract.status}>
              {editing ? (
                <>
                  <label className={h.field}>
                    <span className={h.lab}>Title</span>
                    <input className={h.input} value={d.title} maxLength={160} onChange={(e) => set("title", e.target.value)} data-subs-contract-title />
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                    <label className={h.field}>
                      <span className={h.lab}>Price ($)</span>
                      <input className={h.input} inputMode="decimal" value={d.amount} onChange={(e) => set("amount", e.target.value)} data-subs-contract-amount />
                    </label>
                    <label className={h.field}>
                      <span className={h.lab}>Starts</span>
                      <input className={h.input} type="date" value={d.startsAt} onChange={(e) => set("startsAt", e.target.value)} data-subs-contract-starts />
                    </label>
                    <label className={h.field}>
                      <span className={h.lab}>Done by</span>
                      <input className={h.input} type="date" value={d.endsAt} onChange={(e) => set("endsAt", e.target.value)} data-subs-contract-ends />
                    </label>
                  </div>
                  <label className={h.field}>
                    <span className={h.lab}>Scope of work — one line each</span>
                    <textarea className={h.input} rows={6} maxLength={8000} value={d.scope} onChange={(e) => set("scope", e.target.value)} data-subs-contract-scope />
                  </label>
                  <div className={h.field} data-subs-contract-milestones>
                    <span className={h.lab}>Payment schedule · {sumPct}% of 100%</span>
                    {d.milestones.map((m, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) 72px minmax(0,1fr) auto", gap: 6, alignItems: "center" }} data-subs-contract-milestone>
                        <input className={h.input} value={m.name} maxLength={80} aria-label="Payment" onChange={(e) => set("milestones", d.milestones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-subs-contract-milestone-name />
                        <input className={h.input} inputMode="decimal" value={m.pct} aria-label="Share %" onChange={(e) => set("milestones", d.milestones.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} data-subs-contract-milestone-pct />
                        <input className={h.input} type="date" value={m.due} aria-label="Due" onChange={(e) => set("milestones", d.milestones.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
                        <button type="button" className="bps-btn bps-btn--ghost" disabled={d.milestones.length < 2} onClick={() => set("milestones", d.milestones.filter((_, j) => j !== i))} aria-label="Remove the payment">
                          ×
                        </button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <button type="button" className="bps-btn bps-btn--ghost" disabled={d.milestones.length >= 8} onClick={() => set("milestones", [...d.milestones, { name: "", pct: String(Math.max(0, Math.round((100 - sumPct) * 10) / 10)), due: "" }])} data-subs-contract-milestone-add>
                        + Payment
                      </button>
                      <button type="button" className="bps-btn bps-btn--ghost" onClick={() => set("milestones", [{ name: "Deposit, at signing", pct: "20", due: "" }, { name: "Rough-in", pct: "40", due: "" }, { name: "On completion", pct: "40", due: "" }])} data-subs-contract-milestone-preset>
                        Deposit 20 · Rough-in 40 · Completion 40
                      </button>
                      <span className={s.muted} style={{ fontSize: 12.5 }}>
                        {num(d.amount) > 0 ? milestoneAmounts(num(d.amount), milestonesOf(d).filter((m) => m.pct > 0)).map((m) => usd(m.amount)).join(" · ") : ""}
                      </span>
                    </div>
                  </div>
                  <label className={h.field} data-subs-contract-retainage>
                    <span className={h.lab}>Retainage held from each payment (%) — paid with the last; empty for none</span>
                    <input className={h.input} inputMode="decimal" value={d.retainagePct} onChange={(e) => set("retainagePct", e.target.value)} placeholder="e.g. 10" style={{ maxWidth: 160 }} data-subs-contract-retainage-input />
                  </label>
                  <div className={h.field} data-subs-contract-files>
                    <span className={h.lab}>Files the sub sees with it</span>
                    {docsForSub.length ? (
                      <div className={h.checks}>
                        {docsForSub.map((x) => (
                          <label key={x.id} className={h.check}>
                            <input
                              type="checkbox"
                              checked={d.attachmentIds.has(x.id)}
                              onChange={(e) =>
                                setD((cur) => {
                                  if (!cur) return cur;
                                  const next = new Set(cur.attachmentIds);
                                  if (e.target.checked) next.add(x.id);
                                  else next.delete(x.id);
                                  return { ...cur, attachmentIds: next };
                                })
                              }
                            />
                            <span>
                              {x.name}
                              {x.bytes ? ` · ${docSize(x.bytes)}` : ""} · {x.kind === "QUOTE" ? "estimate" : x.kind === "PLAN" ? "drawing" : x.kind.toLowerCase()}
                            </span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className={h.empty}>No documents on the project for this sub.</p>
                    )}
                  </div>
                  <label className={h.field}>
                    <span className={h.lab}>Terms — have your attorney review them once</span>
                    <textarea className={h.input} rows={10} maxLength={20000} value={d.terms} onChange={(e) => set("terms", e.target.value)} data-subs-contract-terms />
                  </label>
                  <label className={h.field}>
                    <span className={h.lab}>Sign for the company — your full name</span>
                    <input className={h.input} value={d.signer} maxLength={120} onChange={(e) => set("signer", e.target.value)} autoComplete="name" data-subs-contract-signer />
                  </label>
                  {err ? <p className={h.err} data-subs-contract-err>{err}</p> : null}
                  <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("save", async () => { await save(); return `Subcontract ${contractNo(contract.number)} saved — still a draft.`; })} data-subs-contract-save>
                      {busy === "save" ? "Saving…" : "Save the draft"}
                    </button>
                    <a className="bps-btn bps-btn--ghost" href={contract.link} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }} data-subs-contract-preview>
                      Preview the sub&apos;s page
                    </a>
                    <button
                      type="button"
                      className="bps-btn bps-btn--primary"
                      disabled={busy !== null || d.signer.trim().length < 2}
                      onClick={() =>
                        void act("send", async () => {
                          await save();
                          const r = await sendSubcontract({ contractId: contract.id, signerName: d.signer.trim() });
                          return r.email === "sent" || r.text === "sent" ? `Subcontract ${contractNo(contract.number)} signed for the company and sent to ${contract.contractorName}.` : r.email === "failed" || r.text === "failed" ? `Subcontract ${contractNo(contract.number)} is signed for the company, but the message to ${contract.contractorName} did not go through — copy the link to them.` : `Subcontract ${contractNo(contract.number)} is ready to sign — ${contract.contractorName} has no email or phone on file, so copy the link to them.`;
                        })
                      }
                      data-subs-contract-send
                    >
                      {busy === "send" ? "Sending…" : "Sign and send"}
                    </button>
                    <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("cancel", async () => { await cancelSubcontract({ contractId: contract.id, reason: null }); onClose(); return `Subcontract ${contractNo(contract.number)} discarded.`; })} data-subs-contract-discard>
                      Discard the draft
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <dl className={s.facts} data-subs-contract-facts>
                    <Fact label="Total" value={`${usd(contract.total)}${contract.total !== contract.amount ? ` (${usd(contract.amount)} + approved changes)` : ""}`} />
                    <Fact label="State" value={contract.words} />
                    {contract.startsAt || contract.endsAt ? <Fact label="Schedule" value={`${contract.startsAt ? `starts ${isoDay(contract.startsAt)}` : ""}${contract.startsAt && contract.endsAt ? " · " : ""}${contract.endsAt ? `done by ${isoDay(contract.endsAt)}` : ""}`} /> : null}
                    <Fact label="Payments" value={`${milestoneAmounts(contract.amount, contract.milestones).map((m) => `${m.name} ${m.pct}% ${usd(m.amount)}`).join(" · ")}${contract.retainagePct ? ` · ${contract.retainagePct}% retainage` : ""}`} />
                    {contract.companySignedName ? <Fact label="For the company" value={`${contract.companySignedName}${contract.companySignedAt ? ` · ${longDay(contract.companySignedAt)}` : ""}`} /> : null}
                    {contract.signedName ? <Fact label="For the sub" value={signatureWords({ signedName: contract.signedName, signedAt: contract.signedAt, signedIp: contract.signedIp }) ?? contract.signedName} /> : null}
                    {contract.cancelledAt ? <Fact label="Cancelled" value={`${longDay(contract.cancelledAt)}${contract.cancelReason ? ` — ${contract.cancelReason}` : ""}`} /> : null}
                  </dl>
                  {st === "SENT" || st === "VIEWED" || st === "EXECUTED" ? (
                    <div className={h.field}>
                      <span className={h.lab}>The sub&apos;s page</span>
                      <span className={s.mono} style={{ overflowWrap: "anywhere" }} data-subs-contract-link>
                        {contract.link}
                      </span>
                    </div>
                  ) : null}
                  {err ? <p className={h.err} data-subs-contract-err>{err}</p> : null}
                  <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                    {contract.pdf ? (
                      <button type="button" className="bps-btn bps-btn--primary" onClick={() => setViewing({ id: contract.pdf!.id, name: contract.pdf!.name, href: `/api/subs/doc/${contract.pdf!.id}`, contentType: "application/pdf", downloadHref: `/api/subs/doc/${contract.pdf!.id}?download=1`, meta: `${contractNo(contract.number)} · signed ${contract.signedAt ? longDay(contract.signedAt) : ""}${contract.pdf!.bytes ? ` · ${docSize(contract.pdf!.bytes)}` : ""}` })} data-subs-contract-pdf>
                        Open the signed PDF
                      </button>
                    ) : st === "EXECUTED" && canManage ? (
                      <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("pdf", async () => { await rebuildSubcontractPdf(contract.id); return "The signed PDF is made."; })} data-subs-contract-pdf-build>
                        {busy === "pdf" ? "Making…" : "Make the signed PDF"}
                      </button>
                    ) : null}
                    {st !== "CANCELLED" ? (
                      <button type="button" className="bps-btn bps-btn--ghost" onClick={() => void navigator.clipboard?.writeText(contract.link).then(() => onNote("Link copied."))} data-subs-contract-copy>
                        Copy link
                      </button>
                    ) : null}
                    {canManage && (st === "SENT" || st === "VIEWED") ? (
                      <>
                        <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act("resend", async () => { const r = await resendSubcontract(contract.id); return r.email === "sent" || r.text === "sent" ? `Sent to ${contract.contractorName} again.` : r.email === "failed" || r.text === "failed" ? `The message to ${contract.contractorName} did not go through — copy the link.` : `${contract.contractorName} has no email or phone on file — copy the link.`; })} data-subs-contract-resend>
                          Resend
                        </button>
                        <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setCancelling("")} data-subs-contract-cancel>
                          Cancel the contract
                        </button>
                      </>
                    ) : null}
                  </div>
                  {cancelling !== null ? (
                    <div className={h.form} data-subs-contract-cancel-form>
                      <input className={h.input} value={cancelling} maxLength={300} onChange={(e) => setCancelling(e.target.value)} placeholder="Why (the sub reads it) — optional" />
                      <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                        <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void act("cancel", async () => { await cancelSubcontract({ contractId: contract.id, reason: cancelling.trim() || null }); setCancelling(null); return `Subcontract ${contractNo(contract.number)} cancelled; ${contract.contractorName} was told.`; })} data-subs-contract-cancel-send>
                          Cancel it and tell the sub
                        </button>
                        <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setCancelling(null)}>
                          Keep it
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {st === "EXECUTED" ? (
                    <div className={h.field} data-subs-contract-changes>
                      <span className={h.lab}>Change orders</span>
                      {contract.changes.length ? (
                        <div className={s.table}>
                          {contract.changes.map((c) => (
                            <div key={c.id} className={s.row} style={{ gridTemplateColumns: "1fr" }} data-subs-change data-subs-change-status={c.status}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                                <span className={s.name}>
                                  {changeNo(c.number)} · {signedUsd(c.amount)}
                                </span>
                                <span className={`${s.pill} ${c.status === "APPROVED" ? s.pillIn : c.status === "PROPOSED" ? s.pillWait : s.pillLate}`}>
                                  {CHANGE_LABEL[changeStatusOf(c.status)]}
                                  {c.decidedName ? ` · ${c.decidedName}` : ""}
                                </span>
                              </div>
                              <div className={s.muted} style={{ fontSize: 13 }}>
                                {c.scope}
                                {c.declineReason ? ` — ${c.declineReason}` : ""}
                              </div>
                              {canManage && c.status === "PROPOSED" ? (
                                <div className={h.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap", marginTop: 6 }}>
                                  <input className={h.input} style={{ minWidth: 0, flex: "1 1 160px" }} value={inPerson[c.id] ?? ""} onChange={(e) => setInPerson((cur) => ({ ...cur, [c.id]: e.target.value }))} placeholder="The sub's name, agreed in person" data-subs-change-inperson-name />
                                  <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null || (inPerson[c.id] ?? "").trim().length < 2} onClick={() => void act(`ok:${c.id}`, async () => { await decideSubcontractChange({ changeId: c.id, approve: true, name: (inPerson[c.id] ?? "").trim(), reason: null }); return `${changeNo(c.number)} approved in person.`; })} data-subs-change-inperson>
                                    Approved in person
                                  </button>
                                  <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void act(`void:${c.id}`, async () => { await decideSubcontractChange({ changeId: c.id, approve: false, name: null, reason: null }); return `${changeNo(c.number)} withdrawn.`; })} data-subs-change-withdraw>
                                    Withdraw
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className={h.empty} style={{ margin: 0 }}>
                          None yet.
                        </p>
                      )}
                      {canManage ? (
                        <div className={h.form} style={{ marginTop: 8 }} data-subs-change-form>
                          <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1fr)", gap: 8 }}>
                            <input className={h.input} inputMode="decimal" value={change.amount} onChange={(e) => setChange((cur) => ({ ...cur, amount: e.target.value, confirm: false }))} placeholder="+ or − $" aria-label="Amount" data-subs-change-amount />
                            <input className={h.input} value={change.scope} maxLength={4000} onChange={(e) => setChange((cur) => ({ ...cur, scope: e.target.value }))} placeholder="What changes — 6 more recessed lights in the den" aria-label="What changes" data-subs-change-scope />
                          </div>
                          <input className={h.input} value={change.reason} maxLength={1000} onChange={(e) => setChange((cur) => ({ ...cur, reason: e.target.value }))} placeholder="Why (optional) — the owner added the den" aria-label="Why" data-subs-change-reason />
                          {warn ? (
                            <p className={h.note} style={{ margin: 0 }} data-subs-change-warning>
                              {warn}
                            </p>
                          ) : null}
                          <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                            <button
                              type="button"
                              className="bps-btn bps-btn--primary"
                              disabled={busy !== null || !Number.isFinite(delta) || delta === 0 || !change.scope.trim()}
                              onClick={() => {
                                // Over the stage's share, the warning shows first and Send waits for a second press.
                                if (warn && !change.confirm) {
                                  setChange((cur) => ({ ...cur, confirm: true }));
                                  return;
                                }
                                void act("change", async () => {
                                  const r = await proposeSubcontractChange({ contractId: contract.id, amount: delta, scope: change.scope.trim(), reason: change.reason.trim() || null });
                                  setChange({ amount: "", scope: "", reason: "", confirm: false });
                                  return r.email === "sent" || r.text === "sent" ? `${changeNo(r.change.number)} (${signedUsd(r.change.amount)}) sent to ${contract.contractorName} to agree to.` : `${changeNo(r.change.number)} is on the contract — the message to ${contract.contractorName} did not go out, so copy the link to them.`;
                                });
                              }}
                              data-subs-change-send
                            >
                              {busy === "change" ? "Sending…" : warn && change.confirm ? "Send it anyway" : "Propose the change order"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </BlueprintSheet>
      <DocViewer doc={viewing} onClose={() => setViewing(null)} />
    </>
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
