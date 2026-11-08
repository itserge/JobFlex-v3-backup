"use client";
// QUOTES & PROPOSALS (2026-11-08, the subcontractors plan, part 1): every quote across the company's projects,
// finished ones included — searched by company, project, request number or file name, filtered by trade, status and
// project, by amount and by date, sorted — each with its versions and the document that opens in the viewer, and the
// project's Subcontractors section one tap away. Read-only here; the writes live on the project.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachInboundEmail, ignoreInboundEmail } from "@/actions/projectSubs";
import { DocViewer, type ViewerDoc } from "@/components/v3/docs/doc-viewer";
import { QuoteReadPanel } from "@/components/v3/docs/quote-read-panel";
import type { CompanyQuoteRow } from "@/lib/projectSubs/server";
import type { InboundRow } from "@/lib/subInbound/server";
import { QUOTE_LABEL, QUOTE_STATUSES, dollars, quoteStatusOf, requestNo } from "@/lib/projectSubs/shared";
import { REVIEW_LABEL, reviewStatusOf } from "@/lib/subQuotes/shared";
import { docSize } from "@/lib/subDocs/shared";
import h from "@/components/v3/project-links/project-hub.module.css";
import s from "@/components/v3/subs-section/subs.module.css";

const longDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
type Sort = "newest" | "oldest" | "amount-desc" | "amount-asc" | "company";

// `projectHref` is a pattern with `{id}` for the project's id, not a function: the server pages render this client
// component and React Server Components cannot pass a function across that line.
// Part 2 (2026-11-08): `inbox` is the mail to match — letters that reached the inbound address but fit no open
// request, a stranger's address, or a closed request; a manager attaches one to a quote or sets it aside.
export function QuotesPage({ rows, inbox, canManage, projectHref }: { rows: CompanyQuoteRow[]; inbox: InboundRow[]; canManage: boolean; projectHref: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [attachTo, setAttachTo] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [trade, setTrade] = useState("");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const [viewing, setViewing] = useState<{ doc: ViewerDoc; versionId: string | null } | null>(null);
  const viewingVersion = viewing?.versionId ? (rows.flatMap((r) => r.versions).find((v) => v.id === viewing.versionId) ?? null) : null;
  const openQuotes = useMemo(() => rows.filter((r) => ["ASKED", "VIEWED", "QUOTED", "REVISION", "AWARDED"].includes(r.status)), [rows]);

  async function run(key: string, fn: () => Promise<string | null>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (words) setNote(words);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const trades = useMemo(() => [...new Set(rows.map((r) => r.contractorTrade).filter((x): x is string => Boolean(x)))].sort(), [rows]);
  const projects = useMemo(() => [...new Map(rows.map((r) => [r.projectId, r.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [rows]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    const lo = min.trim() ? Number(min.replace(/[^\d.]/g, "")) : null;
    const hi = max.trim() ? Number(max.replace(/[^\d.]/g, "")) : null;
    const list = rows.filter((r) => {
      if (words) {
        const hay = `${r.contractorName} ${r.projectName} ${r.requestNumber ? requestNo(r.requestNumber) : ""} ${r.stageName ?? ""} ${r.versions.map((v) => v.document?.name ?? "").join(" ")}`.toLowerCase();
        if (!hay.includes(words)) return false;
      }
      if (trade && r.contractorTrade !== trade) return false;
      if (status && r.status !== status) return false;
      if (project && r.projectId !== project) return false;
      if (lo != null && (r.amount == null || r.amount < lo)) return false;
      if (hi != null && (r.amount == null || r.amount > hi)) return false;
      const day = r.askedAt.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
    const by: Record<Sort, (a: CompanyQuoteRow, b: CompanyQuoteRow) => number> = {
      newest: (a, b) => b.askedAt.localeCompare(a.askedAt),
      oldest: (a, b) => a.askedAt.localeCompare(b.askedAt),
      "amount-desc": (a, b) => (b.amount ?? -1) - (a.amount ?? -1),
      "amount-asc": (a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity),
      company: (a, b) => a.contractorName.localeCompare(b.contractorName),
    };
    return [...list].sort(by[sort]);
  }, [rows, q, trade, status, project, min, max, from, to, sort]);

  const total = shown.reduce((n, r) => n + (r.amount ?? 0), 0);

  // `h.w` is the hub stylesheet's scope (`.w.w .x` rules); without it the hub's buttons and links render as plain
  // text. A wrapper, since `.w` sets display: block and the page is a grid.
  return (
    <div className={h.w}>
    <div className={s.page} data-quotes-page>
      <header className={s.head}>
        <div>
          <p className={s.kicker}>Remodeling · Quotes &amp; Proposals</p>
          <h1 className={s.title}>Quotes &amp; Proposals</h1>
          <p className={s.sub}>
            {shown.length} of {rows.length} quote{rows.length === 1 ? "" : "s"} · {dollars(total)} in the ones shown · every project, finished ones too
            {inbox.length ? ` · ${inbox.length} email${inbox.length === 1 ? "" : "s"} to match` : ""}
          </p>
        </div>
        <div className={s.acts}>
          <a className={h.btnSm} href="/dashboard/subcontractors" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Subcontractors
          </a>
        </div>
      </header>

      {note ? (
        <p className={h.note} role="status" data-quotes-note>
          {note}
        </p>
      ) : null}

      {inbox.length ? (
        <section className={h.card} aria-label="Mail to match" data-quotes-inbox>
          <div className={h.head}>
            <h3 className={h.title}>Mail to match</h3>
            <span className={h.headSub}>letters that reached the quotes address but fit no open request — pick the quote they belong to, or set them aside</span>
          </div>
          <div className={s.inbox} style={{ marginTop: 10 }}>
            {inbox.map((m) => (
              <div key={m.id} className={s.inboxRow} data-quotes-inbox-row>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <span className={s.name}>
                    {m.from}
                    <span className={s.muted}>{m.subject ? ` · ${m.subject}` : ""}</span>
                  </span>
                  <span className={s.mono}>
                    {longDay(m.receivedAt)}
                    {m.requestNumber ? ` · ${requestNo(m.requestNumber)}` : ""}
                  </span>
                </div>
                {m.note ? <span className={`${s.pill} ${s.pillWait}`}>{m.note}</span> : null}
                {m.excerpt ? <p className={s.muted} style={{ margin: 0, fontSize: 13 }}>{m.excerpt}</p> : null}
                <div className={s.muted} style={{ fontSize: 12.5 }}>
                  {m.documents.length
                    ? m.documents.map((d) => (
                        <button key={d.id} type="button" className={s.linkBtn} style={{ marginRight: 8 }} onClick={() => setViewing({ doc: { id: d.id, name: d.name, href: `/api/subs/doc/${d.id}`, contentType: d.contentType, downloadHref: `/api/subs/doc/${d.id}?download=1`, meta: `${m.from} · ${longDay(m.receivedAt)}${d.bytes ? ` · ${docSize(d.bytes)}` : ""}` }, versionId: null })} data-quotes-inbox-doc>
                          {d.name}
                        </button>
                      ))
                    : "no file attached"}
                  {m.rawHref ? (
                    <a className={h.link} href={m.rawHref} style={{ textDecoration: "underline" }} data-quotes-inbox-raw>
                      the original message
                    </a>
                  ) : null}
                </div>
                {canManage ? (
                  <div className={s.inboxActs}>
                    <select value={attachTo[m.id] ?? m.quoteId ?? ""} onChange={(e) => setAttachTo((cur) => ({ ...cur, [m.id]: e.target.value }))} aria-label="The quote it belongs to" data-quotes-inbox-quote>
                      <option value="">Which quote is it?</option>
                      {openQuotes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.contractorName} · {r.projectName}
                          {r.requestNumber ? ` · ${requestNo(r.requestNumber)}` : ""}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !(attachTo[m.id] ?? m.quoteId)} onClick={() => void run(`attach:${m.id}`, async () => { const r = await attachInboundEmail({ inboundId: m.id, quoteId: attachTo[m.id] ?? m.quoteId ?? "" }); return r.versionId ? "Attached — the document is a version on the quote; its figures are being read." : "Attached as a note on the quote."; })} data-quotes-inbox-attach>
                      Attach
                    </button>
                    <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void run(`ignore:${m.id}`, async () => { await ignoreInboundEmail(m.id); return "Set aside."; })} data-quotes-inbox-ignore>
                      Ignore
                    </button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className={s.filters} data-quotes-filters>
        <input type="search" placeholder="Company, project, RFQ number, file name" value={q} onChange={(e) => setQ(e.target.value)} data-quotes-search />
        <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" data-quotes-filter-project>
          <option value="">Every project</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={trade} onChange={(e) => setTrade(e.target.value)} aria-label="Trade" data-quotes-filter-trade>
          <option value="">Every trade</option>
          {trades.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" data-quotes-filter-status>
          <option value="">Every status</option>
          {QUOTE_STATUSES.map((k) => (
            <option key={k} value={k}>
              {QUOTE_LABEL[k]}
            </option>
          ))}
        </select>
        <input type="text" inputMode="numeric" placeholder="$ from" value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 90 }} aria-label="Amount from" data-quotes-min />
        <input type="text" inputMode="numeric" placeholder="$ to" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 90 }} aria-label="Amount to" data-quotes-max />
        <input type="text" placeholder="From YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 150 }} aria-label="Asked from" data-quotes-from />
        <input type="text" placeholder="To YYYY-MM-DD" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 150 }} aria-label="Asked to" data-quotes-to />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" data-quotes-sort>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="amount-desc">Highest amount</option>
          <option value="amount-asc">Lowest amount</option>
          <option value="company">By company</option>
        </select>
      </div>

      {shown.length ? (
        <div className={s.table}>
          <div className={`${s.row} ${s.rowHead}`} style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1fr) auto minmax(0,1.2fr)" }}>
            <span>Sub</span>
            <span>Project · request</span>
            <span>Status</span>
            <span style={{ textAlign: "right" }}>Amount</span>
            <span>Versions and documents</span>
          </div>
          {shown.map((r) => {
            const st = quoteStatusOf(r.status);
            const tone = st === "AWARDED" || st === "PAID" || st === "INVOICED" || st === "QUOTED" ? s.pillIn : st === "DECLINED" || st === "EXPIRED" || st === "CANCELLED" ? s.pillLate : s.pillWait;
            return (
              <div key={r.id} className={s.row} style={{ gridTemplateColumns: "minmax(0,1.3fr) minmax(0,1.3fr) minmax(0,1fr) auto minmax(0,1.2fr)" }} data-quotes-row data-quotes-status={r.status}>
                <div className={s.name}>
                  {r.contractorName}
                  <div className={s.mono}>
                    {r.contractorTrade ?? ""}
                    {r.contractorTrade ? " · " : ""}asked {longDay(r.askedAt)}
                  </div>
                </div>
                <div>
                  <a className={h.link} href={projectHref.replace("{id}", r.projectId)} style={{ textDecoration: "underline", fontWeight: 700 }} data-quotes-project>
                    {r.projectName}
                  </a>
                  <div className={s.mono}>
                    {r.requestNumber ? requestNo(r.requestNumber) : "—"}
                    {r.stageName ? ` · ${r.stageName}` : ""}
                    {r.projectStatus === "COMPLETED" || r.projectStatus === "ARCHIVED" ? " · finished project" : ""}
                  </div>
                </div>
                <div>
                  <span className={`${s.pill} ${tone}`}>{QUOTE_LABEL[st]}</span>
                </div>
                <div className={s.amt}>{r.amount != null ? dollars(r.amount) : "—"}</div>
                <div className={s.muted}>
                  {r.versions.length ? (
                    r.versions.map((v) => (
                      <div key={v.id} data-quotes-version data-quotes-read-status={v.reviewStatus}>
                        V{v.version}
                        {v.amount != null ? ` · ${dollars(v.amount)}` : ""}
                        {v.source === "EMAIL" ? " · by email" : ""}
                        {v.approved ? " · approved" : ""}
                        {v.document ? (
                          <>
                            {" · "}
                            <button type="button" className={s.linkBtn} onClick={() => setViewing({ doc: { id: v.document!.id, name: v.document!.name, href: `/api/subs/doc/${v.document!.id}`, contentType: v.document!.contentType, downloadHref: `/api/subs/doc/${v.document!.id}?download=1`, meta: `${r.contractorName} · V${v.version} · ${longDay(v.submittedAt)}${v.document!.bytes ? ` · ${docSize(v.document!.bytes)}` : ""}` }, versionId: v.id })} data-quotes-open-doc>
                              {v.document.name}
                            </button>
                          </>
                        ) : null}
                        {v.document && v.reviewStatus !== "NONE" ? ` · ${REVIEW_LABEL[reviewStatusOf(v.reviewStatus)]}` : ""}
                        {v.read?.read.total.value != null && v.amount == null ? ` · read ${dollars(v.read.read.total.value)}` : ""}
                      </div>
                    ))
                  ) : (
                    <span>no price yet</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className={s.empty}>{rows.length ? "No quote matches these filters." : "No quotes yet — a project's Subcontractors section sends the first request."}</p>
      )}
      <DocViewer doc={viewing?.doc ?? null} onClose={() => setViewing(null)} side={viewingVersion ? <QuoteReadPanel version={viewingVersion} canManage={canManage} onChanged={() => startTransition(() => router.refresh())} /> : undefined} />
    </div>
    </div>
  );
}
