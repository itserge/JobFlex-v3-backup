"use client";
// SUBCONTRACTORS — the card (2026-11-07, part 2 of the plan "Projects: Remodel and New construction"; grown
// 2026-11-08 by part 1 of the subcontractors plan). On the desktop and the handheld project page: the quotes by
// stage — who was sent the request, who opened it, who answered with what (every price a version, the estimate
// opened in the viewer), against the stage's share of the Subcontractors budget, the lowest marked, over-budget
// flagged, the awarded one leading — with Award / Revision / Decline / Their estimate / Mark paid / Copy link /
// Resend. "Request quotes" is the request sheet (./request-sheet). Open Subcontractors leads to the project's own
// section with the directory, the requests, Quotes & Proposals and the history. Every write is actions/projectSubs
// (estimators and managers); everyone else reads the card. The contractor's own page is /q/<token>.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { addQuoteVersion, awardProjectQuote, declineProjectQuote, draftSubcontract, markProjectQuotePaid, requestQuoteRevision, resendProjectQuote } from "@/actions/projectSubs";
import { CONTRACT_LABEL, contractNo, contractStatusOf } from "@/lib/subContracts/shared";
import { DocViewer, type ViewerDoc } from "@/components/v3/docs/doc-viewer";
import { QuoteReadPanel } from "@/components/v3/docs/quote-read-panel";
import type { PdStage, PdSubs } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { QUOTE_LABEL, dollars, quoteStatusOf } from "@/lib/projectSubs/shared";
import { REVIEW_LABEL, awardWarning, reviewStatusOf } from "@/lib/subQuotes/shared";
import { DOC_ACCEPT, docSize } from "@/lib/subDocs/shared";
import { DocUploadError, uploadSubDocument } from "@/lib/subDocs/client";
import { RequestSheet, newRequestDraft, type RequestDraft } from "./request-sheet";
import s from "./project-hub.module.css";

type QuoteRow = PdSubs["quotes"][number];
type ContractorRow = PdSubs["contractors"][number];

const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The invoice link's words: the file's name when the URL ends in one ("ridge-1041.pdf"), else "open it". */
function invoiceFileName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return last && last.length <= 48 && /\.[a-z0-9]{2,5}$/i.test(last) ? last : "open it";
  } catch {
    return "open it";
  }
}

/** A version's document as the viewer takes it. */
export function viewerDocOf(v: QuoteRow["versions"][number], who: string): ViewerDoc | null {
  if (!v.document) return null;
  return { id: v.document.id, name: v.document.name, href: `/api/subs/doc/${v.document.id}`, contentType: v.document.contentType, downloadHref: `/api/subs/doc/${v.document.id}?download=1`, meta: `${who} · V${v.version} · ${longDay(v.submittedAt)}${v.document.bytes ? ` · ${docSize(v.document.bytes)}` : ""}` };
}

/** The status line of a quote row, with its version and document. */
export function quoteTag(q: QuoteRow): string {
  const st = quoteStatusOf(q.status);
  const vs = q.versions.length > 1 ? ` · V${q.versions.length}` : "";
  const doc = q.versions.some((v) => v.document) ? " · PDF" : "";
  if (st === "ASKED") return q.overdue ? `Overdue — sent for ${q.dueBy ? longDay(q.dueBy) : "a reply"}` : `Sent${q.dueBy ? ` · reply by ${longDay(q.dueBy)}` : ""}`;
  if (st === "VIEWED") return q.overdue ? `Viewed, overdue — reply was due ${q.dueBy ? longDay(q.dueBy) : ""}` : `Viewed${q.viewedAt ? ` ${longDay(q.viewedAt)}` : ""}${q.dueBy ? ` · reply by ${longDay(q.dueBy)}` : ""}`;
  // Part 2: a quote that came by email carries its document and no typed price — the AI's read waits for a person.
  if (st === "QUOTED") return q.amount == null ? `Quoted · price to confirm${vs}${doc}` : `Quoted ${dollars(q.amount)}${vs}${doc}${q.best ? " · lowest" : ""}${q.over && q.overBy != null ? ` · ${dollars(q.overBy)} over the line` : ""}`;
  if (st === "REVISION") return `Revision asked${q.amount != null ? ` · was ${dollars(q.amount)}` : ""}${vs}`;
  if (st === "AWARDED") return `Awarded${q.amount != null ? ` · ${dollars(q.amount)}` : ""}${vs} · waiting for the invoice`;
  if (st === "INVOICED") return `Invoice in · ${q.invoiceAmount != null ? dollars(q.invoiceAmount) : ""}${q.amount != null && q.invoiceAmount != null && q.invoiceAmount > q.amount ? ` (quoted ${dollars(q.amount)})` : ""}`;
  if (st === "PAID") return `Paid${q.invoiceAmount != null ? ` · ${dollars(q.invoiceAmount)}` : ""}`;
  if (st === "DECLINED") return `Declined${q.declineReason ? ` — ${q.declineReason}` : ""}`;
  return QUOTE_LABEL[st];
}

export function quoteTone(q: QuoteRow): string {
  const st = quoteStatusOf(q.status);
  if (st === "PAID" || st === "AWARDED") return s.tagIn;
  if (q.overdue || (st === "QUOTED" && q.over)) return s.tagLate;
  if (st === "REVISION" || st === "VIEWED") return s.tagOrdered;
  return "";
}

export function ProjectSubsCard({ projectId, subs, stages, canManage, sectionHref, onOpenContract, onOpenInvoices }: { projectId: string; subs: PdSubs; stages: PdStage[]; canManage: boolean; sectionHref?: string | null; onOpenContract?: (contractId: string) => void; onOpenInvoices?: () => void }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<RequestDraft | null>(null);
  const [paying, setPaying] = useState<Record<string, string>>({});
  const [revising, setRevising] = useState<{ id: string; note: string } | null>(null);
  const [uploadFor, setUploadFor] = useState<{ id: string; amount: string; pct: number | null } | null>(null);
  // The viewer opens a version's document with "What the AI read" beside it (part 2); the version is looked up on
  // every render so the panel follows a refresh.
  const [viewing, setViewing] = useState<{ doc: ViewerDoc; versionId: string } | null>(null);
  const [awarding, setAwarding] = useState<string | null>(null);
  const [contractors, setContractors] = useState<ContractorRow[]>(subs.contractors);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const viewingVersion = viewing ? (subs.quotes.flatMap((q) => q.versions).find((v) => v.id === viewing.versionId) ?? null) : null;

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") setNote(words);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  // The quotes by stage, in the stages' order, the project-wide ones last.
  const groups = useMemo(() => {
    const byStage = new Map<string | null, QuoteRow[]>();
    for (const q of subs.quotes) byStage.set(q.stageId, [...(byStage.get(q.stageId) ?? []), q]);
    const order = [...stages.map((st) => st.id), null];
    return order.filter((id) => byStage.has(id)).map((id) => ({ stageId: id, stageName: id ? (stages.find((st) => st.id === id)?.name ?? byStage.get(id)![0].stageName ?? "Stage") : "The project", quotes: byStage.get(id)! }));
  }, [subs.quotes, stages]);
  const open = subs.quotes.filter((q) => ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED", "INVOICED"].includes(q.status));
  const quoted = subs.quotes.filter((q) => q.status === "QUOTED");
  const overdue = subs.quotes.filter((q) => q.overdue);

  async function uploadEstimate(q: QuoteRow, file: File) {
    const amount = Number((uploadFor?.amount ?? "").replace(/[^\d.]/g, ""));
    await run(`upload:${q.id}`, async () => {
      try {
        const up = await uploadSubDocument({ kind: "office", projectId }, file, (pct) => setUploadFor((cur) => (cur ? { ...cur, pct } : cur)));
        const v = await addQuoteVersion({ quoteId: q.id, amount: Number.isFinite(amount) && amount > 0 ? amount : null, note: null, file: { url: up.url, name: up.name, contentType: up.contentType, bytes: up.bytes } });
        setUploadFor(null);
        return `${q.contractorName}'s estimate kept as V${v.version}${v.amount != null ? ` (${dollars(v.amount)})` : ""}.`;
      } catch (err) {
        if (err instanceof DocUploadError) throw new Error(err.message);
        throw err;
      } finally {
        if (fileRef.current) fileRef.current.value = "";
      }
    });
  }

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Subcontractors" data-project-subs>
        <div className={s.head}>
          <h3 className={s.title}>Subcontractors</h3>
          <span className={s.headSub}>
            {subs.quotes.length ? (
              <>
                <b>{open.length}</b> open{quoted.length ? ` · ${quoted.length} quoted` : ""}{overdue.length ? ` · ${overdue.length} overdue` : ""}
                {subs.subsBudget != null ? ` · subs budget ${dollars(subs.subsBudget)}` : ""}
              </>
            ) : (
              "Send a request for quotes on a stage; every estimate is kept, the lowest and the budget line are marked when the prices come in"
            )}
          </span>
          <div className={s.acts}>
            {sectionHref ? (
              <a className={s.btnSm} href={sectionHref} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }} data-subs-open-section>
                Open Subcontractors
              </a>
            ) : null}
            {canManage ? (
              <button type="button" className={s.btnSm} disabled={busy !== null || !stages.length} onClick={() => { setNote(null); setAsk(newRequestDraft(stages, stages[0]?.id ?? "")); }} data-subs-ask>
                Request quotes
              </button>
            ) : null}
          </div>
        </div>
        {!stages.length ? <p className={s.empty}>Add the stages first — a quote is asked for a stage&apos;s work.</p> : null}
        {note ? (
          <p className={s.note} role="status" data-subs-note>
            {note}
          </p>
        ) : null}
        {groups.map((g) => {
          const line = g.quotes[0]?.line ?? null;
          return (
            <div key={g.stageId ?? "project"} className={s.group} data-subs-stage>
              <div className={s.groupHead}>
                <b>{g.stageName}</b>
                {line != null ? <span>budget share {dollars(line)}</span> : subs.subsBudget == null ? <span>no subs budget to compare against</span> : null}
              </div>
              {g.quotes.map((q) => (
                <div key={q.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-subs-quote data-subs-status={q.status} data-subs-versions={q.versions.length}>
                  <div>
                    <div className={s.lineName} style={{ fontWeight: 600 }}>
                      {q.contractorName}
                      {q.contractorTrade ? <span className={s.qty}> · {q.contractorTrade}</span> : null}
                      {q.requestNumber ? <span className={s.qty}> · RFQ-{q.requestNumber}</span> : null}
                    </div>
                    <div>
                      <span className={`${s.tag} ${quoteTone(q)}`} data-subs-tag>
                        {quoteTag(q)}
                      </span>
                    </div>
                    {q.note ? <div style={{ fontSize: 13 }}>{q.note}</div> : null}
                    {q.versions.length ? (
                      <div style={{ fontSize: 12.5, marginTop: 4, display: "grid", gap: 2 }} data-subs-versions-list>
                        {q.versions.map((v) => (
                          <div key={v.id} className={s.lineSub} data-subs-version data-subs-version-n={v.version} data-subs-read-status={v.reviewStatus}>
                            V{v.version}
                            {v.amount != null ? ` · ${dollars(v.amount)}` : ""} · {longDay(v.submittedAt)}
                            {v.source === "UPLOAD" ? " · by the office" : v.source === "EMAIL" ? " · by email" : ""}
                            {v.approved ? " · approved" : ""}
                            {v.document ? (
                              <>
                                {" · "}
                                <button type="button" className={s.link} style={{ textDecoration: "underline", background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit" }} onClick={() => { const d = viewerDocOf(v, q.contractorName); if (d) setViewing({ doc: d, versionId: v.id }); }} data-subs-open-doc>
                                  {v.document.name}
                                </button>
                              </>
                            ) : null}
                            {v.document && v.reviewStatus !== "NONE" ? ` · ${REVIEW_LABEL[reviewStatusOf(v.reviewStatus)]}` : ""}
                            {v.read?.read.total.value != null && v.amount == null ? ` · read ${dollars(v.read.read.total.value)}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {q.invoiceUrl && /^https?:\/\//i.test(q.invoiceUrl) ? (
                      <div style={{ fontSize: 13 }}>
                        Invoice:{" "}
                        <a className={s.link} href={q.invoiceUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
                          {invoiceFileName(q.invoiceUrl)}
                        </a>
                      </div>
                    ) : null}
                    {canManage ? (
                      <div className={s.stageActs} style={{ justifyContent: "flex-start", flexWrap: "wrap" }}>
                        {q.status === "QUOTED" ? (
                          <button
                            type="button"
                            className={s.btnPrimary}
                            style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }}
                            disabled={busy !== null || q.amount == null}
                            title={q.amount == null ? "Confirm the price first — open the estimate and use the AI's read, or type it with Their estimate…" : undefined}
                            onClick={() => {
                              // Part 2: over the stage's share, the warning comes first and the award waits for a second press.
                              if (awardWarning(q.amount, q.line, g.stageName)) setAwarding(q.id);
                              else void run(`award:${q.id}`, async () => { await awardProjectQuote(q.id); return `${g.stageName} awarded to ${q.contractorName}; the others were told.`; });
                            }}
                            data-subs-award
                          >
                            Award
                          </button>
                        ) : null}
                        {awarding === q.id ? (
                          <span className={s.note} style={{ marginTop: 0, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-subs-award-warning>
                            {awardWarning(q.amount, q.line, g.stageName)}
                            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => { setAwarding(null); void run(`award:${q.id}`, async () => { await awardProjectQuote(q.id); return `${g.stageName} awarded to ${q.contractorName} over the share; the others were told.`; }); }} data-subs-award-anyway>
                              Award anyway
                            </button>
                            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setAwarding(null)}>
                              Cancel
                            </button>
                          </span>
                        ) : null}
                        {q.status === "QUOTED" ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setRevising({ id: q.id, note: "" })} data-subs-revise>
                            Ask for a revision
                          </button>
                        ) : null}
                        {["ASKED", "VIEWED", "QUOTED", "REVISION"].includes(q.status) ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`decline:${q.id}`, async () => { await declineProjectQuote(q.id, null); return null; })} data-subs-decline>
                            Decline
                          </button>
                        ) : null}
                        {["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED"].includes(q.status) ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setUploadFor({ id: q.id, amount: "", pct: null })} data-subs-upload>
                            Their estimate…
                          </button>
                        ) : null}
                        {(q.status === "AWARDED" || q.status === "INVOICED") && !q.contract ? (
                          // Part 4: the award's next step — the agreement drafted from this quote, opened in the Contracts tab.
                          <button
                            type="button"
                            className={s.btnPrimary}
                            style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }}
                            disabled={busy !== null || q.amount == null}
                            onClick={() =>
                              void run(`contract:${q.id}`, async () => {
                                const row = await draftSubcontract(q.id);
                                if (onOpenContract) onOpenContract(row.id);
                                else if (sectionHref) router.push(`${sectionHref}?tab=contracts&contract=${row.id}` as Route);
                                return `Subcontract ${contractNo(row.number)} drafted from ${q.contractorName}'s quote — check it, then sign and send.`;
                              })
                            }
                            data-subs-draft-contract
                          >
                            {busy === `contract:${q.id}` ? "Drafting…" : "Draft the contract"}
                          </button>
                        ) : null}
                        {q.contract ? (
                          <button
                            type="button"
                            className={s.btnSm}
                            onClick={() => {
                              if (onOpenContract) onOpenContract(q.contract!.id);
                              else if (sectionHref) router.push(`${sectionHref}?tab=contracts&contract=${q.contract!.id}` as Route);
                            }}
                            data-subs-open-contract
                          >
                            {contractNo(q.contract.number)} · {CONTRACT_LABEL[contractStatusOf(q.contract.status)]}
                          </button>
                        ) : null}
                        {q.invoiceCount > 0 || q.paidOut > 0 ? (
                          // Part 5a: invoiced work is paid on its invoices — the Invoices tab, not a lump "paid" here.
                          <button
                            type="button"
                            className={s.btnSm}
                            onClick={() => {
                              if (onOpenInvoices) onOpenInvoices();
                              else if (sectionHref) router.push(`${sectionHref}?tab=invoices` as Route);
                            }}
                            data-subs-open-invoices
                          >
                            {q.invoiceCount} invoice{q.invoiceCount === 1 ? "" : "s"}
                            {q.paidOut > 0 ? ` · ${dollars(q.paidOut)} paid` : ""}
                          </button>
                        ) : null}
                        {(q.status === "AWARDED" || q.status === "INVOICED") && !q.contract && q.invoiceCount === 0 && q.paidOut === 0 ? (
                          <>
                            <input className={s.input} inputMode="decimal" style={{ width: 110 }} value={paying[q.id] ?? String(q.invoiceAmount ?? q.amount ?? "")} onChange={(e) => setPaying((cur) => ({ ...cur, [q.id]: e.target.value }))} aria-label={`Paid to ${q.contractorName}`} data-subs-paid />
                            <button
                              type="button"
                              className={s.btnSm}
                              disabled={busy !== null}
                              onClick={() =>
                                void run(`paid:${q.id}`, async () => {
                                  const n = Number((paying[q.id] ?? String(q.invoiceAmount ?? q.amount ?? "")).replace(/[^\d.]/g, ""));
                                  await markProjectQuotePaid({ quoteId: q.id, amount: Number.isFinite(n) && n > 0 ? n : null });
                                  return `${q.contractorName} marked paid — a Subcontractors expense is on the project.`;
                                })
                              }
                              data-subs-mark-paid
                            >
                              Mark paid
                            </button>
                          </>
                        ) : null}
                        {!["DECLINED", "PAID", "EXPIRED", "CANCELLED"].includes(q.status) ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`resend:${q.id}`, async () => { const r = await resendProjectQuote(q.id); return r.text === "sent" || r.email === "sent" ? `Sent to ${q.contractorName} again.` : `${q.contractorName} has no phone or email on file — copy the link.`; })} data-subs-resend>
                            Resend
                          </button>
                        ) : null}
                        {!["DECLINED", "PAID", "EXPIRED", "CANCELLED"].includes(q.status) ? <span className={s.link} data-subs-link>{q.link}</span> : null}
                        <button type="button" className={s.btnSm} onClick={() => void navigator.clipboard?.writeText(q.link).then(() => setNote("Link copied."))} data-subs-copy>
                          Copy link
                        </button>
                      </div>
                    ) : null}
                    {revising?.id === q.id ? (
                      <div className={s.form} style={{ marginTop: 8 }} data-subs-revise-form>
                        <textarea className={s.input} rows={2} maxLength={1000} value={revising.note} onChange={(e) => setRevising({ id: q.id, note: e.target.value })} placeholder="What should change — the scope, the price, the exclusions." data-subs-revise-note />
                        <div className={s.stageActs} style={{ justifyContent: "flex-start" }}>
                          <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void run(`revise:${q.id}`, async () => { const r = await requestQuoteRevision({ quoteId: q.id, note: revising.note.trim() || null }); setRevising(null); return r.email === "sent" || r.text === "sent" ? `${q.contractorName} was asked for a revised quote.` : `Marked for revision — ${q.contractorName} has no phone or email on file, copy the link.`; })} data-subs-revise-send>
                            Send
                          </button>
                          <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setRevising(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {uploadFor?.id === q.id ? (
                      <div className={s.form} style={{ marginTop: 8 }} data-subs-upload-form>
                        <input className={s.input} inputMode="decimal" style={{ width: 140 }} placeholder="Their price ($)" value={uploadFor.amount} onChange={(e) => setUploadFor({ ...uploadFor, amount: e.target.value })} data-subs-upload-amount />
                        <input ref={fileRef} type="file" accept={DOC_ACCEPT} style={{ display: "none" }} onChange={(e) => e.target.files?.[0] && void uploadEstimate(q, e.target.files[0])} data-subs-upload-file />
                        <div className={s.stageActs} style={{ justifyContent: "flex-start" }}>
                          <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => fileRef.current?.click()} data-subs-upload-pick>
                            {busy === `upload:${q.id}` ? `Uploading… ${uploadFor.pct ?? 0}%` : "Pick the PDF or picture"}
                          </button>
                          <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setUploadFor(null)}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <span className={s.qty}>{q.sentAt ? `sent ${longDay(q.sentAt)}` : q.askedAt ? `asked ${longDay(q.askedAt)}` : ""}</span>
                </div>
              ))}
            </div>
          );
        })}
        {subs.quotes.length === 0 && stages.length ? (
          <p className={s.empty} data-subs-empty>
            {contractors.length ? `${contractors.length} contractor${contractors.length === 1 ? "" : "s"} on your list.` : "No contractors on your list yet — add one when you ask."}
          </p>
        ) : null}
      </section>

      <RequestSheet projectId={projectId} draft={ask} setDraft={(fn) => setAsk((cur) => fn(cur))} stages={stages} contractors={contractors} setContractors={(fn) => setContractors((cur) => fn(cur))} files={subs.files} onSent={(words) => { setAsk(null); setNote(words); startTransition(() => router.refresh()); }} onClose={() => setAsk(null)} />
      <DocViewer doc={viewing?.doc ?? null} onClose={() => setViewing(null)} side={viewingVersion ? <QuoteReadPanel version={viewingVersion} canManage={canManage} onChanged={() => startTransition(() => router.refresh())} /> : undefined} />
    </div>
  );
}
