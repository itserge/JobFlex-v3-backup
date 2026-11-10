import "server-only";
// PUBLIC LINKS ON THE FREE PLAN (owner, 2026-11-09). A link the company sends to someone outside it — the buyer's
// list (/buy/<token>), the crew's day (/w/<token>), a sub's quote (/q/<token>) and subcontract (/s/<token>), the
// homeowner's project page (/p/<token>), the lender's page (/l/<token>), SmartBook's time pick (/b/<token>) and its
// answer page (/b/r/<token>), the client's page (/c/<token>) — keeps working while the company that owns it holds a live plan or a trial, and is
// PAUSED while it is on the Free plan: the page says "This link is paused" and shows nothing of the company's, and
// the link's own actions and routes refuse. Asked as nobody (lib/customPageAccess linkPaused): the visitor has no
// session, and a signed-in visitor's session never opens it. The feature behind each link is the paid feature it
// belongs to (lib/customPlan PAID_FEATURES).
import { db } from "@/lib/db";
import { linkPaused } from "@/lib/customPageAccess";
import type { PaidFeatureId } from "@/lib/customPlan";

export type PublicLinkKind = "buy" | "crew" | "sub-quote" | "subcontract" | "project" | "lender" | "smartbook-pick" | "smartbook-request" | "client-home";

const FEATURE: Record<PublicLinkKind, PaidFeatureId> = {
  buy: "project-tools",
  project: "project-tools",
  lender: "project-tools",
  crew: "crew-field",
  "sub-quote": "subcontractors",
  subcontract: "subcontractors",
  "smartbook-pick": "smartbook",
  "smartbook-request": "smartbook",
  // The client's page (/c/<token>, Smart CRM part 5, 2026-11-10).
  "client-home": "smart-crm",
};

/** The words a paused link shows, and the refusal its actions answer with. */
export const LINK_PAUSED_TITLE = "This link is paused";
export const LINK_PAUSED_TEXT = "The company that sent it has paused this part of JobFlex. Contact them directly — nothing you entered before is lost.";
export const LINK_PAUSED_REFUSAL = `${LINK_PAUSED_TITLE}. ${LINK_PAUSED_TEXT}`;

const TOKEN = /^[A-Za-z0-9_-]{6,120}$/;

/** The organization that owns a link, or null when the token names nothing. */
export async function publicLinkOrg(kind: PublicLinkKind, token: string): Promise<string | null> {
  if (!TOKEN.test(token)) return null;
  const pick = { select: { organizationId: true } } as const;
  switch (kind) {
    case "buy":
      return (await db.projectOrder.findUnique({ where: { publicToken: token }, ...pick }))?.organizationId ?? null;
    case "crew":
      return (await db.workerProfile.findUnique({ where: { token }, ...pick }))?.organizationId ?? null;
    case "sub-quote":
      return (await db.projectSubQuote.findUnique({ where: { publicToken: token }, ...pick }))?.organizationId ?? null;
    case "subcontract":
      return (await db.subcontract.findUnique({ where: { publicToken: token }, ...pick }))?.organizationId ?? null;
    case "project":
      return (await db.project.findUnique({ where: { publicToken: token }, ...pick }))?.organizationId ?? null;
    case "lender":
      return (await db.project.findUnique({ where: { lenderToken: token }, ...pick }))?.organizationId ?? null;
    case "client-home":
      return (await db.client.findUnique({ where: { homeToken: token }, ...pick }))?.organizationId ?? null;
    case "smartbook-pick":
    case "smartbook-request": {
      const key = kind === "smartbook-pick" ? `smartbook:t:${token}` : `smartbook:rt:${token}`;
      const row = await db.syncState.findUnique({ where: { key }, select: { cursor: true } });
      try {
        const v = row ? (JSON.parse(row.cursor) as { o?: unknown }) : null;
        return typeof v?.o === "string" ? v.o : null;
      } catch {
        return null;
      }
    }
  }
}

/** The link is paused: its owner is on the Free plan. An unknown token is not "paused" — the page's own 404 stands. */
export async function publicLinkPaused(kind: PublicLinkKind, token: string): Promise<boolean> {
  const org = await publicLinkOrg(kind, token).catch(() => null);
  return !!org && (await linkPaused(org, FEATURE[kind]));
}

/** For a link's action: the refusal when it is paused, else null. */
export async function publicLinkRefusal(kind: PublicLinkKind, token: string): Promise<{ ok: false; error: string } | null> {
  return (await publicLinkPaused(kind, token)) ? { ok: false, error: LINK_PAUSED_REFUSAL } : null;
}

/** For a link's API route: the 403 when it is paused, else null. */
export async function publicLinkResponse(kind: PublicLinkKind, token: string): Promise<Response | null> {
  return (await publicLinkPaused(kind, token)) ? Response.json({ ok: false, error: LINK_PAUSED_REFUSAL, code: "LINK_PAUSED" }, { status: 403 }) : null;
}
