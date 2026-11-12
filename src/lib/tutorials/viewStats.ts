// WHO WATCHED THE TUTORIALS — the counting (owner, 2026-11-11: "add to admin statistics how many times the tutorials
// were watched and by who"). Pure: the server keeps one record per person per film (lib/tutorials/views) and
// Admin → Tutorials counts them here.
//
// A PLAY is a film started in a page view (pausing and going on is the same play; opening it again later is a new
// one). FURTHEST is the latest second reached; FINISHED is the film's end reached at least once.

export type ViewEvent = "play" | "progress" | "done";

export interface TutorialView {
  userId: string;
  organizationId: string;
  slug: string;
  plays: number;
  /** The furthest second reached. */
  maxSec: number;
  done: boolean;
  firstAt: string;
  lastAt: string;
  /** When the last counted play started (a second "play" within a minute isn't a new one). */
  lastPlayAt?: string | null;
  doneAt?: string | null;
}

/** A play counts when it's the first, or the last one started more than a minute ago. */
export const PLAY_GAP_MS = 60_000;

/** The record after one event from the player. Pure; `sec` is clamped to the film (plus a little for rounding). */
export function applyViewEvent(prev: TutorialView | null, input: { userId: string; organizationId: string; slug: string; event: ViewEvent; sec: number; duration: number; now: Date }): TutorialView {
  const at = input.now.toISOString();
  const sec = Math.max(0, Math.min(Math.round(Number.isFinite(input.sec) ? input.sec : 0), input.duration + 5));
  const base: TutorialView = prev ?? { userId: input.userId, organizationId: input.organizationId, slug: input.slug, plays: 0, maxSec: 0, done: false, firstAt: at, lastAt: at, lastPlayAt: null, doneAt: null };
  const next: TutorialView = { ...base, organizationId: input.organizationId, lastAt: at, maxSec: Math.max(base.maxSec, sec) };
  if (input.event === "play") {
    const last = base.lastPlayAt ? Date.parse(base.lastPlayAt) : NaN;
    if (!(Number.isFinite(last) && input.now.getTime() - last < PLAY_GAP_MS)) {
      next.plays = base.plays + 1;
      next.lastPlayAt = at;
    }
  }
  if (input.event === "done" || sec >= input.duration - 2) {
    if (!base.done) next.doneAt = at;
    next.done = true;
    next.maxSec = Math.max(next.maxSec, input.duration);
  }
  return next;
}

/** The share of a film reached, 0–100. */
export function watchedPct(maxSec: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((maxSec / duration) * 100)));
}

export interface FilmStats {
  slug: string;
  title: string;
  duration: number;
  plays: number;
  people: number;
  finished: number;
  /** The middle viewer's furthest point, as a share of the film. */
  avgPct: number;
}

export interface TutorialStats {
  plays: number;
  people: number;
  finished: number;
  companies: number;
  films: FilmStats[];
}

/** Totals and one line per film (every film, watched or not, in the catalog's order). */
export function tutorialStats(views: readonly TutorialView[], films: ReadonlyArray<{ slug: string; title: string; duration: number }>): TutorialStats {
  const known = new Map(films.map((f) => [f.slug, f]));
  const kept = views.filter((v) => known.has(v.slug) && v.plays > 0);
  return {
    plays: kept.reduce((n, v) => n + v.plays, 0),
    people: new Set(kept.map((v) => v.userId)).size,
    finished: kept.filter((v) => v.done).length,
    companies: new Set(kept.map((v) => v.organizationId)).size,
    films: films.map((f) => {
      const mine = kept.filter((v) => v.slug === f.slug);
      return {
        slug: f.slug,
        title: f.title,
        duration: f.duration,
        plays: mine.reduce((n, v) => n + v.plays, 0),
        people: new Set(mine.map((v) => v.userId)).size,
        finished: mine.filter((v) => v.done).length,
        avgPct: mine.length ? Math.round(mine.reduce((n, v) => n + watchedPct(v.maxSec, f.duration), 0) / mine.length) : 0,
      };
    }),
  };
}
