"use client";

// JOB DETAIL · HANDHELD — /dashboard/jobs/[id] at ≤768px, and /mobile-job-detail-v1/[id]
//
// The handheld build of the job record, fluid 320px → 768px. It stands BESIDE
// the desktop page (src/components/v3/job-detail-blueprint/*), which keeps
// serving /dashboard/jobs/[id] above 768px. Both entry points import this one
// implementation, so the preview URL and the live URL cannot drift.
//
// ── THE SAME RECORD AS THE DESKTOP, NOT A FIXTURE ──────────────────────────
// This page shipped rendering the desktop port's demo fixture. It now takes the
// `record` the server read in ../job-detail-blueprint/job-detail-load.ts — the
// same object the desktop edition renders, passed down by the viewport switch —
// so the two can only ever disagree about LAYOUT. Every write goes through
// ../job-detail-blueprint/use-job-detail-actions.ts, which is also shared: one
// set of rules about what a button does, drawn two ways.
//
// ── WHAT WAS RE-CUT, AND WHY ───────────────────────────────────────────────
// · The six-tab bar is a dropdown section picker (owner's call) — six tabs plus
//   counts measure ~640px.
// · Overview's 2fr/1fr grid is one column; the Client contact card follows the
//   Overview card as its own block, so each reveals on its own.
// · `jd-fields` 4-up → 2-up; `jd-photos` 4-up → 2-up (4/3 + hatch kept).
// · The change-order row's `1fr 104px 104px 140px` grid restacks into an
//   identity block over a money-and-decision strip.
// · "View proposal" — the one action the desktop head carries on all six tabs
//   — becomes the thumb-zone bar, as a grid row of the shell. It is present
//   ONLY when the job has a linked proposal; with none, the row collapses and
//   the sheet runs to the bottom edge.
//
// ── AND IT IS ALSO THE FIELD WORKER'S RECORD ───────────────────────────────
// An INSTALLER on a phone gets this build, with `record.viewer === "worker"`:
// no Changes or Expenses section, no proposal bar, an assignment stamp on the
// Overview card, and the two office affordances re-cut for the field (the
// address gains "Get directions", "Add to schedule" becomes "Add to calendar").
// See the same block in ../job-detail-blueprint/job-detail-content.tsx — the
// worker record is one prop on the shared components, not a component of its
// own, so the two audiences cannot drift apart.
//
// ── MOTION ─────────────────────────────────────────────────────────────────
// Balanced: a reveal cascade over the content blocks (adaptive duration below
// the fold), the graph-paper parallax, a press stamp delegated from the root,
// and a row arrival that plays ONLY when a view genuinely arrives — it is
// keyed on the tab, never wired to a MutationObserver, which is the most
// expensive trap in this codebase. prefers-reduced-motion switches all of it
// off in both CSS and JS.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { PortalBar } from "@/components/v3/mobile-shell/portal-bar";
import { CrewActions, CrewDays, CrewPendingBanner, CrewReceipts } from "@/components/v3/crew-board/crew-board";
import { CrewField } from "@/components/v3/crew-board/crew-field";
import {
  JD_ASSIGN,
  ST,
  STATUS_BUTTONS,
  fmt,
  type JobDetailRecord, KEY_TO_STATUS } from "@/components/v3/job-detail-blueprint/job-detail-data";
import { useJobDetailActions } from "@/components/v3/job-detail-blueprint/use-job-detail-actions";
import { onSiteLine } from "@/lib/jobProgressShared";
import { Who } from "@/components/v3/who/who";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { useRouter } from "next/navigation";
import "./mobile-job-detail.css";
import { openRepairSheet } from "@/components/v3/repairs/repair-sheet";
import { openPaymentsPanel } from "@/components/v3/payments-panel/payments-sheet";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Same sections, same order, same counts as the desktop's `TABS`. "days"
 *  replaced "photos" (stage C, 2026-09-30); "receipts" is the crew's. */
type TabKey = "overview" | "schedule" | "crew" | "changes" | "days" | "receipts" | "expenses";

/* The head's status badge (and its `ST_MOD` class map) was removed at the
   owner's request. Status itself is unchanged — it is set and shown on the
   Overview card's picker, which owns the control. `ST`'s labels came back for
   the WORKER edition only, which has no picker to read the status off. */

function Icon({ id }: { id: string }) {
  return (
    <svg className="mjd-ic" aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** DESIGN.md's empty state: a note on the drawing, 1.5px dashed. */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="mjd-empty">{children}</div>;
}

/** Stagger index as a custom property — read by `.mjd-rowin`'s animation-delay. */
const rowVar = (i: number) => ({ "--i": i }) as React.CSSProperties;

export function MobileJobDetail({ record }: { record: JobDetailRecord }) {
  const scrollRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [tab, setTab] = useState<TabKey>("overview");
  const [rosterOpen, setRosterOpen] = useState(false);
  // The row arrival plays on a REAL view change only, never on the first paint
  // (where the block reveal already carries the entrance) and never on a
  // repaint such as approving a change order.
  const [switched, setSwitched] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  const router = useRouter();

  const a = useJobDetailActions(
    record.id,
    record.booking,
    record.status,
    record.viewer === "worker",
    record.blobEnabled,
    record.door,
  );

  // What counts (lib/expenseTotals): approved and reimbursed receipts only.
  const expTotal = record.board.totals.counted;
  const fileCount = record.board.days.reduce((n, d) => n + d.files.length, 0) + record.board.looseFiles.length;
  const portal = record.door.kind === "token";
  const scheduled = record.events.length > 0;
  // The field worker's edition — see the block on `JdViewer` in
  // ../job-detail-blueprint/job-detail-data.ts, and the same three consts in
  // the desktop component. This build is the one an installer actually uses:
  // they open the job on a phone, standing in a driveway.
  const worker = record.viewer === "worker";
  const assign = record.assignment ? JD_ASSIGN[record.assignment] : null;

  // Money is dropped for the field: Changes and Expenses are the two sections a
  // worker's record has no columns behind.
  const TABS: Array<[TabKey, string, number | null]> = [
    ["overview", "Overview", null],
    ["schedule", "Schedule", record.events.length],
    ["crew", "Crew", record.crew.length],
    ...(worker
      ? []
      : ([["changes", "Changes", record.changes.length]] as Array<
          [TabKey, string, number | null]
        >)),
    ["days", "Days & photos", fileCount],
    ...(worker
      ? ([["receipts", "Receipts", record.board.receipts.length]] as Array<[TabKey, string, number | null]>)
      : ([["expenses", "Expenses", record.board.receipts.length]] as Array<
          [TabKey, string, number | null]
        >)),
  ];

  const selectTab = useCallback((k: TabKey) => {
    setTab(k);
    setSwitched(true);
  }, []);

  /* ---------- Motion: reveal on load + adaptive reveal on scroll ---------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    let velLastY = host.scrollTop;
    let velLastT = performance.now();
    let vel = 0;
    const onScroll = () => {
      const now = performance.now();
      vel = Math.abs(host.scrollTop - velLastY) / Math.max(1, now - velLastT);
      velLastY = host.scrollTop;
      velLastT = now;
    };
    host.addEventListener("scroll", onScroll, { passive: true });

    const vpH = window.innerHeight;
    // The blocks that exist at mount only. A view mounted later by a tab tap
    // is NOT decorated — it arrives with its own row stagger instead, and an
    // undecorated element renders at full opacity, so nothing can be stranded
    // invisible by an observer that stopped watching.
    const blocks = Array.from(content.children) as HTMLElement[];
    blocks.forEach((el, i) => {
      el.classList.add("mjd-rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? `${i * 60}ms` : "200ms";
    });

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const t = en.target as HTMLElement;
          // Below the fold: duration follows scroll speed — slow ≈ 900ms, fast
          // never shorter than 550ms.
          if (t.dataset.rvScroll) {
            t.style.transitionDuration = `${Math.round(Math.max(550, 900 - vel * 160))}ms`;
          }
          t.classList.add("mjd-rv-in");
          io.unobserve(t);
          const done = () => {
            t.style.transitionDelay = "";
            t.style.transitionDuration = "";
            t.removeEventListener("transitionend", done);
          };
          t.addEventListener("transitionend", done);
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      host.removeEventListener("scroll", onScroll);
    };
  }, []);

  /* ---------- Motion: graph-paper parallax ------------------------------- */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const host = scrollRef.current;
    if (!host) return;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        host.style.setProperty("--gy", `${(-(host.scrollTop * 0.06)).toFixed(1)}px`);
        ticking = false;
      });
    };
    host.addEventListener("scroll", onScroll, { passive: true });
    return () => host.removeEventListener("scroll", onScroll);
  }, []);

  /* ---------- Motion: press stamp, delegated from the root ---------------
     Bound to the root rather than to the controls that exist at mount: the
     tab views replace their controls wholesale, and a listener attached at
     mount would lose every one of them on the first tab tap. */
  const onRootClick = useCallback((e: React.MouseEvent) => {
    if (prefersReducedMotion()) return;
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(
      ".mjd-btn, .mjd-tab, .mjd-sbtn, .mjd-pick-row",
    );
    if (!el) return;
    el.classList.remove("mjd-pressed");
    void el.offsetWidth;
    el.classList.add("mjd-pressed");
  }, []);
  const onRootAnimEnd = useCallback((e: React.AnimationEvent) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains("mjd-pressed")) el.classList.remove("mjd-pressed");
  }, []);

  return (
    <div
      className="jf-mobile-job-detail"
      onClick={onRootClick}
      onAnimationEnd={onRootAnimEnd}
    >
      {/* Shared handheld chrome: dark topbar + slide-out drawer + icon sprite.
          It owns its own state and reads its token contract off this root.
          The worker portal has no dashboard to navigate: its own bar, same
          plate, with "All jobs" where the burger is (stage C). */}
      {record.chrome === "portal" && record.portal ? (
        <PortalBar workerName={record.portal.workerName} orgName={record.portal.orgName} backHref={record.portal.backHref} />
      ) : (
        <MobileNav />
      )}

      <main className="mjd-scroll" ref={scrollRef}>
        <div className="mjd-content" ref={contentRef}>
          {/* ============ PAGE HEAD ============ */}
          {/* The "Job status ·" kicker and its badge were removed at the
              owner's request. Status is still set and read on the Overview
              card's own picker, which is the control that owns it. */}
          <div className="mjd-head">
            {/* A project's job leads back to its project (2026-11-04). */}
            {record.project && (
              <Link className="mjd-proj" href={`/dashboard/projects/${record.project.id}` as Route} data-job-project>
                ← Project · {record.project.name}
              </Link>
            )}
            <h1 className="mjd-title">{record.title}</h1>
            <div className="mjd-dates">{record.dates}</div>
            {/* A repair says what it's for (2026-11-09); the desk page lets the office change why it came back. */}
            {record.repair ? (
              <div className="mjd-repair" data-job-repair-banner>
                <b>Repair</b>
                {record.repair.of ? (
                  <>
                    {" of "}
                    <Link href={`/dashboard/jobs/${record.repair.of.id}` as Route}>{record.repair.of.title}</Link>
                  </>
                ) : null}{" "}
                · {record.repair.causeLabel.toLowerCase()} · {record.repair.whoPays}
              </div>
            ) : record.comebacks?.length ? (
              <div className="mjd-repair" data-job-comebacks>
                {record.comebacks.length} come-back{record.comebacks.length === 1 ? "" : "s"}
                {record.money && record.money.repairs > 0 ? ` · ${fmt(record.money.repairs)} off the profit` : ""}
              </div>
            ) : null}
          </div>

          {/* THE CREW'S DAY (2026-10-01, after the owner's iPhone check): the
              worker's own actions — Start / Back on site / Close day / Mark
              completed — big, right under the title. The office keeps its
              status picker on Overview. Then the days left unclosed. */}
          {worker && <CrewActions data={record.board} door={record.door} />}

          {/* Days that passed without being closed — on top, whatever the tab. */}
          <CrewPendingBanner data={record.board} door={record.door} />

          {/* On site (2026-11-05): the stage's tasks, deliveries due, problems from site, hours. */}
          <CrewField data={record.field} jobId={record.id} door={record.door} office={!worker} canWork={record.board.canWork} />

          {/* ============ SECTIONS ============
              Every section in sight at 390, no sideways scroll (owner,
              2026-10-01): a grid of three across, the last row sharing its
              width so no cell is left empty (5 tabs = 3 + 2, 6 = 3 + 3).
              Full labels and their counts; the picked one inked. */}
          <nav className="mjd-tabs" role="tablist" aria-label="Job sections" data-n={TABS.length} data-job-tabs>
            {TABS.map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`mjd-tab${tab === key ? " mjd-on" : ""}`}
                onClick={() => selectTab(key)}
              >
                {/* One run of text, so a label that wraps in a narrow cell keeps
                    its count beside its last word ("Days & / photos 4"). */}
                <span className="mjd-tab-t">
                  {label}
                  {count !== null && <> <i>{count}</i></>}
                </span>
              </button>
            ))}
          </nav>

          {/* Write failures land here rather than in an alert() — one line, in
              the page's own voice, dismissible. */}
          {a.error && (
            <div className="mjd-err" role="alert">
              <span>{a.error}</span>
              <button type="button" onClick={a.dismissError} aria-label="Dismiss">
                <Icon id="i-x" />
              </button>
            </div>
          )}

          {/* ============ VIEW ============
              Keyed on the tab: React remounts the subtree on a real view
              change, which is exactly when the row arrival should play. */}
          <div className="mjd-view" key={tab}>
            {tab === "overview" && (
              <>
                <section className="mjd-card">
                  <div className="mjd-h">
                    <h2 className="mjd-t">Overview</h2>
                  </div>

                  {/* Crew progress control (2026-08-21): an ACCEPTED worker
                      moves the job forward — In progress / Completed only.
                      Office roles keep the full four-state picker. */}
                  {/* The office's status picker — the owner's and the manager's
                      (canWrite). The crew moves the job with its own actions
                      above the tabs (CrewActions). */}
                  {record.canWrite && (
                    <div className="mjd-status">
                      <div className="mjd-sec-l">Set up the status</div>
                      <div className="mjd-status-row">
                        {STATUS_BUTTONS.filter(
                          ([key]) => record.canWrite || key === "prog" || key === "done",
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            className={`mjd-sbtn mjd-sbtn--${key}${a.status === key ? " mjd-on" : ""}`}
                            type="button"
                            aria-pressed={a.status === key}
                            disabled={a.busy?.kind === "status"}
                            onClick={() => a.pickStatus(key)}
                          >
                            {label}
                          </button>
                        ))}
                        {/* Back on site (2026-09-27): a new day on a job that
                            runs more than one — once per day. */}
                        {a.status === "prog" && !record.progress.startedToday && (
                          <button
                            className="mjd-sbtn mjd-sbtn--prog"
                            type="button"
                            disabled={a.busy?.kind === "continue"}
                            onClick={() => a.backOnSite()}
                            data-progress="continue"
                          >
                            {a.busy?.kind === "continue" ? "Marking…" : `Back on site · day ${record.progress.day}`}
                          </button>
                        )}
                      </div>
                      {onSiteLine(record.progress, KEY_TO_STATUS[a.status]) ? (
                        <div className="mjd-onsite" data-onsite>{onSiteLine(record.progress, KEY_TO_STATUS[a.status])}</div>
                      ) : null}
                    </div>
                  )}

                  <div className="mjd-fields">
                    <div className="mjd-f">
                      <span>Client</span>
                      <b>{record.clientName ?? "—"}</b>
                    </div>
                    <div className="mjd-f">
                      <span>Crew</span>
                      <b>{record.crew.length} assigned</b>
                    </div>
                    {/* The fourth cell is the one that differs by audience: the
                        office reads the money on the job, the crew reads where
                        the job itself stands (they have no picker to read it
                        off). */}
                    {worker ? (
                      <div className="mjd-f">
                        <span>Status</span>
                        <b>{ST[a.status].l}</b>
                      </div>
                    ) : (
                      <div className="mjd-f">
                        <span>Expenses</span>
                        <b>
                          {fmt(expTotal)} · {record.board.receipts.length}
                        </b>
                      </div>
                    )}
                    <div className="mjd-f">
                      <span>Dates</span>
                      <b>{record.fieldDates}</b>
                    </div>
                  </div>

                  {/* THE READER'S OWN STANDING — the first question a crew opens
                      a work order to answer, so it sits above the scope. */}
                  {assign && (
                    <div className="mjd-sec">
                      <div className="mjd-sec-l">Your assignment</div>
                      <p>
                        <span className={`mjd-b mjd-b--${assign.tone}`}>{assign.stamp}</span>{" "}
                        {portal && record.assignment === "wait" ? "The office sent you this job. Can you take it?" : assign.line}
                      </p>
                      {portal && record.assignment === "wait" && record.myAssignmentId && (
                        <div className="mjd-status-row" data-respond>
                          <button className="mjd-btn mjd-btn-primary" type="button" disabled={a.busy?.kind === "respond"} onClick={() => void a.respond(record.myAssignmentId!, "ACCEPTED")}>
                            Accept job
                          </button>
                          <button className="mjd-btn mjd-btn-ghost" type="button" disabled={a.busy?.kind === "respond"} onClick={() => void a.respond(record.myAssignmentId!, "DECLINED")}>
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="mjd-sec">
                    <div className="mjd-sec-l">Scope of work</div>
                    {record.scopeOfWork ? (
                      <p className="mjd-scope">{record.scopeOfWork}</p>
                    ) : (
                      <EmptyNote>No scope recorded on this job.</EmptyNote>
                    )}
                  </div>
                  <div className="mjd-sec">
                    <div className="mjd-sec-l">Notes</div>
                    {record.notes ? <p>{record.notes}</p> : <EmptyNote>No notes yet.</EmptyNote>}
                  </div>
                </section>

                {/* The desktop's right-hand column, now the block that follows
                    Overview. On a phone the contact rows are the page's most
                    tapped content, so they keep their own card and frame. */}
                <section className="mjd-card">
                  <div className="mjd-h">
                    <h2 className="mjd-t">Client contact</h2>
                  </div>
                  {record.contact ? (
                    <>
                      <div className="mjd-c-row">
                        <Icon id="i-users" />
                        {record.contact.name}
                      </div>
                      {/* The whole row is the anchor — see the note on
                          `a.mjd-c-row` in the stylesheet: an inline link around
                          13px mono type is a 20px tap target. */}
                      {record.contact.phone &&
                        (record.contact.phoneHref ? (
                          <a className="mjd-c-row mjd-mono" href={record.contact.phoneHref}>
                            <Icon id="i-phone" />
                            <span className="mjd-c-link">{record.contact.phone}</span>
                          </a>
                        ) : (
                          <div className="mjd-c-row mjd-mono">
                            <Icon id="i-phone" />
                            {record.contact.phone}
                          </div>
                        ))}
                      {record.contact.email && (
                        <a className="mjd-c-row mjd-mono" href={`mailto:${record.contact.email}`}>
                          <Icon id="i-msg" />
                          <span className="mjd-c-link">{record.contact.email}</span>
                        </a>
                      )}
                      {record.contact.address && (
                        <div className="mjd-c-row">
                          <Icon id="i-pin" />
                          {record.contact.address}
                        </div>
                      )}
                      {/* Worker edition only — see `directionsUrl` on the
                          record. A full-width button rather than a link on the
                          address: this is the one control on the sheet a crew
                          taps with gloves on, in a truck. */}
                      {record.directionsUrl && (
                        <div className="mjd-total mjd-foot">
                          <a
                            className="mjd-btn mjd-btn-primary mjd-btn-block"
                            href={record.directionsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Icon id="i-arrow" />
                            Get directions
                          </a>
                        </div>
                      )}
                    </>
                  ) : (
                    <EmptyNote>No client linked to this job.</EmptyNote>
                  )}
                </section>

                {/* WHO DID WHAT (2026-09-24): the job's trail with each
                    member's mark — the same rows the desktop Activity card
                    reads, one column wide. */}
                <section className="mjd-card" data-trail>
                  <div className="mjd-h">
                    <h2 className="mjd-t">Activity</h2>
                    <span className="mjd-s">{record.trail.length ? `${record.trail.length} on this job` : "who did what"}</span>
                  </div>
                  {record.trail.length === 0 ? (
                    <EmptyNote>Nothing logged on this job yet.</EmptyNote>
                  ) : (
                    <ol className="mjd-trail">
                      {record.trail.map((t) => (
                        <li className="mjd-tr" key={t.id} data-kind={t.kind}>
                          <div className="mjd-tr-h">
                            <Who who={t.who} compact />
                            <span className="mjd-tr-t">{t.at}</span>
                          </div>
                          <div className="mjd-tr-s">{t.summary}</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              </>
            )}

            {tab === "schedule" && (
              <section className="mjd-card">
                <div className="mjd-h">
                  <h2 className="mjd-t">Schedule</h2>
                  <span className="mjd-s">{record.events.length} on the calendar</span>
                </div>
                {record.events.length === 0 ? (
                  <EmptyNote>Nothing on the calendar for this job yet.</EmptyNote>
                ) : (
                  record.events.map((e, i) => (
                    <div
                      className={`mjd-row${switched ? " mjd-rowin" : ""}`}
                      style={rowVar(i)}
                      key={e.id}
                    >
                      <div>
                        <div className="mjd-row-n">{e.title}</div>
                        <div className="mjd-row-m">
                          {e.when}
                          {e.meta ? ` · ${e.meta}` : ""}
                        </div>
                      </div>
                    </div>
                  ))
                )}
                {record.canWrite && (
                  <div className="mjd-total mjd-foot">
                    <div className="mjd-note">
                      {scheduled ? "Already booked" : `Books ${record.booking.label}`}
                    </div>
                    {scheduled ? (
                      <Link
                        className="mjd-btn mjd-btn-ghost mjd-btn-block"
                        href="/dashboard/calendar"
                      >
                        <Icon id="i-cal" />
                        On the schedule
                      </Link>
                    ) : (
                      <button
                        className="mjd-btn mjd-btn-ghost mjd-btn-block"
                        type="button"
                        disabled={a.busy?.kind === "schedule"}
                        onClick={() => a.addToSchedule(record.title)}
                      >
                        <Icon id="i-cal" />
                        {a.busy?.kind === "schedule" ? "Adding…" : "Add to schedule"}
                      </button>
                    )}
                  </div>
                )}
                {/* The crew's half of the same footer: the office books PEOPLE
                    onto the job, a worker puts the window in their own phone.
                    Mutually exclusive with the block above — `calendarUrl` is
                    set on the worker edition only, and `canWrite` is false
                    there. */}
                {record.calendarUrl && (
                  <div className="mjd-total mjd-foot">
                    <div className="mjd-note">{record.dates}</div>
                    <a
                      className="mjd-btn mjd-btn-ghost mjd-btn-block"
                      href={record.calendarUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Icon id="i-cal" />
                      Add to calendar
                    </a>
                  </div>
                )}
              </section>
            )}

            {tab === "crew" && (
              <section className="mjd-card">
                <div className="mjd-h">
                  <h2 className="mjd-t">Crew</h2>
                  <span className="mjd-s">confirm via portal link</span>
                </div>
                {record.crew.length === 0 ? (
                  <EmptyNote>Nobody is on this job yet.</EmptyNote>
                ) : (
                  record.crew.map((w, i) => (
                    <div
                      className={`mjd-row${switched ? " mjd-rowin" : ""}`}
                      style={rowVar(i)}
                      key={w.assignmentId}
                    >
                      <div>
                        {/* `me` is set on the worker edition only — the
                            reader's own row, so they can check the office put
                            the right person on the job. */}
                        <div className="mjd-row-n">
                          {w.name}
                          {w.me ? " (you)" : ""}
                        </div>
                        <div className="mjd-row-m">{w.meta}</div>
                      </div>
                      <div className="mjd-row-act">
                        <span
                          className={`mjd-b ${
                            w.state === "ok"
                              ? "mjd-b--ok"
                              : w.state === "no"
                                ? "mjd-b--no"
                                : "mjd-b--wait"
                          }`}
                        >
                          {w.state === "ok"
                            ? "Confirmed"
                            : w.state === "no"
                              ? "Declined"
                              : "Pending"}
                        </span>
                        {record.canWrite && (
                          <button
                            className="mjd-btn mjd-btn-ghost mjd-x"
                            type="button"
                            aria-label={`Take ${w.name} off this job`}
                            disabled={a.busy?.kind === "unassign" && a.busy.id === w.assignmentId}
                            onClick={() => a.unassign(w.assignmentId)}
                          >
                            <Icon id="i-trash" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
                {record.canWrite && (
                  <>
                    <div className="mjd-total mjd-foot">
                      <div className="mjd-note">{record.roster.length} on the roster</div>
                      <button
                        className="mjd-btn mjd-btn-ghost mjd-btn-block"
                        type="button"
                        aria-expanded={rosterOpen}
                        onClick={() => setRosterOpen((o) => !o)}
                      >
                        <Icon id={rosterOpen ? "i-x" : "i-userplus"} />
                        {rosterOpen ? "Close" : "Assign worker"}
                      </button>
                    </div>
                    {rosterOpen &&
                      (record.roster.length === 0 ? (
                        <EmptyNote>
                          Everyone on the roster is already on this job.{" "}
                          <Link className="mjd-link" href="/dashboard/workers">
                            Add a worker
                          </Link>
                          .
                        </EmptyNote>
                      ) : (
                        <div className="mjd-pick" role="list">
                          {record.roster.map((w) => (
                            <button
                              key={w.id}
                              type="button"
                              role="listitem"
                              className="mjd-pick-row"
                              disabled={a.busy?.kind === "assign" && a.busy.id === w.id}
                              onClick={async () => {
                                const ok = await a.assign(w.id);
                                if (ok) setRosterOpen(false);
                              }}
                            >
                              <span className="mjd-pick-id">
                                <span className="mjd-row-n">{w.name}</span>
                                {w.meta && <span className="mjd-row-m">{w.meta}</span>}
                              </span>
                              <Icon id="i-plus" />
                            </button>
                          ))}
                        </div>
                      ))}
                  </>
                )}
              </section>
            )}

            {record.canWrite && <ChangeOrderSheet open={coOpen} onClose={() => setCoOpen(false)} jobId={record.id} onDone={() => router.refresh()} />}
            {tab === "changes" && (
              <section className="mjd-card">
                <div className="mjd-h">
                  <h2 className="mjd-t">Change orders</h2>
                  <span className="mjd-s">client-signed extras</span>
                </div>
                {record.canWrite && (
                  <button className="mjd-btn mjd-btn-primary" type="button" onClick={() => setCoOpen(true)}>
                    {record.changes.length ? `Change orders · ${record.changes.length}` : "New change order"}
                  </button>
                )}
                {record.changes.length === 0 ? (
                  <EmptyNote>
                    No change orders on this job. They are raised from the proposal or the
                    job, then signed by the client.
                  </EmptyNote>
                ) : (
                  record.changes.map((c, i) => {
                    const working = a.busy?.kind === "change" && a.busy.id === c.id;
                    return (
                      <div
                        className={`mjd-co${switched ? " mjd-rowin" : ""}`}
                        style={rowVar(i)}
                        key={c.id}
                      >
                        <div className="mjd-row-n">
                          {c.ref} · {c.title}
                        </div>
                        <div className="mjd-row-m">{c.meta}</div>
                        <div className="mjd-co-foot">
                          <span className="mjd-amt">{fmt(c.amount)}</span>
                          <span
                            className={`mjd-b ${
                              c.state === "ok"
                                ? "mjd-b--ok"
                                : c.state === "no"
                                  ? "mjd-b--no"
                                  : c.state === "sent"
                                    ? "mjd-b--warn"
                                    : "mjd-b--wait"
                            }`}
                          >
                            {c.state === "ok"
                              ? "Approved"
                              : c.state === "no"
                                ? "Declined"
                                : c.state === "void"
                                  ? "Withdrawn"
                                  : c.state === "sent"
                                    ? "Pending"
                                    : "Draft"}
                          </span>
                          {record.canWrite && c.state === "draft" && (
                            <button
                              className="mjd-btn mjd-btn-primary"
                              type="button"
                              disabled={working}
                              onClick={() => a.sendChange(c.id)}
                            >
                              {working ? "Sending…" : "Send"}
                            </button>
                          )}
                          {record.canWrite && c.state === "sent" && (
                            <button
                              className="mjd-btn mjd-btn-primary"
                              type="button"
                              disabled={working}
                              onClick={() => a.approveChange(c.id)}
                            >
                              {working ? "Saving…" : "Mark approved"}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            )}

            {/* DAYS ON SITE (stage C, 2026-09-30): today, then every day with
                its photos and videos — the same board in the portal. The office
                reads the receipts under Expenses, with review in place. */}
            {tab === "days" && <CrewDays data={record.board} door={record.door} />}
            {tab === "receipts" && <CrewReceipts data={record.board} door={record.door} />}
            {tab === "expenses" && <CrewReceipts data={record.board} door={record.door} />}
          </div>
        </div>
      </main>

      {/* ============ THUMB-ZONE ACTION BAR ============
          The proposal link, and ONLY when the job has one. With no linked
          proposal the row is not rendered at all — the shell's third grid
          track collapses to zero and the sheet runs to the bottom edge. */}
      {(record.proposal || record.canWrite) && (
        <div className={`mjd-bar${record.proposal && record.canWrite ? " mjd-bar--three" : ""}`}>
          {/* Send someone back (2026-11-09) — the office's; the sheet is in the shell. */}
          {record.canWrite && (
            <button type="button" className={`mjd-btn ${record.proposal ? "mjd-btn-ghost" : "mjd-btn-primary"} mjd-btn-block`} onClick={() => openRepairSheet({ jobId: record.id })} data-job-repair>
              <Icon id="i-wrench" />
              {record.repair ? "Another repair" : record.comebacks?.length ? `Repair · ${record.comebacks.length}` : "Repair"}
            </button>
          )}
          {record.canWrite && record.proposal && (
            <button type="button" className="mjd-btn mjd-btn-ghost mjd-btn-block" onClick={() => openPaymentsPanel({ proposalId: record.proposal!.id })} data-job-payments>
              <Icon id="i-card" />
              Payments
            </button>
          )}
          {record.proposal && (
            <Link
              className="mjd-btn mjd-btn-primary mjd-btn-block"
              href={`/dashboard/manual-blueprint?proposal=${record.proposal.id}` as Route}
            >
              <Icon id="i-file" />
              View proposal · {fmt(record.proposal.total)}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
