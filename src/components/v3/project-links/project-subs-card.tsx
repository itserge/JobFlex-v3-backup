"use client";
// CONTRACTORS: QUOTES AND INVOICES — the card (2026-11-07, part 2 of the plan "Projects: Remodel and New
// construction"). On the desktop and the handheld project page: the quotes by stage — who was asked, who answered
// with what, against the stage's share of the Subcontractors budget, the lowest marked, over-budget flagged, the
// awarded one leading — with Award / Decline / Mark paid / Copy link / Resend. "Ask for a quote" is one sheet: the
// stage, the contractors of its trade first (a new one added in place), the scope prefilled from the stage and its
// tasks, a reply-by day. Every write is actions/projectSubs (estimators and managers); everyone else reads the
// card. The contractor's own page is /q/<token>.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addProjectContractor, askProjectQuotes, awardProjectQuote, declineProjectQuote, markProjectQuotePaid, resendProjectQuote } from "@/actions/projectSubs";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdStage, PdSubs } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { QUOTE_LABEL, dollars, quoteStatusOf, replyByDefault, scopeFor, tradeForStage } from "@/lib/projectSubs/shared";
import { TRADE_TYPES } from "@/lib/tradeTypes";
import s from "./project-hub.module.css";

type QuoteRow = PdSubs["quotes"][number];
type ContractorRow = PdSubs["contractors"][number];

const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const todayIso = () => new Date().toISOString().slice(0, 10);

type AskDraft = {
  stageId: string;
  picked: Set<string>;
  scope: string;
  dueBy: string;
  adding: { name: string; trade: string; phone: string; email: string } | null;
};

/** The invoice link's words: the file's name when the URL ends in one ("ridge-1041.pdf"), else "open it". */
function invoiceFileName(url: string): string {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return last && last.length <= 48 && /\.[a-z0-9]{2,5}$/i.test(last) ? last : "open it";
  } catch {
    return "open it";
  }
}

export function ProjectSubsCard({ projectId, subs, stages, canManage }: { projectId: string; subs: PdSubs; stages: PdStage[]; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskDraft | null>(null);
  const [paying, setPaying] = useState<Record<string, string>>({});
  const [contractors, setContractors] = useState<ContractorRow[]>(subs.contractors);

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
  const open = subs.quotes.filter((q) => q.status === "ASKED" || q.status === "QUOTED" || q.status === "AWARDED" || q.status === "INVOICED");
  const quoted = subs.quotes.filter((q) => q.status === "QUOTED");
  const overdue = subs.quotes.filter((q) => q.overdue);

  function openAsk(stageId: string) {
    const st = stages.find((x) => x.id === stageId) ?? stages[0];
    setNote(null);
    setAsk({
      stageId: st?.id ?? "",
      picked: new Set(),
      scope: st ? scopeFor(st.name, st.tasks.map((t) => t.title)) : "",
      dueBy: replyByDefault(todayIso()),
      adding: null,
    });
  }

  function pickStage(stageId: string) {
    setAsk((cur) => {
      if (!cur) return cur;
      const st = stages.find((x) => x.id === stageId);
      return { ...cur, stageId, scope: st ? scopeFor(st.name, st.tasks.map((t) => t.title)) : cur.scope, picked: new Set() };
    });
  }

  const askStage = ask ? stages.find((x) => x.id === ask.stageId) ?? null : null;
  const askTrade = askStage ? tradeForStage(askStage.name) : null;
  // The contractors of the stage's trade first, then the rest, each by name.
  const ordered = useMemo(() => {
    const mine = contractors.filter((c) => askTrade && c.trade === askTrade);
    const rest = contractors.filter((c) => !(askTrade && c.trade === askTrade));
    return [...mine, ...rest];
  }, [contractors, askTrade]);

  async function addNew() {
    if (!ask?.adding?.name.trim()) return;
    const a = ask.adding;
    await run("add", async () => {
      const made = await addProjectContractor({ name: a.name, trade: a.trade || null, phone: a.phone || null, email: a.email || null });
      const row: ContractorRow = { id: made.id, name: made.name, company: null, trade: made.trade, phone: made.phone, email: made.email, license: null, insuranceUntil: null, notes: null };
      setContractors((cur) => [...cur, row]);
      setAsk((cur) => (cur ? { ...cur, adding: null, picked: new Set([...cur.picked, made.id]) } : cur));
      return null;
    });
  }

  async function send() {
    if (!ask) return;
    const ids = [...ask.picked];
    if (!ids.length) {
      setNote("Pick at least one contractor.");
      return;
    }
    await run("ask", async () => {
      const r = await askProjectQuotes({ projectId, stageId: ask.stageId || null, contractorIds: ids, scope: ask.scope, dueBy: /^\d{4}-\d{2}-\d{2}$/.test(ask.dueBy) ? ask.dueBy : null });
      setAsk(null);
      const how = (a: (typeof r.asked)[number]) => (a.text === "sent" && a.email === "sent" ? "text and email sent" : a.text === "sent" ? "text sent" : a.email === "sent" ? "email sent" : a.text === "failed" || a.email === "failed" ? "the send failed — copy the link from the card" : "no phone or email on file — copy the link from the card");
      return `Asked ${r.asked.map((a) => `${a.contractor} (${how(a)})`).join(", ")}.`;
    });
  }

  function tag(q: QuoteRow) {
    const st = quoteStatusOf(q.status);
    if (st === "ASKED") return q.overdue ? `Overdue — asked for ${q.dueBy ? longDay(q.dueBy) : "a reply"}` : `Asked${q.dueBy ? ` · reply by ${longDay(q.dueBy)}` : ""}`;
    if (st === "QUOTED") return `Quoted ${q.amount != null ? dollars(q.amount) : ""}${q.best ? " · lowest" : ""}${q.over && q.overBy != null ? ` · ${dollars(q.overBy)} over the line` : ""}`;
    if (st === "AWARDED") return `Awarded${q.amount != null ? ` · ${dollars(q.amount)}` : ""} · waiting for the invoice`;
    if (st === "INVOICED") return `Invoice in · ${q.invoiceAmount != null ? dollars(q.invoiceAmount) : ""}${q.amount != null && q.invoiceAmount != null && q.invoiceAmount > q.amount ? ` (quoted ${dollars(q.amount)})` : ""}`;
    if (st === "PAID") return `Paid${q.invoiceAmount != null ? ` · ${dollars(q.invoiceAmount)}` : ""}`;
    return QUOTE_LABEL[st];
  }
  const tone = (q: QuoteRow) => {
    const st = quoteStatusOf(q.status);
    if (st === "PAID" || st === "AWARDED") return s.tagIn;
    if (q.overdue || (st === "QUOTED" && q.over)) return s.tagLate;
    return "";
  };

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="Contractors" data-project-subs>
        <div className={s.head}>
          <h3 className={s.title}>Contractors</h3>
          <span className={s.headSub}>
            {subs.quotes.length ? (
              <>
                <b>{open.length}</b> open{quoted.length ? ` · ${quoted.length} quoted` : ""}{overdue.length ? ` · ${overdue.length} overdue` : ""}
                {subs.subsBudget != null ? ` · subs budget ${dollars(subs.subsBudget)}` : ""}
              </>
            ) : (
              "Ask the contractors you work with for a price on a stage; the lowest and the budget line are marked when the prices come in"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null || !stages.length} onClick={() => openAsk(stages[0]?.id ?? "")} data-subs-ask>
                Ask for a quote
              </button>
            </div>
          ) : null}
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
                <div key={q.id} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-subs-quote data-subs-status={q.status}>
                  <div>
                    <div className={s.lineName} style={{ fontWeight: 600 }}>
                      {q.contractorName}
                      {q.contractorTrade ? <span className={s.qty}> · {q.contractorTrade}</span> : null}
                    </div>
                    <div>
                      <span className={`${s.tag} ${tone(q)}`} data-subs-tag>
                        {tag(q)}
                      </span>
                    </div>
                    {q.note ? <div style={{ fontSize: 13 }}>{q.note}</div> : null}
                    {q.invoiceUrl ? (
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
                          <button type="button" className={s.btnPrimary} style={{ minHeight: 32, padding: "0 12px", fontSize: 10.5 }} disabled={busy !== null} onClick={() => void run(`award:${q.id}`, async () => { await awardProjectQuote(q.id); return `${g.stageName} awarded to ${q.contractorName}; the others were told.`; })} data-subs-award>
                            Award
                          </button>
                        ) : null}
                        {q.status === "ASKED" || q.status === "QUOTED" ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`decline:${q.id}`, async () => { await declineProjectQuote(q.id); return null; })} data-subs-decline>
                            Decline
                          </button>
                        ) : null}
                        {q.status === "AWARDED" || q.status === "INVOICED" ? (
                          <>
                            <input
                              className={s.input}
                              inputMode="decimal"
                              style={{ width: 110 }}
                              value={paying[q.id] ?? String(q.invoiceAmount ?? q.amount ?? "")}
                              onChange={(e) => setPaying((cur) => ({ ...cur, [q.id]: e.target.value }))}
                              aria-label={`Paid to ${q.contractorName}`}
                              data-subs-paid
                            />
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
                        {q.status !== "DECLINED" && q.status !== "PAID" ? (
                          <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => void run(`resend:${q.id}`, async () => { const r = await resendProjectQuote(q.id); return r.text === "sent" || r.email === "sent" ? `Sent to ${q.contractorName} again.` : `${q.contractorName} has no phone or email on file — copy the link.`; })} data-subs-resend>
                            Resend
                          </button>
                        ) : null}
                        {q.status !== "DECLINED" && q.status !== "PAID" ? <span className={s.link} data-subs-link>{q.link}</span> : null}
                        <button type="button" className={s.btnSm} onClick={() => void navigator.clipboard?.writeText(q.link).then(() => setNote("Link copied."))} data-subs-copy>
                          Copy link
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <span className={s.qty}>{q.askedAt ? `asked ${longDay(q.askedAt.slice(0, 10))}` : ""}</span>
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

      {/* ASK FOR A QUOTE — the stage, the contractors (the stage's trade first; a new one in place), the scope, the day. */}
      <BlueprintSheet open={ask !== null} onClose={() => busy === null && setAsk(null)} title="Ask for a quote" description="Each contractor gets a text or an email with their own link: the scope, a price box, a note.">
        {ask ? (
          <div className={s.form} data-subs-ask-sheet>
            <label className={s.field}>
              <span className={s.lab}>The work</span>
              <select className={s.input} value={ask.stageId} onChange={(e) => pickStage(e.target.value)} data-subs-ask-stage>
                {stages.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
            <div className={s.field}>
              <span className={s.lab}>Contractors{askTrade ? ` — ${askTrade} first` : ""}</span>
              {ordered.length ? (
                <div className={s.checks}>
                  {ordered.map((c) => (
                    <label key={c.id} className={s.check} data-subs-ask-contractor>
                      <input
                        type="checkbox"
                        checked={ask.picked.has(c.id)}
                        onChange={(e) =>
                          setAsk((cur) => {
                            if (!cur) return cur;
                            const next = new Set(cur.picked);
                            if (e.target.checked) next.add(c.id);
                            else next.delete(c.id);
                            return { ...cur, picked: next };
                          })
                        }
                      />
                      <span>
                        {c.name}
                        {c.trade ? ` · ${c.trade}` : ""}
                        {!c.phone && !c.email ? " · no phone or email" : ""}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className={s.empty}>No contractors on your list yet.</p>
              )}
              {ask.adding ? (
                <div className={s.form} style={{ marginTop: 8 }} data-subs-new-contractor>
                  <input className={s.input} placeholder="Name" value={ask.adding.name} onChange={(e) => setAsk((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, name: e.target.value } } : cur))} aria-label="Contractor name" data-subs-new-name />
                  <select className={s.input} value={ask.adding.trade} onChange={(e) => setAsk((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, trade: e.target.value } } : cur))} aria-label="Trade">
                    <option value="">Trade</option>
                    {TRADE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <input className={s.input} placeholder="Phone" inputMode="tel" value={ask.adding.phone} onChange={(e) => setAsk((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, phone: e.target.value } } : cur))} aria-label="Phone" data-subs-new-phone />
                  <input className={s.input} placeholder="Email" inputMode="email" value={ask.adding.email} onChange={(e) => setAsk((cur) => (cur && cur.adding ? { ...cur, adding: { ...cur.adding, email: e.target.value } } : cur))} aria-label="Email" data-subs-new-email />
                  <div className={s.stageActs} style={{ justifyContent: "flex-start" }}>
                    <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !ask.adding.name.trim()} onClick={() => void addNew()} data-subs-new-save>
                      Add and pick
                    </button>
                    <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setAsk((cur) => (cur ? { ...cur, adding: null } : cur))}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="bps-btn bps-btn--ghost" style={{ marginTop: 8 }} disabled={busy !== null} onClick={() => setAsk((cur) => (cur ? { ...cur, adding: { name: "", trade: askTrade ?? "", phone: "", email: "" } } : cur))} data-subs-new>
                  + New contractor
                </button>
              )}
            </div>
            <label className={s.field}>
              <span className={s.lab}>The scope they read</span>
              <textarea className={s.input} rows={6} maxLength={2000} value={ask.scope} onChange={(e) => setAsk((cur) => (cur ? { ...cur, scope: e.target.value } : cur))} data-subs-ask-scope />
            </label>
            <label className={s.field}>
              <span className={s.lab}>Reply by</span>
              <input className={s.input} type="text" placeholder="YYYY-MM-DD" value={ask.dueBy} onChange={(e) => setAsk((cur) => (cur ? { ...cur, dueBy: e.target.value } : cur))} data-subs-ask-due />
            </label>
            {note ? <p className={s.note}>{note}</p> : null}
            <div className={s.stageActs}>
              <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => setAsk(null)}>
                Cancel
              </button>
              <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !ask.picked.size || !ask.scope.trim()} onClick={() => void send()} data-subs-ask-send>
                {busy === "ask" ? "Sending…" : `Ask ${ask.picked.size || ""}`.trim()}
              </button>
            </div>
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
