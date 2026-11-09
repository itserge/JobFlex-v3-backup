"use client";

// PROJECT DETAIL / BLUEPRINT — the page.
// Route: /dashboard/projects/[id].
//
// A verbatim port of `jobflex-projectdetail-blueprint (14).html`, wired to the
// REAL project. It REPLACES the classic record page that lived at
// src/app/(dashboard)/dashboard/projects/[id]/ — it does not stand beside it.
// (That reverses the side-by-side convention the earlier blueprint ports
// recorded in their headers, e.g. /dashboard/subscription-blueprint.)
//
// ── CHROME DROPPED ─────────────────────────────────────────────────
// The donor file carries its own sidebar, topbar, SVG sprite, `.layout`,
// `.main` (graph-paper field + scrollbars) and `.content` wrapper. ALL of it is
// discarded here: blueprint-shell already renders that furniture from
// src/app/dashboard/layout.tsx and it persists across navigation. Verified
// value-for-value against the donor before dropping — `--sidebar-w: 264px`,
// `--topbar-h: 62px`, `.content { padding: 40px 96px 80px; gap: 22px;
// display: flex; flex-direction: column; position: relative; z-index: 1 }` —
// all identical. This component returns ONLY the donor's `.content` children,
// as a fragment, so they stay DIRECT children of `.content`: the donor's
// reveal cascade walks `.content > *`.
//
// Also dropped, for the same reason: the donor's `#i-plus` symbol (the shell
// sprite's copy is character-identical — same viewBox, same two path `d`s), the
// nav burger / backdrop (the shell owns the drawer), FLUID SCALE, the sidebar
// cascade and the graph-paper parallax (shell-behavior.ts, same donor numbers).
//
// ── THE FIXTURE IS GONE ────────────────────────────────────────────
// The donor's six-job `JOBS` array, its three-job `AVAIL` array, its
// "Maple Ridge — Phase 2" title, its "$86,500" budget and its hardcoded
// Jun 15 → Sep 30 2026 window are all placeholders. Every one is read from the
// project instead; the page's existing query is untouched, and `attachJob` —
// the server action the old drawer called — still does the writing.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { setProposalProject } from "@/actions/projectLinks";
import Link from "next/link";
import type { Route } from "next";
import { closeMdl, openMdl } from "@/components/v3/blueprint-shell/mdl-motion";
import { money } from "@/lib/format";
import { KIND_TAG, kindOf } from "@/lib/projectKind";
import { useProjectDetailMotion } from "./project-detail-motion";
import {
  MO,
  MOFULL,
  type PdAvailProposal,
  type PdBudget,
  type PdJob,
  type PdOpens,
  type PdPayments,
  type PdBuying, PdSubs, PdSelections, PdPhases, PdLot, PdMoneyPlan, PdDraws,
  type PdField,
  type PdFinish,
  type PdShare,
  type PdTimeline,
  type PdProject,
  type PdStages,
  type PdWorker,
  type PdProposal,
  attachableFirst,
  badgeMod,
  bucketOf,
  changeOrderDoor,
  jobLabel,
  labelOf,
  needsDates,
  monthKey,
  proposalLabel,
  proposalMeta,
  proposalTone,
  shortDate,
  withLocalDays,
} from "./project-detail-data";
import s from "./project-detail.module.css";
import { PROJECT_STATUS, ProjectEditDialog } from "./project-edit-dialog";
import { ProjectPaymentsCard } from "@/components/v3/project-links/project-payments-card";
import { ProjectCombine } from "@/components/v3/project-links/project-combine";
import { ProjectCrewSheet } from "@/components/v3/project-links/project-crew-sheet";
import { LooseProposalsStrip } from "@/components/v3/project-links/loose-proposals-strip";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { ProjectBudgetCard } from "@/components/v3/project-links/project-budget-card";
import { ProjectStagesCard } from "@/components/v3/project-links/project-stages-card";
import { ProjectBuyingCard } from "@/components/v3/project-links/project-buying-card";
import { ProjectSubsCard } from "@/components/v3/project-links/project-subs-card";
import { ProjectSelectionsCard } from "@/components/v3/project-links/project-selections-card";
import { ProjectPhasesStrip } from "@/components/v3/project-links/project-phases-strip";
import { ProjectLotCard } from "@/components/v3/project-links/project-lot-card";
import { ProjectMoneyCard } from "@/components/v3/project-links/project-money-card";
import type { BuildAnswers } from "@/lib/projectPhases/shared";
import { ProjectFieldCard } from "@/components/v3/project-links/project-field-card";
import { ProjectTimelineCard } from "@/components/v3/project-links/project-timeline-card";
import { ProjectFinishCard } from "@/components/v3/project-links/project-finish-card";
import { ProjectClientCard } from "@/components/v3/project-links/project-client-card";
import { ProjectOverviewCard } from "@/components/v3/project-links/project-overview-card";
import type { Overview, Snoozes } from "@/lib/projectOverview/shared";
import { SPACES, spaceHref, type SpaceId } from "@/lib/projectSpaces";

/** "New proposal" on a project opens the estimator picker filed under it, so
 *  any engine — Smart Proposal, roof, fence, HVAC, video or manual — can make
 *  the project's next proposal (owner, 2026-09-18). */
function newProposalIn(project: PdProject) {
  document.dispatchEvent(
    new CustomEvent("jf:estimator-picker", {
      detail: {
        projectId: project.id,
        projectName: project.name,
        clientId: project.client?.id ?? null,
        clientName: project.client?.name ?? null,
      },
    }),
  );
}

/** Hashed module class, or the literal name when the module has none — which is
 *  how the fleet's global `rv` / `rv-in` / `rv-cell` / `pressed` pass through. */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => (s as Record<string, string>)[n as string] ?? (n as string))
    .join(" ");
}

type View = "list" | "calendar" | "gantt";
/** Donor: `let listF = 'all'`. */
type ListFilter = "all" | "done" | "prog" | "sch";

/** `?view=` — read so a link can open the record straight on its schedule or
 *  its gantt, at either width (the handheld build reads the same key).
 *  Anything unrecognised falls back to the donor's own default, the list. */
function viewFromParam(raw: string | null): View {
  return raw === "calendar" || raw === "gantt" ? raw : "list";
}

const DAY_MS = 86400000;

const moneyShort = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function ProjectDetailContent({
  project: projectIn,
  jobs,
  proposals = [],
  availableProposals,
  looseProposals = [],
  budget,
  canManage = false,
  opens = { client: true, jobs: true },
  payments = [],
  roster = [],
  stages = { stages: [], done: null, draftedByAi: false },
  buying,
  subs,
  selections,
  phases,
  lot,
  lotAddress = null,
  build = null,
  buildWords = null,
  moneyPlan,
  draws = null,
  field,
  timeline,
  finish,
  share,
  overview,
  space = "remodel",
  snoozes = {},
}: {
  project: PdProject;
  /** The Overview at the top (2026-11-09, lib/projectOverview) and the workspace the project lives in (lib/projectSpaces);
   *  `snoozes`: the rows the signed-in person hid with "Not now". */
  overview?: Overview;
  space?: SpaceId;
  snoozes?: Snoozes;
  /** The order of the work (2026-11-05). */
  stages?: PdStages;
  /** The to-buy list and the orders (2026-11-05). */
  buying?: PdBuying;
  subs?: PdSubs;
  /** What the client has to choose (2026-11-07). */
  selections?: PdSelections;
  /** A new build (part 4): the phases, the lot, the client's address, the start questions and their words. */
  phases?: PdPhases;
  lot?: PdLot;
  lotAddress?: string | null;
  build?: BuildAnswers | null;
  buildWords?: string | null;
  /** Who it is for and the money (part 5). */
  moneyPlan?: PdMoneyPlan;
  /** A lender's draws (part 6). */
  draws?: PdDraws | null;
  /** On site: problems, hours, the subs' bills (2026-11-05). */
  field?: PdField;
  /** The stages across the weeks (2026-11-06). */
  timeline?: PdTimeline;
  /** The punch list and the finish line (2026-11-06). */
  finish?: PdFinish;
  /** The client's page and the files (2026-11-06). */
  share?: PdShare;
  jobs: PdJob[];
  proposals?: PdProposal[];
  availableProposals: PdAvailProposal[];
  looseProposals?: Array<{ id: string; title: string; total: number }>;
  budget?: PdBudget;
  canManage?: boolean;
  opens?: PdOpens;
  payments?: PdPayments;
  roster?: PdWorker[];
}) {
  // The project's dates are days, not moments (withLocalDays).
  const project = useMemo(() => withLocalDays(projectIn), [projectIn]);
  const [editOpen, setEditOpen] = useState(false);
  // The job whose Schedule & crew sheet is open (2026-11-04).
  const [crewFor, setCrewFor] = useState<PdJob | null>(null);
  // A fresh dialog per open: what was typed and not saved does not come back.
  const [editKey, setEditKey] = useState(0);
  const closeEdit = useCallback(() => setEditOpen(false), []);
  const statusLbl = PROJECT_STATUS.find(([v]) => v === projectIn.status)?.[1] ?? null;
  const router = useRouter();
  const search = useSearchParams();
  const [, startTransition] = useTransition();

  // Donor: `let view = 'list'; let listF = 'all', calF = 'all';` — seeded from
  // `?view=` so a deep link opens the right tab, then owned by the tab bar.
  const [view, setView] = useState<View>(() => viewFromParam(search.get("view")));
  const [listF, setListF] = useState<ListFilter>("all");
  const [calF, setCalF] = useState<string>("all");

  // The optimistic move is a set of PROPOSAL ids laid over the server's list:
  // once `router.refresh()` lands, that proposal's jobs are in `jobs` and it is
  // gone from `availableProposals`, and the id turns inert on its own.
  const [moved, setMoved] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // The donor has no failure state — its attach cannot fail. A refused write
  // (permissions, a deleted record) says so in the dialog rather than silently
  // rolling the row back.
  const [attachErr, setAttachErr] = useState<string | null>(null);

  useProjectDetailMotion({ btnClass: s.btn, cellClass: s.kpi, valClass: s["kpi-val"] });

  /* ── the attach DIALOG ───────────────────────────────────────────────────
     Was an inline expanding panel under the tab bar; it is a house dialog now
     (owner, 2026-08-15). The motion helpers are imperative — `closeMdl` needs
     the exit keyframes to play before `.open` comes off, and a React render
     that unmounted the box would cut the exit — so the element is driven
     through a ref, exactly as client-detail's two dialogs are. */
  const attachRef = useRef<HTMLDivElement>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const [attachOpen, setAttachOpen] = useState(false);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const closeAttach = useCallback(() => {
    if (attachRef.current) closeMdl(attachRef.current, after);
    setAttachOpen(false);
  }, [after]);

  const openAttach = useCallback(() => {
    if (!attachRef.current) return;
    setAttachErr(null);
    openMdl(attachRef.current);
    setAttachOpen(true);
  }, []);

  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach(clearTimeout);
      set.clear();
    };
  }, []);

  // Escape closes, and stops there: the shell binds its own Escape for the
  // command palette and the handheld drawer, and one key press must not
  // dismiss two things.
  useEffect(() => {
    if (!attachOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeAttach();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [attachOpen, closeAttach]);

  const shownAvail = useMemo(
    () => attachableFirst(availableProposals.filter((p) => !moved.includes(p.id))),
    [availableProposals, moved],
  );
  /* No optimistic job row any more. The old panel attached ONE job and could
     splice a stand-in for it out of `availableJobs`; a proposal carries n jobs
     whose titles this page never reads, so inventing rows for them would mean
     widening the query to serve 300ms of placeholder. The attached proposal
     leaves the dialog list the instant it is picked (that is what `moved`
     does), and the jobs arrive with the refresh. */
  const shownJobs = jobs;

  /** Attach a PROPOSAL: file it under this project (its job and change orders
   *  come with it — actions/projectLinks). */
  const onAttach = useCallback(
    async (p: PdAvailProposal) => {
      setAttachErr(null);
      setBusyId(p.id);
      setMoved((m) => [...m, p.id]);
      try {
        await setProposalProject({ proposalId: p.id, projectId: project.id });
        startTransition(() => router.refresh());
      } catch (err) {
        setMoved((m) => m.filter((x) => x !== p.id));
        setAttachErr(err instanceof Error ? err.message : "Could not attach that proposal");
      } finally {
        setBusyId(null);
      }
    },
    [project.id, router],
  );

  // ================= KPI =================
  // Donor: JOBS.length / st === 'sch' / st === 'prog', and a fixed "$86,500".
  const kJobs = shownJobs.length;
  // Scheduled = on the calendar; an accepted job with no dates yet is counted apart.
  const kSch = shownJobs.filter((j) => j.status === "SCHEDULED" && !!j.startsAt).length;
  const kUndated = shownJobs.filter(needsDates).length;
  const kProg = shownJobs.filter((j) => j.status === "IN_PROGRESS").length;

  return (
    <>
      {/* PAGE HEAD — the client the project is for, and the door to a new
          proposal filed straight under it (2026-09-18). */}
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>
            {/* The workspace it lives in, in its colour, and the way back to it (2026-11-09). */}
            <Link href={spaceHref(space) as Route} style={{ color: SPACES[space].color }} data-project-space={space}>
              {SPACES[space].name}
            </Link>
            {project.number ? <span data-project-number>{` · #${project.number}`}</span> : null}
            <span data-project-kind={kindOf(project.kind)}>{` · ${KIND_TAG[kindOf(project.kind)]}`}</span>
            {project.client ? (
              <>
                {" · "}
                {opens.client ? (
                  <Link className={cx("pd-client-link")} href={`/dashboard/client-detail?client=${project.client.id}` as Route}>
                    {project.client.name}
                  </Link>
                ) : (
                  project.client.name
                )}
              </>
            ) : null}
          </div>
          <h1 className={cx("page-title")}>{project.name}</h1>
          {statusLbl && projectIn.status !== "ACTIVE" ? (
            <span
              className={cx("pd-status", projectIn.status === "COMPLETED" && "pd-status--done", projectIn.status === "ARCHIVED" && "pd-status--archived")}
              data-project-status={projectIn.status}
            >
              {statusLbl}
            </span>
          ) : null}
        </div>
        <div className={cx("page-actions")}>
          <button
            className={cx("btn", "btn-ghost")}
            type="button"
            onClick={() => {
              setEditKey((k) => k + 1);
              setEditOpen(true);
            }}
            data-project-edit-open
          >
            <svg className={cx("ic")}>
              <use href="#i-pen" />
            </svg>
            Edit project
          </button>
          <button className={cx("btn", "btn-primary")} type="button" onClick={() => newProposalIn(project)}>
            <svg className={cx("ic")}>
              <use href="#i-plus" />
            </svg>
            New proposal
          </button>
        </div>
      </div>

      {overview ? <ProjectOverviewCard projectId={project.id} projectName={project.name} overview={overview} space={space} snoozes={snoozes} canManage={canManage} /> : null}

      {/* KPI */}
      <div className={cx("kpi-grid", "kpi-grid--pd")}>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Jobs</div>
          <div className={cx("kpi-val")}>{kJobs}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Scheduled</div>
          <div className={cx("kpi-val")}>{kSch}</div>
          {kUndated > 0 && <div className={cx("kpi-sub")}>{kUndated} need{kUndated === 1 ? "s" : ""} dates</div>}
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>In progress</div>
          <div className={cx("kpi-val")}>{kProg}</div>
        </div>
        <div className={cx("kpi")}>
          <div className={cx("kpi-lbl")}>Cost budget</div>
          <div className={cx("kpi-val")}>{money(project.budget)}</div>
        </div>
      </div>

      {phases && phases.phases.length ? <ProjectPhasesStrip phases={phases} answers={buildWords} /> : null}
      {kindOf(project.kind) === "NEW_BUILD" && lot && timeline ? <ProjectLotCard projectId={project.id} lot={lot} answers={build} clientAddress={lotAddress} today={timeline.today} canManage={canManage} /> : null}
      <ProjectStagesCard projectId={project.id} stages={stages} canManage={canManage} kind={kindOf(project.kind)} />
      {timeline ? <ProjectTimelineCard projectId={project.id} timeline={timeline} canManage={canManage} /> : null}
      {share ? <ProjectClientCard projectId={project.id} share={share} canManage={canManage} /> : null}
      {field ? <ProjectFieldCard projectId={project.id} field={field} canManage={canManage} /> : null}
      {finish ? <ProjectFinishCard projectId={project.id} finish={finish} jobs={jobs.map((j) => ({ id: j.id, title: j.title }))} payments={payments} canManage={canManage} /> : null}
      <LooseProposalsStrip projectId={project.id} client={project.client} loose={looseProposals} />
      <ProposalsCard proposals={proposals} project={project} onAttach={openAttach} canManage={canManage} />
      <ProjectCombine projectId={project.id} projectName={project.name} proposals={proposals} />
      {selections ? <ProjectSelectionsCard projectId={project.id} selections={selections} stages={stages.stages} canManage={canManage} /> : null}
      {buying ? <ProjectBuyingCard projectId={project.id} buying={buying} stages={stages.stages} canManage={canManage} /> : null}
      {subs ? <ProjectSubsCard projectId={project.id} subs={subs} stages={stages.stages} canManage={canManage} sectionHref={`/dashboard/projects/${project.id}/subs`} /> : null}
      {moneyPlan ? <ProjectMoneyCard projectId={project.id} money={moneyPlan} canManage={canManage} /> : null}
      {budget ? <ProjectBudgetCard projectId={project.id} budget={budget} /> : null}
      <ProjectPaymentsCard payments={payments} canManage={canManage} draws={draws} projectId={project.id} />

      {/* ВИДЫ + ATTACH */}
      <div className={cx("pd-bar")}>
        <div className={cx("pd-tabs")}>
          <button
            className={cx("pd-tab", view === "list" && "on")}
            type="button"
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            className={cx("pd-tab", view === "calendar" && "on")}
            type="button"
            onClick={() => setView("calendar")}
          >
            Calendar
          </button>
          <button
            className={cx("pd-tab", view === "gantt" && "on")}
            type="button"
            onClick={() => setView("gantt")}
          >
            Gantt
          </button>
        </div>
        <button className={cx("btn", "btn-ghost")} type="button" onClick={openAttach}>
          <svg className={cx("ic")}>
            <use href="#i-plus" />
          </svg>
          Attach proposal
        </button>
      </div>

      <ProjectEditDialog key={editKey} project={projectIn} open={editOpen} onClose={closeEdit} />
      <ProjectCrewSheet key={crewFor?.id ?? "none"} job={crewFor} roster={roster} onClose={() => setCrewFor(null)} />

      {/* ATTACH DIALOG — was an inline expanding panel under the tab bar
          (owner, 2026-08-15). It wears `mdl pmdl`, the house dialog frame the
          always-on proposals module publishes, so it opens and closes on the
          same motion contract as every other dialog in the app and introduces
          no new vocabulary. What it lists changed too: PROPOSALS, not jobs —
          see the note above `PdAvailProposal` in ./project-detail-data.ts for
          what the schema allows and why some rows arrive blocked. */}
      <div
        className={cx("mdl", "pmdl")}
        ref={attachRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdAttachTitle"
      >
        <div className={cx("mdl-bg")} onClick={closeAttach} />
        <div className={cx("mdl-box")}>
          <div className={cx("mdl-head", "mdl-head--row")}>
            <span id="pdAttachTitle">Attach a proposal</span>
            <button
              className={cx("mdl-x")}
              type="button"
              onClick={closeAttach}
              aria-label="Close dialog"
            >
              <svg className={cx("ic")}>
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className={cx("mdl-txt")}>
            Picking one files it under {project.name} — its change orders and its job come with it.
          </div>
          <div className={cx("mdl-body", "pd-attach-list")}>
            {attachErr && <div className={cx("pd-attach-err")}>{attachErr}</div>}
            {shownAvail.length ? (
              shownAvail.map((p) => (
                <div className={cx("pd-av")} key={p.id}>
                  <span className={cx("pd-av-n")}>{p.title}</span>
                  <span className={cx("pd-av-m")}>{proposalMeta(p, money)}</span>
                  <button
                    className={cx("btn", "btn-primary")}
                    type="button"
                    disabled={busyId === p.id}
                    onClick={() => onAttach(p)}
                  >
                    {busyId === p.id ? "Attaching" : "Attach"}
                  </button>
                </div>
              ))
            ) : (
              <div className={cx("pd-empty")}>No proposals left</div>
            )}
          </div>
          <div className={cx("mdl-foot")}>
            <button className={cx("btn", "btn-ghost")} type="button" onClick={closeAttach}>
              Close
            </button>
          </div>
        </div>
      </div>

      <div>
        {view === "list" ? (
          <ListView jobs={shownJobs} listF={listF} onFilter={setListF} openJobs={opens.jobs} onCrew={canManage ? setCrewFor : null} />
        ) : view === "calendar" ? (
          <CalView project={project} jobs={shownJobs} calF={calF} onFilter={setCalF} />
        ) : (
          <GanttView project={project} jobs={shownJobs} />
        )}
      </div>
    </>
  );
}

/* ================= PROPOSALS (2026-09-18) =================
   The proposals filed under the project, oldest first — the order the job was
   sold in. Each row: what it is, its status, its contract today (the total
   plus approved change orders) and what is still waiting on the client. The
   card's head carries the project's sold value and the open value, which is
   the number a contractor looks for first. */

function ProposalsCard({
  proposals,
  project,
  onAttach,
  canManage,
}: {
  proposals: PdProposal[];
  project: PdProject;
  onAttach: () => void;
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // The proposal whose change orders are open (2026-09-18) — the same sheet
  // the Proposals page and the job page use: price extras, send for signature.
  const [coFor, setCoFor] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const won = proposals.filter((p) => proposalTone(p.status) === "done");
  const open = proposals.filter((p) => proposalTone(p.status) === "prog" || proposalTone(p.status) === "sch");
  const sold = won.reduce((n, p) => n + p.contract, 0);
  const pending = open.reduce((n, p) => n + p.total, 0);

  const moveOut = async (p: PdProposal) => {
    if (!window.confirm(`Take "${p.title}" out of this project? The proposal itself is not changed.`)) return;
    setBusy(p.id);
    try {
      await setProposalProject({ proposalId: p.id, projectId: null });
      startTransition(() => router.refresh());
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={cx("card", "pd-props")} aria-label="Proposals in this project">
      <ChangeOrderSheet
        open={coFor !== null}
        onClose={() => setCoFor(null)}
        proposalId={coFor ?? undefined}
        onDone={() => startTransition(() => router.refresh())}
      />
      <div className={cx("pd-jobs-h")}>
        <h2 className={cx("pd-jobs-t")}>Proposals</h2>
        <span className={cx("pd-props-sum")}>
          {won.length ? (
            <>
              {/* What the client pays, tax in — the Budget card's contract is the same before tax. */}
              Sold <b>{moneyShort(sold)}</b> with tax
            </>
          ) : null}
          {won.length && open.length ? " · " : null}
          {open.length ? (
            <>
              Open <b>{moneyShort(pending)}</b>
            </>
          ) : null}
          {!proposals.length ? "None yet" : null}
        </span>
      </div>
      {proposals.length ? (
        <div className={cx("pd-props-list")}>
          {proposals.map((p, i) => (
            <div className={cx("pd-prop")} key={p.id}>
              <span className={cx("pd-prop-no")} aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className={cx("pd-prop-main")}>
                <Link className={cx("pd-prop-n")} href={`/dashboard/proposals/${p.id}` as Route}>
                  {p.title}
                </Link>
                <div className={cx("pd-row-m")}>
                  {p.clientName ?? "No client"}
                  {p.co.count
                    ? ` · ${p.co.count} change order${p.co.count === 1 ? "" : "s"}` +
                      (p.co.approved ? ` · ${p.co.approvedTotal >= 0 ? "+" : "−"}${moneyShort(Math.abs(p.co.approvedTotal))} approved` : "") +
                      (p.co.pending ? ` · ${moneyShort(p.co.pendingTotal)} waiting` : "")
                    : ""}
                  {" · "}
                  {shortDate(p.updatedAt)}
                </div>
              </div>
              <span className={cx("pd-b", "pd-b--" + proposalTone(p.status))}>{proposalLabel(p.status)}</span>
              {changeOrderDoor(p, canManage) ? (
                <button
                  className={cx("pd-prop-co")}
                  type="button"
                  onClick={() => setCoFor(p.id)}
                  aria-label={`Change orders for ${p.title}`}
                >
                  <svg className={cx("ic")}>
                    <use href="#i-plus" />
                  </svg>
                  {p.co.count ? `Change orders · ${p.co.count}` : "Change order"}
                </button>
              ) : (
                <span className={cx("pd-prop-co-gap")} aria-hidden="true" />
              )}
              <span className={cx("pd-prop-amt")}>
                {moneyShort(p.contract)}
                {Math.round(p.contract) !== Math.round(p.total) ? <i>was {moneyShort(p.total)}</i> : null}
              </span>
              <button
                className={cx("pd-prop-x")}
                type="button"
                aria-label={`Take ${p.title} out of this project`}
                title="Take out of this project"
                disabled={busy === p.id}
                onClick={() => void moveOut(p)}
              >
                <svg className={cx("ic")}>
                  <use href="#i-x" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className={cx("pd-props-empty")}>
          <span>No proposals in this project yet.</span>
          <button className={cx("btn", "btn-primary")} type="button" onClick={() => newProposalIn(project)}>
            New proposal
          </button>
          <button className={cx("btn", "btn-ghost")} type="button" onClick={onAttach}>
            Attach one
          </button>
        </div>
      )}
    </section>
  );
}

/* ================= ВИДЫ ================= */

/** A job row: a link to the job, or a plain row for a role that cannot open it. */
function RowLink({ className, href, children }: { className: string; href: string | null; children: React.ReactNode }) {
  return href ? (
    <Link className={className} href={href as Route} data-pd-job>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

function ListView({
  jobs,
  listF,
  onFilter,
  openJobs,
  onCrew,
}: {
  jobs: PdJob[];
  listF: ListFilter;
  onFilter: (f: ListFilter) => void;
  /** False for a role with no job page: the rows stay plain. */
  openJobs: boolean;
  /** Opens Schedule & crew for a job — owners and managers; null hides the button. */
  onCrew: ((j: PdJob) => void) | null;
}) {
  const counts: Record<ListFilter, number> = {
    all: jobs.length,
    done: jobs.filter((j) => bucketOf(j.status) === "done").length,
    prog: jobs.filter((j) => bucketOf(j.status) === "prog").length,
    sch: jobs.filter((j) => bucketOf(j.status) === "sch").length,
  };
  const FILTERS: Array<[ListFilter, string]> = [
    ["all", "All"],
    ["prog", "In progress"],
    ["sch", "Scheduled"],
    ["done", "Done"],
  ];
  const vis = listF === "all" ? jobs : jobs.filter((j) => bucketOf(j.status) === listF);

  return (
    <section className={cx("card")}>
      <div className={cx("pd-jobs-h")}>
        <h2 className={cx("pd-jobs-t")}>Jobs</h2>
        <span className={cx("pd-jobs-s")}>
          {vis.length} of {jobs.length}
        </span>
      </div>
      <div className={cx("pd-fbar")}>
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            className={cx("pd-f", k !== "all" && "pd-f--" + k, listF === k && "on")}
            type="button"
            onClick={() => onFilter(k)}
          >
            {label} <i>{counts[k]}</i>
          </button>
        ))}
      </div>
      {vis.length ? (
        vis.map((j) => (
          <div className={cx("pd-row", "pd-row--job")} key={j.id}>
          <RowLink className={cx("pd-row-main", openJobs && "pd-row--link")} href={openJobs ? `/dashboard/jobs/${j.id}` : null}>
            <div>
              <div className={cx("pd-row-n")}>{j.title}</div>
              <div className={cx("pd-row-m")}>
                {j.clientName ?? "Unassigned"}
                {j.startsAt
                  ? " · " +
                    shortDate(j.startsAt) +
                    (j.endsAt ? " → " + shortDate(j.endsAt) : "")
                  : ""}
                {j.contract
                  ? j.contract.changes !== 0
                    ? ` · ${moneyShort(j.contract.original)} ${j.contract.changes > 0 ? "+" : "−"} ${moneyShort(Math.abs(j.contract.changes))} in changes → ${moneyShort(j.contract.current)}`
                    : ` · ${moneyShort(j.contract.current)}`
                  : ""}
              </div>
              {j.crew?.length ? <div className={cx("pd-row-crew")}>Crew · {j.crew.map((c) => c.name).join(", ")}</div> : null}
            </div>
            <span className={cx("pd-b", "pd-b--" + badgeMod(j.status))}>{jobLabel(j)}</span>
          </RowLink>
          {onCrew ? (
            <button className={cx("btn", "btn-ghost", "pd-crew-btn")} type="button" onClick={() => onCrew(j)} data-pd-crew={j.title}>
              {j.startsAt || j.crew?.length ? "Schedule & crew" : "Schedule"}
            </button>
          ) : null}
          </div>
        ))
      ) : (
        <div className={cx("pd-empty")}>Nothing in this filter</div>
      )}
    </section>
  );
}

/** The donor's project window, or — when the project carries no dates — the
 *  span the dated jobs themselves cover. The donor hardcodes
 *  `W0 = Jun 15 2026`, `W1 = Sep 30 2026`. */
function windowOf(project: PdProject, jobs: PdJob[]): { w0: number; w1: number } | null {
  if (project.startsAt && project.endsAt) {
    const w0 = project.startsAt.getTime();
    const w1 = project.endsAt.getTime();
    if (w1 > w0) return { w0, w1 };
  }
  const dated = jobs.filter((j) => j.startsAt);
  if (!dated.length) return null;
  const w0 = Math.min(...dated.map((j) => j.startsAt!.getTime()));
  const w1 = Math.max(...dated.map((j) => (j.endsAt ?? j.startsAt!).getTime() + DAY_MS));
  return w1 > w0 ? { w0, w1 } : null;
}

function CalView({
  project,
  jobs,
  calF,
  onFilter,
}: {
  project: PdProject;
  jobs: PdJob[];
  calF: string;
  onFilter: (f: string) => void;
}) {
  // Donor: `const MONTHS = [5, 6, 7, 8]` — the months the project window covers,
  // single-year. Derived here so the chip row follows the real window; the key
  // carries the year too, which the donor's month index alone could not.
  const win = windowOf(project, jobs);
  const months: Array<{ y: number; m: number; key: string }> = [];
  if (win) {
    const cur = new Date(win.w0);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(1);
    const end = new Date(win.w1);
    while (cur.getTime() <= end.getTime()) {
      months.push({ y: cur.getFullYear(), m: cur.getMonth(), key: cur.getFullYear() + "-" + cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  function inMonth(j: PdJob, y: number, m: number) {
    const m0 = new Date(y, m, 1).getTime();
    const m1 = new Date(y, m + 1, 1).getTime() - 1;
    const s0 = j.startsAt!.getTime();
    const e0 = (j.endsAt ?? j.startsAt!).getTime();
    return s0 <= m1 && e0 >= m0;
  }

  const dated = jobs.filter((j) => j.startsAt);
  const sorted = dated
    .filter((j) => {
      if (calF === "all") return true;
      const mo = months.find((x) => x.key === calF);
      return mo ? inMonth(j, mo.y, mo.m) : true;
    })
    .slice()
    .sort((a, b) => a.startsAt!.getTime() - b.startsAt!.getTime());

  const body: React.ReactNode[] = [];
  let lastMo = "";
  sorted.forEach((j) => {
    const k = monthKey(j.startsAt!);
    if (k !== lastMo) {
      lastMo = k;
      body.push(
        <div className={cx("pd-ag-mo")} key={"mo-" + k}>
          {MOFULL[j.startsAt!.getMonth()]} {j.startsAt!.getFullYear()}
        </div>,
      );
    }
    body.push(
      <div className={cx("pd-agrow")} key={j.id}>
        <span className={cx("pd-ag-d")}>
          {shortDate(j.startsAt!)}
          {j.endsAt ? " → " + shortDate(j.endsAt) : ""}
        </span>
        <div>
          <div className={cx("pd-row-n")}>{j.title}</div>
          <div className={cx("pd-row-m")}>{j.clientName ?? "Unassigned"}</div>
        </div>
        <span className={cx("pd-b", "pd-b--" + badgeMod(j.status))}>{labelOf(j.status)}</span>
      </div>,
    );
  });

  return (
    <section className={cx("card")}>
      <div className={cx("pd-cal-head")}>
        <h2 className={cx("pd-cal-t")}>Schedule</h2>
        <span className={cx("pd-cal-s")}>
          {project.startsAt && project.endsAt
            ? "project window · " + shortDate(project.startsAt) + " → " + shortDate(project.endsAt)
            : "no window set"}
        </span>
      </div>
      <div className={cx("pd-fbar")}>
        <button
          className={cx("pd-f", calF === "all" && "on")}
          type="button"
          onClick={() => onFilter("all")}
        >
          All dates
        </button>
        {months.map((mo) => (
          <button
            key={mo.key}
            className={cx("pd-f", calF === mo.key && "on")}
            type="button"
            onClick={() => onFilter(mo.key)}
          >
            {MOFULL[mo.m].slice(0, 3)} <i>{dated.filter((j) => inMonth(j, mo.y, mo.m)).length}</i>
          </button>
        ))}
      </div>
      {body.length ? body : <div className={cx("pd-empty")}>Nothing scheduled in this range</div>}
    </section>
  );
}

function GanttView({ project, jobs }: { project: PdProject; jobs: PdJob[] }) {
  const win = windowOf(project, jobs);
  const rows = jobs.filter((j) => j.startsAt);

  // Donor, verbatim:
  //   host.querySelectorAll('.pd-g-bar').forEach((b, i) => {
  //     if (reduce) { b.classList.add('in'); return; }
  //     setTimeout(() => b.classList.add('in'), 120 + i * 70);
  //   });
  // Driven straight at the DOM rather than through state, exactly as the donor
  // does — a re-render rebuilds the bars at scaleX(0) and the run replays,
  // which is what `renderView()` produces too.
  const hostRef = useRef<HTMLElement>(null);
  const runKey = rows.map((j) => j.id).join(",");
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bars = Array.from(host.querySelectorAll<HTMLElement>("." + s["pd-g-bar"]));
    const timers: number[] = [];
    bars.forEach((b, i) => {
      if (reduce) {
        b.classList.add(s.in);
        return;
      }
      timers.push(window.setTimeout(() => b.classList.add(s.in), 120 + i * 70));
    });
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [runKey]);

  if (!win || !rows.length) {
    return (
      <section className={cx("card")}>
        <div className={cx("pd-empty")}>Nothing scheduled in this range</div>
      </section>
    );
  }

  const span = win.w1 - win.w0;

  // месячная ось: первое число каждого месяца внутри окна (месяц окна обрезан
  // его началом — донор перечисляет Jul, Aug, Sep для окна Jun 15 → Sep 30)
  const ticks: Array<{ key: string; left: string; label: string }> = [];
  {
    const cur = new Date(win.w0);
    cur.setHours(0, 0, 0, 0);
    cur.setDate(1);
    cur.setMonth(cur.getMonth() + 1);
    while (cur.getTime() <= win.w1) {
      if (cur.getTime() > win.w0) {
        ticks.push({
          key: cur.getFullYear() + "-" + cur.getMonth(),
          left: (((cur.getTime() - win.w0) / span) * 100).toFixed(1),
          label: MO[cur.getMonth()],
        });
      }
      cur.setMonth(cur.getMonth() + 1);
    }
  }

  return (
    <section className={cx("card")} ref={hostRef}>
      <div className={cx("pd-g-axis")}>
        <div></div>
        <div className={cx("pd-g-months")}>
          {ticks.map((t) => (
            <span className={cx("pd-g-month")} key={t.key} style={{ left: t.left + "%" }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>
      {rows.map((j) => {
        const st = j.startsAt!.getTime();
        // `+ 86400000` is the donor's: its fixture dates are whole days and the
        // end day is inclusive. Ported as written.
        const en = (j.endsAt ?? j.startsAt!).getTime() + DAY_MS;
        const width = Math.max(3, Math.min(100, ((en - st) / span) * 100));
        const left = Math.min(100 - width, Math.max(0, ((st - win.w0) / span) * 100));
        const label = width >= 12 ? j.title : "";
        return (
          <div className={cx("pd-g-row")} key={j.id}>
            <div className={cx("pd-g-name")}>{j.title}</div>
            <div className={cx("pd-g-track")}>
              <div
                className={cx("pd-g-bar", "pd-g-bar--" + badgeMod(j.status))}
                style={{ left: left.toFixed(1) + "%", width: width.toFixed(1) + "%" }}
                title={
                  j.title +
                  " · " +
                  shortDate(j.startsAt!) +
                  (j.endsAt ? " → " + shortDate(j.endsAt) : "")
                }
              >
                {label}
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
