"use client";
// ADMIN · SUPPORT → SMARTHELP (2026-10-30). What contractors ask SmartHelp (components/v3/smarthelp), so the owner
// sees what they struggle with and which guide to write next: the week's four facts, the questions SmartHelp didn't
// answer (left to a person, not sure, or a 👎), the newest questions with SmartHelp's answer, and each guide's opens and
// 👍 / 👎. Read on the server by listSmartHelp (lib/smarthelp/server), platform admins only; questions are kept 90 days.
// The page's "Tickets | SmartHelp" tabs are links (?view=smarthelp), so each view reads only its own data.

import { useRef } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Chip, Empty, KpiStrip, cx, useReveal, type Tone } from "@/components/v3/admin-influencers/admin-ui";
import ui from "@/components/v3/admin-influencers/admin-ui.module.css";
import { makeCx } from "@/components/v3/admin-users/admin-kit";
import shared from "@/components/v3/admin-users/admin-shared.module.css";
import { ago } from "@/components/v3/admin-overview/admin-ui";
import { smartHelpSummary, type QuestionLog } from "@/lib/smarthelp/log";
import styles from "./smarthelp-admin.module.css";

const sx = makeCx(shared);

export type SmartHelpGuideRow = { id: string; title: string; opens: number; up: number; down: number };

/** The page's two views, as links: each reads only its own data. */
export function SupportViewTabs({ view }: { view: "tickets" | "smarthelp" }) {
  const tab = (to: "tickets" | "smarthelp", label: string, href: string) => (
    <Link href={href as Route} role="tab" aria-selected={view === to} className={cx(ui.segBtn, styles.view, view === to && ui.segOn)}>
      {label}
    </Link>
  );
  return (
    <div className={cx(ui.seg, styles.views)} role="tablist" aria-label="Support views" data-support-views>
      {tab("tickets", "Tickets", "/admin/support")}
      {tab("smarthelp", "SmartHelp", "/admin/support?view=smarthelp")}
    </div>
  );
}

const OUTCOME: Record<QuestionLog["outcome"], { tone: Tone; label: string }> = {
  none: { tone: "mute", label: "No rating" },
  up: { tone: "ok", label: "👍 Helped" },
  down: { tone: "bad", label: "👎 Didn't help" },
  person: { tone: "bp", label: "Sent to a person" },
};

/** Why a question counts as not answered. */
function unansweredWhy(q: QuestionLog): { tone: Tone; label: string } {
  if (q.outcome === "down") return OUTCOME.down;
  if (q.kind === "person") return { tone: "bp", label: "Left to a person" };
  return { tone: "wait", label: "Not sure" };
}

const excerpt = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

function who(q: QuestionLog): string {
  const name = q.userName?.trim() || "Someone";
  return q.role ? `${name} · ${q.role.toLowerCase()}` : name;
}

export function SmartHelpAdmin({ questions, guides, now }: { questions: QuestionLog[]; guides: SmartHelpGuideRow[]; now: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);
  const sum = smartHelpSummary(questions, new Date(now));
  const byOpens = [...guides].sort((a, b) => b.opens - a.opens || a.title.localeCompare(b.title));

  return (
    <div ref={rootRef} data-smarthelp-admin>
      <div className="page-head">
        <div>
          <div className="kicker">Platform</div>
          <h1 className="page-title">SmartHelp questions</h1>
        </div>
      </div>

      <KpiStrip
        cols={4}
        cells={[
          { label: "Questions · 7 days", value: String(sum.week), accent: true },
          { label: "👍 Helped", value: String(sum.up), tone: sum.up ? "ok" : undefined },
          { label: "👎 Didn't help", value: String(sum.down), tone: sum.down ? "bad" : undefined },
          { label: "Sent to a person", value: String(sum.person) },
        ]}
      />

      <section className="card rv" data-smarthelp-unanswered>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Not answered · 7 days</div>
            <div className="card-sub">SmartHelp left these to a person, wasn&apos;t sure, or got a 👎 — the next guides to write.</div>
          </div>
        </div>
        {sum.unanswered.length === 0 ? (
          <Empty>Nothing left unanswered this week.</Empty>
        ) : (
          <div className={sx("tbl-wrap")}>
            <table className={sx("tbl")}>
              <thead>
                <tr>
                  <th>Question</th>
                  <th>Why</th>
                  <th>Asked</th>
                </tr>
              </thead>
              <tbody>
                {sum.unanswered.map((q) => {
                  const why = unansweredWhy(q);
                  return (
                    <tr key={q.id}>
                      <td>
                        <div className={sx("t-title")} title={q.question}>
                          {excerpt(q.question, 160)}
                        </div>
                        <div className={sx("t-sub")}>
                          {q.orgName || "—"} · {who(q)} · {q.page}
                        </div>
                      </td>
                      <td>
                        <Chip tone={why.tone}>{why.label}</Chip>
                      </td>
                      <td>{ago(q.at, now)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rv" data-smarthelp-newest>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Newest</div>
            <div className="card-sub">The latest {questions.length === 1 ? "question" : `${questions.length} questions`}, with what SmartHelp answered. Kept 90 days.</div>
          </div>
        </div>
        {questions.length === 0 ? (
          <Empty>No one has asked SmartHelp anything yet.</Empty>
        ) : (
          <div className={sx("tbl-wrap")}>
            <table className={sx("tbl")}>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Person</th>
                  <th>Page</th>
                  <th>Question</th>
                  <th>Answer</th>
                  <th>Outcome</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {questions.map((q) => (
                  <tr key={q.id}>
                    <td>{q.orgName || "—"}</td>
                    <td>{who(q)}</td>
                    <td>
                      {q.page}
                      {q.plan ? <div className={sx("t-sub")}>{q.plan}</div> : null}
                    </td>
                    <td title={q.question}>{excerpt(q.question, 160)}</td>
                    <td title={q.answer}>{excerpt(q.answer, 140)}</td>
                    <td>
                      <Chip tone={OUTCOME[q.outcome].tone}>{OUTCOME[q.outcome].label}</Chip>
                    </td>
                    <td>{ago(q.at, now)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card rv" data-smarthelp-guides>
        <div className={cx("card-head", ui.cardHead)}>
          <div className="card-titles">
            <div className="card-title">Guides</div>
            <div className="card-sub">How often each guide is opened, and how it is rated.</div>
          </div>
        </div>
        <div className={sx("tbl-wrap")}>
          <table className={sx("tbl")}>
            <thead>
              <tr>
                <th>Guide</th>
                <th>Opens</th>
                <th>👍</th>
                <th>👎</th>
              </tr>
            </thead>
            <tbody>
              {byOpens.map((g) => (
                <tr key={g.id}>
                  <td>{g.title}</td>
                  <td>{g.opens}</td>
                  <td>{g.up}</td>
                  <td>{g.down}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
