import "server-only";
// WHO WATCHED THE TUTORIALS — the records (owner, 2026-11-11). One SyncState row per person per film,
// `tutorialView:<userId>:<slug>` (lib/tutorials/viewStats TutorialView): plays, the furthest second, finished, first
// and last time. Written by the tutorials page's player (actions/tutorials noteTutorialWatch), read by
// Admin → Tutorials. Nothing before 2026-11-11 was recorded on the server (the page kept progress in the browser).

import { db } from "@/lib/db";
import { applyViewEvent, type TutorialView, type ViewEvent } from "./viewStats";

export const TUTORIAL_VIEW_PREFIX = "tutorialView:";
const keyOf = (userId: string, slug: string) => `${TUTORIAL_VIEW_PREFIX}${userId}:${slug}`;

function parse(raw: string | null | undefined): TutorialView | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as TutorialView;
    return v && typeof v.userId === "string" && typeof v.slug === "string" && Number.isFinite(v.plays) ? v : null;
  } catch {
    return null;
  }
}

/** One event from the player. Never throws (a count must never stop a film). */
export async function noteTutorialView(input: { userId: string; organizationId: string; slug: string; event: ViewEvent; sec: number; duration: number; now?: Date }): Promise<void> {
  try {
    const key = keyOf(input.userId, input.slug);
    const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
    const next = applyViewEvent(parse(row?.cursor), { ...input, now: input.now ?? new Date() });
    const cursor = JSON.stringify(next);
    await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
  } catch (err) {
    console.warn("[tutorials] view not counted:", err instanceof Error ? err.message : err);
  }
}

export interface TutorialViewRow extends TutorialView {
  name: string | null;
  email: string | null;
  staff: boolean;
  company: string | null;
}

/** Every record, with who it is and their company — for Admin → Tutorials. */
export async function readTutorialViews(): Promise<TutorialViewRow[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: TUTORIAL_VIEW_PREFIX } }, select: { cursor: true } });
  const views = rows.map((r) => parse(r.cursor)).filter((v): v is TutorialView => !!v);
  if (!views.length) return [];
  const [users, orgs] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(views.map((v) => v.userId))] } }, select: { id: true, name: true, email: true, isPlatformAdmin: true } }),
    db.organization.findMany({ where: { id: { in: [...new Set(views.map((v) => v.organizationId))] } }, select: { id: true, name: true } }),
  ]);
  const userBy = new Map(users.map((u) => [u.id, u]));
  const orgBy = new Map(orgs.map((o) => [o.id, o.name]));
  return views.map((v) => {
    const u = userBy.get(v.userId);
    return { ...v, name: u?.name ?? null, email: u?.email ?? null, staff: !!u?.isPlatformAdmin, company: orgBy.get(v.organizationId) ?? null };
  });
}
