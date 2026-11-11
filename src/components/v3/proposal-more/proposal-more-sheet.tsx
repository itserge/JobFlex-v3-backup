"use client";
// THE "MORE" SHEET FOR A SOLD PROPOSAL (2026-11-10, the ProSmart gaps plan, part 4). Mounted once in the shell
// (blueprint-shell, mobile-nav) and opened with `document.dispatchEvent(new CustomEvent("jf:proposal-more",
// { detail: { proposalId, section? } }))` — the card's Crew and More buttons. Office only.
//
// ProSmart's row actions, in one place: the crew on the job (with their pay), who sold it and their commission —
// earned as the money comes in — "call the rep first" for the crew, the project it's filed under, and cancelling a
// sold job with a reason (and reopening it).

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { cancelSoldJob, getProposalMore, reopenSoldJob, setDealCallFirst, setDealCommission, setDealSeller } from "@/actions/proposalRow";
import { assignWorker, unassignAssignment } from "@/actions/workers";
import { setAssignmentPay } from "@/actions/jobPay";
import { createJobFromProposal } from "@/actions/jobs";
import { setProposalProject } from "@/actions/projectLinks";
import { createProject } from "@/actions/projects";
import type { ProposalMore } from "@/lib/proposalRow/server";
import { CANCEL_REASONS } from "@/lib/proposalRow/shared";
import "./proposal-more-sheet.css";

export type ProposalMoreDetail = { proposalId: string; section?: "crew" | "sale" | "project" | "cancel" };

export function openProposalMore(detail: ProposalMoreDetail): void {
  document.dispatchEvent(new CustomEvent("jf:proposal-more", { detail }));
}

let listener: symbol | null = null;
const money = (n: number) => {
  const c = Math.round(n * 100);
  return `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const num = (s: string) => {
  const t = s.replace(/[$,%\s]/g, "");
  if (!t) return null;
  const v = Number.parseFloat(t);
  return Number.isFinite(v) && v >= 0 ? v : Number.NaN;
};

export function ProposalMoreSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [section, setSection] = useState<ProposalMoreDetail["section"]>(undefined);
  const [data, setData] = useState<ProposalMore | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [changed, setChanged] = useState(false);
  const [pays, setPays] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<{ workerId: string; pay: string }>({ workerId: "", pay: "" });
  const [dealPct, setDealPctText] = useState("");
  const [newProject, setNewProject] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<{ reason: string; other: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (pid: string) => {
    try {
      const d = await getProposalMore(pid);
      setData(d);
      setPays(Object.fromEntries((d.job?.crew ?? []).map((c) => [c.assignmentId, String(c.pay || "")])));
      setDealPctText(d.rep?.dealPct != null ? String(d.rep.dealPct) : "");
      setLoadErr(null);
      return d;
    } catch (x) {
      setLoadErr(x instanceof Error && /manager/i.test(x.message) ? "This is the office's — the owner or a manager." : "It couldn't load. Try again.");
      return null;
    }
  }, []);

  useEffect(() => {
    const me = Symbol("proposal-more");
    if (listener) return;
    listener = me;
    function onOpen(e: Event) {
      const d = (e as CustomEvent<ProposalMoreDetail>).detail;
      if (!d?.proposalId) return;
      setId(d.proposalId);
      setSection(d.section);
      setData(null);
      setLoadErr(null);
      setNote(null);
      setChanged(false);
      setAdding({ workerId: "", pay: "" });
      setNewProject(null);
      setCancelling(null);
      setOpen(true);
      void load(d.proposalId);
    }
    document.addEventListener("jf:proposal-more", onOpen);
    return () => {
      document.removeEventListener("jf:proposal-more", onOpen);
      if (listener === me) listener = null;
    };
  }, [load]);

  // Opened from Crew: the crew section in view.
  useEffect(() => {
    if (!data || !section) return;
    bodyRef.current?.querySelector(`[data-more-sec="${section}"]`)?.scrollIntoView({ block: "start" });
  }, [data, section]);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    if (changed) {
      document.dispatchEvent(new CustomEvent("jf:payments-changed", { detail: { proposalId: id } }));
      router.refresh();
    }
  }, [busy, changed, id, router]);

  async function act(key: string, fn: () => Promise<string | { bad: string } | void>) {
    if (!id) return;
    setBusy(key);
    setNote(null);
    try {
      const r = await fn();
      setChanged(true);
      await load(id);
      if (r && typeof r === "object") setNote({ tone: "bad", text: r.bad });
      else if (typeof r === "string") setNote({ tone: "ok", text: r });
    } catch (x) {
      setNote({ tone: "bad", text: x instanceof Error ? x.message : "That didn't go through." });
    } finally {
      setBusy(null);
    }
  }

  const d = data;
  return (
    <BlueprintSheet open={open} onClose={close} title={d ? d.title : "Proposal"} description={d ? [d.client?.name, d.canceled ? "cancelled after sold" : d.sold ? `sold · ${money(d.money.collected)} of ${money(d.money.contract)} collected` : d.status.toLowerCase()].filter(Boolean).join(" · ") : undefined} width="min(640px, 100%)">
      <div className="pms" ref={bodyRef} data-more-sheet>
        {loadErr ? <p className="bps-err">{loadErr}</p> : null}
        {!d && !loadErr ? <p className="bps-note">Opening…</p> : null}
        {note ? (
          <p className={note.tone === "bad" ? "bps-err" : "pms-ok"} role="status" data-more-note>
            {note.text}
          </p>
        ) : null}

        {d ? (
          <>
            {d.canceled ? (
              <div className="pms-cancelled" data-more-cancelled>
                <b>Cancelled after sold</b> {d.canceled.at}
                {d.canceled.reason ? ` — ${d.canceled.reason}` : ""}
                <button type="button" className="bps-btn bps-btn--sm" disabled={!!busy} onClick={() => void act("reopen", async () => (await reopenSoldJob(d.proposalId), "Reopened — it's sold work again, with its payments and its job."))} data-more-reopen>
                  Reopen
                </button>
              </div>
            ) : null}

            {/* ── CREW ── */}
            <section className="pms-sec" data-more-sec="crew">
              <div className="pms-k">Crew</div>
              {d.job ? (
                <>
                  <a className="pms-link" href={`/dashboard/jobs/${d.job.id}`}>
                    {d.job.title} · {d.job.status.toLowerCase().replace("_", " ")}
                  </a>
                  {d.job.crew.length ? (
                    <ul className="pms-crew">
                      {d.job.crew.map((c) => (
                        <li key={c.assignmentId} data-more-crew={c.workerId}>
                          <span className="pms-crew-n">
                            {c.name}
                            <i>{c.status === "ACCEPTED" ? "accepted" : c.status === "DECLINED" ? "declined" : "asked"}</i>
                          </span>
                          <label className="pms-pay">
                            <span>$</span>
                            <input className="bps-in" inputMode="decimal" value={pays[c.assignmentId] ?? ""} onChange={(e) => setPays({ ...pays, [c.assignmentId]: e.target.value })} aria-label={`${c.name}'s pay`} data-more-pay />
                          </label>
                          <button
                            type="button"
                            className="bps-btn bps-btn--sm"
                            disabled={!!busy || (pays[c.assignmentId] ?? "") === String(c.pay || "")}
                            onClick={() =>
                              void act(`pay-${c.assignmentId}`, async () => {
                                const v = num(pays[c.assignmentId] ?? "");
                                if (v === null || Number.isNaN(v)) return { bad: "Enter the pay in dollars." };
                                const r = await setAssignmentPay(c.assignmentId, v);
                                return r.ok ? `${c.name}: ${money(r.pay)}.` : { bad: r.error };
                              })
                            }
                            data-more-pay-save
                          >
                            Save
                          </button>
                          <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost pms-del" disabled={!!busy} onClick={() => void act(`rm-${c.assignmentId}`, async () => (await unassignAssignment(c.assignmentId), `${c.name} is off the job.`))} data-more-crew-remove>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="bps-hint">Nobody on it yet.</p>
                  )}
                  <div className="pms-row">
                    <select className="bps-in" value={adding.workerId} onChange={(e) => setAdding({ ...adding, workerId: e.target.value })} aria-label="Who" data-more-crew-who>
                      <option value="">Put someone on it…</option>
                      {d.workers
                        .filter((w) => !d.job!.crew.some((c) => c.workerId === w.id))
                        .map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                            {w.role !== "INSTALLER" ? ` · ${w.role.toLowerCase()}` : ""}
                          </option>
                        ))}
                    </select>
                    <label className="pms-pay">
                      <span>$</span>
                      <input className="bps-in" inputMode="decimal" placeholder="pay" value={adding.pay} onChange={(e) => setAdding({ ...adding, pay: e.target.value })} aria-label="Their pay" data-more-crew-pay />
                    </label>
                    <button
                      type="button"
                      className="bps-btn bps-btn--sm bps-btn--primary"
                      disabled={!!busy || !adding.workerId}
                      onClick={() =>
                        void act("add-crew", async () => {
                          const who = d.workers.find((w) => w.id === adding.workerId);
                          await assignWorker(d.job!.id, adding.workerId);
                          const pay = num(adding.pay);
                          if (pay && !Number.isNaN(pay)) {
                            const fresh = await getProposalMore(d.proposalId);
                            const a = fresh.job?.crew.find((c) => c.workerId === adding.workerId);
                            if (a) await setAssignmentPay(a.assignmentId, pay);
                          }
                          setAdding({ workerId: "", pay: "" });
                          return `${who?.name ?? "They"} ${who ? "is" : "are"} on the job — asked to accept${pay ? `, ${money(pay)}` : ""}.`;
                        })
                      }
                      data-more-crew-add
                    >
                      Add
                    </button>
                  </div>
                </>
              ) : d.sold ? (
                <div className="pms-row">
                  <span className="bps-hint">No job on file for this sale yet.</span>
                  <button type="button" className="bps-btn bps-btn--sm bps-btn--primary" disabled={!!busy} onClick={() => void act("make-job", async () => (await createJobFromProposal(d.proposalId), "The job is made — it's on the calendar a week out; move it there."))} data-more-make-job>
                    Make the job
                  </button>
                </div>
              ) : (
                <p className="bps-hint">The crew comes once it&apos;s sold.</p>
              )}
            </section>

            {/* ── THE SALE ── */}
            <section className="pms-sec" data-more-sec="sale">
              <div className="pms-k">Sold by</div>
              {/* No sales commission on the plan (a new-plan Basic shop — the server refuses the edits): who sold it,
                  as words; no percent, no earnings. */}
              {!d.commission ? (
                <p className="pms-comm" data-more-seller-name>
                  {d.rep ? d.rep.name : "Nobody"}
                </p>
              ) : null}
              {d.commission ? <div className="pms-row">
                <select
                  className="bps-in"
                  value={d.rep?.userId ?? ""}
                  disabled={!!busy}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) void act("seller", async () => (await setDealSeller(d.proposalId, v), "Credited — the commission follows them."));
                  }}
                  data-more-seller
                >
                  {!d.rep ? <option value="">Nobody</option> : null}
                  {d.sellers.map((s) => (
                    <option key={s.userId} value={s.userId}>
                      {s.name} · {s.role.toLowerCase()}
                      {s.pct ? ` · ${s.pct}%` : ""}
                    </option>
                  ))}
                </select>
              </div> : null}
              {d.rep && d.commission ? (
                <>
                  <p className="pms-comm" data-more-commission>
                    {d.rep.pct ? (
                      <>
                        <b>{money(d.rep.earned)}</b> earned of {money(d.rep.full)} · {d.rep.pct}% {d.rep.dealPct != null ? "on this deal" : `(${d.rep.name.split(" ")[0]}'s own)`} — paid as the client pays, before tax.
                      </>
                    ) : (
                      <>No commission on this deal. Set {d.rep.name.split(" ")[0]}&apos;s percent on the Workers page, or one for this deal here.</>
                    )}
                  </p>
                  <div className="pms-row">
                    <label className="pms-pay">
                      <input className="bps-in" inputMode="decimal" placeholder={d.rep.repPct != null ? String(d.rep.repPct) : "0"} value={dealPct} onChange={(e) => setDealPctText(e.target.value)} aria-label="This deal's percent" data-more-deal-pct />
                      <span>%</span>
                    </label>
                    <button
                      type="button"
                      className="bps-btn bps-btn--sm"
                      disabled={!!busy}
                      onClick={() =>
                        void act("deal-pct", async () => {
                          const v = num(dealPct);
                          if (v !== null && Number.isNaN(v)) return { bad: "Enter a percent." };
                          await setDealCommission(d.proposalId, v);
                          return v ? `This deal pays ${v}%.` : "This deal follows the rep's own percent.";
                        })
                      }
                      data-more-deal-pct-save
                    >
                      Set for this deal
                    </button>
                  </div>
                </>
              ) : null}
              <label className="pms-check">
                <input type="checkbox" checked={d.callRepFirst} disabled={!!busy} onChange={(e) => {
                  const on = e.target.checked;
                  setData({ ...d, callRepFirst: on });
                  void act("call-first", async () => (await setDealCallFirst(d.proposalId, on), on ? `The crew sees "Call ${d.rep?.name.split(" ")[0] ?? "the rep"} first".` : "No call-first."));
                }} data-more-call-first />
                <span>
                  The crew calls {d.rep ? d.rep.name.split(" ")[0] : "the rep"} before starting{d.rep?.phone ? ` · ${d.rep.phone}` : ""} — something to explain on site
                </span>
              </label>
            </section>

            {/* ── PROJECT ── */}
            <section className="pms-sec" data-more-sec="project">
              <div className="pms-k">Project</div>
              {d.project ? (
                <p>
                  In <a className="pms-link" href={`/dashboard/projects/${d.project.id}`}>{d.project.name}</a>
                </p>
              ) : (
                <p className="bps-hint">Not in a project.</p>
              )}
              <div className="pms-row">
                <select
                  className="bps-in"
                  value=""
                  disabled={!!busy}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new") setNewProject(d.client ? `${d.client.name} — ${d.title}`.slice(0, 80) : d.title);
                    else if (v === "__out") void act("project", async () => (await setProposalProject({ proposalId: d.proposalId, projectId: null }), "Taken out of the project."));
                    else if (v) void act("project", async () => (await setProposalProject({ proposalId: d.proposalId, projectId: v }), `Filed in ${d.projects.find((p) => p.id === v)?.name ?? "the project"}.`));
                  }}
                  data-more-project
                >
                  <option value="">{d.project ? "Move to another project…" : "Add to a project…"}</option>
                  {d.projects
                    .filter((p) => p.id !== d.project?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.clients ? " · this client" : ""}
                      </option>
                    ))}
                  <option value="__new">+ New project…</option>
                  {d.project ? <option value="__out">Take it out of the project</option> : null}
                </select>
              </div>
              {newProject !== null ? (
                <div className="pms-row">
                  <input className="bps-in" value={newProject} maxLength={80} onChange={(e) => setNewProject(e.target.value)} aria-label="Project name" data-more-new-project />
                  <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setNewProject(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="bps-btn bps-btn--sm bps-btn--primary"
                    disabled={!!busy || !newProject.trim()}
                    onClick={() =>
                      void act("new-project", async () => {
                        const made = (await createProject({ name: newProject.trim(), clientId: d.client?.id ?? null })) as { id: string };
                        await setProposalProject({ proposalId: d.proposalId, projectId: made.id });
                        setNewProject(null);
                        return `Filed in the new project "${newProject.trim()}".`;
                      })
                    }
                    data-more-new-project-save
                  >
                    Make and file it
                  </button>
                </div>
              ) : null}
            </section>

            {/* ── CANCEL ── */}
            {d.cancel.can ? (
              <section className="pms-sec pms-sec--danger" data-more-sec="cancel">
                <div className="pms-k">Cancel the sold job</div>
                {cancelling ? (
                  <>
                    <div className="bps-chips">
                      {CANCEL_REASONS.map((r) => (
                        <button key={r} type="button" className={`bps-chip${cancelling.reason === r ? " is-on" : ""}`} onClick={() => setCancelling({ ...cancelling, reason: r })} data-more-cancel-reason>
                          {r}
                        </button>
                      ))}
                    </div>
                    <input className="bps-in" placeholder="Or in your words" maxLength={300} value={cancelling.other} onChange={(e) => setCancelling({ ...cancelling, other: e.target.value })} data-more-cancel-other />
                    <ul className="pms-warn">
                      {d.cancel.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                    <div className="pms-row">
                      <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost" onClick={() => setCancelling(null)}>
                        Keep it sold
                      </button>
                      <button
                        type="button"
                        className="bps-btn bps-btn--sm pms-del-solid"
                        disabled={!!busy || !(cancelling.reason || cancelling.other.trim())}
                        onClick={() =>
                          void act("cancel", async () => {
                            const r = await cancelSoldJob(d.proposalId, cancelling.other.trim() || cancelling.reason);
                            setCancelling(null);
                            return r.done.join(" ");
                          })
                        }
                        data-more-cancel-yes
                      >
                        Cancel the job
                      </button>
                    </div>
                  </>
                ) : (
                  <button type="button" className="bps-btn bps-btn--sm bps-btn--ghost pms-del" disabled={!!busy} onClick={() => setCancelling({ reason: "", other: "" })} data-more-cancel>
                    Cancel the sold job…
                  </button>
                )}
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </BlueprintSheet>
  );
}
