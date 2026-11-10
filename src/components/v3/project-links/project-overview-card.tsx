"use client";

// THE PROJECT OVERVIEW (2026-11-09, lib/projectOverview): the card at the top of every project — how it stands in one
// line, a road of the work with the project's place on it, what to do now (a button on every row), the next 14 days,
// who waits on whom, the money as a bar, and what happened last. Every button runs what the card below already runs,
// or opens it: nothing here writes anything a card cannot. Desk and phone draw the same card; the phone folds the
// last three blocks.

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { setStageStatus } from "@/actions/projectStages";
import { recordProjectInspection } from "@/actions/projectFinish";
import { sendClientUpdate } from "@/actions/projectClient";
import { showOverviewItems, snoozeOverviewItem } from "@/actions/projectOverview";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { openAssistant } from "@/components/v3/assistant/events";
import { SPACES, type SpaceId } from "@/lib/projectSpaces";
import { dollars, shortDay, visibleItems, type OvAct, type OvCard, type OvItem, type Overview, type Snoozes } from "@/lib/projectOverview/shared";
import s from "./project-overview.module.css";

/** Bring a card on the page into view and flash it in the workspace's colour. */
function goTo(card: OvCard, stageId?: string) {
  const bySel = (sel: string) => document.querySelector<HTMLElement>(sel);
  const el =
    (stageId && card === "stages" ? bySel(`[data-stage-id="${CSS.escape(stageId)}"]`) : null) ??
    bySel(`[data-project-${card}]`) ??
    (card === "budget" ? bySel('section[aria-label="Budget"]') : null) ??
    (card === "phases" ? bySel("[data-project-phases]") : null);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: stageId && card === "stages" ? "center" : "start" });
  const color = getComputedStyle(document.querySelector("[data-project-overview]") ?? document.body).getPropertyValue("--space").trim() || "#1854a0";
  el.animate([{ boxShadow: `0 0 0 0 ${color}` }, { boxShadow: `0 0 0 6px ${color}55` }, { boxShadow: `0 0 0 0 ${color}00` }], { duration: 900, iterations: 2, delay: 350 });
  return true;
}

const TONE_WORD: Record<Overview["tone"], string> = { red: "red", amber: "amber", green: "green" };

export function ProjectOverviewCard({
  projectId,
  projectName,
  overview,
  space,
  snoozes = {},
  canManage,
  subsHref,
}: {
  projectId: string;
  projectName: string;
  overview: Overview;
  space: SpaceId;
  snoozes?: Snoozes;
  canManage: boolean;
  /** The subs section's address on this device: the phone has its own (mobile-project-subs-v1). */
  subsHref?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; key: string } | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [allNow, setAllNow] = useState(false);
  const [hiddenHere, setHiddenHere] = useState<Set<string>>(new Set());
  const sp = SPACES[space];
  const deskSubs = `/dashboard/projects/${projectId}/subs`;
  const href = (h: string) => (subsHref && h.startsWith(deskSubs) ? subsHref + h.slice(deskSubs.length) : h);

  const { shown, hidden } = visibleItems(overview.doNow, snoozes);
  const rows = shown.filter((x) => !hiddenHere.has(x.key));
  // A row hidden here and already in the server's list after the refresh is counted once.
  const hiddenCount = hidden + [...hiddenHere].filter((k) => !snoozes[k]).length;
  const visible = allNow ? rows : rows.slice(0, 5);

  const refresh = () => startTransition(() => router.refresh());
  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't go through. Try again.");
    } finally {
      setBusy(null);
      setSure(null);
    }
  }

  function act(item: OvItem, a: OvAct, which: string) {
    const key = `${item.key}:${which}`;
    switch (a.t) {
      case "go":
        if (!goTo(a.card, a.stageId)) setErr("That card isn't on this page.");
        return;
      case "open":
        router.push(href(a.href) as never);
        return;
      case "mail":
        window.location.href = `mailto:${a.to}?subject=${encodeURIComponent(a.subject)}`;
        return;
      case "text":
        window.location.href = `sms:${a.to}`;
        return;
      case "remind-picks":
        setNote({ text: a.note, key });
        return;
      case "stage-done":
        if (sure !== key) return setSure(key);
        void run(key, () => setStageStatus(a.stageId, "DONE"));
        return;
      case "inspection":
        if (sure !== key) return setSure(key);
        void run(key, () => recordProjectInspection(a.inspectionId, a.result, null));
        return;
    }
  }

  const needsSure = (a: OvAct) => a.t === "stage-done" || a.t === "inspection";
  const canRun = (a: OvAct) => canManage || a.t === "go" || a.t === "open" || a.t === "mail" || a.t === "text";
  const button = (item: OvItem, a: OvAct | null, which: "act" | "alt") => {
    if (!a || !canRun(a)) return null;
    const key = `${item.key}:${which}`;
    const asking = sure === key && needsSure(a);
    return (
      <button type="button" className={which === "act" ? s.btnGo : s.btnAlt} disabled={busy !== null} onClick={() => act(item, a, which)} data-ov-act={a.t} data-ov-which={which}>
        {busy === key ? "…" : asking ? `Sure? ${a.label}` : a.label}
      </button>
    );
  };

  const asks = [
    `What's going on with ${projectName}?`,
    overview.road.find((x) => x.state === "now" || x.state === "late") ? `What's late on ${projectName}?` : `What's next on ${projectName}?`,
    `How much does the client still owe on ${projectName}?`,
  ];

  const m = overview.money;
  const scale = m ? Math.max(m.budget, m.headingFor, m.spent + m.committed, 1) : 1;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%`;

  return (
    <div className={s.w} data-project-overview data-overview-tone={overview.tone} style={{ "--space": sp.color, "--space-wash": sp.wash } as CSSProperties}>
      <section className={s.card} aria-label="Overview">
        {/* THE STATUS LINE */}
        <div className={`${s.status} ${s[`tone_${TONE_WORD[overview.tone]}`]}`} data-ov-status>
          <div className={s.statusMain}>
            <span className={s.statusWord} data-ov-word>{overview.word}</span>
            <span className={s.statusLine} data-ov-line>{overview.line}</span>
          </div>
          <div className={s.statusSub}>{overview.sub}</div>
          {overview.summary ? (
            <p className={s.summary} data-ov-summary={overview.summaryBy ?? "rules"}>
              {overview.summary}
            </p>
          ) : null}
        </div>

        {/* ASK THE OPERATOR, about this project */}
        <div className={s.ask} data-ov-ask>
          <button type="button" className={s.askBox} onClick={(e) => openAssistant(e.currentTarget, `${asks[0]}`)}>
            <span className={s.askDot} aria-hidden />
            Ask about this project, by voice or typing
          </button>
          <div className={s.askChips}>
            {asks.map((q) => (
              <button key={q} type="button" className={s.askChip} onClick={(e) => openAssistant(e.currentTarget, q)}>
                {q.replace(` on ${projectName}`, "").replace(` with ${projectName}`, "")}
              </button>
            ))}
          </div>
        </div>

        {/* THE ROAD */}
        {overview.road.length ? (
          <div className={s.roadWrap} data-ov-road>
            <ol className={s.road} style={{ "--steps": overview.road.length } as CSSProperties}>
              {overview.road.map((st, i) => (
                <li key={st.key} className={`${s.step} ${s[`step_${st.state}`]}`} data-ov-step={st.state}>
                  <button type="button" className={s.stepBtn} onClick={() => (st.stageId && st.key === st.stageId ? goTo("stages", st.stageId) : goTo("phases"))} title={st.days ?? undefined}>
                    <span className={s.stepDot} aria-hidden>
                      {st.state === "done" ? "✓" : st.state === "late" ? "!" : i + 1}
                    </span>
                    <span className={s.stepName}>{st.name}</span>
                    {st.state === "now" || st.state === "late" ? <span className={s.here}>{st.state === "late" ? "late" : "here"}</span> : st.days ? <span className={s.stepDays}>{st.days}</span> : null}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        <div className={s.grid}>
          {/* DO NOW */}
          <div className={s.block} data-ov-do-now>
            <div className={s.blockHead}>
              <h4 className={s.blockTitle}>Do now</h4>
              <span className={s.count}>{rows.length}</span>
              {hiddenCount > 0 ? (
                <button type="button" className={s.linkBtn} onClick={() => { setHiddenHere(new Set()); void run("show", () => showOverviewItems(projectId)); }} data-ov-unhide>
                  {hiddenCount} hidden · show
                </button>
              ) : null}
            </div>
            {rows.length ? (
              <ul className={s.list}>
                {visible.map((item) => (
                  <li key={item.key} className={`${s.item} ${item.tone === "red" ? s.itemRed : s.itemAmber}`} data-ov-item={item.key} data-ov-tone={item.tone}>
                    <span className={s.dot} aria-hidden />
                    <span className={s.itemText}>
                      <b>{item.text}</b>
                      {item.why ? <span className={s.why}>{item.why}</span> : null}
                    </span>
                    <span className={s.itemActs}>
                      {button(item, item.act, "act")}
                      {button(item, item.alt, "alt")}
                      <button
                        type="button"
                        className={s.notNow}
                        title="Hide for 3 days"
                        aria-label={`Not now: ${item.text}`}
                        disabled={busy !== null}
                        onClick={() => {
                          setHiddenHere((h) => new Set(h).add(item.key));
                          void snoozeOverviewItem({ projectId, key: item.key, tone: item.tone }).catch(() => null);
                        }}
                        data-ov-not-now
                      >
                        Not now
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={s.clear} data-ov-clear>
                Nothing needs you on this {sp.one} right now.
              </div>
            )}
            {rows.length > 5 ? (
              <button type="button" className={s.linkBtn} onClick={() => setAllNow((v) => !v)}>
                {allNow ? "Show fewer" : `Show all ${rows.length}`}
              </button>
            ) : null}
            {err ? <div className={s.err}>{err}</div> : null}
            {sent ? <div className={s.ok}>{sent}</div> : null}
          </div>

          {/* COMING UP */}
          <div className={s.block} data-ov-ahead>
            <div className={s.blockHead}>
              <h4 className={s.blockTitle}>Coming up</h4>
              <span className={s.blockSub}>next 14 days</span>
            </div>
            {overview.ahead.length ? (
              <ul className={s.ahead}>
                {overview.ahead.map((a) => (
                  <li key={a.key} className={s.aheadRow} data-ov-ahead-row>
                    <span className={s.date}>
                      <b>{shortDay(a.day).split(" ")[0]}</b>
                      {shortDay(a.day).split(" ")[1]}
                    </span>
                    <span className={s.aheadBody}>
                      <button type="button" className={s.aheadTitle} onClick={() => a.stageId && goTo("stages", a.stageId)}>
                        {a.title}
                      </button>
                      {a.missing.map((x) => (
                        <span key={x} className={`${s.check} ${s.missing}`}>
                          {x}
                        </span>
                      ))}
                      {a.ready.map((x) => (
                        <span key={x} className={`${s.check} ${s.ready}`}>
                          {x}
                        </span>
                      ))}
                      {!a.missing.length && !a.ready.length ? <span className={s.check}>Nothing to prepare on file</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={s.clear}>Nothing starts in the next two weeks.</div>
            )}
          </div>
        </div>

        <div className={s.grid}>
          {/* PEOPLE */}
          <details className={s.fold} open data-ov-people>
            <summary className={s.blockHead}>
              <h4 className={s.blockTitle}>People</h4>
              <span className={s.blockSub}>who waits on whom</span>
            </summary>
            {overview.people.length ? (
              <ul className={s.people}>
                {overview.people.map((p) => (
                  <li key={p.key} className={s.person} data-ov-person={p.role}>
                    <span className={s.role}>{p.role}</span>
                    <span className={s.personName}>{p.name}</span>
                    <span className={`${s.personLine} ${p.waits === "you" ? s.waitsYou : p.waits === "them" ? s.waitsThem : ""}`}>{p.line}</span>
                    <span className={s.contact}>
                      {p.phone ? (
                        <>
                          <a href={`tel:${p.phone}`} className={s.contactBtn}>Call</a>
                          <a href={`sms:${p.phone}`} className={s.contactBtn}>Text</a>
                        </>
                      ) : null}
                      {p.email ? <a href={`mailto:${p.email}`} className={s.contactBtn}>Email</a> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={s.clear}>No client, subs or crew on this {sp.one} yet.</div>
            )}
          </details>

          {/* MONEY */}
          <details className={s.fold} open data-ov-money>
            <summary className={s.blockHead}>
              <h4 className={s.blockTitle}>Money</h4>
              {m && m.budget > 0 ? <span className={`${s.blockSub} ${m.over > 0 ? s.overWord : ""}`}>{m.over > 0 ? `${dollars(m.over)} over` : m.spent + m.committed <= 0 ? "nothing spent yet" : m.over < 0 ? `${dollars(-m.over)} to spare` : "on budget"}</span> : null}
            </summary>
            {m && m.budget > 0 ? (
              <button type="button" className={s.moneyBtn} onClick={() => goTo("money")} aria-label="Open the money">
                <span className={s.bar} aria-hidden>
                  <i className={s.barSpent} style={{ width: pct(m.spent) }} />
                  <i className={s.barCommitted} style={{ left: pct(m.spent), width: pct(m.committed) }} />
                  <i className={s.barBudget} style={{ left: pct(m.budget) }} />
                  <i className={`${s.barHeading} ${m.over > 0 ? s.barHeadingOver : ""}`} style={{ left: pct(m.headingFor) }} />
                </span>
                <span className={s.legend}>
                  <span><i className={s.keySpent} />Spent {dollars(m.spent)}</span>
                  <span><i className={s.keyCommitted} />Signed, not paid {dollars(m.committed)}</span>
                  <span><i className={s.keyBudget} />Budget {dollars(m.budget)}</span>
                </span>
              </button>
            ) : null}
            {m ? (
              <dl className={s.figures}>
                <div><dt>Heading for</dt><dd className={m.over > 0 ? s.overWord : undefined}>{dollars(m.headingFor || Math.max(m.budget, m.spent + m.committed))}</dd></div>
                {m.contract != null ? <div><dt>Contract</dt><dd>{dollars(m.contract)}</dd></div> : null}
                {m.margin != null ? <div><dt>Margin at this pace</dt><dd className={m.margin < 0 ? s.overWord : undefined}>{dollars(m.margin)}</dd></div> : null}
                <div><dt>Client paid</dt><dd>{dollars(m.collected)}</dd></div>
                {m.owed > 0 ? <div><dt>Client owes</dt><dd>{dollars(m.owed)}</dd></div> : null}
              </dl>
            ) : (
              <div className={s.clear}>No budget yet. Set one to catch overruns early.</div>
            )}
            {m && m.ideas > 0 ? (
              <button type="button" className={s.linkBtn} onClick={() => goTo("money")}>
                {m.ideas} {m.ideas === 1 ? "idea" : "ideas"} to save money
              </button>
            ) : null}
          </details>
        </div>

        {/* HISTORY */}
        {overview.history.length ? (
          <details className={s.fold} data-ov-history>
            <summary className={s.blockHead}>
              <h4 className={s.blockTitle}>What happened last</h4>
              <span className={s.blockSub}>{shortDay(overview.history[0].at.slice(0, 10))}: {overview.history[0].text}</span>
            </summary>
            <ul className={s.history}>
              {overview.history.map((h, i) => (
                <li key={`${h.at}:${i}`}>
                  <span className={s.when}>{shortDay(h.at.slice(0, 10))}</span>
                  {h.text}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <BlueprintSheet
        open={note !== null}
        onClose={() => setNote(null)}
        title="Remind the client"
        description="They get the project update by email, and by text when they agreed to texts, with a link to their page where they make the picks."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setNote(null)}>Cancel</button>
            <button
              type="button"
              className="bps-btn bps-btn--primary"
              disabled={busy !== null || !note?.text.trim()}
              onClick={() => {
                const n = note;
                if (!n) return;
                void run(n.key, async () => {
                  const r = await sendClientUpdate(projectId, n.text.trim());
                  setNote(null);
                  setSent(r.words);
                });
              }}
              data-ov-remind-send
            >
              Send it
            </button>
          </>
        }
      >
        <div className="bps-form">
          <label className="bps-fld">
            <span className="bps-lbl">Your note</span>
            <textarea className="bps-in" rows={4} value={note?.text ?? ""} onChange={(e) => setNote((n) => (n ? { ...n, text: e.target.value } : n))} maxLength={600} data-ov-remind-note />
          </label>
        </div>
      </BlueprintSheet>
    </div>
  );
}
