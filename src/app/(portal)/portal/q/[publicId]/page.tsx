// PUBLIC PROPOSAL PORTAL — the page a homeowner opens from a proposal link.
// Route: /portal/q/[publicId].
//
// A verbatim port of the approved mockup
// `jobflex-proposal-client-blueprint (3).html`. The editorial sage-era
// treatment that lived here before is REPLACED IN PLACE — same route, same
// three files — not forked into a parallel `-blueprint` route. (That reverses
// the side-by-side convention some earlier ports recorded in their headers,
// e.g. /dashboard/subscription-blueprint. Replacement is the instruction now.)
//
// THE CHROME IS THE DONOR'S OWN, ALL OF IT. This surface is standalone by
// definition — the reader is a homeowner, not a signed-in contractor — and the
// `(portal)` route group has no layout.tsx, so the only thing above this page
// is the root layout's <html>/<body>. Nothing is doubled: there is no
// blueprint-shell here, no sidebar, no topbar. What the donor draws as its
// whole document (`div.pv` and its seven blocks) is what ships, wrapped in one
// `.jf-proposal-portal` div that carries the donor's token block and universal
// reset. See the header of ./proposal-portal.css for why that wrapper exists
// and how the donor's <body> rule was split across it and <body>.
//
// THIS FILE STAYS A SERVER COMPONENT so the proposal read, the VIEWED
// side-effect and the donor's <title> all run on the server. The two client
// pieces are surgical: ./portal-actions.tsx (the accept/decline block) and
// ./portal-reveal.tsx (the entrance observer).
//
// NO DATA-LAYER CHANGE. Same Prisma read, same includes, same view-tracking
// write, same /api/public-quote/[publicId]/{accept,decline,pdf} and
// /api/checkout/[provider] contracts as the page this replaces.

import type { Metadata } from "next";
import { fireTextRules, proposalContext } from "@/lib/sms/rulesEngine";
import { afterResponse } from "@/lib/server-events";
import { alertProposalOpened } from "@/lib/assistant/alerts";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientSplit, splitCaption } from "@/lib/pricing/markup";
import { contractTotal } from "@/lib/contractTotal";
import { money, longDate } from "@/lib/format";
import { measureWords } from "@/lib/measureWords";
import { parseProposalSettings } from "@/lib/settings";
import { buildPortalView, type PortalRating } from "@/components/v3/mobile-proposal-client/portal-view";
import { proposalLogoHref } from "@/lib/orgLogo";
import { BrandAccentStyle } from "@/components/portal/brand-accent-style";
import { proposalPictures } from "@/lib/proposalPictures";
import { FenceSceneFigure } from "@/components/v3/fence-scene/fence-scene-figure";
import { DeckSceneFigure } from "@/components/v3/deck-scene/deck-scene-figure";
import { buildPortalPayModel } from "@/lib/payments/portalModel";
import { syncLoanForPublicId } from "@/lib/financing/service";
import { formatAvg, orgPublicRating, publicReviewsPath } from "@/lib/reviews/publicSummary";
import { StarsInline } from "@/components/reviews/StarsInline";
import { PortalActions } from "./portal-actions";
import { PortalPayment } from "./portal-payment";
import { PortalReveal } from "./portal-reveal";
import { PortalViewport } from "./portal-viewport";
import { HomeBackLink } from "./home-back-link";
import "./proposal-portal.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const proposal = await db.proposal.findUnique({
    where: { publicId },
    select: { organization: { select: { name: true } } },
  });
  // The donor's own <title>: "Reyes & Sons Roofing · Proposal".
  return { title: proposal ? `${proposal.organization.name} · Proposal` : "Proposal" };
}

export default async function PublicProposalPortal({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { publicId } = await params;
  // An invoice link carries the stage it is for and the rail the office chose
  // (lib/payments/invoices): the payment block opens on that stage and shows
  // only that way to pay.
  const sp = (await searchParams) ?? {};
  const focusStage = typeof sp.pay === "string" ? sp.pay : null;
  const methodParam = typeof sp.method === "string" && ["card", "bank", "any"].includes(sp.method) ? (sp.method as "card" | "bank" | "any") : null;
  // Back from Wisetack (lib/financing): read the client's loan once, so the page shows where it stands.
  if (sp.financing === "back") await syncLoanForPublicId(publicId).catch(() => {});
  const proposal = await db.proposal.findUnique({
    where: { publicId },
    include: {
      lineItems: { orderBy: { position: "asc" } },
      installments: { orderBy: { position: "asc" } },
      changeOrders: { where: { status: { in: ["SENT", "APPROVED"] } }, orderBy: { createdAt: "asc" }, select: { id: true, number: true, title: true, status: true, total: true, amount: true, publicToken: true } },
      client: true,
      organization: {
        // paymentSettingsJson decides WHICH pay buttons this client is offered:
        // the portal used to print Stripe, Square and PayPal to everyone and
        // only admit that two of them were switched off after the click, in a
        // toast written for the contractor ("add the keys to .env") and shown
        // to their customer.
        select: {
          name: true,
          slug: true,
          logoUrl: true,
          primaryColor: true,
          phone: true,
          address: true,
          deletedAt: true,
          paymentSettingsJson: true,
          proposalSettingsJson: true,
          paymentConnections: true,
        },
      },
    },
  });

  // A soft-deleted org's proposals are gone from the outside world too.
  if (!proposal || proposal.organization.deletedAt) return notFound();

  // The client's own job in pictures (lib/proposalPictures, 2026-09-23): the
  // fence's 3D and traced layout, the roof from the air with the measured
  // outline, or as a plan. None is fine; a missing table costs a picture,
  // never the page.
  const pictures = await proposalPictures({ id: proposal.id, publicId, trade: proposal.trade, beforePhotos: proposal.beforePhotos }).catch(() => []);
  // The fence in 3D stands on its own, full width, above the stills (2026-09-27).
  const sceneShot = pictures.find((p) => p.kind === "fence-scene") ?? null;
  // The deck in 3D (2026-10-04) stands the same way.
  const deckShot = pictures.find((p) => p.kind === "deck-scene") ?? null;
  const stills = pictures.filter((p) => p.kind !== "fence-scene" && p.kind !== "deck-scene");

  // THE SHOP'S OWN OPENS DO NOT COUNT (2026-09-20). The contractor checking
  // their own link — the preview from the proposals list, a reread before a
  // follow-up call — used to land in the client's view count, so "3 views"
  // could be three of their own. A signed-in member of the proposal's own
  // organization is skipped; everybody else counts, and a client who is not
  // signed in (which is every client) is unaffected.
  let ownSide = false;
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (userId) {
      ownSide = Boolean(
        await db.membership.findFirst({
          where: { userId, organizationId: proposal.organizationId },
          select: { id: true },
        }),
      );
    }
  } catch {
    // No session to read — treat it as a client, which is the safe default.
    ownSide = false;
  }

  // Track view. EVERY client open counts and stamps `viewedAt` — a declined or
  // accepted proposal being re-read is still a fact the office wants (owner,
  // 2026-09-02: the count sat frozen once a proposal settled). Only the STATUS
  // is guarded: SENT becomes VIEWED on the first open, and nothing else moves —
  // a decline stays a decline however many times the page is reloaded.
  if (!ownSide) {
    await db.proposal.update({
      where: { id: proposal.id },
      data: {
        viewCount: { increment: 1 },
        viewedAt: new Date(),
        ...(proposal.status === "SENT" ? { status: "VIEWED" as const } : {}),
      },
    });
  }
  // The activity line is for the FIRST reading, not every reload — a feed
  // entry per refresh would bury the events that matter.
  if (!ownSide && (proposal.status === "SENT" || proposal.status === "DRAFT")) {
    await db.activityEvent.create({
      data: {
        organizationId: proposal.organizationId,
        proposalId: proposal.id,
        clientId: proposal.clientId,
        kind: "VIEWED",
        summary: `${proposal.client?.name ?? "Client"} opened the proposal`,
      },
    });
    // The company's own texts on the first opening (2026-09-29).
    const openedId = proposal.id;
    afterResponse(() => fireTextRules("proposal.viewed", proposalContext(openedId)));
    // The AI Operator tells the people who asked (2026-11-05, lib/assistant/alerts): the first look only, as this block is.
    afterResponse(() => alertProposalOpened(openedId).then(() => undefined));
    if (proposal.status === "SENT") afterResponse(async () => { await (await import("@/lib/followUps/engine")).scheduleFollowUpsFor(openedId, "VIEWED"); }); // the "Viewed" follow-up rules (lib/followUps/defaults)
  }

  const org = proposal.organization;
  // What the client can pay, and how — resolved once, shared by both trees.
  const payModel = await buildPortalPayModel(publicId, proposal, org, { money, longDate });
  // The contractor's public standing (not-hidden reviews only), under their
  // name in the header, linking to /r/<slug>. Absent when there is none —
  // "no reviews" has no place on a sales document.
  const pub = await orgPublicRating(proposal.organizationId);
  const rating: PortalRating | null =
    pub.count > 0 && pub.avg != null
      ? { avg: formatAvg(pub.avg) as string, count: pub.count, href: publicReviewsPath(org.slug) }
      : null;
  // The contract as it stands: the proposal's own total plus every approved
  // change order (a change order never edits the proposal's figures).
  const contractValue = contractTotal(proposal.total, proposal.changeOrders);
  const approvedChangesTotal = Math.round((contractValue - proposal.total) * 100) / 100;
  const orgTerms = parseProposalSettings(org.proposalSettingsJson).terms?.trim() || "";
  const monogram = (org.name?.trim()?.[0] ?? "J").toUpperCase();
  // The logo from Company → Branding, when the shop has set one; the letter
  // box is only the stand-in for a shop without a logo.
  const logoHref = proposalLogoHref(publicId, org.logoUrl);
  const clientName = proposal.client?.name?.trim() || "you";

  // The donor stamps "Proposal № 2851". There is NO proposal-number column on
  // the Proposal model and adding one is a schema change, which is out of
  // scope — so this is the last four characters of the row's publicId (a v4
  // UUID), uppercased. Stable, unique in practice, and a real reference the
  // contractor can search on. Flagged in the port report.
  const refCode = publicId.replace(/-/g, "").slice(-4).toUpperCase();

  // The scope prints only when the builder's "Show to client" says so.
  const hasScope = Boolean(proposal.showScope && proposal.scopeOfWork && proposal.scopeOfWork.trim());
  const hasDescription = Boolean(proposal.description && proposal.description.trim());
  const telHref = org.phone ? `tel:${org.phone.replace(/\s+/g, "")}` : null;

  // ── HANDHELD ────────────────────────────────────────────────────────────
  // At ≤768px this URL serves the handheld rebuild instead of the tree below;
  // above it, nothing changes. The switch is a media query inside
  // ./portal-viewport.tsx and exactly one of the two trees is ever mounted.
  //
  // The read, the VIEWED write and generateMetadata all stay here, on the
  // server — this page is opened from an email link and is the PayPal/Square
  // return_url, so it does not become a client-side fetch. `view` is the same
  // row, already formatted, in a plain serialisable shape. No data-layer
  // change: same query, same includes, same endpoints.
  const view = buildPortalView(publicId, proposal, { money, longDate }, {
    pay: payModel,
    terms: orgTerms,
    rating,
    pictures,
  });

  return (
    <>
    {/* The shop's brand colour (Company → Branding) as the page's accent. */}
    <BrandAccentStyle color={org.primaryColor} />
    <PortalViewport view={view}>
    <div className="jf-proposal-portal">
      <div className="pv">
        {/* Back to the home dashboard, when that is where the homeowner came from (2026-10-14). */}
        <HomeBackLink />

        {/* ШАПКА */}
        {/* (RU: "Header") */}
        <header className="pv-head rv">
          {logoHref ? (
            // eslint-disable-next-line @next/next/no-img-element -- the shop's own logo, served by /api/public-quote/[publicId]/logo
            <img className="pv-logo" src={logoHref} alt={org.name ? `${org.name} logo` : "Company logo"} />
          ) : (
            <span className="pv-mono">{monogram}</span>
          )}
          {/* Identity only — the name and the reference. The row reads
              mark · identity · stamps; a long name truncates (the full
              string rides in `title`) so the stamps never leave the row. */}
          <div className="pv-org">
            <b title={org.name || undefined}>{org.name}</b>
            <span>{`Proposal № ${refCode} · ${longDate(proposal.createdAt)}`}</span>
          </div>
          {/* The contractor's standing as a plate beside the PDF stamp, on
              the row's own centreline — not a third line under the name,
              which made the identity block taller than the monogram. */}
          {rating ? (
            <a
              className="pv-rating"
              href={rating.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Rated ${rating.avg} out of 5 from ${rating.count} client ${rating.count === 1 ? "review" : "reviews"} — see all reviews`}
            >
              <StarsInline value={Number(rating.avg)} size={13} />
              <em>{rating.avg}</em>
              <i>{`· ${rating.count} ${rating.count === 1 ? "review" : "reviews"}`}</i>
            </a>
          ) : null}
          <a
            className="pv-pdf"
            href={`/api/public-quote/${publicId}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Download PDF
          </a>
        </header>

        {/* ИНТРО */}
        {/* (RU: "Intro") */}
        <section className="pv-intro rv">
          <div className="pv-intro-card">
            <div className="pv-kicker">{`Prepared for ${clientName}`}</div>
            <h1 className="pv-h1">{proposal.title}</h1>
            <div className="pv-facts">
              <div className="total"><span>Total</span><b>{money(proposal.total)}</b></div>
              <div><span>Valid until</span><b>{longDate(proposal.validUntil)}</b></div>
            </div>

            {sceneShot && (
              <FenceSceneFigure className="pv-scene" src={sceneShot.src} poster={sceneShot.poster ?? null} caption={sceneShot.caption} facts={sceneShot.facts} />
            )}
            {deckShot && <DeckSceneFigure className="pv-scene" src={deckShot.src} caption={deckShot.caption} facts={deckShot.facts} />}
            {stills.length > 0 && (
              <div className={`pv-pics${stills.length > 1 ? " pv-pics--two" : ""}`} data-pictures={pictures.map((p) => p.kind).join(" ")}>
                {stills.map((p) => (
                  <figure key={p.kind} className="pv-site" data-picture={p.kind}>
                    <div className="pv-site-frame">
                      {/* eslint-disable-next-line @next/next/no-img-element -- streamed from this app's own routes or Blob; next/image adds nothing */}
                      <img src={p.src} alt={p.alt} loading="lazy" />
                      {p.overlay && (
                        <svg className="pv-site-ov" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                          {p.overlay.map((pts, i) => <polygon key={i} points={pts} />)}
                        </svg>
                      )}
                      {p.pin && (
                        <span className="pv-site-pin" style={{ left: `${p.pin.x / 10}%`, top: `${p.pin.y / 10}%` }} data-roof-pin>
                          <svg viewBox="-40 -104 80 112" aria-hidden="true"><ellipse cx="0" cy="2" rx="16" ry="6" fill="#000" fillOpacity="0.28" /><path d="M0 0C-6-22-34-40-34-62a34 34 0 1 1 68 0C34-40 6-22 0 0z" fill="#e5322d" stroke="#fff" strokeWidth="6" strokeLinejoin="round" /><circle cx="0" cy="-62" r="12" fill="#fff" /></svg>
                        </span>
                      )}
                    </div>
                    <figcaption>
                      {p.caption}
                      {p.facts ? <span className="pv-site-facts">{p.facts}</span> : null}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            <PortalActions
              publicId={publicId}
              status={proposal.status}
                model={payModel}
            />
          </div>

        </section>

        {/* OVERVIEW — not a donor section. `proposal.description` is
            contractor-authored copy that the page this replaces rendered under
            the H1; the mockup's intro card has no slot for it. Rather than
            drop customer content or invent a treatment, it reuses the donor's
            own `.pv-sec` / `.pv-scope` pair. Flagged in the port report. */}
        {hasDescription ? (
          <section className="pv-sec rv">
            <h2 className="pv-sec-h">Overview</h2>
            <p className="pv-scope">{proposal.description}</p>
          </section>
        ) : null}

        {/* ESTIMATE DETAIL */}
        <section className="pv-sec rv">
          <h2 className="pv-sec-h">Estimate detail</h2>
          <div className="pv-ledger">
            {proposal.lineItems.map((item) => {
              const measure = measureWords(item.measurementType, item.quantity);
              // The donor's meta line reads "24 sq · 24 × $310" — the quantity
              // leads the measurement, then repeats against the unit price.
              const meta = [
                measure ? (item.quantity ? `${item.quantity} ${measure}` : measure) : null,
                item.quantity ? `${item.quantity} × ${money(item.unitPrice)}` : null,
              ]
                .filter(Boolean)
                .join(" · ");
              // "Labor + material breakdown" (card 06 of the builder, saved on
              // the row): the client-facing halves of the line, which add up to
              // its total. Off, the line reads as one total.
              const split = proposal.showBreakdown
                ? splitCaption(clientSplit(item, { materialMarkupPct: proposal.materialMarkupPct, laborMarkupPct: proposal.laborMarkupPct }, { marginOnLabor: proposal.marginOnLabor }), money)
                : null;
              return (
                <div className="pv-li" key={item.id}>
                  <div>
                    <div className="pv-li-n">{item.name}</div>
                    {item.description ? (
                      <div className="pv-li-d">{item.description}</div>
                    ) : null}
                    {meta ? <div className="pv-li-m">{meta}</div> : null}
                    {split ? <div className="pv-li-m">{split}</div> : null}
                  </div>
                  <div className="pv-li-v">{money(item.total)}</div>
                </div>
              );
            })}
            <div className="pv-tot">
              <div className="pv-tot-r"><span>Subtotal</span><b>{money(proposal.subtotal)}</b></div>
              {/* Always show the tax line — at 0% it reads "Tax · 0.0%" / $0. */}
              <div className="pv-tot-r">
                <span>{`Tax · ${(proposal.taxRate * 100).toFixed(1)}%`}</span>
                <b>{money(proposal.taxTotal)}</b>
              </div>
              {approvedChangesTotal !== 0 && (
                <div className="pv-tot-r">
                  <span>Approved changes</span>
                  <b>{approvedChangesTotal > 0 ? "+" : "−"}{money(Math.abs(approvedChangesTotal))}</b>
                </div>
              )}
              <div className="pv-tot-due"><span>Total due</span><b>{money(contractValue)}</b></div>
            </div>
            {proposal.changeOrders.length > 0 && (
              <div className="pv-changes">
                <div className="pv-changes-h">Changes to the contract</div>
                {proposal.changeOrders.map((c) => {
                  const amt = c.total ?? c.amount;
                  const label = `Change order${c.number ? ` #${c.number}` : ""} · ${c.title}`;
                  return c.status === "SENT" ? (
                    <a key={c.id} className="pv-change pv-change--open" href={`/co/${c.publicToken}`}>
                      <span>{label}</span>
                      <b>{amt >= 0 ? "+" : "−"}{money(Math.abs(amt))} · needs your approval</b>
                    </a>
                  ) : (
                    <div key={c.id} className="pv-change">
                      <span>{label}</span>
                      <b>{amt >= 0 ? "+" : "−"}{money(Math.abs(amt))} · approved</b>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* SCOPE */}
        {hasScope ? (
          <section className="pv-sec rv">
            <h2 className="pv-sec-h">Scope of work</h2>
            <p className="pv-scope">{proposal.scopeOfWork}</p>
          </section>
        ) : null}

        {/* PAYMENT SCHEDULE — the stages, their state, and the pay buttons
            on the next one. Always rendered: a proposal with no stages is one
            "Full payment" stage, and that is exactly what the client pays. */}
        <PortalPayment model={payModel} focus={focusStage} method={methodParam} />

        {/* TERMS & CONDITIONS — a disclosure, closed by default.
            Source is the ORG's terms (settings/proposals). The manual builder
            has a per-proposal terms box, but nothing persists it: the bridge
            writes `terms: ""` in both directions and the Proposal model has no
            column for it, so the org default is the only terms text that
            actually survives a save. Flagged for the owner — storing them per
            proposal is a schema change. */}
        {orgTerms ? (
          <section className="pv-sec rv">
            <details className="pv-terms">
              <summary>Terms &amp; conditions</summary>
              <div className="pv-terms-body">{orgTerms}</div>
            </details>
          </section>
        ) : null}

        {/* ВОПРОСЫ */}
        {/* (RU: "Questions") — the donor's call-out is entirely about phoning
            the contractor, so it stands down when the org has no phone on
            file. Flagged in the port report. */}
        {telHref ? (
          <section className="pv-call rv">
            <div className="pv-call-t">Questions in the meantime? Just call.</div>
            <div className="pv-call-p"><a href={telHref}>{org.phone}</a></div>
          </section>
        ) : null}

        <footer className="pv-foot rv">
          <i>JF</i>{`Prepared by ${org.name} on JobFlex`}
        </footer>

      </div>

      <PortalReveal />
      {/* The donor's own <noscript> fallback, verbatim. */}
      <noscript
        dangerouslySetInnerHTML={{
          __html: "<style>.rv{opacity:1!important;transform:none!important}</style>",
        }}
      />
    </div>
    </PortalViewport>
    </>
  );
}
