// GET /api/assistant/photo/<proposalId> (2026-11-05, the estimators by voice) — a roof's aerial photo for the
// phone's sheet: Google's satellite centred on the pin of the measurement the proposal was converted from
// (ProposalSitePhoto, as the client's own page shows it), else on the proposal's address when Google can place it.
// One company's own proposals only, with the session's auth — the middleware does not match /api. 404 without a
// pin, 502 when the photo can't be had (no key here): the sheet then shows no picture.
import { db } from "@/lib/db";
import { actorForSession, proposalScope } from "@/lib/assistant/actor";
import { geocode } from "@/lib/maps";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ proposalId: string }> }) {
  const { proposalId } = await ctx.params;
  let actor;
  try {
    actor = await actorForSession();
  } catch {
    return new Response("Not signed in.", { status: 403 });
  }
  const p = await db.proposal.findFirst({ where: { id: proposalId.slice(0, 64), organizationId: actor.organizationId, ...proposalScope(actor) }, select: { id: true, address: true } });
  if (!p) return new Response("Not found", { status: 404 });

  let link: { roofMeasurementId: string } | null = null;
  try {
    link = await db.proposalSitePhoto.findUnique({ where: { proposalId: p.id }, select: { roofMeasurementId: true } });
  } catch {
    link = null;
  }
  const row = link
    ? await db.roofMeasurement.findFirst({ where: { id: link.roofMeasurementId, organizationId: actor.organizationId }, select: { address: true, city: true, state: true, zip: true, lat: true, lng: true, instantJson: true } })
    : null;
  let subject = row;
  if (!subject && p.address) {
    const pin = await geocode(p.address).catch(() => null);
    if (pin) subject = { address: p.address, city: null, state: null, zip: null, lat: pin.lat, lng: pin.lng, instantJson: null };
  }
  if (!subject) return new Response("Not found", { status: 404 });
  const photo = await satellitePhotoPng(subject);
  if (!photo.ok) return new Response(photo.error, { status: 502 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
