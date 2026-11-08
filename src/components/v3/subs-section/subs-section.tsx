"use client";
// THE SUBCONTRACTORS SECTION (2026-11-08, the subcontractors plan, part 1): a page of its own inside a project,
// reached from the project page's Subcontractors card. One tab strip — Overview · Subs · Requests · Quotes · History
// (Find, Compare, Contracts, Invoices, Payments and Budget arrive with their parts) — each tab a hub card. Overview
// is the figures the prompt asks for and the last moves; Subs is the company's directory (add, edit, the paper on
// file); Requests lists every request with its recipients and their state; Quotes is the project's Subcontractors
// card itself (every version, the viewer, award, revision, mark paid); History is the project's trail filtered to
// subcontractor events. Every write is actions/projectSubs. The same component serves the desk and the phone.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelProjectRequest, compareRequestWords } from "@/actions/projectSubs";
import { COMPARE_FIELDS, REVIEW_LABEL, budgetRows, budgetTotals, compareTable, reviewStatusOf, type CompareIn } from "@/lib/subQuotes/shared";
import { ProjectSubsCard } from "@/components/v3/project-links/project-subs-card";
import { RequestSheet, newRequestDraft, type RequestDraft } from "@/components/v3/project-links/request-sheet";
import type { ContractorRow, DocRow } from "@/lib/projectSubs/server";
import { QUOTE_LABEL, contractorFlags, dollars, insuranceWords, quoteStatusOf, requestNo, tradeForStage } from "@/lib/projectSubs/shared";
import { SubsFind } from "./subs-find";
import type { SubsSectionRead } from "./subs-section-load";
import { ContractorSheet, draftOf, type ContractorDraft } from "./contractor-sheet";
import { SUBS_TABS as TABS, type SubsTab } from "./subs-tabs";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "./subs.module.css";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const isoShort = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const money = (n: number) => dollars(n);

export function SubsSection({ read, canManage, initialTab, hrefs }: { read: SubsSectionRead; canManage: boolean; initialTab: SubsTab; hrefs: { project: string; directory: string; quotes: string } }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState<SubsTab>(initialTab);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [contractors, setContractors] = useState<ContractorRow[]>(read.subs.contractors);
  const [docs, setDocs] = useState<DocRow[]>(read.subs.documents);
  const [editing, setEditing] = useState<ContractorDraft | null>(null);
  const [ask, setAsk] = useState<RequestDraft | null>(null);
  const [compareReq, setCompareReq] = useState<string | null>(null);
  const m = read.metrics;
  const today = read.subs.today;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") setNote(words);
      refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const onProject = useMemo(() => new Set(read.subs.quotes.map((q) => q.contractorId)), [read.subs.quotes]);
  const quoteById = useMemo(() => new Map(read.subs.quotes.map((q) => [q.id, q])), [read.subs.quotes]);

  // `h.w` is the hub stylesheet's scope: its buttons, links, cards, heads and empty boxes are written `.w.w .x` and
  // apply only under it (project-hub.module.css); without it they render as plain text. A wrapper, since `.w` sets
  // display: block and the page is a grid.
  return (
    <div className={h.w}>
    <div className={s.page} data-subs-section data-subs-tab={tab}>
      <header className={s.head}>
        <div>
          <p className={s.kicker}>
            <a href={hrefs.project}>{read.project.name}{read.project.number ? ` · #${read.project.number}` : ""}</a> · Subcontractors
          </p>
          <h1 className={s.title}>Subcontractors</h1>
          <p className={s.sub}>
            {m.requestsOpen} request{m.requestsOpen === 1 ? "" : "s"} open · {m.quotesIn} quote{m.quotesIn === 1 ? "" : "s"} in · {money(m.committed)} committed
            {m.subsBudget != null ? ` of a ${money(m.subsBudget)} subs budget` : ""}
          </p>
        </div>
        <div className={s.acts}>
          <a className={h.btnSm} href={hrefs.directory} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Company directory
          </a>
          <a className={h.btnSm} href={hrefs.quotes} style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Quotes &amp; Proposals
          </a>
          {canManage ? (
            <button type="button" className={h.btnPrimary} disabled={!read.stages.length} onClick={() => { setNote(null); setAsk(newRequestDraft(read.stages, read.stages[0]?.id ?? "")); }} data-subs-new-request>
              Request quotes
            </button>
          ) : null}
        </div>
      </header>

      <nav className={s.tabs} aria-label="Subcontractors">
        {TABS.map((t) => (
          <button key={t.key} type="button" className={`${s.tab} ${tab === t.key ? s.tabOn : ""}`} onClick={() => setTab(t.key)} data-subs-tab-btn={t.key}>
            {t.label}
            {t.key === "requests" && m.requestsOpen ? <b>{m.requestsOpen}</b> : null}
            {t.key === "quotes" && m.awaitingApproval ? <b>{m.awaitingApproval}</b> : null}
          </button>
        ))}
      </nav>

      {note ? (
        <p className={h.note} role="status" data-subs-section-note>
          {note}
        </p>
      ) : null}

      {tab === "overview" ? (
        <>
          <div className={s.tiles} data-subs-tiles>
            <Tile label="Subs" value={String(m.subs)} sub={`${m.subsActive} on this project`} />
            <Tile label="Requests open" value={String(m.requestsOpen)} sub={m.overdue ? `${m.overdue} overdue` : "none overdue"} warn={m.overdue > 0} />
            <Tile label="Quotes in" value={String(m.quotesIn)} sub={`${m.awaitingApproval} awaiting approval${m.pending ? ` · ${money(m.pending)} pending` : ""}`} />
            <Tile label="Awarded" value={String(m.awarded)} sub={`${m.invoicesOpen} invoice${m.invoicesOpen === 1 ? "" : "s"} open`} />
            <Tile label="Committed" value={money(m.committed)} sub="awarded and invoiced" />
            <Tile label="Paid" value={money(m.paid)} sub="to subs on this project" />
            <Tile label="Subs budget" value={m.subsBudget != null ? money(m.subsBudget) : "—"} sub={m.remaining != null ? `${money(m.remaining)} left after committed and paid${m.pending ? `; ${money(m.pending)} pending` : ""}` : "no Subcontractors line in the budget"} warn={m.remaining != null && m.remaining < 0} />
          </div>
          {read.subs.flags.length ? (
            <div className={s.table} data-subs-flags>
              {read.subs.flags.map((f) => (
                <div key={f.kind + f.text} className={s.row} style={{ gridTemplateColumns: "1fr" }}>
                  <span className={`${s.pill} ${f.kind === "quote-overdue" ? s.pillLate : s.pillIn}`}>{f.kind.replace("-", " ")}</span> {f.text}
                </div>
              ))}
            </div>
          ) : null}
          <section className={h.card} aria-label="Latest">
            <div className={h.head}>
              <h3 className={h.title}>Latest</h3>
              <span className={h.headSub}>{read.history.length ? "the last moves on this project's subs" : "nothing yet — send a request to start"}</span>
            </div>
            {read.history.slice(0, 6).map((e) => (
              <div key={e.id} className={`${s.row} ${s.hist}`} style={{ borderBottom: "1px solid var(--ink-line, #ddd)" }}>
                <span className={s.mono}>{longDay(e.at)}</span>
                <span>{e.summary}</span>
                <span className={s.mono}>{e.who ?? ""}</span>
              </div>
            ))}
          </section>
        </>
      ) : null}

      {tab === "find" ? (
        // Part 3: subs the company does not have yet; Request quote saves one and opens the request sheet with them ticked.
        <SubsFind
          projectId={read.project.id}
          stages={read.stages}
          siteAddress={read.siteAddress}
          canManage={canManage}
          onSaved={(row) => {
            setContractors((cur) => (cur.some((c) => c.id === row.id) ? cur : [...cur, row].sort((a, b) => a.name.localeCompare(b.name))));
            refresh();
          }}
          onRequest={(contractorId, trade) => {
            const st = read.stages.find((x) => trade && tradeForStage(x.name) === trade) ?? read.stages[0];
            setNote(null);
            setAsk({ ...newRequestDraft(read.stages, st?.id ?? ""), picked: new Set([contractorId]) });
          }}
        />
      ) : null}

      {tab === "subs" ? (
        <section className={h.card} aria-label="My subs" data-subs-directory>
          <div className={h.head}>
            <h3 className={h.title}>My subs</h3>
            <span className={h.headSub}>
              <b>{contractors.length}</b> on the company&apos;s list · {onProject.size} on this project
            </span>
            {canManage ? (
              <div className={h.acts}>
                <button type="button" className={h.btnSm} onClick={() => setEditing(draftOf(null))} data-subs-add-contractor>
                  + Contractor
                </button>
              </div>
            ) : null}
          </div>
          {contractors.length ? (
            <div className={s.table}>
              {contractors.map((c) => {
                const flags = contractorFlags(c, today);
                return (
                  <div key={c.id} className={s.row} style={{ gridTemplateColumns: "minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.2fr) auto" }} data-subs-contractor data-subs-contractor-name={c.name}>
                    <div className={s.name}>
                      {c.name}
                      {c.company ? <span className={s.muted}> · {c.company}</span> : null}
                      <div className={s.mono}>{c.trades.join(" · ") || "no trade yet"}{onProject.has(c.id) ? " · on this project" : ""}</div>
                    </div>
                    <div className={s.muted}>
                      {c.phone ?? ""}
                      {c.phone && c.email ? <br /> : null}
                      {c.email ?? ""}
                    </div>
                    <div>
                      {flags.map((f) => (
                        <span key={f.kind} className={`${s.pill} ${f.late ? s.pillLate : s.pillWait}`}>
                          {f.text}
                        </span>
                      ))}
                      {!flags.length ? <span className={`${s.pill} ${s.pillIn}`}>{insuranceWords(c.insuranceUntil, today)}</span> : null}
                    </div>
                    <div className={h.stageActs}>
                      {canManage ? (
                        <button type="button" className={h.btnSm} onClick={() => setEditing(draftOf(c))} data-subs-edit-contractor>
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={h.empty}>No contractors yet — add the ones you work with, then request quotes.</p>
          )}
        </section>
      ) : null}

      {tab === "requests" ? (
        <section className={h.card} aria-label="Requests" data-subs-requests>
          <div className={h.head}>
            <h3 className={h.title}>Requests</h3>
            <span className={h.headSub}>
              <b>{m.requestsOpen}</b> open · {read.subs.requests.length} in all
            </span>
          </div>
          {read.subs.requests.length ? (
            <div className={s.table}>
              {read.subs.requests.map((r) => {
                const recips = r.recipientIds.map((id) => quoteById.get(id)).filter((q): q is NonNullable<typeof q> => Boolean(q));
                return (
                  <div key={r.id} className={s.row} style={{ gridTemplateColumns: "1fr" }} data-subs-request data-subs-request-no={r.number}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                      <span className={s.name}>
                        {requestNo(r.number)} · {r.title}
                        <span className={s.muted}>{r.stageName && r.stageName !== r.title ? ` · ${r.stageName}` : ""}</span>
                      </span>
                      <span className={s.mono}>
                        {r.status === "SENT" ? "open" : r.status.toLowerCase()}
                        {r.sentAt ? ` · sent ${longDay(r.sentAt)}` : ""}
                        {r.dueBy ? ` · reply by ${isoShort(r.dueBy)}` : ""}
                        {r.attachments.length ? ` · ${r.attachments.length} file${r.attachments.length === 1 ? "" : "s"}` : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                      {recips.map((q) => {
                        const st = quoteStatusOf(q.status);
                        const tone = st === "AWARDED" || st === "PAID" || st === "INVOICED" ? s.pillIn : q.overdue || st === "DECLINED" || st === "EXPIRED" || st === "CANCELLED" ? s.pillLate : st === "QUOTED" ? s.pillIn : s.pillWait;
                        return (
                          <span key={q.id} className={`${s.pill} ${tone}`} data-subs-recipient data-subs-recipient-status={q.status}>
                            {q.contractorName} · {st === "QUOTED" && q.amount != null ? money(q.amount) : QUOTE_LABEL[st]}
                          </span>
                        );
                      })}
                    </div>
                    {r.attachments.length ? (
                      <div className={s.muted} style={{ marginTop: 4 }}>
                        Files: {r.attachments.map((a) => (a.href ? <a key={a.id} className={h.link} href={a.href} target="_blank" rel="noreferrer" style={{ marginRight: 8, textDecoration: "underline" }}>{a.name}</a> : <span key={a.id} style={{ marginRight: 8 }}>{a.name}</span>))}
                      </div>
                    ) : null}
                    {canManage && r.status === "SENT" ? (
                      <div className={h.stageActs} style={{ justifyContent: "flex-start", marginTop: 6 }}>
                        <button type="button" className={h.btnSm} onClick={() => setTab("quotes")} data-subs-request-quotes>
                          See the quotes
                        </button>
                        <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => void run(`cancel:${r.id}`, async () => { await cancelProjectRequest(r.id); return `${requestNo(r.number)} cancelled; the subs still open on it were closed out (they are not told automatically).`; })} data-subs-request-cancel>
                          Cancel the request
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className={h.empty}>No requests yet — Request quotes sends the first.</p>
          )}
        </section>
      ) : null}

      {tab === "quotes" ? <ProjectSubsCard projectId={read.project.id} subs={{ ...read.subs, contractors }} stages={read.stages} canManage={canManage} /> : null}

      {tab === "compare"
        ? (() => {
            // Part 2: one request's quotes side by side, from the current versions' reads; the AI's two sentences under it.
            const requests = read.subs.requests;
            const picked = requests.find((r) => r.id === compareReq) ?? requests.find((r) => r.status === "SENT") ?? requests[0] ?? null;
            const rowsIn: CompareIn[] = picked
              ? read.subs.quotes
                  .filter((q) => q.requestId === picked.id)
                  .map((q) => {
                    const v = q.versions.find((x) => x.id === q.currentVersionId) ?? q.versions[q.versions.length - 1] ?? null;
                    return { quoteId: q.id, contractorName: q.contractorName, status: q.status, amount: q.amount, read: v?.read?.read ?? null, reviewStatus: v?.reviewStatus ?? "NONE", versionId: v?.id ?? null, version: v?.version ?? null, documentName: v?.document?.name ?? null };
                  })
              : [];
            const line = picked ? (read.subs.quotes.find((q) => q.requestId === picked.id)?.line ?? null) : null;
            const rows = compareTable(rowsIn, line);
            return (
              <section className={h.card} aria-label="Compare" data-subs-compare>
                <div className={h.head}>
                  <h3 className={h.title}>Compare</h3>
                  <span className={h.headSub}>{picked ? `${requestNo(picked.number)} · ${picked.title}${line != null ? ` · budget share ${money(line)}` : " · no budget share"}` : "no requests yet"}</span>
                  {requests.length > 1 ? (
                    <select value={picked?.id ?? ""} onChange={(e) => setCompareReq(e.target.value)} aria-label="Request" style={{ marginLeft: "auto", minHeight: 32, border: "1.5px solid var(--ink)", background: "#fff", font: "inherit", fontSize: 13, padding: "0 8px" }} data-subs-compare-request>
                      {requests.map((r) => (
                        <option key={r.id} value={r.id}>
                          {requestNo(r.number)} · {r.title}
                          {r.status !== "SENT" ? ` (${r.status.toLowerCase()})` : ""}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                {rows.length ? (
                  <div className={s.gridWrap} style={{ marginTop: 12 }}>
                    <table className={s.grid} data-subs-compare-table>
                      <thead>
                        <tr>
                          <th />
                          {rows.map((r) => (
                            <th key={r.quoteId} className={r.lowest ? s.best : undefined} data-subs-compare-sub data-subs-compare-lowest={r.lowest ? "1" : undefined}>
                              {r.contractorName}
                              <div style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                                {QUOTE_LABEL[quoteStatusOf(r.status)]}
                                {r.lowest ? " · lowest" : ""}
                                {r.version ? ` · V${r.version}` : ""}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {COMPARE_FIELDS.map((f) => (
                          <tr key={f.key} data-subs-compare-field={f.key}>
                            <td className={s.k}>{f.label}</td>
                            {rows.map((r) => (
                              <td key={r.quoteId} className={`${r.lowest ? s.best : ""} ${f.key === "budget" && r.over ? s.overCell : ""}`}>
                                {f.of(r, line)}
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr data-subs-compare-field="read">
                          <td className={s.k}>The read</td>
                          {rows.map((r) => (
                            <td key={r.quoteId} className={r.lowest ? s.best : undefined}>
                              {r.read ? REVIEW_LABEL[reviewStatusOf(r.reviewStatus)] : r.documentName ? "not read yet" : "no document"}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={h.empty}>No quotes on this request yet.</p>
                )}
                <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
                  {picked?.compare ? (
                    <p className={s.words} data-subs-compare-words>
                      {picked.compare.words}
                      <br />
                      <span className={s.wordsBy}>
                        {picked.compare.by === "model" ? "the AI, from the extracted fields only" : "the rules' words"} · {longDay(picked.compare.at)}
                      </span>
                    </p>
                  ) : null}
                  {canManage && picked && rows.some((r) => r.amount != null) ? (
                    <div className={h.stageActs} style={{ justifyContent: "flex-start" }}>
                      <button type="button" className={h.btnSm} disabled={busy !== null} onClick={() => void run(`compare:${picked.id}`, async () => { const r = await compareRequestWords(picked.id); return r.by === "model" ? "Compared — the AI's two sentences are above." : "Compared — the rules' words are above (one price, or AI is off)."; })} data-subs-compare-write>
                        {busy === `compare:${picked.id}` ? "Comparing…" : picked.compare ? "Compare again" : "Write the comparison"}
                      </button>
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })()
        : null}

      {tab === "budget"
        ? (() => {
            // Part 2: the Subcontractors line by stage — pending (quoted, not awarded) as its own column, never committed.
            const rows = budgetRows(read.stages, read.subs.quotes);
            const t = budgetTotals(rows);
            return (
              <section className={h.card} aria-label="Budget" data-subs-budget>
                <div className={h.head}>
                  <h3 className={h.title}>Budget</h3>
                  <span className={h.headSub}>{m.subsBudget != null ? `the ${money(m.subsBudget)} Subcontractors line, by stage` : "no Subcontractors line in the budget — the shares are empty"}</span>
                </div>
                {rows.length ? (
                  <div className={s.gridWrap} style={{ marginTop: 12 }}>
                    <table className={s.grid} data-subs-budget-table>
                      <thead>
                        <tr>
                          <th>Stage</th>
                          <th className={s.n}>Share</th>
                          <th className={s.n}>Pending</th>
                          <th className={s.n}>Committed</th>
                          <th className={s.n}>Paid</th>
                          <th className={s.n}>Left</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.stageId ?? "none"} data-subs-budget-row data-subs-budget-over={r.over ? "1" : undefined}>
                            <td>
                              {r.stageName}
                              <span className={s.muted}> · {r.quotes} quote{r.quotes === 1 ? "" : "s"}</span>
                            </td>
                            <td className={s.n}>{r.line != null ? money(r.line) : "—"}</td>
                            <td className={s.n} data-subs-budget-pending>{r.pending ? money(r.pending) : "—"}</td>
                            <td className={s.n}>{r.committed ? money(r.committed) : "—"}</td>
                            <td className={s.n}>{r.paid ? money(r.paid) : "—"}</td>
                            <td className={`${s.n} ${r.over ? s.overCell : ""}`}>{r.left != null ? (r.over ? `${money(-r.left)} over` : money(r.left)) : "—"}</td>
                          </tr>
                        ))}
                        <tr className={s.total}>
                          <td>All stages</td>
                          <td className={s.n}>{t.line != null ? money(t.line) : "—"}</td>
                          <td className={s.n} data-subs-budget-pending-total>{t.pending ? money(t.pending) : "—"}</td>
                          <td className={s.n}>{t.committed ? money(t.committed) : "—"}</td>
                          <td className={s.n}>{t.paid ? money(t.paid) : "—"}</td>
                          <td className={`${s.n} ${t.left != null && t.left < 0 ? s.overCell : ""}`}>{t.left != null ? (t.left < 0 ? `${money(-t.left)} over` : money(t.left)) : "—"}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className={h.empty}>No quotes yet — the Subcontractors line is untouched.</p>
                )}
                <p className={s.muted} style={{ marginTop: 10, fontSize: 12.5 }}>
                  Pending is quoted but not awarded — it never counts as committed or spent. Committed is awarded and invoiced; Left is the share after committed and paid. Awarding over a share asks once before it goes through.
                </p>
              </section>
            );
          })()
        : null}

      {tab === "history" ? (
        <section className={h.card} aria-label="History" data-subs-history>
          <div className={h.head}>
            <h3 className={h.title}>History</h3>
            <span className={h.headSub}>every subcontractor event on this project, newest first</span>
          </div>
          {read.history.length ? (
            <div className={s.table}>
              {read.history.map((e) => (
                <div key={e.id} className={`${s.row} ${s.hist}`} data-subs-history-row>
                  <span className={s.mono}>{new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  <span>{e.summary}</span>
                  <span className={s.mono}>{e.who ?? ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className={h.empty}>Nothing yet.</p>
          )}
        </section>
      ) : null}

      <ContractorSheet
        draft={editing}
        setDraft={(fn) => setEditing((cur) => fn(cur))}
        documents={editing?.id ? docs.filter((d) => d.contractorId === editing.id && (d.kind === "W9" || d.kind === "INSURANCE")) : []}
        onSaved={(row) => {
          setContractors((cur) => (cur.some((c) => c.id === row.id) ? cur.map((c) => (c.id === row.id ? row : c)) : [...cur, row].sort((a, b) => a.name.localeCompare(b.name))));
          setEditing(null);
          setNote(`${row.name} saved.`);
          refresh();
        }}
        onDocument={(doc) => setDocs((cur) => [doc, ...cur])}
        onClose={() => setEditing(null)}
      />
      <RequestSheet projectId={read.project.id} draft={ask} setDraft={(fn) => setAsk((cur) => fn(cur))} stages={read.stages} contractors={contractors} setContractors={(fn) => setContractors((cur) => fn(cur))} files={read.subs.files} onSent={(words) => { setAsk(null); setNote(words); setTab("requests"); refresh(); }} onClose={() => setAsk(null)} />
    </div>
    </div>
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
