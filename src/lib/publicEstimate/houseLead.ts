import "server-only";
// THE HOUSE LEAD (2026-10-28): "Get quotes" on a house page (/estimate/jobflex/<trade>, lib/webEstimator houseShop) is a
// Lead Center lead, as the roof's on /price/roof is — never a Lead of the house org. The website estimator's record
// rides beside it whole (lib/leadCenter/estimate WebLeadEstimate) for the Lead Center, the offer card and the
// contractor who buys it; the consent is the Lead Center's own words; the trade is the homeowner's own (no model asked)
// where the page is one trade; the homeowner lands on their request page and hears by email that a local pro will call.
// Design: docs/superpowers/specs/2026-10-28-home-portal-house-estimators-design.md.
import { appBaseUrl } from "@/lib/appUrl";
import { LEAD_CONSENT_TEXT } from "@/lib/leadConsent";
import { createHomeownerLead } from "@/lib/leadCenter/intake";
import { HOUSE_TRADE, estimateWords, houseSource, leadEstimateFromWeb } from "@/lib/leadCenter/estimate";
import { sendEmail } from "@/lib/sdk/resend";
import { afterResponse } from "@/lib/server-events";
import { HOUSE_NAME, PROJECT_TYPE, homeownerEmail, type WebEstimateRecord, type WebLeadContact, type WebShop } from "@/lib/webEstimator";
import { bumpWebCount, dropWebEstimate, restoreWebEstimate } from "@/lib/webEstimatorServer";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/** The pin the estimate was priced at, when the trade's page had one (fence, HVAC). */
function pinOf(est: WebEstimateRecord): { lat: number; lng: number } | null {
  const p = est.facts.pin as { lat?: unknown; lng?: unknown } | null | undefined;
  return p && typeof p.lat === "number" && typeof p.lng === "number" && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
}

export async function createHouseLead(
  shop: WebShop,
  est: WebEstimateRecord,
  contact: WebLeadContact & { email: string },
  ctx: { ip: string; page: string; timezone?: string | null },
): Promise<{ platformLeadId: string; next: string }> {
  const e = leadEstimateFromWeb(est, contact.note);
  const words = estimateWords(e);
  const pin = pinOf(est);
  // "Any project" names no trade — the detector reads the brief as for any described request.
  const known = e.trade === "smart" ? null : { trade: { trade: HOUSE_TRADE[e.trade], confidence: 1, reason: `the homeowner priced it on ${HOUSE_NAME}` }, lat: pin?.lat ?? null, lng: pin?.lng ?? null };
  // The token is claimed before the lead is made: the intake takes seconds (the cascade, the alerts), and a second
  // send of the same estimate in that window must find nothing. Put back if the intake throws.
  await dropWebEstimate(est.token);
  let res: Awaited<ReturnType<typeof createHomeownerLead>>;
  try {
    res = await createHomeownerLead(
    {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      address: est.address,
      city: est.city ?? undefined,
      state: est.state ?? undefined,
      zip: est.zip ?? undefined,
      projectType: PROJECT_TYPE[est.trade],
      description: words,
      // Pre-written and over 20 characters: the intake keeps it as the scope and skips the scope writer.
      scope: words,
    },
    {
      isTest: false,
      timezone: ctx.timezone ?? null,
      source: houseSource(e.trade),
      consent: { text: LEAD_CONSENT_TEXT, at: new Date(), ip: ctx.ip === "local" || ctx.ip === "unknown" ? null : ctx.ip, page: ctx.page },
      estimate: e,
      known,
    },
    );
  } catch (err) {
    await restoreWebEstimate(est).catch(() => {});
    throw err;
  }
  await bumpWebCount(shop.id, "leads").catch(() => {});
  const url = `${await appBaseUrl()}${res.statusPath}`;
  afterResponse(async () => {
    const m = homeownerEmail({ shop: HOUSE_NAME, trade: est.trade, band: est.band, show: est.show, summary: est.summary, choice: est.choice, phone: contact.phone, house: { url } });
    try {
      await sendEmail({ mailClass: "transactional", to: contact.email, subject: m.subject, text: m.text, html: `<pre style="font:15px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;white-space:pre-wrap">${escapeHtml(m.text)}</pre>` });
    } catch (err) {
      console.error("[house] homeowner email failed:", err instanceof Error ? err.message : err);
    }
  });
  return { platformLeadId: res.platformLeadId, next: res.statusPath };
}
