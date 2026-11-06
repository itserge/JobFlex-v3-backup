"use client";

// JOB DETAIL / BLUEPRINT — the page.
// Route: /dashboard/jobs/[id].
//
// A port of `jobflex-jobdetail-blueprint (14).html`. It REPLACES the classic
// record page that lived at src/app/(dashboard)/dashboard/jobs/[id]/ — it does
// not stand beside it. Same arrangement as the sibling project-detail port.
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
// as a fragment, so they stay DIRECT children of `.content`: the donor's reveal
// cascade walks `.content > *`.
//
// ── THE FIXTURE IS GONE — THIS IS THE REAL JOB ─────────────────────
// The port shipped with the donor's demo content ("Roof tear-off & reroof —
// 4812 Maple Ave") rendering for every id. It now renders the Job row behind
// `[id]`: title, client, address, span, status, crew, calendar events, change
// orders, photos and expenses, read by ../job-detail-blueprint/job-detail-load.ts
// and handed down as one `record`. The handheld build reads the same record, so
// the two editions cannot describe different jobs.
//
// Every control writes through an action that already existed — see the header
// of ./use-job-detail-actions.ts for the mapping. Nothing on this page is a
// decoration that pretends to work: a section with no rows draws a dashed
// drawing-note instead, and a role that `requireManager` would reject
// (SALES / ESTIMATOR) gets the record with the write controls withheld.
//
// ── DONOR SCRIPT → REACT ───────────────────────────────────────────
// The donor drives everything through `innerHTML` re-renders (`renderTabs()`,
// `renderView()`, `renderBadge()`) off two module-level variables, `tab` and
// `status`. `tab` is component state here; `status` is the record's, flipped
// optimistically by the picker and then re-read from the database.
//
// ── AND IT IS ALSO THE FIELD WORKER'S RECORD ───────────────────────
// /dashboard/jobs/[id] serves an INSTALLER the same page. It used to serve a
// separate Tailwind "Field Command" bento, then (briefly, 2026-08-18) a second
// blueprint component beside this one; both are gone. A worker's record is this
// component with `record.viewer === "worker"`, which:
//   · drops the Changes and Expenses TABS — a worker's record carries no money
//     at all, so those cards could only ever be empty (and the loader does not
//     select the columns, so there is nothing behind them either);
//   · drops the proposal link with them — `record.proposal` is null, so the
//     head button and its total never render;
//   · adds the one thing only a worker needs: their own standing on the job,
//     as a stamp on the Overview card;
//   · turns the two office affordances into field ones — the address becomes
//     directions, "Add to schedule" (which books a crew) becomes "Add to
//     calendar" (which books the reader).
// Everything else is `canWrite`, which was already false for every role
// `requireManager` rejects: the status picker, the roster, the unassign and
// upload controls and the change-order buttons were withheld before this
// component knew what a worker was.

import { useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import s from "./job-detail.module.css";
import { useJobDetailMotion } from "./job-detail-motion";
import { useJobDetailActions } from "./use-job-detail-actions";
import { onSiteLine } from "@/lib/jobProgressShared";
import { ChangeOrderSheet } from "@/components/changeOrders/ChangeOrderSheet";
import { makeProjectFromJob } from "@/actions/projectStages";
import { useRouter } from "next/navigation";
import { JD_ASSIGN, ST, STATUS_BUTTONS, fmt, type JobDetailRecord, KEY_TO_STATUS } from "./job-detail-data";
import { Who } from "@/components/v3/who/who";
import { CrewActions, CrewDays, CrewPendingBanner, CrewReceipts } from "@/components/v3/crew-board/crew-board";
import { CrewField } from "@/components/v3/crew-board/crew-field";

/** Hashed module class, or the literal name when the module has none — which is
 *  how the fleet's global `rv` / `rv-in` / `pressed` pass through. */
function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter(Boolean)
    .map((n) => (s as Record<string, string>)[n as string] ?? (n as string))
    .join(" ");
}

// "days" replaced "photos" (stage C, 2026-09-30): the crew's days on site and
// the photos and videos of each day. "receipts" is the crew's; the office
// reads the same receipts inside "expenses", beside the job's money.
type TabKey = "overview" | "schedule" | "crew" | "changes" | "days" | "receipts" | "expenses";


function Ic({ id }: { id: string }) {
  return (
    <svg className={cx("ic")} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

/** DESIGN.md's empty state: a note on the drawing, 1.5px dashed. */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className={cx("jd-empty")}>{children}</div>;
}

export function JobDetailContent({ record }: { record: JobDetailRecord }) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [rosterOpen, setRosterOpen] = useState(false);
  const [coOpen, setCoOpen] = useState(false);
  // "Make it a project" (2026-11-05): busy, or why it was refused.
  const [making, setMaking] = useState<string | null>(null);
  const router = useRouter();

  const a = useJobDetailActions(
    record.id,
    record.booking,
    record.status,
    record.viewer === "worker",
    record.blobEnabled,
    record.door,
  );

  useJobDetailMotion(s.btn);

  // What counts (lib/expenseTotals): approved and reimbursed receipts only.
  const expTotal = record.board.totals.counted;
  const fileCount = record.board.days.reduce((n, d) => n + d.files.length, 0) + record.board.looseFiles.length;
  const scheduled = record.events.length > 0;
  const worker = record.viewer === "worker";
  const assign = record.assignment ? JD_ASSIGN[record.assignment] : null;

  // Donor: `const TABS = [...]` — id, label, and a count thunk (null on Overview).
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

  return (
    <>
      {/* PAGE HEAD */}
      <div className={cx("page-head")}>
        <div>
          {/* A project's job leads back to its project (2026-11-04); any other office job can become one (2026-11-05). */}
          {record.project ? (
            <Link className={cx("jd-proj")} href={`/dashboard/projects/${record.project.id}` as Route} data-job-project>
              ← Project · {record.project.name}
            </Link>
          ) : !worker ? (
            <button
              type="button"
              className={cx("jd-proj", "jd-proj--make")}
              data-job-make-project
              disabled={making === "busy"}
              onClick={() => {
                setMaking("busy");
                makeProjectFromJob(record.id)
                  .then((r) => router.push(`/dashboard/projects/${r.id}` as Route))
                  .catch((e) => setMaking(e instanceof Error ? e.message : "Could not make the project"));
              }}
            >
              {making === "busy" ? "Making the project…" : making ? making : "Make it a project →"}
            </button>
          ) : null}
          <div className={cx("kicker", "jd-kick")}>
            Job status ·{" "}
            {/* "Scheduled" is where an accepted job starts; with no dates yet the
                head said "Scheduled" over "Unscheduled". It says what it waits for. */}
            <span className={cx("jd-st", ST[a.status].cls)}>{a.status === "sch" && record.undated ? "Needs dates" : ST[a.status].l}</span>
          </div>
          <h1 className={cx("page-title")}>{record.title}</h1>
          <div className={cx("jd-dates")}>{record.dates}</div>
        </div>
      </div>

      {/* The crew's own actions (2026-10-01): Start / Back on site / Close day /
          Mark completed. The office keeps its status picker on Overview. */}
      {worker && <CrewActions data={record.board} door={record.door} />}

      {/* Days that passed without being closed — on top, whatever the tab. */}
      <CrewPendingBanner data={record.board} door={record.door} />

      {/* On site (2026-11-05): the stage's tasks, deliveries due, problems from site, hours. */}
      <CrewField data={record.field} jobId={record.id} door={record.door} office={!worker} canWork={record.board.canWork} />

      {/* ТАБЫ */}
      <div className={cx("jd-tabbar")}>
        <div className={cx("jd-tabs")}>
          {TABS.map(([key, label, count]) => (
            <button
              key={key}
              className={cx("jd-tab", tab === key && "on")}
              type="button"
              onClick={() => setTab(key)}
            >
              {/* The space is the donor's: `t[1] + (t[2] ? ' <i>' + … )`. */}
              {label}
              {count !== null && <> <i>{count}</i></>}
            </button>
          ))}
        </div>
        {/* THE PROPOSAL SECTION IS THE LINK, and it exists only when
            `Job.proposalId` resolved. No proposal — no button, not a disabled
            one: there is nothing to open. */}
        {record.proposal && (
          <Link
            className={cx("btn", "btn-ghost", "jd-vp")}
            href={`/dashboard/manual-blueprint?proposal=${record.proposal.id}` as Route}
          >
            <Ic id="i-file" />
            View proposal · {fmt(record.proposal.total)}
          </Link>
        )}
      </div>

      {/* Write failures land here rather than in an alert() — one line, in the
          page's own voice, dismissible. */}
      {a.error && (
        <div className={cx("jd-err")} role="alert">
          <span>{a.error}</span>
          <button type="button" onClick={a.dismissError} aria-label="Dismiss">
            <Ic id="i-x" />
          </button>
        </div>
      )}

      {/* ВИД */}
      <div>
        {tab === "overview" && (
          <div className={cx("jd-grid")}>
            <section className={cx("card")}>
              <div className={cx("jd-h")}>
                <h2 className={cx("jd-t")}>Overview</h2>
              </div>

              {/* Crew progress control (2026-08-21): an ACCEPTED worker moves
                  the job forward — In progress / Completed only. Office roles
                  keep the full four-state picker. */}
              {/* The office's status picker — the owner's and the manager's. */}
              {record.canWrite && (
                <div className={cx("jd-status")}>
                  <div className={cx("jd-sec-l")}>Set up the status</div>
                  <div className={cx("jd-status-row")}>
                    {STATUS_BUTTONS.filter(
                      ([key]) => record.canWrite || key === "prog" || key === "done",
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={cx("jd-sbtn", `jd-sbtn--${key}`, a.status === key && "on")}
                        type="button"
                        aria-pressed={a.status === key}
                        disabled={a.busy?.kind === "status"}
                        onClick={() => a.pickStatus(key)}
                      >
                        {label}
                      </button>
                    ))}
                    {/* Back on site (2026-09-27): a new day on a job that runs
                        more than one — offered once per day, to the crew and
                        the office alike; the owner and the manager are texted. */}
                    {a.status === "prog" && !record.progress.startedToday && (
                      <button
                        className={cx("jd-sbtn", "jd-sbtn--prog")}
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
                    <div className={cx("jd-onsite")} data-onsite>{onSiteLine(record.progress, KEY_TO_STATUS[a.status])}</div>
                  ) : null}
                </div>
              )}

              <div className={cx("jd-fields")}>
                <div className={cx("jd-f")}>
                  <span>Client</span>
                  <b>{record.clientName ?? "—"}</b>
                </div>
                <div className={cx("jd-f")}>
                  <span>Crew</span>
                  <b>{record.crew.length} assigned</b>
                </div>
                {/* The fourth cell is the one that differs by audience: the
                    office reads the money on the job, the crew reads where the
                    job itself stands (they have no picker to read it off). */}
                {worker ? (
                  <div className={cx("jd-f")}>
                    <span>Status</span>
                    <b>{ST[a.status].l}</b>
                  </div>
                ) : (
                  <div className={cx("jd-f")}>
                    <span>Expenses</span>
                    <b>
                      {fmt(expTotal)} · {record.expenses.length}
                    </b>
                  </div>
                )}
                <div className={cx("jd-f")}>
                  <span>Dates</span>
                  <b>{record.fieldDates}</b>
                </div>
              </div>

              {/* THE READER'S OWN STANDING — the first question a crew opens a
                  work order to answer, so it sits above the scope. */}
              {assign && (
                <div className={cx("jd-sec")}>
                  <div className={cx("jd-sec-l")}>Your assignment</div>
                  <p>
                    <span className={cx("jd-b", `jd-b--${assign.tone}`)}>{assign.stamp}</span>{" "}
                    {record.door.kind === "token" && record.assignment === "wait" ? "The office sent you this job. Can you take it?" : assign.line}
                  </p>
                  {record.door.kind === "token" && record.assignment === "wait" && record.myAssignmentId && (
                    <div className={cx("jd-status-row")} data-respond>
                      <button className={cx("btn", "btn-primary")} type="button" disabled={a.busy?.kind === "respond"} onClick={() => void a.respond(record.myAssignmentId!, "ACCEPTED")}>
                        Accept job
                      </button>
                      <button className={cx("btn", "btn-ghost")} type="button" disabled={a.busy?.kind === "respond"} onClick={() => void a.respond(record.myAssignmentId!, "DECLINED")}>
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className={cx("jd-sec")}>
                <div className={cx("jd-sec-l")}>Scope of work</div>
                {record.scopeOfWork ? (
                  <p>{record.scopeOfWork}</p>
                ) : (
                  <EmptyNote>No scope recorded on this job.</EmptyNote>
                )}
              </div>
              <div className={cx("jd-sec")}>
                <div className={cx("jd-sec-l")}>Notes</div>
                {record.notes ? <p>{record.notes}</p> : <EmptyNote>No notes yet.</EmptyNote>}
              </div>
            </section>

            <section className={cx("card")}>
              <div className={cx("jd-h")}>
                <h2 className={cx("jd-t")}>Client contact</h2>
              </div>
              {record.contact ? (
                <>
                  <div className={cx("jd-c-row")}>
                    <Ic id="i-users" />
                    {record.contact.name}
                  </div>
                  {record.contact.phone && (
                    <div className={cx("jd-c-row", "mono")}>
                      <Ic id="i-phone" />
                      {record.contact.phoneHref ? (
                        <a href={record.contact.phoneHref}>{record.contact.phone}</a>
                      ) : (
                        record.contact.phone
                      )}
                    </div>
                  )}
                  {record.contact.email && (
                    <div className={cx("jd-c-row", "mono")}>
                      <Ic id="i-msg" />
                      <a href={`mailto:${record.contact.email}`}>{record.contact.email}</a>
                    </div>
                  )}
                  {record.contact.address && (
                    <div className={cx("jd-c-row")}>
                      <Ic id="i-pin" />
                      {record.contact.address}
                    </div>
                  )}
                  {/* Worker edition only — see `directionsUrl` on the record.
                      The address stays plain text above it: a link that opens
                      Maps should say so, not be discovered by tapping the only
                      line on the card that looked like a label. */}
                  {record.directionsUrl && (
                    <div className={cx("jd-total", "jd-total--foot")}>
                      <div className={cx("jd-note")}>Opens in Maps</div>
                      <a
                        className={cx("btn", "btn-ghost")}
                        href={record.directionsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Ic id="i-arrow" />
                        Get directions
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <EmptyNote>No client linked to this job.</EmptyNote>
              )}
            </section>
          </div>
        )}

        {/* WHO DID WHAT (2026-09-24): the job's trail — every action a member
            took on it, with their mark (lib/team/who). Read from the org's
            ActivityEvents by meta.jobId / the job's proposal; the loader has
            already dropped the money rows for a crew reader. */}
        {tab === "overview" && (
          <section className={cx("card")} data-trail>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>Activity</h2>
              <span className={cx("jd-s")}>{record.trail.length ? `${record.trail.length} on this job` : "who did what"}</span>
            </div>
            {record.trail.length === 0 ? (
              <EmptyNote>Nothing logged on this job yet.</EmptyNote>
            ) : (
              <ol className={cx("jd-trail")}>
                {record.trail.map((t) => (
                  <li className={cx("jd-tr")} key={t.id} data-kind={t.kind}>
                    <div className={cx("jd-tr-h")}>
                      <Who who={t.who} compact />
                      <span className={cx("jd-tr-t")}>{t.at}</span>
                    </div>
                    <div className={cx("jd-tr-s")}>{t.summary}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {tab === "schedule" && (
          <section className={cx("card")}>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>Schedule</h2>
              <span className={cx("jd-s")}>
                {record.events.length} on the calendar
              </span>
            </div>
            {record.events.length === 0 ? (
              <EmptyNote>Nothing on the calendar for this job yet.</EmptyNote>
            ) : (
              record.events.map((e) => (
                <div className={cx("jd-row")} key={e.id}>
                  <div>
                    <div className={cx("jd-row-n")}>{e.title}</div>
                    <div className={cx("jd-row-m")}>
                      {e.when}
                      {e.meta ? ` · ${e.meta}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
            {record.canWrite && (
              <div className={cx("jd-total", "jd-total--foot")}>
                {/* A div, not a span: `.jd-total span` is the "TOTAL" label. */}
                <div className={cx("jd-note")}>
                  {scheduled ? "Already booked" : `Books ${record.booking.label}`}
                </div>
                {scheduled ? (
                  <Link className={cx("btn", "btn-ghost")} href="/dashboard/calendar">
                    <Ic id="i-cal" />
                    On the schedule
                  </Link>
                ) : (
                  <button
                    className={cx("btn", "btn-ghost")}
                    type="button"
                    disabled={a.busy?.kind === "schedule"}
                    onClick={() => a.addToSchedule(record.title)}
                  >
                    <Ic id="i-cal" />
                    {a.busy?.kind === "schedule" ? "Adding…" : "Add to schedule"}
                  </button>
                )}
              </div>
            )}
            {/* The crew's half of the same footer: the office books PEOPLE onto
                the job, a worker puts the window in their own phone. Mutually
                exclusive with the block above — `calendarUrl` is set on the
                worker edition only, and `canWrite` is false there. */}
            {record.calendarUrl && (
              <div className={cx("jd-total", "jd-total--foot")}>
                <div className={cx("jd-note")}>{record.dates}</div>
                <a
                  className={cx("btn", "btn-ghost")}
                  href={record.calendarUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Ic id="i-cal" />
                  Add to calendar
                </a>
              </div>
            )}
          </section>
        )}

        {tab === "overview" && record.pick.length > 0 && (
          <section className={cx("card")} data-pick-list>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>Take from the warehouse</h2>
              <span className={cx("jd-s")}>{record.loadedAt ? `loaded ${new Date(record.loadedAt).toLocaleDateString("en-US")}` : "what this job needs on the truck"}</span>
              {/* The office's way to the shelf this list reads; the crew has no Inventory page. */}
              {!worker && record.pickTrade && (
                <Link className={cx("jd-link", "jd-hlink")} href={`/dashboard/${record.pickTrade}-estimator/inventory?tab=stock` as Route} data-pick-stock>
                  Open the stock
                </Link>
              )}
            </div>
            {/* The crew's list (lib/inventory pickList): every material line of
                the proposal in whole units, and whether the shelf has it. "Loaded"
                takes the tracked lines out of the warehouse, once. */}
            {record.pick.map((p) => (
              <div className={cx("jd-row")} key={p.name}>
                <div>
                  <div className={cx("jd-row-n")}>
                    {p.quantity} {p.unit} — {p.name}
                  </div>
                  <div className={cx("jd-row-m")}>
                    {!p.tracked
                      ? "not tracked in the warehouse — bring it anyway"
                      : p.perJob
                        ? p.enough
                          ? `ordered for this job — arrived (${p.onHand} there)`
                          : "bought per job — order it for this job, it is not shelf stock"
                        : p.enough
                          ? `on the shelf (${p.onHand})`
                          : `short on the shelf — only ${p.onHand} there`}
                  </div>
                </div>
                {p.tracked && !p.enough && !record.loadedAt ? (
                  <div className={cx("jd-row-act")}>
                    {p.perJob ? <span className={cx("jd-b")}>Per job</span> : <span className={cx("jd-b", "jd-b--wait")}>Short</span>}
                  </div>
                ) : null}
              </div>
            ))}
            {record.loadedAt && record.picked.some((p) => p.taken > p.returned) && (
              <form
                className={cx("jd-row")}
                data-leftovers
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = e.currentTarget;
                  const lines = record.picked
                    .map((p) => ({ itemId: p.itemId, quantity: Number((f.elements.namedItem(`back-${p.itemId}`) as HTMLInputElement | null)?.value) || 0 }))
                    .filter((l) => l.quantity > 0);
                  if (lines.length) void a.returnMaterials(lines);
                  f.reset();
                }}
              >
                <div style={{ flex: 1 }}>
                  <div className={cx("jd-row-n")}>Leftovers back to the warehouse</div>
                  {record.picked
                    .filter((p) => p.taken > p.returned)
                    .map((p) => (
                      <div className={cx("jd-row-m")} key={p.itemId} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                        <input name={`back-${p.itemId}`} className="pinput" type="number" min={0} max={p.taken - p.returned} step="any" placeholder="0" style={{ width: 80 }} aria-label={`${p.name} returned`} />
                        <span>
                          of {p.taken - p.returned} {p.unit} — {p.name}
                          {p.returned > 0 ? ` (${p.returned} already back)` : ""}
                        </span>
                      </div>
                    ))}
                </div>
                <div className={cx("jd-row-act")}>
                  <button className={cx("btn")} type="submit" disabled={a.busy?.kind === "return"}>
                    Return
                  </button>
                </div>
              </form>
            )}
            {!record.loadedAt && record.door.kind === "session" && (
              <div className={cx("jd-row")}>
                <div className={cx("jd-row-m")}>Tap when the truck is loaded — the warehouse count comes down and the office sees it.</div>
                <div className={cx("jd-row-act")}>
                  <button className={cx("btn")} type="button" disabled={a.busy?.kind === "load"} onClick={() => void a.loadMaterials()}>
                    Loaded
                  </button>
                </div>
              </div>
            )}
          </section>
        )}
        {tab === "crew" && (
          <section className={cx("card")}>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>Crew</h2>
              <span className={cx("jd-s")}>confirm via portal link</span>
            </div>
            {record.crew.length === 0 ? (
              <EmptyNote>Nobody is on this job yet.</EmptyNote>
            ) : (
              record.crew.map((w) => (
                <div className={cx("jd-row")} key={w.assignmentId}>
                  <div>
                    {/* `me` is set on the worker edition only — the reader's own
                        row, so they can check the office put the right person
                        on the job. */}
                    <div className={cx("jd-row-n")}>
                      {w.name}
                      {w.me ? " (you)" : ""}
                    </div>
                    <div className={cx("jd-row-m")}>
                      {w.meta}
                      {/* What this worker is paid for this job. The office sees
                          every row and can set it; a field worker sees only
                          their own figure (the loader gives them no other). */}
                      {record.canWrite ? null : w.me && w.pay > 0 ? ` · your pay ${fmt(w.pay)}${w.paidAt ? " (paid)" : ""}` : ""}
                    </div>
                  </div>
                  <div className={cx("jd-row-act")}>
                    <span
                      className={cx(
                        "jd-b",
                        w.state === "ok" ? "jd-b--ok" : w.state === "no" ? "jd-b--no" : "jd-b--wait",
                      )}
                    >
                      {w.state === "ok" ? "Confirmed" : w.state === "no" ? "Declined" : "Pending"}
                    </span>
                    {record.canWrite && (
                      <>
                        <label className={cx("jd-row-m")} htmlFor={`pay-${w.assignmentId}`}>
                          Pay
                        </label>
                        <input
                          id={`pay-${w.assignmentId}`}
                          className="pinput"
                          style={{ width: 96 }}
                          type="number"
                          min={0}
                          step={25}
                          defaultValue={w.pay || ""}
                          placeholder="0"
                          aria-label={`What ${w.name} is paid for this job`}
                          onBlur={(e) => {
                            const next = Number(e.currentTarget.value) || 0;
                            if (next !== w.pay) void a.setPay(w.assignmentId, next);
                          }}
                        />
                        <button
                          className={cx("btn", "btn-ghost")}
                          type="button"
                          disabled={w.pay <= 0}
                          aria-pressed={!!w.paidAt}
                          onClick={() => void a.markPaid(w.assignmentId, !w.paidAt)}
                        >
                          {w.paidAt ? "Paid" : "Mark paid"}
                        </button>
                      </>
                    )}
                    {record.canWrite && (
                      <button
                        className={cx("btn", "btn-ghost", "jd-x")}
                        type="button"
                        aria-label={`Take ${w.name} off this job`}
                        disabled={
                          a.busy?.kind === "unassign" && a.busy.id === w.assignmentId
                        }
                        onClick={() => a.unassign(w.assignmentId)}
                      >
                        <Ic id="i-trash" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            {record.canWrite && (
              <>
                <div className={cx("jd-total", "jd-total--foot")}>
                  <div className={cx("jd-note")}>
                    {record.roster.length} on the roster
                  </div>
                  <button
                    className={cx("btn", "btn-ghost")}
                    type="button"
                    aria-expanded={rosterOpen}
                    onClick={() => setRosterOpen((o) => !o)}
                  >
                    <Ic id={rosterOpen ? "i-x" : "i-userplus"} />
                    {rosterOpen ? "Close" : "Assign worker"}
                  </button>
                </div>
                {rosterOpen &&
                  (record.roster.length === 0 ? (
                    <EmptyNote>
                      Everyone on the roster is already on this job.{" "}
                      <Link className={cx("jd-link")} href="/dashboard/workers">
                        Add a worker
                      </Link>
                      .
                    </EmptyNote>
                  ) : (
                    <div className={cx("jd-pick")} role="list">
                      {record.roster.map((w) => (
                        <button
                          key={w.id}
                          type="button"
                          role="listitem"
                          className={cx("jd-pick-row")}
                          disabled={a.busy?.kind === "assign" && a.busy.id === w.id}
                          onClick={async () => {
                            const ok = await a.assign(w.id);
                            if (ok) setRosterOpen(false);
                          }}
                        >
                          <span className={cx("jd-row-n")}>{w.name}</span>
                          {w.meta && <span className={cx("jd-row-m")}>{w.meta}</span>}
                          <Ic id="i-plus" />
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
          <section className={cx("card")}>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>Change orders</h2>
              <span className={cx("jd-s")}>client-signed extras</span>
              {record.canWrite && (
                <button className={cx("btn", "btn-primary")} type="button" onClick={() => setCoOpen(true)}>
                  {record.changes.length ? `Change orders · ${record.changes.length}` : "New change order"}
                </button>
              )}
            </div>
            {record.changes.length === 0 ? (
              <EmptyNote>
                No change orders on this job. They are raised from the proposal or the
                job, then signed by the client.
              </EmptyNote>
            ) : (
              record.changes.map((c) => {
                const working = a.busy?.kind === "change" && a.busy.id === c.id;
                return (
                  <div className={cx("jd-corow")} key={c.id}>
                    <div>
                      <div className={cx("jd-row-n")}>
                        {c.ref} · {c.title}
                      </div>
                      <div className={cx("jd-row-m")}>{c.meta}</div>
                    </div>
                    <span className={cx("jd-amt")}>{fmt(c.amount)}</span>
                    <span
                      className={cx(
                        "jd-b",
                        c.state === "ok"
                          ? "jd-b--ok"
                          : c.state === "no"
                            ? "jd-b--no"
                            : c.state === "sent"
                              ? "jd-b--warn"
                              : "jd-b--wait",
                      )}
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
                        className={cx("btn", "btn-primary")}
                        type="button"
                        disabled={working}
                        onClick={() => a.sendChange(c.id)}
                      >
                        {working ? "Sending…" : "Send"}
                      </button>
                    )}
                    {record.canWrite && c.state === "sent" && (
                      <button
                        className={cx("btn", "btn-primary")}
                        type="button"
                        disabled={working}
                        onClick={() => a.approveChange(c.id)}
                      >
                        {working ? "Saving…" : "Mark approved"}
                      </button>
                    )}
                    {(!record.canWrite || c.state === "ok" || c.state === "no" || c.state === "void") && <span />}
                  </div>
                );
              })
            )}
          </section>
        )}

        {/* DAYS ON SITE (stage C, 2026-09-30): today (Start · Back on site ·
            Close day), then every day with its photos and videos, who opened
            and who closed it — the same board in the portal. */}
        {tab === "days" && <CrewDays data={record.board} door={record.door} />}
        {tab === "receipts" && <CrewReceipts data={record.board} door={record.door} />}

        {tab === "expenses" && record.money && (
          <section className={cx("card")}>
            <div className={cx("jd-h")}>
              <h2 className={cx("jd-t")}>What this job makes</h2>
              <span className={cx("jd-s")}>
                {record.money.costIsPlanned
                  ? "costed from its share of the project budget — nothing booked yet"
                  : record.money.costKnown
                    ? "contract before tax against what it has cost"
                    : "nothing booked yet — crew pay, receipts and stock show here"}
              </span>
            </div>
            {/* The job's own money (lib/jobCosting): the contract before tax
                with its approved change orders, what the client has paid, and
                the cost — the crew's pay plus the receipts, or a project job's
                share of the project budget until one is booked. */}
            <div className={cx("jd-row")}>
              <div>
                <div className={cx("jd-row-n")}>Contract · before tax</div>
                <div className={cx("jd-row-m")}>
                  {record.money.salesTax > 0 ? `+${fmt(record.money.salesTax)} sales tax, not profit · ` : ""}
                  {fmt(record.money.collected)} collected · {fmt(record.money.outstanding)} to come
                </div>
              </div>
              <div className={cx("jd-row-act")}>
                <b>{fmt(record.money.revenue)}</b>
              </div>
            </div>
            <div className={cx("jd-row")}>
              <div>
                <div className={cx("jd-row-n")}>Cost</div>
                <div className={cx("jd-row-m")}>
                  crew {fmt(record.money.crew)}
                  {record.money.crewUnpaid > 0 ? ` (${fmt(record.money.crewUnpaid)} unpaid)` : ""} · receipts {fmt(record.money.expenses)}
                  {record.money.expensesPending > 0 ? ` (${fmt(record.money.expensesPending)} on review, not counted)` : ""}
                  {record.money.stock > 0 ? ` · from the warehouse ${fmt(record.money.stock)}` : ""}
                  {record.money.stockUnpriced.length > 0 ? ` (no price on ${record.money.stockUnpriced.join(", ")} — counted at $0)` : ""}
                  {record.money.planFrom === "project" ? ` · project budget share ${fmt(record.money.plannedCost)}` : ""}
                </div>
              </div>
              <div className={cx("jd-row-act")}>
                <b>{fmt(record.money.cost)}</b>
              </div>
            </div>
            <div className={cx("jd-row")}>
              <div>
                <div className={cx("jd-row-n")}>Profit</div>
                <div className={cx("jd-row-m")}>
                  {!record.money.costKnown ? (
                    "known once a cost is booked"
                  ) : (
                    <>
                      {record.money.marginPct}% margin
                      {record.money.planFrom === "project" && !record.money.costIsPlanned
                        ? ` · plan said ${fmt(record.money.plannedProfit)}${
                            record.money.costVariance > 0
                              ? ` · ${fmt(record.money.costVariance)} over the plan`
                              : record.money.costVariance < 0
                                ? ` · ${fmt(-record.money.costVariance)} under the plan`
                                : ""
                          }`
                        : ""}
                    </>
                  )}
                </div>
              </div>
              <div className={cx("jd-row-act")}>
                <b>{record.money.costKnown ? fmt(record.money.profit) : "—"}</b>
              </div>
            </div>
          </section>
        )}
        {/* The receipts, with the office's approve / reject / reimbursed in
            place (stage C). Only approved ones are in the card above. */}
        {tab === "expenses" && <CrewReceipts data={record.board} door={record.door} />}
      </div>
    </>
  );
}
