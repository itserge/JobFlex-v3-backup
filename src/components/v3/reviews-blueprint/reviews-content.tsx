"use client";

// Blueprint reviews — page CONTENT only. The donor's `.content` children,
// verbatim (jobflex-reviews-blueprint_3.html); the sidebar, topbar and the
// 42-symbol sprite come from the shared shell (components/v3/blueprint-shell),
// which persists across navigation. Dynamic regions (#statGrid, #rvFilters,
// #rvList, #spread, #pendList, #pendCount and #pMenu) are left empty exactly
// like the donor and filled by the ported script on mount — same architecture,
// same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// NOT a fixture page any more: the rows are the org's real `ReviewRequest`
// records, read in ../../../app/dashboard/reviews/page.tsx, and the request
// dialog calls the real `createReviewRequest` server action. The dialog is the
// one structural addition to the donor — it is a position:fixed overlay, so
// putting it at the end of the fragment changes no layout, and the behavior
// module excludes `.mdl` from the reveal cascade so the donor's block set and
// its i*60ms stagger indices stay exactly as authored.

import { useCallback, useRef } from "react";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initReviewsContent } from "./reviews-behavior";
import type { EligibleJob, ReviewEntry } from "./reviews-data";
import { ReviewsSprite } from "./sprite";

export function ReviewsContent({
  entries,
  jobs,
  publicHref,
  publicRating,
}: {
  /** The org's real review requests, read in the page's server component. */
  entries: ReviewEntry[];
  /** Jobs with no review request yet — the request dialog's option list. */
  jobs: EligibleJob[];
  /** /r/<slug> — the public reviews page clients see from the portal badge. */
  publicHref?: string;
  /** What that page shows right now (hidden reviews excluded). */
  publicRating?: { avg: string | null; count: number };
}) {
  // The seed reaches `init` through a ref, NOT through the callback's deps.
  // `useBlueprintContent` re-runs whenever `init` changes identity, and a re-run
  // tears the page down and replays the whole reveal cascade — so the init has
  // to stay referentially stable for the life of the mount. The ref is never
  // written after creation: from the first commit the behavior module owns the
  // list and keeps itself in step with the database through the server action.
  const seedRef = useRef({ entries, jobs });

  const init = useCallback(
    (content: HTMLElement) =>
      initReviewsContent(content, {
        entries: seedRef.current.entries,
        jobs: seedRef.current.jobs,
      }),
    [],
  );
  useBlueprintContent(init);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Reputation</div>
          <h1 className="page-title">Reviews</h1>
        </div>
        <div className="page-actions">
          {publicHref ? (
            <a
              className="btn btn-ghost"
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              title={
                publicRating && publicRating.count
                  ? `${publicRating.avg} from ${publicRating.count} public review${publicRating.count === 1 ? "" : "s"}`
                  : "Nothing public yet — reviews appear here once a client submits one"
              }
            >
              <svg className="ic">
                <use href="#i-link" />
              </svg>
              Public page
              {publicRating && publicRating.count ? (
                <span className="rv-pub-n">{`${publicRating.avg} · ${publicRating.count}`}</span>
              ) : null}
            </a>
          ) : null}
          <button className="btn btn-primary" type="button" id="rvReqBtn" data-tour="reviews:request">
            <svg className="ic">
              <use href="#i-plus" />
            </svg>
            Request review
          </button>
        </div>
      </div>

      <div className="stat-grid" id="statGrid"></div>

      <div className="rv-grid">
        {/* review feed */}
        <div className="card rv-card">
          <div className="rv-head">
            <div>
              <div className="card-title">Recent reviews</div>
              <div className="card-sub">Completed submissions come through here</div>
            </div>
            <div className="rv-filters" id="rvFilters"></div>
          </div>
          <ul className="rv-list" id="rvList"></ul>
          <div className="rv-empty is-hidden" id="rvEmpty">
            <svg className="ic">
              <use href="#i-thumb" />
            </svg>
            <b>No reviews yet</b>
            <span>Mark a job as completed and the client gets a review link. Their submission appears here.</span>
          </div>
        </div>

        {/* score spread + awaiting */}
        <aside className="rv-side">
          <div className="card rv-card">
            <div className="rv-head"><div className="card-title">Score spread</div></div>
            <div className="spread" id="spread"></div>
          </div>

          <div className="card rv-card">
            <div className="rv-head">
              <div className="card-title">Awaiting response</div>
              <span className="pstatus rv-count" id="pendCount">0</span>
            </div>
            <ul className="pend" id="pendList"></ul>
            <div className="pend-empty is-hidden" id="pendEmpty">Every request has been answered.</div>
          </div>
        </aside>
      </div>
      <div className="pmenu" id="pMenu"></div>

      {/* REQUEST DIALOG — the manual send. `createReviewRequest` creates the
          request row and emails the client their /review/<token> link; the job
          list is the set that has no request yet, so the action's idempotency
          guard can never silently swallow a send made from here. */}
      <div className="mdl" id="rvReqMdl">
        <div className="mdl-bg" data-mdl="req"></div>
        <div className="mdl-box">
          <div className="mdl-head mdl-head--row">
            <span>Request a review</span>
            <button className="mdl-x" type="button" data-mdl="req" aria-label="Close dialog">
              <svg className="ic">
                <use href="#i-x" />
              </svg>
            </button>
          </div>
          <div className="mdl-body" id="rvReqBody"></div>
          {/* The action refuses past the plan's monthly review-request cap —
              the reason lands here rather than the dialog closing on a write
              that never happened. */}
          <div className="mf-err mf-err--boxed is-hidden" id="rvReqErr" role="alert"></div>
          <div className="mdl-foot">
            <button className="btn btn-ghost btn--sm" type="button" data-mdl="req">Cancel</button>
            <button className="btn btn-primary btn--sm" type="button" id="rvReqOk">
              <svg className="ic">
                <use href="#i-send" />
              </svg>
              <span data-save-lbl>Send request</span>
            </button>
          </div>
        </div>
      </div>

      <ReviewsSprite />
    </>
  );
}
