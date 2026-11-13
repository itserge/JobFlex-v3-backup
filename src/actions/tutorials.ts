"use server";
// THE TUTORIALS PAGE'S PLAYER TELLS THE SERVER (owner, 2026-11-11: "how many times the tutorials were watched and by
// who") — a film started, how far it got, the end reached. Signed-in members only; the film must be one of ours.
// lib/tutorials/views keeps it; Admin → Tutorials shows it. Never throws to the player.
import { requireOrg } from "@/lib/orgContext";
import { tutorialBySlug } from "@/lib/tutorials/catalog";
import { noteTutorialView } from "@/lib/tutorials/views";
import type { ViewEvent } from "@/lib/tutorials/viewStats";

const EVENTS: readonly ViewEvent[] = ["play", "progress", "done"];

export async function noteTutorialWatch(input: { slug?: unknown; event?: unknown; sec?: unknown }): Promise<void> {
  const film = typeof input?.slug === "string" ? tutorialBySlug(input.slug) : null;
  const event = EVENTS.includes(input?.event as ViewEvent) ? (input.event as ViewEvent) : null;
  if (!film || !event) return;
  let ctx: Awaited<ReturnType<typeof requireOrg>>;
  try {
    ctx = await requireOrg();
  } catch {
    return;
  }
  const sec = typeof input.sec === "number" ? input.sec : 0;
  await noteTutorialView({ userId: ctx.user.id, organizationId: ctx.organizationId, slug: film.slug, event, sec, duration: film.duration });
}
