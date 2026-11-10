"use client";

// CLIENT DETAIL / BLUEPRINT — the page.
// Route: /dashboard/client-detail.
//
// The old client record (src/app/(dashboard)/dashboard/clients/[id]/page.tsx)
// contributed its CONTENT LIST and nothing else: identity, contact, tags,
// proposals, payments, activity, and the figures worth a headline. Its layout —
// a three-column grid of four same-weight cards — is the thing being replaced,
// not the thing being ported.
//
// THE COMPOSITION, top to bottom, decaying in weight:
//
//   MASTHEAD      the client's NAME at the shell's 46px/900. A record page
//                 should be titled by who it is about, so the name is not
//                 repeated inside the band below it.
//   PARTICULARS   a headless band: an ink monogram stamp and the company on
//                 the left, the reachable facts on the right, one 2px rule
//                 between them. Headless on purpose — it needs no title to say
//                 what it is, and skipping the title keeps it a different
//                 SHAPE from every card under it.
//   FIGURES       the house KPI strip. The only 38px type on the page.
//   LEDGER        proposals, full width, the tallest object and the real
//                 content. Chips filter it in place.
//   TAIL          payments and activity side by side, the lightest beat.
//
// DERIVED, NEVER STORED. Every headline figure is computed from the fixture
// arrays on this render. A hardcoded lifetime total is a number that goes
// stale the first time somebody edits a payment row, and a page that lies
// about its own arithmetic is worse than one with no figures.
//
// THE CHIPS DO NOT REPLAY THE ENTRANCE. Filtering re-renders the ledger and
// nothing animates — see the note in ./use-reveal.ts about the observer trap
// that would otherwise wipe the list on every click.
//
// Nothing here writes. The masthead carries no record number and no fixture
// disclaimer: a page titled by a person should not be annotated by a filing
// code, and a caveat pinned beside the actions reads as part of the actions.

import { useCallback, useMemo, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { type ProposalFilter, bucketOf, money } from "./client-detail-data";
import type { ClientDetailMiss, ClientDetailRecord, ClientDetailView } from "./client-detail-load";
import {
  Btn,
  ClampedName,
  EmptyNote,
  Fact,
  Panel,
  PaymentBadge,
  ProposalBadge,
  Tag,
  cx,
} from "./cd-ui";
import {
  ClientEditDialog,
  ClientMessageDialog,
  type EditHandle,
  type MessageHandle,
} from "./cd-dialogs";
import styles from "./client-detail.module.css";
import { AddToProjectSheet } from "@/components/v3/project-links/add-to-project-sheet";
import { openAddToProject } from "@/components/v3/project-links/open-add-to-project";
import { useReveal } from "./use-reveal";
import { BriefBand, MemoryPanel, MergeBanner, PromisesPanel, StoryPanel } from "./client-360";
import { activateServicePlan, cancelServicePlan, enrollClientInPlan, renewServicePlan, sendServicePlan } from "@/actions/servicePlans";
import { EquipmentPanel } from "./equipment-panel";
import { openRepairSheet } from "@/components/v3/repairs/repair-sheet";

const FILTERS: { value: ProposalFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
];

/**
 * The switch, and the only reason this file has two components.
 *
 * A record with no row behind it used to be drawn by handing the SAME component
 * an invented client. Now the two cases are two different pages, and the split
 * has to happen above the first hook — an early return inside `ClientRecord`
 * would sit after `useState`, which is the one place React forbids it.
 */
export function ClientDetailContent({ view }: { view: ClientDetailView }) {
  if (!view.found) return <ClientMissing view={view} />;
  return <ClientRecordPage view={view} />;
}

/**
 * Nothing to show, said plainly.
 *
 * Two readings, because they need two different next steps: arriving with no id
 * at all is a route you can only reach by typing it, so it points at the book;
 * an id that resolved to nothing is a link that has gone stale, and saying so is
 * what stops the reader hunting for a record that is not there.
 */
function ClientMissing({ view }: { view: ClientDetailMiss }) {
  const router = useRouter();
  useReveal();
  const missing = view.reason === "missing";
  return (
    <div className={styles.page}>
      <div className={cx("page-head", styles.head)} data-rv="">
        <div className={styles.headMain}>
          <div className="kicker">Client</div>
          <h1 className={cx("page-title", styles.title)}>
            {missing ? "Record not found" : "No client selected"}
          </h1>
        </div>
        <div className={styles.headRight}>
          <div className={styles.actions}>
            <Btn tone="primary" icon="users" onClick={() => router.push("/dashboard/clients" as Route)}>
              Back to clients
            </Btn>
          </div>
        </div>
      </div>

      <div className={styles.stack}>
        <Panel title="Client record">
          <EmptyNote kicker={missing ? "Nothing behind this link" : "Nothing to open"}>
            {missing
              ? "This client is no longer on your books — the record was deleted, or the link points at one that was never yours. Open the client book and pick a record."
              : "This page draws one client at a time. Open a record from the client book and it will be shown here."}
          </EmptyNote>
        </Panel>
      </div>
    </div>
  );
}

function ClientRecordPage({ view }: { view: ClientDetailRecord }) {
  const { clientId, client: CLIENT, proposals: PROPOSALS, payments: PAYMENTS } = view;
  // The membership (2026-09-22): the live plan, else the one waiting to be signed.
  const PLAN = view.plans.find((p) => p.status === "ACTIVE") ?? view.plans.find((p) => p.status === "SENT" || p.status === "DRAFT") ?? null;
  const PLAN_LABEL: Record<string, string> = { draft: "Draft — not sent", sent: "Sent — waiting to be signed", active: "Member", expiring: "Member · expiring", lapsed: "Ended — renew", expired: "Expired", canceled: "Canceled" };
  const router = useRouter();
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const editRef = useRef<EditHandle | null>(null);
  const messageRef = useRef<MessageHandle | null>(null);

  // The fleet entrance cascade. Marker-driven, plays once on mount.
  useReveal();

  const counts = useMemo(() => {
    const base: Record<ProposalFilter, number> = { all: PROPOSALS.length, draft: 0, open: 0, won: 0, lost: 0 };
    for (const p of PROPOSALS) base[bucketOf(p.status)] += 1;
    return base;
  }, [PROPOSALS]);

  const rows = useMemo(
    () => (filter === "all" ? PROPOSALS : PROPOSALS.filter((p) => bucketOf(p.status) === filter)),
    [filter, PROPOSALS],
  );

  const figures = useMemo(() => {
    const paid = PAYMENTS.filter((p) => p.status === "PAID").reduce((a, p) => a + p.amount, 0);
    const due = PAYMENTS.filter((p) => p.status === "PENDING").reduce((a, p) => a + p.amount, 0);
    const sent = PROPOSALS.filter((p) => p.status !== "DRAFT").length;
    const won = PROPOSALS.filter((p) => p.status === "ACCEPTED").length;
    return {
      paid,
      due,
      sent,
      // Acceptance is measured against what actually went out, not against
      // drafts sitting in a folder.
      rate: sent === 0 ? 0 : Math.round((won / sent) * 100),
    };
  }, [PAYMENTS, PROPOSALS]);

  // NEW PROPOSAL opens the estimator picker rather than routing straight to an
  // engine, because the record page has no business deciding whether this job
  // is a roof, a fence or a hand-written sheet. The client rides along on the
  // event: whichever engine is chosen receives `?client=<id>` and starts with
  // this client already attached, so a proposal begun from a client's record
  // can never be saved against nobody. The picker is mounted once in the shell
  // and listens on the document — the topbar's own New Estimate button opens
  // the same dialog the same way, minus the client.
  const newProposal = useCallback(() => {
    document.dispatchEvent(new CustomEvent("jf:estimator-picker", { detail: { clientId, clientName: view.client.name } }));
  }, [clientId, view.client.name]);

  /** The ledger rows were `<button>`s with no handler — twelve pixels of hover
   *  feedback on a control that did nothing. Each row is a real proposal id, so
   *  it opens that proposal. Client-side push, like every other door out of a
   *  blueprint page (see clients-behavior.ts on why a hard load replays the
   *  entrance). */
  const openProposal = useCallback(
    (id: string) => router.push(`/dashboard/proposals/${id}` as Route),
    [router],
  );

  // The band prints the address as ONE SENTENCE and the form edits the four
  // columns it was built from, so the raw values travel from the server beside
  // the formatted ones. Splitting "14208 NE 182nd St, Woodinville, WA 98072"
  // back into street / city / state / zip would be guessing at commas, and the
  // first client who wrote "Suite B, Building 2" would have their address
  // quietly rearranged by an edit they never made.
  const editValues = view.editable;

  return (
    <div className={styles.page}>
      <AddToProjectSheet />
      {/* MASTHEAD --------------------------------------------------- */}
      <div className={cx("page-head", styles.head)} data-rv="">
        {/* `min-width: 0` on the title column and `overflow-wrap: anywhere` on
            the H1: a flex child defaults to its content's min-content width, so
            an unbroken 200-character name would otherwise widen the head past
            the viewport and take the horizontal scrollbar with it. */}
        <div className={styles.headMain}>
          <div className={cx("kicker", styles.kickerText)}>Client · {CLIENT.city}</div>
          <h1 className={cx("page-title", styles.title)} title={CLIENT.name}>
            {CLIENT.name}
          </h1>
        </div>
        <div className={styles.headRight}>
          <div className={styles.actions}>
            <Btn tone="quiet" icon="pen" onClick={() => editRef.current?.open()}>
              Edit
            </Btn>
            {/* The client's project, one tap away; or the door into one
                (2026-09-18). A client already in a project can still be added
                to another — the sheet opens on the one they are in. */}
            {view.projects[0] ? (
              <Btn icon="folder" onClick={() => router.push(`/dashboard/projects/${view.projects[0].id}` as Route)}>
                {view.projects[0].name.length > 28 ? view.projects[0].name.slice(0, 27) + "…" : view.projects[0].name}
              </Btn>
            ) : null}
            <Btn icon="folder" tone={view.projects[0] ? "quiet" : "plain"} onClick={() => openAddToProject(clientId)}>
              {view.projects[0] ? "Projects" : "Add to project"}
            </Btn>
            <Btn icon="msg" onClick={() => messageRef.current?.open()}>
              Message
            </Btn>
            {/* Send someone back to this client's house (2026-11-09) — the office's, when there's work to go back to. */}
            {view.repairJobs > 0 ? (
              <Btn icon="wrench" onClick={() => openRepairSheet({ clientId })}>
                Repair
              </Btn>
            ) : null}
            <Btn tone="primary" icon="plus" onClick={newProposal}>
              New proposal
            </Btn>
          </div>
        </div>
      </div>

      <div className={styles.stack}>
        {/* THE SAME PERSON TWICE (2026-11-08): shown only when another live record shares this one's email or phone. */}
        <MergeBanner clientId={clientId} duplicates={view.duplicates} />

        {/* PARTICULARS ---------------------------------------------- */}
        <section data-rv="" className={styles.card} aria-label="Client particulars">
          <div className={styles.bandGrid}>
            <div className={styles.bandId}>
              <div className={styles.lockup}>
                <span className={styles.stamp} aria-hidden="true">
                  {CLIENT.initials}
                </span>
                <span className={styles.company}>
                  <span className={styles.companyName} title={CLIENT.company}>
                    {CLIENT.company}
                  </span>
                  <span className={styles.companySub}>Last contact {CLIENT.lastContact}</span>
                </span>
              </div>
              <div className={styles.tags}>
                {CLIENT.tags.map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>

            {/* Two paired rows of tokens, then the one sentence. Billing used
                to trail the address and sat alone on the last row looking like
                an afterthought; paired with "Client since" it is a field like
                any other, and the address — the only value that is a sentence —
                is the thing that spans. */}
            <div className={styles.bandFacts}>
              <Fact label="Email" icon="send" value={CLIENT.email} />
              <Fact label="Phone" icon="phone" value={CLIENT.phone} />
              <Fact label="Client since" icon="cal" value={CLIENT.since} />
              <Fact label="Notes" icon="building" value={CLIENT.notes} />
              <Fact label="Job address" icon="pin" value={CLIENT.address} wide />
            </div>
          </div>
        </section>

        {/* WHERE THEY STAND (2026-11-08): the saved AI brief, rebuilt when the timeline moves. */}
        <BriefBand clientId={clientId} brief={view.brief} />

        {/* FIGURES --------------------------------------------------- */}
        <div data-rv="" className={styles.kpis}>
          <div className={styles.kpi} data-rv-cell="">
            <div className={styles.kpiLbl}>Lifetime value</div>
            <div className={cx(styles.kpiVal, styles.kpiValAccent)}>{money(figures.paid)}</div>
          </div>
          <div className={styles.kpi} data-rv-cell="">
            <div className={styles.kpiLbl}>Proposals sent</div>
            <div className={styles.kpiVal}>{figures.sent}</div>
          </div>
          <div className={styles.kpi} data-rv-cell="">
            <div className={styles.kpiLbl}>Acceptance rate</div>
            <div className={styles.kpiVal}>{figures.rate}%</div>
          </div>
          <div className={styles.kpi} data-rv-cell="">
            <div className={styles.kpiLbl}>Outstanding balance</div>
            <div className={cx(styles.kpiVal, figures.due > 0 && styles.kpiValDue)}>
              {money(figures.due)}
            </div>
          </div>
        </div>

        {/* MEMORY AND PROMISES (2026-11-08): the source-linked facts, and what either side owes. */}
        <div className={styles.duo}>
          <MemoryPanel clientId={clientId} facts={view.facts} />
          <PromisesPanel clientId={clientId} promises={view.promises} />
        </div>

        {/* THE PLAN (2026-09-22): the client's membership, or the way in. */}
        <Panel title="Service plan" note={PLAN ? PLAN_LABEL[PLAN.phase] ?? PLAN.status : view.planTemplates.length ? "Not a member" : "No plans set up"}>
          <div data-client-plan={PLAN ? PLAN.phase : "none"} style={{ fontSize: 13, lineHeight: 1.5 }}>
            {PLAN ? (
              <>
                <div style={{ fontWeight: 800, fontSize: 15 }}>{PLAN.name}{PLAN.discountPct > 0 && PLAN.status === "ACTIVE" ? ` · ${PLAN.discountPct}% off every proposal` : ""}</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted)" }}>{PLAN.terms}</div>
                {PLAN.term && <div style={{ marginTop: 6 }}>Term: <span style={{ fontFamily: "var(--font-mono)" }}>{PLAN.term}</span></div>}
                {PLAN.nextVisit && <div>Next visit: {PLAN.nextVisit}</div>}
                {PLAN.nextBill && <div>Billing: {PLAN.nextBill}</div>}
                {PLAN.acceptHref && (
                  <div style={{ marginTop: 6 }}>
                    Accept link: <a href={PLAN.acceptHref} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>open</a> — the client signs there, or start it below if they signed with you.
                  </div>
                )}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {(PLAN.status === "DRAFT" || PLAN.status === "SENT") && (
                    <>
                      <form action={sendServicePlan.bind(null, PLAN.id)}><button type="submit" className="btn btn-ghost btn--sm">{PLAN.status === "SENT" ? "Send again" : "Send to sign"}</button></form>
                      <form action={activateServicePlan.bind(null, PLAN.id)}><button type="submit" className="btn btn-primary btn--sm" data-client-plan-activate>Start today</button></form>
                    </>
                  )}
                  {(PLAN.phase === "expiring" || PLAN.phase === "lapsed") && (
                    <form action={renewServicePlan.bind(null, PLAN.id)}><button type="submit" className="btn btn-primary btn--sm">Renew now</button></form>
                  )}
                  <form action={cancelServicePlan.bind(null, PLAN.id)}><button type="submit" className="btn btn-ghost btn--sm">Cancel plan</button></form>
                  <a href="/dashboard/hvac-estimator/service-desk?tab=clients" className="btn btn-ghost btn--sm">All plans</a>
                </div>
              </>
            ) : view.planTemplates.length === 0 ? (
              <EmptyNote kicker="No plans yet">
                Set up the plans you sell on the <a href="/dashboard/hvac-estimator/service-desk?tab=plans" style={{ textDecoration: "underline" }}>HVAC services</a> page — three starter plans are one click away.
              </EmptyNote>
            ) : (
              <form action={enrollClientInPlan} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }} data-client-plan-enroll>
                <input type="hidden" name="clientId" value={clientId} />
                <select name="templateId" defaultValue={view.planTemplates[0]?.id} style={{ font: "inherit", fontSize: 13, padding: "6px 8px", border: "1.5px solid var(--ink)", borderRadius: "var(--radius)", background: "#fff", minWidth: 220 }}>
                  {view.planTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name} — {t.terms}</option>
                  ))}
                </select>
                <button type="submit" name="then" value="send" className="btn btn-primary btn--sm">Enroll and send to sign</button>
                <button type="submit" name="then" value="activate" className="btn btn-ghost btn--sm">Enroll and start today</button>
              </form>
            )}
          </div>
        </Panel>

        {/* THE EQUIPMENT (2026-09-23): what is installed at the home. */}
        <Panel title="Equipment on file" note={view.equipment.length ? `${view.equipment.length} unit${view.equipment.length === 1 ? "" : "s"}` : "Nothing on file"}>
          <EquipmentPanel clientId={clientId} rows={view.equipment} />
        </Panel>

        {/* THE LEDGER ------------------------------------------------ */}
        <Panel
          title="Proposals"
          note={`${PROPOSALS.length} on file`}
          tools={
            <div className={styles.chips} role="group" aria-label="Filter proposals by state">
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  data-f={f.value}
                  aria-pressed={filter === f.value}
                  className={cx(styles.chip, filter === f.value && styles.chipOn)}
                  onClick={() => setFilter(f.value)}
                >
                  {f.label}
                  <span className={styles.chipCount}>{counts[f.value]}</span>
                </button>
              ))}
            </div>
          }
        >
          {rows.length === 0 ? (
            <EmptyNote kicker="Nothing in this state">
              {/* The name is CLAMPED inside the sentence. A client whose name is
                  a 200-character paste — an imported book will always have one —
                  used to push this line, and with it the card, past the right
                  edge of the page. One line, an ellipsis, the full value on
                  hover; the sentence keeps its shape whatever it is given. */}
              {/* The possessive stays welded to the closing tag: JSX joins two
                  text lines with a space, and a space before an apostrophe is
                  a typographic error the reader sees before they read it. */}
              No proposals on <ClampedName>{CLIENT.name}</ClampedName>&rsquo;s record are marked{" "}
              {filter}.
            </EmptyNote>
          ) : (
            <div className={styles.ledger}>
              {rows.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={styles.lRow}
                  onClick={() => openProposal(p.id)}
                  aria-label={`Open ${p.title}`}
                >
                  <span className={styles.lMain}>
                    <span className={styles.lTitle}>{p.title}</span>
                    <span className={styles.lMeta}>
                      {p.ref} · Updated {p.updated}
                    </span>
                  </span>
                  <ProposalBadge status={p.status} />
                  <span className={styles.lAmount}>{money(p.amount)}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* THE TAIL -------------------------------------------------- */}
        <div className={styles.duo}>
          {/* No annotation on either tail card. The collected total is already
              the Lifetime value figure at the top of the page, and the signal
              count is a number about the list rather than about the client —
              both were restating what the reader can see. */}
          <Panel title="Payment history" bodyClass={styles.scroll}>
            {PAYMENTS.length === 0 ? (
              <EmptyNote kicker="No payments yet">
                Nothing has been collected against this client. Payments appear here the moment a
                provider settles one.
              </EmptyNote>
            ) : (
              PAYMENTS.map((p) => (
                <div key={p.id} className={styles.pRow}>
                  <span className={styles.lMain}>
                    <span className={styles.pMethod}>{p.method}</span>
                    <span className={styles.pMeta}>
                      {p.instrument} · {p.date}
                    </span>
                  </span>
                  <PaymentBadge status={p.status} />
                  <span className={styles.pAmount}>{money(p.amount)}</span>
                </div>
              ))
            )}
          </Panel>

          {/* THE STORY (2026-11-08): the full timeline took the Activity panel's chair — the trail lines it showed
              ride inside it, with everything the trail never saw (emails, texts, desk calls, invoices, reviews). */}
          <StoryPanel story={view.story} />
        </div>
      </div>

      {/* Both dialogs are mounted, closed, at the END of the page tree rather
          than beside the buttons that open them. `.content` carries
          `z-index: 1`, so a `position: fixed` overlay declared inside an
          earlier band would be trapped under the bands after it — the same
          stacking note the proposals module records against `.pmdl`. */}
      <ClientEditDialog clientId={clientId} initial={editValues} handleRef={editRef} />
      <ClientMessageDialog clientId={clientId} clientName={CLIENT.name} handleRef={messageRef} />
    </div>
  );
}
