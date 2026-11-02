// ONE LEAD ON THE BLUEPRINT SHEET (2026-09-22). The page the Leads list
// opens: who it is, the scope of work (or the homeowner's words with a
// button that writes the scope), and the estimators — the lead's own trade
// first. Server-rendered; the forms bind server actions (actions/leadEstimate)
// and only the estimate cards' busy state hydrates (estimate-card-button).

import Link from "next/link";
import type { Route } from "next";
import { AirVent, Fence, FilePen, type LucideIcon } from "lucide-react";
import { startEstimateFromLead, writeLeadScope } from "@/actions/leadEstimate";
import { openWebLeadInEstimator } from "@/actions/webEstimator";
import type { WebTrade } from "@/lib/webEstimator";
import { ESTIMATOR_LABEL, estimatorFor, looksLikeStreetAddress, type EstimatorId } from "@/lib/leadRules";
import { EstimateCardButton } from "./estimate-card-button";
import { JobFolder, type JobFolderProps } from "./job-folder";
import { LeadVisits, type LeadVisitsProps } from "./lead-visits";
import styles from "./lead-detail.module.css";
import { metaLeadPresentation } from "@/lib/meta/leadPresentation";
import { leadSourceOf } from "@/lib/leads/sources";
import { LeadSmartBook } from "@/components/v3/smartbook/lead-smartbook";
import type { LeadSmartBook as SmartBookView } from "@/lib/smartbook/office";

const cx = (...names: Array<string | false | null | undefined>) =>
  names.filter(Boolean).map((n) => styles[n as string] ?? n).join(" ");

// The manual proposal last (owner, 2026-09-22): the sheet opens with the
// lead's name, contact, address and scope already on it.
const ENGINES: EstimatorId[] = ["roof", "fence", "hvac", "smart", "manual"];

/** What each way of pricing does, in a line (the estimate list, 2026-09-25). */
const ENGINE_NOTE: Record<EstimatorId, string> = {
  roof: "Measures the roof from the address",
  fence: "Draws the fence on the property lines",
  hvac: "Sizes the system and prices the install",
  smart: "Prices the scope of work — it opens in the brief",
  manual: "A blank proposal with the lead filled in",
};

/** Each way of pricing wears its own icon, in its own hue (owner, 2026-09-26).
 *  Smart Proposal and the roof estimator draw the sidebar's own marks — the
 *  shell sprite's lightbulb and roof (blueprint-shell/sprite, mounted by both
 *  the desk shell and the handheld frame); the rest are Lucide. */
const ENGINE_ICON: Record<EstimatorId, LucideIcon | "i-bulb" | "i-roof"> = {
  roof: "i-roof",
  fence: Fence,
  hvac: AirVent,
  smart: "i-bulb",
  manual: FilePen,
};

function EngineIcon({ engine }: { engine: EstimatorId }) {
  const icon = ENGINE_ICON[engine];
  if (typeof icon === "string") {
    return (
      <svg className={cx("ic")}>
        <use href={`#${icon}`} />
      </svg>
    );
  }
  const Icon = icon;
  return <Icon strokeWidth={2} />;
}

/** Roof and fence measure off the parcel — they need a street address. They
 *  open without one all the same (owner, 2026-09-26): the contractor types it
 *  in there, and the lead's client and scope ride along either way. */
const needsStreet = (engine: EstimatorId) => engine === "roof" || engine === "fence";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const two = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
  return two || name.slice(0, 2).toUpperCase() || "—";
}

export type LeadDetailProps = {
  lead: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    projectType: string | null;
    description: string | null;
    scope: string | null;
    status: string;
    source: string | null;
    aiCategory: string | null;
    aiConfidence: number | null;
    assignee: string | null;
    created: string;
  };
  /** Owners, managers and estimators price; sales reps and workers only read. */
  canEstimate: boolean;
  /** `?scope=failed` — the model could not write the scope just now. */
  scopeFailed: boolean;
  /** A Lead Center lead not accepted yet: the homeowner's contacts are withheld
   *  (lib/leadCenter/contacts) and the card says when they open. */
  contactsLocked?: boolean;
  /** A Lead Center lead the shop paid to open (lib/leadCenter/purchase). */
  paid?: { amount: string; when: string } | null;
  /** The homeowner's job folder (lib/home/files); null for a lead with none. */
  folder?: JobFolderProps | null;
  /** A lead from the shop's website estimator (2026-10-27, lib/webEstimator): what the homeowner saw. */
  website?: { trade: WebTrade; estimator: string; summary: string; choice: string; price: string; show: "range" | "exact"; note: string | null; handoff: string; house: boolean } | null;
  /** Visits & calls (2026-10-31): the next visit, Schedule visit, Have the AI desk call; null while contacts are locked. */
  visits?: LeadVisitsProps | null;
  /** SmartBook with this lead (2026-10-31): where it stands, the conversation, Pause / Restart / Offer times. Null
   *  for the roles that don't work leads (estimators, workers) and for a lead whose contacts are still locked. */
  smartbook?: SmartBookView | null;
};

export function LeadDetailContent({ lead, canEstimate, scopeFailed, contactsLocked = false, paid = null, folder = null, website = null, visits = null, smartbook = null }: LeadDetailProps) {
  const primary = estimatorFor(lead.aiCategory, lead.description);
  const fullAddress = [lead.address, lead.city, [lead.state, lead.zip].filter(Boolean).join(" ")]
    .filter((s) => s && s.trim())
    .join(", ");
  const hasStreet = looksLikeStreetAddress(lead.address);
  // The lead's own trade first, then every other way in the usual order.
  const ways: EstimatorId[] = [primary, ...ENGINES.filter((e) => e !== primary)];
  const words = (lead.description ?? "").trim();
  const meta = metaLeadPresentation(lead);
  const canWriteScope = !lead.scope && canEstimate && words.length >= 12 && (!meta || meta.answers.length > 0);
  // One vocabulary with the leads list (lib/leads/sources): JobFlex's own leads
  // say so, and the shop's own say where they came from.
  const src = leadSourceOf(lead.source);
  const source = src.side === "jobflex" ? "From JobFlex · Lead Center" : `Your own lead · ${src.label}`;

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Pipeline · Lead · {lead.status}</div>
          <h1 className={cx("page-title")}>{lead.name}</h1>
        </div>
        <div className={cx("page-actions")}>
          <Link className={cx("btn", "btn-ghost")} href={"/dashboard/leads" as Route}>
            ‹ My leads
          </Link>
        </div>
      </div>

      <div className={cx("grid")}>
        {/* The left column: who it is, the visits and desk calls, then SmartBook's card (2026-10-31). */}
        <div className={cx("side")}>
          <section className={cx("card")} data-lead-contact>
            <div className={cx("who")}>
              <span className={cx("av")}>{initials(lead.name)}</span>
              <div>
                <div className={cx("who-n")}>{lead.name}</div>
                <div className={cx("who-s")}>{[lead.city, lead.state].filter(Boolean).join(", ") || lead.zip || "—"}</div>
              </div>
            </div>
            <dl className={cx("kv")}>
              <dt>Email</dt>
              <dd className={cx("mono")}>{contactsLocked ? "Opens when you accept" : (lead.email ?? "—")}</dd>
              <dt>Phone</dt>
              <dd className={cx("mono")}>{contactsLocked ? "Opens when you accept" : (lead.phone ?? "—")}</dd>
              <dt>Job address</dt>
              <dd data-lead-address>
                {fullAddress || "Not given"}
                {contactsLocked ? (
                  <span className={cx("soft")}> — the street opens when you accept</span>
                ) : (
                  !hasStreet && <span className={cx("soft")}> — no street address yet; a roof or fence quote needs one</span>
                )}
              </dd>
              <dt>Project</dt>
              <dd>{lead.projectType ?? lead.aiCategory ?? "—"}</dd>
              <dt>Source</dt>
              <dd>{source}</dd>
              <dt>Created</dt>
              <dd className={cx("mono")}>{lead.created}</dd>
              {paid ? (
                <>
                  <dt>Paid</dt>
                  <dd data-lead-paid>
                    <span className={cx("mono")}>
                      {paid.amount} · {paid.when}
                    </span>
                    {/* No refunds by policy; a dud contact is a support case,
                        and the lead's id in the subject finds the payment. */}
                    <span className={cx("soft", "paid-help")}>
                      Contact not real?{" "}
                      <a
                        href={`mailto:support@jobflex.app?subject=${encodeURIComponent(`Lead ${lead.id} — contact not real`)}`}
                      >
                        Contact support
                      </a>
                    </span>
                  </dd>
                </>
              ) : null}
            </dl>
          </section>
          {visits && <LeadVisits {...visits} />}
          {smartbook && <LeadSmartBook leadId={lead.id} initial={smartbook} className={cx("card")} />}
        </div>

        <section className={cx("card")}>
          <div className={cx("plates")}>
            <span className={cx("plate", "plate--status")}>{lead.status}</span>
            {lead.aiCategory && (
              <span className={cx("plate")}>
                AI · {lead.aiCategory}
                {lead.aiConfidence != null && <b>{Math.round(lead.aiConfidence * 100)}%</b>}
              </span>
            )}
            {lead.assignee && <span className={cx("plate")}>Assigned · {lead.assignee}</span>}
          </div>

          {/* The scope written for a contractor (lib/leadScope) when the
              request carried one; the homeowner's own words are always kept. */}
          {lead.scope ? (
            <>
              <div className={cx("sec-h")}>Scope of work</div>
              <p className={cx("scope")} data-lead-scope>
                {lead.scope}
              </p>
              <div className={cx("sec-h")}>{meta ? "Form responses" : "In the homeowner’s words"}</div>
            </>
          ) : (
            <div className={cx("sec-h")}>{meta ? "Project details" : "Project description"}</div>
          )}
          {meta ? <>
            {meta.answers.length ? <dl className={cx("form-answers")}>
              {meta.answers.map((answer, index) => <div key={index}>
                <dt>{answer.label}</dt>
                <dd>{answer.value}</dd>
              </div>)}
            </dl> : <p className={cx("words")}>No project details provided.</p>}
            {meta.inboxUrl && <a className={cx("inbox-link")} href={meta.inboxUrl} target="_blank" rel="noopener noreferrer">Open Facebook conversation ↗</a>}
          </> : <p className={cx("words")}>{words || "No description provided."}</p>}

          {/* A lead without a scope — a request from before the scope
              existed, an import, a hand-typed lead: one click writes it. */}
          {canWriteScope && (
            <form action={writeLeadScope.bind(null, lead.id)} className={cx("write")} data-lead-write-scope>
              <button className={cx("btn", "btn-ghost", "btn--sm")} type="submit">
                Write the scope of work
              </button>
              <span className={cx("hint")}>
                {scopeFailed
                  ? "The scope couldn't be written just now — try again in a minute."
                  : "Turns these words into the scope a contractor prices from; it then opens in the estimators."}
              </span>
            </form>
          )}

          {/* THE JOB FOLDER (2026-10-03): the homeowner's pictures, videos and
              PDFs, a way to ask for more, a picture onto a proposal. */}
          {folder && <JobFolder {...folder} />}

          {/* ESTIMATE THIS JOB (owner, 2026-09-26: every way "shown the same
              as the Smart Proposal", each with its own coloured icon): one
              framed card per estimator — icon, name, what it does, Start
              estimate — the lead's own trade first and tagged. Every card is
              a form posting startEstimateFromLead; none waits on an address. */}
          {/* THE WEBSITE ESTIMATOR'S LEAD (2026-10-27): the homeowner already saw a price on the shop's own site, in
              the shop's prices; one click opens the estimator with their address, measurement and package. */}
          {website && (
            <div className={cx("est")} data-lead-website>
              <div className={cx("sec-h")}>{website.house ? "Priced by the homeowner on JobFlex" : "From your website estimator"}</div>
              <p className={cx("est-sub")}>
                {website.summary} They {website.house ? "priced it on JobFlex, chose" : "chose"} <b>{website.choice}</b> and saw <b>{website.price}</b> before tax{website.show === "range" ? " (a range)" : ""}.
                {website.note ? ` Their note: "${website.note}"` : ""}
              </p>
              {canEstimate && (
                <form action={openWebLeadInEstimator.bind(null, lead.id)}>
                  <button type="submit" className={cx("est-card", `est-card--${website.trade === "deck" ? "roof" : website.trade}`)} data-lead-website-open>
                    <span className={cx("est-txt")}>
                      <span className={cx("est-n")}>Open in the {website.estimator}</span>
                      <span className={cx("est-s")}>{website.handoff}</span>
                    </span>
                  </button>
                </form>
              )}
            </div>
          )}
          {canEstimate && (
            <div className={cx("est")} data-lead-estimators>
              <div className={cx("sec-h")}>Estimate this job</div>
              <p className={cx("est-sub")}>
                Whichever way you price it, the proposal keeps this lead&rsquo;s client and scope of work.
              </p>
              <ul className={cx("est-cards")}>
                {ways.map((engine) => {
                  const recommended = engine === primary;
                  const needsAddress = needsStreet(engine) && !hasStreet;
                  const noteId = `est-note-${engine}`;
                  return (
                    <li key={engine}>
                      <form action={startEstimateFromLead.bind(null, lead.id, engine)}>
                        <EstimateCardButton
                          className={cx("est-card", `est-card--${engine}`)}
                          goClassName={cx("est-go")}
                          engine={engine}
                          label={`${ESTIMATOR_LABEL[engine]}${recommended ? ", recommended" : ""} — start estimate`}
                          describedBy={noteId}
                        >
                          <span className={cx("est-ic")} aria-hidden="true">
                            <EngineIcon engine={engine} />
                          </span>
                          <span className={cx("est-txt")}>
                            <span className={cx("est-n")}>
                              {ESTIMATOR_LABEL[engine]}
                              {recommended && <span className={cx("est-tag")}>Recommended</span>}
                            </span>
                            <span className={cx("est-s")} id={noteId}>
                              {ENGINE_NOTE[engine]}
                              {needsAddress && (
                                <>
                                  {/* the space keeps the two lines apart when read aloud */}{" "}
                                  <span className={cx("est-need")}>Needs a street address — type it in the estimator</span>
                                </>
                              )}
                            </span>
                          </span>
                        </EstimateCardButton>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
