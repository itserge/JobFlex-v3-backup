"use client";

// THE CLIENT'S 360 BANDS (Smart CRM part 1, 2026-11-08; the plan doc "JobFlex Smart CRM — plan"):
//
//   MERGE BANNER     "looks like the same person" — shown only when another live record shares this one's email or
//                    phone; merging always asks (a confirm) and runs actions/clients360.mergeDuplicate.
//   WHERE THEY STAND the saved AI brief: the paragraph, the one next step, when it was built, a rebuild button.
//                    Marked AI — it is a reading of the record, never the record.
//   MEMORY           the source-linked facts, each removable; a replaced choice shows what it replaced ("was: cedar").
//                    A person can add one by hand (it lands un-marked as AI).
//   PROMISES         what either side promised, with due dates; Kept / Didn't happen settle them. Part 4's tracker
//                    will add and close these on its own; the hands stay useful after it.
//   STORY            the whole timeline — every proposal, visit, call, text, email, payment, review and project
//                    step, newest first, filtered by All / Messages / Money / Jobs.
//
// All five draw inside the record page's existing composition and write through src/actions/clients360.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { addFact, addPromise, mergeDuplicate, rebuildBriefNow, removeFact, settlePromise } from "@/actions/clients360";
import { FACT_CATEGORIES } from "@/lib/clientTimeline/shared";
import { TIMELINE_FILTERS, type TimelineKind } from "@/lib/clientTimeline/shared";
import { EmptyNote, Panel, cx } from "./cd-ui";
import styles from "./client-detail.module.css";

export type StoryRow = { id: string; kind: TimelineKind; stamp: string; tone: string; title: string; detail: string | null; href: string | null; when: string };
export type FactRow = { id: string; category: string; fact: string; source: string | null; byAi: boolean; replaced: string | null };
export type PromiseRow = { id: string; direction: string; text: string; status: string; due: string | null; overdue: boolean };
export type BriefView = { summary: string; nextAction: string | null; built: string } | null;
export type DuplicateRow = { id: string; name: string; via: string; contact: string };

const CATEGORY_WORD: Record<string, string> = {
  CONTACT: "Contact",
  PROJECT: "Project",
  DECISION: "Decision",
  COMMITMENT: "Commitment",
  MONEY: "Money",
  PREFERENCE: "Preference",
  HOUSE: "House",
};

export function MergeBanner({ clientId, duplicates }: { clientId: string; duplicates: DuplicateRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [gone, setGone] = useState<string[]>([]);
  const left = duplicates.filter((d) => !gone.includes(d.id));
  if (!left.length) return null;
  const run = (d: DuplicateRow) => {
    if (!window.confirm(`Fold "${d.name}" into this record? Their proposals, payments, visits and messages move here; the duplicate is archived. This record stays.`)) return;
    start(async () => {
      const r = await mergeDuplicate(clientId, d.id);
      if (r.ok) {
        setGone((g) => [...g, d.id]);
        router.refresh();
      } else window.alert(r.error ?? "The merge didn't go through.");
    });
  };
  return (
    <section data-rv="" className={cx(styles.card, styles.mergeBand)} aria-label="Possible duplicate records">
      {left.map((d) => (
        <div key={d.id} className={styles.mergeRow}>
          <span className={styles.mergeTxt}>
            <b>Looks like the same person:</b> “{d.name}” shares this record&rsquo;s {d.via}
            {d.contact ? <span className={styles.mergeMeta}> · {d.contact}</span> : null}
          </span>
          <span className={styles.mergeActs}>
            <button type="button" className="btn btn-ghost btn--sm" onClick={() => router.push(`/dashboard/client-detail?client=${d.id}` as Route)}>
              Open it
            </button>
            <button type="button" className="btn btn-primary btn--sm" disabled={busy} onClick={() => run(d)} data-merge-client={d.id}>
              {busy ? "Merging…" : "Merge into this one"}
            </button>
          </span>
        </div>
      ))}
    </section>
  );
}

export function BriefBand({ clientId, brief }: { clientId: string; brief: BriefView }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const rebuild = () =>
    start(async () => {
      await rebuildBriefNow(clientId);
      router.refresh();
    });
  return (
    <section data-rv="" className={cx(styles.card, styles.briefBand)} aria-label="Where they stand" data-client-brief={brief ? "built" : "none"}>
      <div className={styles.briefHead}>
        <span className="kicker">Where they stand</span>
        <span className={styles.aiStamp}>AI · {brief ? `rebuilt ${brief.built}` : "not built yet"}</span>
      </div>
      {brief ? (
        <>
          <p className={styles.briefTxt}>{brief.summary}</p>
          {brief.nextAction ? (
            <p className={styles.briefNext}>
              <b>Next:</b> {brief.nextAction}
            </p>
          ) : null}
        </>
      ) : (
        <p className={styles.briefTxt} style={{ color: "var(--muted)" }}>
          The summary builds itself from the timeline the first time something lands here.
        </p>
      )}
      <div className={styles.briefFoot}>
        <button type="button" className="btn btn-ghost btn--sm" onClick={rebuild} disabled={busy} data-brief-rebuild>
          {busy ? "Rebuilding…" : "Rebuild now"}
        </button>
        <span className={styles.briefNote}>An AI reading of the record — never a contract, a price or a confirmed fact.</span>
      </div>
    </section>
  );
}

export function MemoryPanel({ clientId, facts }: { clientId: string; facts: FactRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const textRef = useRef<HTMLInputElement | null>(null);
  const catRef = useRef<HTMLSelectElement | null>(null);
  const drop = (id: string) =>
    start(async () => {
      await removeFact(id);
      router.refresh();
    });
  const save = () => {
    const fact = textRef.current?.value.trim() ?? "";
    if (fact.length < 3) return;
    const category = (catRef.current?.value ?? "PREFERENCE") as (typeof FACT_CATEGORIES)[number];
    start(async () => {
      await addFact({ clientId, category, fact });
      setAdding(false);
      router.refresh();
    });
  };
  return (
    <Panel
      title="Memory"
      note={facts.length ? `${facts.length} fact${facts.length === 1 ? "" : "s"} · every line linked to its source` : "Nothing remembered yet"}
      tools={
        <button type="button" className="btn btn-ghost btn--sm" onClick={() => setAdding((a) => !a)} data-fact-add>
          {adding ? "Never mind" : "Add a fact"}
        </button>
      }
      bodyClass={styles.scroll}
    >
      {adding ? (
        <div className={styles.factAdd}>
          <select ref={catRef} defaultValue="PREFERENCE" aria-label="What kind of fact">
            {FACT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_WORD[c]}
              </option>
            ))}
          </select>
          <input ref={textRef} type="text" maxLength={180} placeholder="Prefers calls after 4 PM" aria-label="The fact" onKeyDown={(e) => e.key === "Enter" && save()} />
          <button type="button" className="btn btn-primary btn--sm" onClick={save} disabled={busy} data-fact-save>
            Save
          </button>
        </div>
      ) : null}
      {facts.length === 0 && !adding ? (
        <EmptyNote kicker="A clean slate">The AI adds what is worth remembering when the brief rebuilds; anything you add by hand lives here too.</EmptyNote>
      ) : (
        facts.map((f) => (
          <div key={f.id} className={styles.factRow} data-fact-row="">
            <span className={styles.factCat}>{CATEGORY_WORD[f.category] ?? f.category}</span>
            <span className={styles.factBody}>
              <span className={styles.factTxt}>{f.fact}</span>
              <span className={styles.factMeta}>
                {f.replaced ? <span className={styles.factWas}>was: {f.replaced} · </span> : null}
                {f.source ?? (f.byAi ? "AI read" : "typed in")}
              </span>
            </span>
            <button type="button" className={styles.factDrop} aria-label={`Forget "${f.fact}"`} title="Forget this" onClick={() => drop(f.id)} disabled={busy}>
              ×
            </button>
          </div>
        ))
      )}
    </Panel>
  );
}

export function PromisesPanel({ clientId, promises }: { clientId: string; promises: PromiseRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [adding, setAdding] = useState(false);
  const textRef = useRef<HTMLInputElement | null>(null);
  const dueRef = useRef<HTMLInputElement | null>(null);
  const settle = (id: string, outcome: "KEPT" | "CANCELED") =>
    start(async () => {
      await settlePromise(id, outcome);
      router.refresh();
    });
  const save = () => {
    const text = textRef.current?.value.trim() ?? "";
    if (text.length < 3) return;
    const due = dueRef.current?.value;
    start(async () => {
      await addPromise({ clientId, text, direction: "OURS", dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null });
      setAdding(false);
      router.refresh();
    });
  };
  const open = promises.filter((p) => p.status === "OPEN");
  const kept = promises.filter((p) => p.status === "KEPT");
  return (
    <Panel
      title="Promises"
      note={open.length ? `${open.length} open` : "Nothing owed either way"}
      tools={
        <button type="button" className="btn btn-ghost btn--sm" onClick={() => setAdding((a) => !a)} data-promise-add>
          {adding ? "Never mind" : "Add one"}
        </button>
      }
      bodyClass={styles.scroll}
    >
      {adding ? (
        <div className={styles.factAdd}>
          <input ref={textRef} type="text" maxLength={240} placeholder="Send the updated estimate" aria-label="What was promised" onKeyDown={(e) => e.key === "Enter" && save()} />
          <input ref={dueRef} type="date" aria-label="Due by" />
          <button type="button" className="btn btn-primary btn--sm" onClick={save} disabled={busy} data-promise-save>
            Save
          </button>
        </div>
      ) : null}
      {promises.length === 0 && !adding ? (
        <EmptyNote kicker="Nothing tracked">“I&rsquo;ll send it tomorrow” belongs here — add one, and part 4&rsquo;s tracker will soon catch them on its own.</EmptyNote>
      ) : (
        <>
          {open.map((p) => (
            <div key={p.id} className={styles.promiseRow} data-promise-row="">
              <span className={cx(styles.promiseStamp, p.overdue && styles.promiseLate)}>{p.overdue ? "Overdue" : p.due ? `Due ${p.due}` : "Open"}</span>
              <span className={styles.factBody}>
                <span className={styles.factTxt}>
                  {p.direction === "THEIRS" ? "They: " : "You: "}
                  {p.text}
                </span>
              </span>
              <span className={styles.promiseActs}>
                <button type="button" className="btn btn-ghost btn--sm" onClick={() => settle(p.id, "KEPT")} disabled={busy} data-promise-kept>
                  Kept
                </button>
                <button type="button" className="btn btn-ghost btn--sm" onClick={() => settle(p.id, "CANCELED")} disabled={busy}>
                  Drop
                </button>
              </span>
            </div>
          ))}
          {kept.map((p) => (
            <div key={p.id} className={cx(styles.promiseRow, styles.promiseDone)}>
              <span className={styles.promiseStamp}>Kept</span>
              <span className={styles.factBody}>
                <span className={styles.factTxt}>
                  <s>{p.text}</s>
                </span>
              </span>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}

export function StoryPanel({ story }: { story: StoryRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("all");
  const rows = useMemo(() => {
    const f = TIMELINE_FILTERS.find((x) => x.key === filter);
    return f?.kinds ? story.filter((r) => (f.kinds as readonly string[]).includes(r.kind)) : story;
  }, [filter, story]);
  return (
    <Panel
      title="Timeline"
      note={`${story.length} event${story.length === 1 ? "" : "s"} · newest first`}
      tools={
        <div className={styles.chips} role="group" aria-label="Filter the timeline">
          {TIMELINE_FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} className={cx(styles.chip, filter === f.key && styles.chipOn)} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      }
      bodyClass={styles.scroll}
    >
      {rows.length === 0 ? (
        <EmptyNote kicker="Nothing here yet">Everything that happens with this client — messages, money, visits, proposals — lands on this line.</EmptyNote>
      ) : (
        rows.map((r) => (
          <div key={r.id} className={styles.storyRow} data-story-row={r.kind}>
            <span className={cx(styles.storyStamp, styles[`tone_${r.tone}` as keyof typeof styles])}>{r.stamp}</span>
            <span className={styles.factBody}>
              <span className={styles.factTxt}>
                {r.href ? (
                  <a
                    href={r.href}
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(r.href as Route);
                    }}
                  >
                    {r.title}
                  </a>
                ) : (
                  r.title
                )}
              </span>
              <span className={styles.factMeta}>
                {r.when}
                {r.detail ? ` · ${r.detail}` : ""}
              </span>
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}
