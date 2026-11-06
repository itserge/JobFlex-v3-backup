// GET /api/assistant/photo/<proposalId> (2026-11-06, the estimators by voice) — a roof's aerial picture for the
// phone's sheet: the measurement the proposal was converted from (ProposalSitePhoto), in the frame the client's
// own page gets (lib/roofPictureFetch: EagleView's ortho when it answers, else Google's satellite centred on the
// pin), else the satellite over the proposal's address when Google can place it. One company's own proposals only,
// with the session's auth — the middleware does not match /api. 404 without a pin, 502 when no picture can be had
// (no key here): the sheet then shows no picture.
import { db } from "@/lib/db";
import { actorForSession, proposalScope } from "@/lib/assistant/actor";
import { geocode } from "@/lib/maps";
import { satellitePhotoPng } from "@/lib/staticMapPhoto";
import { loadRoofPicture } from "@/lib/roofPictureFetch";
import type { InstantRoofData } from "@/lib/eagleview";

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
  if (row) {
    let instant: InstantRoofData | null = null;
    try {
      instant = row.instantJson ? (JSON.parse(row.instantJson) as InstantRoofData) : null;
    } catch {
      instant = null;
    }
    const pic = await loadRoofPicture({ ...row, instant });
    if (!pic.frame) return new Response("No picture", { status: 502 });
    return new Response(pic.bytes, { headers: { "Content-Type": pic.contentType, "Cache-Control": "private, max-age=3600" } });
  }
  if (!p.address) return new Response("Not found", { status: 404 });
  const pin = await geocode(p.address).catch(() => null);
  if (!pin) return new Response("Not found", { status: 404 });
  const photo = await satellitePhotoPng({ address: p.address, city: null, state: null, zip: null, lat: pin.lat, lng: pin.lng, instantJson: null });
  if (!photo.ok) return new Response(photo.error, { status: 502 });
  return new Response(new Uint8Array(photo.bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
