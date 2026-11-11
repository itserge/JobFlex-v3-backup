"use client";

// TUTORIALS (owner, 2026-11-11) — /dashboard/tutorials, desk and phone (one responsive page: the route sits in the
// shell's BLUEPRINT_HANDHELD set, so a phone gets the handheld nav around it and ./tutorials.css restacks it).
//
//   · the list: "For your tools" first — the tutorials whose page this person's sidebar shows open (the sidebar's
//     own rule, navSectionsFor: not locked by the plan, not "Soon") — then "More from JobFlex", every other one,
//     still playable. A card: the film's title frame, its length, who it is for, and where this browser left it;
//   · ?v=<slug>: that tutorial — the film, and its chapters beside it (under it on a phone); a chapter starts the film
//     there and the one playing is marked. &t=<seconds> starts it at a point.
//
// WHERE YOU LEFT OFF is this browser's (localStorage `jf_tutorials`): the second reached, and "watched" once the end
// is reached. A film opened again picks up there. Nothing on the server tracks it yet.
//
// Styles: ./tutorials.css — plain CSS, every selector under `.jf-tutorials` at two classes or more (the shell's reset
// ties single-class rules in production). The page head and buttons are the shell's shared classes.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter, useSearchParams } from "next/navigation";
import { flattenNavItems, navSectionsFor } from "@/components/v3/blueprint-shell/nav-map";
import { useNavHidden, useNavIdentity, useNavLocked, useNavView } from "@/components/v3/blueprint-shell/nav-role";
import { TUTORIALS, chapterAt, clock, minutes, tutorialBySlug, type Tutorial, type TutorialLinks } from "@/lib/tutorials/catalog";
import "./tutorials.css";

// ── where this browser left each film ─────────────────────────────────────────
type Mark = { t: number; done?: boolean };
type Marks = Record<string, Mark>;
const KEY = "jf_tutorials";
const CHANGED = "jf-tutorials-changed";

function subscribeMarks(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}
function marksSnapshot(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
const marksServerSnapshot = () => null;
function parseMarks(raw: string | null): Marks {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === "object" ? (v as Marks) : {};
  } catch {
    return {};
  }
}
const readMarks = () => parseMarks(marksSnapshot());
function keepMark(slug: string, mark: Mark) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...readMarks(), [slug]: mark }));
    window.dispatchEvent(new Event(CHANGED));
  } catch {
    /* a private window: the place just won't be kept */
  }
}

const hrefFor = (slug: string, at?: number) => `/dashboard/tutorials?v=${slug}${at ? `&t=${Math.floor(at)}` : ""}` as Route;

/** What a card says under its title about where this browser is in the film. */
function standing(t: Tutorial, m: Mark | undefined): { words: string; tone: "done" | "part" | "new" } {
  if (m?.done) return { words: "Watched", tone: "done" };
  if (m && m.t >= 5) return { words: `Continue at ${clock(m.t)}`, tone: "part" };
  return { words: "Watch", tone: "new" };
}

export function TutorialsPage({ links, startAt }: { links: TutorialLinks | null; startAt: number | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const open = tutorialBySlug(params.get("v"));

  const rawMarks = useSyncExternalStore(subscribeMarks, marksSnapshot, marksServerSnapshot);
  const marks = useMemo(() => parseMarks(rawMarks), [rawMarks]);

  // The tools this person has open: the sidebar's own rule, so the two never disagree.
  const identity = useNavIdentity();
  const locked = useNavLocked();
  const hidden = useNavHidden();
  const view = useNavView();
  const openTools = useMemo(() => {
    const s = new Set<string>();
    for (const section of navSectionsFor(identity.role, locked, hidden, view))
      for (const item of flattenNavItems(section.items)) if (!item.locked && !item.soon) s.add(item.href);
    return s;
  }, [identity.role, locked, hidden, view]);
  const mine = TUTORIALS.filter((t) => openTools.has(t.toolHref));
  const rest = TUTORIALS.filter((t) => !openTools.has(t.toolHref));

  return (
    <div className="jf-tutorials" data-tutorials-page>
      <div className="page-head">
        <div>
          <div className="kicker">Learn JobFlex</div>
          <h1 className="page-title">Tutorials</h1>
        </div>
      </div>

      {open ? (
        <Player
          key={open.slug}
          tutorial={open}
          link={links?.[open.slug] ?? null}
          links={links}
          mark={marks[open.slug]}
          startAt={startAt}
          onKeep={keepMark}
          onBack={() => router.push("/dashboard/tutorials" as Route)}
          others={TUTORIALS.filter((t) => t.slug !== open.slug)}
          marks={marks}
        />
      ) : (
        <>
          <p className="tut-lead">Short videos that walk through each tool, screen by screen. Open one and pick a chapter to jump straight to it.</p>
          {mine.length ? (
            <section className="tut-group" aria-labelledby="tut-mine">
              <h2 className="tut-h" id="tut-mine">
                {rest.length ? "For your tools" : "Your tutorials"}
              </h2>
              <div className="tut-grid">
                {mine.map((t) => (
                  <Card key={t.slug} t={t} poster={links?.[t.slug]?.poster} mark={marks[t.slug]} />
                ))}
              </div>
            </section>
          ) : null}
          {rest.length ? (
            <section className="tut-group" aria-labelledby="tut-rest">
              <h2 className="tut-h" id="tut-rest">
                {mine.length ? "More from JobFlex" : "All tutorials"}
              </h2>
              <div className="tut-grid">
                {rest.map((t) => (
                  <Card key={t.slug} t={t} poster={links?.[t.slug]?.poster} mark={marks[t.slug]} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Card({ t, poster, mark }: { t: Tutorial; poster: string | undefined; mark: Mark | undefined }) {
  const st = standing(t, mark);
  const part = !mark?.done && mark && mark.t >= 5 ? Math.min(1, mark.t / t.duration) : 0;
  return (
    <Link className="tut-card" href={hrefFor(t.slug)} data-tutorial={t.slug}>
      <span className="tut-shot">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element -- a film's title frame, a signed link; no resizing needed
          <img src={poster} alt="" loading="lazy" width={1280} height={720} />
        ) : null}
        <span className="tut-play" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M8 5.5v13L19 12z" />
          </svg>
        </span>
        <span className="tut-len">{clock(t.duration)}</span>
        {part ? (
          <span className="tut-bar" aria-hidden="true">
            <span style={{ width: `${(part * 100).toFixed(1)}%` }} />
          </span>
        ) : null}
      </span>
      <span className="tut-body">
        <span className="tut-kick">
          {t.tool} · {t.audience}
        </span>
        <span className="tut-name">{t.title}</span>
        <span className="tut-sum">{t.summary}</span>
        <span className="tut-foot">
          <span>
            {minutes(t.duration)} · {t.chapters.length} chapters
          </span>
          <span className={`tut-state tut-state--${st.tone}`}>{st.words}</span>
        </span>
      </span>
    </Link>
  );
}

function Player({
  tutorial: t,
  link,
  links,
  mark,
  startAt,
  onKeep,
  onBack,
  others,
  marks,
}: {
  tutorial: Tutorial;
  link: { video: string; poster: string } | null;
  links: TutorialLinks | null;
  mark: Mark | undefined;
  startAt: number | null;
  onKeep: (slug: string, m: Mark) => void;
  onBack: () => void;
  others: readonly Tutorial[];
  marks: Marks;
}) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  // A link that ran out (a tab left open for hours): one refresh for new links, then on from the same second.
  const retried = useRef(false);
  const [now, setNow] = useState(startAt ?? 0);
  const [resumed, setResumed] = useState<number | null>(null);
  const lastSaved = useRef(0);
  // Watched once stays watched when it is played again.
  const doneRef = useRef(Boolean(mark?.done));
  const at = chapterAt(t, now);

  // Where it starts: the link's own second, else where this browser left it (not once it was watched to the end).
  // Used once, when the film's length is known.
  const startRef = useRef<number | null>(startAt);
  const onMeta = () => {
    const v = video.current;
    const s = startRef.current;
    if (!v || s == null) return;
    v.currentTime = Math.min(s, Math.max(0, (v.duration || t.duration) - 1));
    setNow(v.currentTime);
    if (startAt == null) setResumed(s);
    startRef.current = null;
  };

  const save = (done = false) => {
    const v = video.current;
    if (!v) return;
    if (done) doneRef.current = true;
    onKeep(t.slug, done ? { t: 0, done: true } : { t: Math.floor(v.currentTime), done: doneRef.current });
  };

  const jump = (s: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = s;
    setNow(s);
    setResumed(null);
    void v.play().catch(() => {
      /* the browser wants a tap first: the film waits at the chapter */
    });
  };

  // On arrival: where this browser left the film (read here, not from the list's copy, which a page opened straight
  // on a tutorial has not read yet) — then the start, if the browser already knows the film's length (it may, before
  // React listens for it).
  useEffect(() => {
    const kept = readMarks()[t.slug];
    doneRef.current = Boolean(kept?.done);
    if (startRef.current == null && kept && !kept.done && kept.t >= 5 && kept.t < t.duration - 15) startRef.current = kept.t;
    if ((video.current?.readyState ?? 0) >= 1) onMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  // Keep the place when the page is left mid-film.
  useEffect(() => {
    const v = video.current;
    return () => {
      if (v && v.currentTime >= 5 && !v.ended) onKeep(t.slug, { t: Math.floor(v.currentTime), done: doneRef.current });
    };
  }, [onKeep, t.slug]);

  const chapters = (
    <ol className="tut-chapters" aria-label="Chapters">
      {t.chapters.map((c, i) => (
        <li key={c.at}>
          <button type="button" className={`tut-chap${i === at ? " is-on" : ""}`} onClick={() => jump(c.at)} aria-current={i === at ? "true" : undefined} data-chapter={i}>
            <span className="tut-chap-t">{clock(c.at)}</span>
            <span className="tut-chap-x">
              <span className="tut-chap-n">{c.title}</span>
              <span className="tut-chap-a">{c.about}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="tut-watch" data-tutorial-open={t.slug}>
      <button type="button" className="tut-back" onClick={onBack}>
        <svg className="tut-back-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        All tutorials
      </button>
      <div className="tut-stage">
        <div className="tut-main">
          <div className="tut-frame">
            <video
              ref={video}
              src={link?.video}
              poster={link?.poster}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={() => {
                retried.current = false;
                onMeta();
              }}
              onError={() => {
                const v = video.current;
                if (!v || !link || retried.current) return;
                retried.current = true;
                if (v.currentTime >= 1) startRef.current = Math.floor(v.currentTime);
                router.refresh();
              }}
              onTimeUpdate={(e) => {
                const s = e.currentTarget.currentTime;
                setNow(s);
                if (Math.abs(s - lastSaved.current) >= 5) {
                  lastSaved.current = s;
                  if (s >= 5) save();
                }
              }}
              onPause={() => save()}
              onEnded={() => save(true)}
              data-tutorial-video
            >
              Your browser cannot play this video.
            </video>
            {link ? null : (
              <div className="tut-none" role="status">
                This video can&apos;t be played right now. Try again in a minute.
              </div>
            )}
          </div>
          <div className="tut-about">
            <div className="tut-kick">
              {t.tool} · {t.audience}
            </div>
            <h2 className="tut-title">{t.title}</h2>
            <p className="tut-sum">{t.summary}</p>
            <div className="tut-meta">
              <span>
                {clock(t.duration)} · {t.chapters.length} chapters
              </span>
              {at >= 0 ? <span className="tut-now">Now: {t.chapters[at].title}</span> : null}
              {resumed != null ? (
                <span className="tut-resumed">
                  Picked up at {clock(resumed)} ·{" "}
                  <button type="button" className="tut-link" onClick={() => jump(0)}>
                    Start over
                  </button>
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <aside className="tut-side" aria-label={`${t.title}: chapters`}>
          <div className="tut-side-in">
            <div className="tut-side-h">
              Chapters <span>{t.chapters.length}</span>
            </div>
            {chapters}
          </div>
        </aside>
      </div>

      {others.length ? (
        <section className="tut-group" aria-labelledby="tut-next">
          <h2 className="tut-h" id="tut-next">
            More tutorials
          </h2>
          <div className="tut-grid">
            {others.map((o) => (
              <Card key={o.slug} t={o} poster={links?.[o.slug]?.poster} mark={marks[o.slug]} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
