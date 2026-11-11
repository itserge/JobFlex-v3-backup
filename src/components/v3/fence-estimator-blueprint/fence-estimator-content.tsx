"use client";

// Blueprint fence estimator ("Fence studio") — page CONTENT only. The donor's
// `.content` children, verbatim (jobflex-fence-estimator-blueprint_7.html); the
// sidebar, topbar, graph-paper field and the 42 shared sprite symbols come from
// the shared shell (components/v3/blueprint-shell), which persists across
// navigation. Dynamic regions (#tkLines, #statStrip, #runsList, #openList,
// #matList, #heights, #popGate, #popDoor and #pMenu) are left empty exactly
// like the donor and filled by the ported script on mount — same architecture,
// same timing.
//
// Returning a fragment keeps these blocks as DIRECT children of `.content`,
// which the donor's reveal cascade (`.content > *`) depends on.
//
// The local <Sprite /> adds only the two symbols the shell does not carry
// (i-door-open / i-door-closed). It renders last and is a 0×0
// `position: absolute` <svg>, so it takes no space in the `.content` flex
// column and contributes no `gap`.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useBlueprintContent } from "@/components/v3/blueprint-shell/use-blueprint-content";
import { initFenceEstimatorContent } from "./fence-estimator-behavior";
import type { WebFenceSeed } from "@/lib/webHandoff";
import { Sprite } from "./sprite";

export function FenceEstimatorContent({ initialAddress, webFence: webFenceProp = null }: { initialAddress?: string; webFence?: WebFenceSeed | null } = {}) {
  // The fence as it was at mount: the seed strip spends the seed a moment later and the page re-renders without it —
  // a changed prop would tear the studio down and rebuild it empty.
  const [webFence] = useState(() => webFenceProp);
  // "Convert to proposal" creates a real proposal and has to land on it. A
  // behavior module is plain DOM with no React tree, so the only client-side
  // router on this page is the one THIS component can hold — it is handed down
  // as a callback, the same direction every other island prop travels.
  //
  // Through a ref, NOT the callback's deps: `useBlueprintContent` re-runs
  // whenever `init` changes identity, and a re-run tears the page down and
  // replays the whole reveal cascade. The ref is kept current so the behavior
  // module can never navigate with a stale router, while `init` stays
  // referentially stable for the life of the mount. (Same latest-ref pattern
  // FenceDrawMap uses for its own callback props.)
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  const init = useCallback(
    (content: HTMLElement) =>
      initFenceEstimatorContent(content, {
        navigate: (href) => routerRef.current.push(href as Route),
        initialAddress,
        initialFence: webFence,
      }),
    [initialAddress, webFence],
  );
  useBlueprintContent(init);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Automation · Estimating</div>
          <h1 className="page-title">Fence studio</h1>
        </div>
      </div>

      {/* TOP BAR */}
      <div className="fs-bar">
        <label className="fs-search" data-tour="fence-address">
          <svg className="ic">
            <use href="#i-pin" />
          </svg>
          <input type="text" id="addrInput" placeholder="Search an address…" autoComplete="off" />
          <button className="fs-find" type="button" id="findBtn">
            <svg className="ic">
              <use href="#i-search" />
            </svg>
            Find
          </button>
        </label>
        <div className="fs-bar-r">
          {/* The property lines load themselves the moment an address resolves —
              there is nothing left to ask for. This button is the NEXT step:
              lay fence along the checked sides of the lot. It ADDS to whatever
              is already traced; nothing drawn by hand is replaced. */}
          {/* Two faces, swapped by `.is-done` (set once the fence is laid, cleared
              on reset / a new property): the button then RESTS on the done face
              and shows the offer again only under the pointer. */}
          <button className="btn btn-ghost btn--sm" type="button" id="fenceBtn" data-tour="fence-lay" disabled>
            <span className="fb-idle">
              <svg className="ic">
                <use href="#i-pen" />
              </svg>
              {/* On a phone the three top buttons share one row: the short
                  word is what is drawn, the full sentence is still what is read
                  out (`.lbl-full` is clipped there, not removed). */}
              <span className="lbl-full">Put down the fence</span>
              <span className="lbl-short" aria-hidden="true">Fence</span>
            </span>
            <span className="fb-done" aria-hidden="true">
              <svg className="ic">
                <use href="#i-check" />
              </svg>
              <span className="lbl-full">Fence down</span>
              <span className="lbl-short" aria-hidden="true">Laid</span>
            </span>
          </button>
          <div className="vsw" id="modeSwitch">
            <button className="vsw-btn active" type="button" data-mode="draw">
              <svg className="ic">
                <use href="#i-pen" />
              </svg>
              Draw
            </button>
            <button className="vsw-btn" type="button" data-mode="3d">
              <svg className="ic">
                <use href="#i-box" />
              </svg>
              3D
            </button>
          </div>
          <button className="btn btn-ghost btn--sm" type="button" id="resetBtn">
            <svg className="ic">
              <use href="#i-undo" />
            </svg>
            Reset
          </button>
        </div>
      </div>

      <div className="fs-grid">
        {/* CANVAS: map (Google Maps slot) / 3D */}
        <div className="fs-main">
        <div className="card fs-stage">
          <div className="stage-tools">
            <div className="tool-group">
              {/* Align (dragging a detected outline onto the roof) left with the
                  detected outlines: the house is drawn by hand (2026-09-24). */}
              <button className="tool" type="button" data-act="close-loop">
                <svg className="ic">
                  <use href="#i-undo" />
                </svg>
                Close loop
              </button>
              <button className="tool" type="button" data-act="undo">
                <svg className="ic">
                  <use href="#i-undo" />
                </svg>
                Undo
              </button>
              <button className="tool" type="button" data-act="clear">
                <svg className="ic">
                  <use href="#i-trash" />
                </svg>
                Clear
              </button>
              {/* ReportAll raster boundary layer — every neighbouring lot's
                  line-work. Off by default: the tile quota is ALLTIME, so the
                  layer is spent deliberately, not on page load. */}
              <button className="tool" type="button" data-act="lot-lines" aria-pressed="false">
                <svg className="ic">
                  <use href="#i-grid" />
                </svg>
                Lot lines
              </button>
              {/* Contours on the land (USGS lidar where it exists) — ON by
                  default: the ground is part of the site, not an extra. */}
              {/* House — the house LAYER: outline, hatch and area label on the
                  map, and the walls a fence dot snaps to. The behavior turns
                  it on when the site has an outline. Tracing and moving an
                  outline live inside the layer (Buildings panel, click on
                  the outline). */}
              <button className="tool" type="button" data-act="house" aria-pressed="false">
                <svg className="ic">
                  <use href="#i-roof" />
                </svg>
                House
              </button>
              <button className="tool on" type="button" data-act="topo" aria-pressed="true">
                <svg className="ic">
                  <use href="#i-topo" />
                </svg>
                Topo
              </button>
            </div>
            <div className="tool-group">
              <div className="tool-menu">
                <button className="tool" type="button" data-menu="gate">
                  <svg className="ic">
                    <use href="#i-door-open" />
                  </svg>
                  Gate
                  <svg className="ic caret">
                    <use href="#i-chev" />
                  </svg>
                </button>
                <div className="tool-pop" id="popGate"></div>
              </div>
              <div className="tool-menu">
                <button className="tool" type="button" data-menu="door">
                  <svg className="ic">
                    <use href="#i-door-closed" />
                  </svg>
                  Door
                  <svg className="ic caret">
                    <use href="#i-chev" />
                  </svg>
                </button>
                <div className="tool-pop" id="popDoor"></div>
              </div>
            </div>
          </div>

          {/* STAGE. The map slot opens on a PROMPT, not on a map: the surface
              used to mount straight away on a default lot in Texas, so the page
              greeted every visitor with somebody else's house. The behavior
              module mounts the live surface only once an address resolves, and
              swaps this copy for the "no browser key" failure when there is no
              key to mount with. */}
          <div className="stage-canvas" id="stageCanvas" data-tour="fence-map">
            <div className="map-slot" id="mapSlot">
              {/* TOPO LEGEND. Filled by the behavior module once the lot's
                  elevation lattice lands: contour interval, fall across the
                  lot, the direction it falls, a grade figure and the data
                  source. Lives inside the map slot so the 3D view hides it. */}
              <div className="topo-legend is-hidden" id="topoLegend" aria-live="polite"></div>
              <div className="map-slot-in">
                <svg className="ic">
                  <use href="#i-pin" />
                </svg>
                <div className="ms-t">Enter the address</div>
                <div className="ms-h">Search the property above. The satellite view opens on that
                  lot and its property lines load with it — until then there is no site to trace.</div>
              </div>
            </div>
            <div className="model-slot is-hidden" id="stage3d">
              <div className="map-slot-in">
                <svg className="ic">
                  <use href="#i-box" />
                </svg>
                <div className="ms-t">Nothing traced yet</div>
                <div className="ms-h">The 3D preview is built from the traced run. Draw the fence on
                  the map and it renders here.</div>
              </div>
              {/* The scene draws the ground flat; measured slope is priced but
                  not rendered, and this keeps that from being a silent lie. */}
              <div className="model-note is-hidden" id="modelNote">Terrain not shown — ground rendered flat</div>
            </div>
            <div className="stage-zoom">
              {/* Full screen: the stage takes the whole screen while tracing —
                  the browser's own full screen where it allows it, a fixed
                  overlay elsewhere (iOS). The same button, or Escape, leaves. */}
              <button className="zoom-btn zoom-btn--full" type="button" id="fullBtn" aria-pressed="false" aria-label="Full screen" title="Full screen map — Esc to leave">
                <svg className="ic"><use href="#i-expand" /></svg>
              </button>
              <button className="zoom-btn" type="button" data-zoom="1" data-flash-icon="" aria-label="Zoom in">+</button>
              <button className="zoom-btn" type="button" data-zoom="-1" data-flash-icon="" aria-label="Zoom out">−</button>
            </div>
          </div>

          {/* Finish / Undo while tracing — the only way to end a run or an
              outline on a phone, where there is no right-click or Enter. A
              strip UNDER the map, never over it: on a phone-sized map an
              overlay sat exactly where the corners being tapped were. */}
          <div className="draw-ctl is-hidden" id="drawCtl"></div>
          <div className="stage-hint">Click to trace — dots snap to corners, lot lines and house walls · double-click, Enter or
            right-click to finish · Backspace removes the last dot · click open ground to start a separate fence</div>

          {/* GROUND PROFILE. Filled by the behavior module once the Elevation
              profile of the traced line lands: a sparkline of the measured
              ground, coloured by slope class (blue level / amber racked / red
              stepped). Hidden while there is nothing measured, or under a foot
              of relief — a flat line saying "flat" is noise. */}

          {/* PARCEL SIDES. Filled by the behavior module when /api/parcels
              returns the property for the searched address: one checkbox row per
              boundary side, hover highlights that side on the map, and "Put down
              the fence" (top bar) lays fence along the CHECKED sides. Hidden
              until a parcel exists — an empty panel would advertise a lookup
              that has not happened.

              A property recorded as MORE THAN ONE LOT (two deeds bought
              together) lists every lot's sides here, under its own heading —
              there is no "which one" to pick, because the fence goes round the
              land, not round a deed. */}
          {/* BUILDINGS. The houses traced with the House tool: size, stories
              (their height in 3D) and remove, plus "Use detected outline" when
              the footprint lookup found the house. Hidden until the tool is
              opened or a house exists. */}
          <div className="house-panel is-hidden" id="housePanel">
            <div className="parcel-head">
              <div>
                <div className="kpi-lbl">Buildings</div>
                <div className="parcel-meta" id="houseMounts"></div>
              </div>
              <div className="house-tools" id="houseTools"></div>
            </div>
            <ul className="house-list" id="houseList"></ul>
          </div>

          <div className="parcel-panel is-hidden" id="parcelPanel">
            <div className="parcel-head">
              <div>
                <div className="kpi-lbl">Property sides</div>
                <div className="parcel-meta" id="parcelMeta"></div>
              </div>
              <div className="parcel-sum" id="parcelSum">0 ft checked</div>
            </div>
            <ul className="parcel-sides" id="parcelSides"></ul>
          </div>
        </div>

          {/* SETTINGS — under the lot's sides, columns of cards (3 across at 1440, 2 at
              1280, 1 on a phone). They used to hang under the type list in the
              rail, which ran several screens down beside an empty centre. Posts, the
              tallest card, comes last: in this order the columns come out even at 2
              and at 3 across (every order measured at 1280/1440/1920, 2026-10-18). */}
          <div className="fs-settings" id="fsSettings">
            <div className="card fs-card fs-set fs-set--height" data-tour="fence-height">
              <div className="ledger-head">Height</div>
              <div className="seg" id="heights"></div>
            </div>
            <div className="card fs-card fs-set">
              <div className="ledger-head">Site</div>
              <div className="site-row">
                <div>
                  <div className="tg-t">Remove existing fence</div>
                  <div className="tg-h">
                    Tear-out and haul-away, at{" "}
                    <span className="site-rate"><span className="mat-cur">$</span><input className="mat-new-in" id="removalRate" type="number" min="0" step="0.5" inputMode="decimal" aria-label="Tear-out rate, dollars per linear foot" defaultValue="6" /></span>
                    {" "}per linear foot.
                  </div>
                </div>
                <button className="tgl" type="button" id="demoTgl" aria-label="Remove existing fence"></button>
              </div>
              <div className="site-row is-hidden" id="stainRow">
                <div>
                  <div className="tg-t">Stain &amp; seal after install</div>
                  <div className="tg-h">Two coats, both faces — wood fences only.</div>
                </div>
                <button className="tgl" type="button" id="stainTgl" aria-label="Stain and seal after install"></button>
              </div>
              <div className="site-row" id="clearRow">
                <div>
                  <div className="tg-t">Clear the fence line</div>
                  <div className="tg-h">A 2-ft path — brush, debris, small plants — cleared by the crew, $3 per foot. Off: the owner clears it first.</div>
                </div>
                <button className="tgl" type="button" id="clearTgl" aria-label="Clear the fence line"></button>
              </div>
              <div className="site-row" id="haulRow">
                <div>
                  <div className="tg-t">Haul away excavated soil</div>
                  <div className="tg-h">The spoil from every post hole loaded and hauled off. Off: spread along the line.</div>
                </div>
                <button className="tgl" type="button" id="haulTgl" aria-label="Haul away excavated soil"></button>
              </div>
            </div>
            <div className="card fs-card fs-set is-hidden" id="woodCard">
              <div className="ledger-head">Boards &amp; fasteners</div>
              <div className="site-row site-row--stack" id="gradeRow">
                <div>
                  <div className="tg-t">Cedar grade</div>
                  <div className="tg-h">#2 &amp; better is the standard tight-knot board; #1 has tighter, smaller knots; clear has none.</div>
                </div>
                <div className="site-seg" role="group" aria-label="Cedar grade"></div>
              </div>
              <div className="site-row site-row--stack" id="fastenRow">
                <div>
                  <div className="tg-t">Fasteners</div>
                  <div className="tg-h">Hot-dip galvanized ring-shank is standard; stainless leaves no rust streaks down the cedar.</div>
                </div>
                <div className="site-seg" role="group" aria-label="Fasteners"></div>
              </div>
            </div>
            <div className="card fs-card fs-set">
              <div className="ledger-head">Ground</div>
              <div className="site-row site-row--stack" id="groundRow">
                <div>
                  <div className="tg-t">Ground</div>
                  <div className="tg-h"></div>
                </div>
                <div className="site-seg" role="group" aria-label="Ground difficulty"></div>
              </div>
            </div>
            <div className="card fs-card fs-set">
              <div className="ledger-head">Posts</div>
              <div className="site-row site-row--stack is-hidden" id="upgradeRow">
                <div>
                  <div className="tg-t">Post system</div>
                  <div className="tg-h">Standard 4×4 pressure-treated carries the 4-year workmanship warranty; steel and post-on-pipe systems add 10-year to lifetime structural.</div>
                </div>
                <div className="site-seg" role="group" aria-label="Post system"></div>
              </div>
              <div className="site-row is-hidden" id="gatePostsRow">
                <div>
                  <div className="tg-t">Steel gate posts</div>
                  <div className="tg-h">Gates hang on 4×4 black steel even on a wood-post fence — a wood gate post sags. Off: the gate warranty is 6 months.</div>
                </div>
                <button className="tgl" type="button" id="gatePostsTgl" aria-label="Steel gate posts"></button>
              </div>
              <div className="site-row site-row--stack" id="gateHwRow">
                <div>
                  <div className="tg-t">Gate hardware</div>
                  <div className="tg-h">Heavy-duty: ball-bearing hinges, a heavy latch, a cane bolt on a double gate.</div>
                </div>
                <div className="site-seg" role="group" aria-label="Gate hardware"></div>
              </div>
              <div className="site-row site-row--stack" id="spacingRow">
                <div>
                  <div className="tg-t">Post spacing</div>
                  <div className="tg-h"></div>
                </div>
                <div className="site-seg" role="group" aria-label="Post spacing"></div>
              </div>
            </div>
          </div>
          <div className="fs-ledgers">
            <div className="card fs-card">
              <div className="stat-strip" id="statStrip"></div>
              <div className="ledger-head">Runs</div>
              <ul className="runs" id="runsList" data-tour="fence-runs"></ul>
              {/* Same empty-state idiom as #openEmpty below. The page opens with
                  NO runs: every foot in the ledger is either traced on the map or
                  typed by the user, so nothing on the ticket is invented. */}
              <div className="open-empty" id="runsEmpty">Enter the address above and trace the fence on the map, or add a run and type its length.</div>
              <div className="runs-add">
                <button className="btn btn-ghost btn--sm" type="button" data-act="add-run">
                  <svg className="ic">
                    <use href="#i-plus" />
                  </svg>
                  Add run
                </button>
              </div>
              <div className="ledger-head">Gates &amp; doors</div>
              <ul className="openings" id="openList"></ul>
              <div className="open-empty is-hidden" id="openEmpty">No openings yet — add a gate or door above.</div>
            </div>
              {/* MATERIAL TAKEOFF — the bill of materials the same engine prices:
                posts by kind, rails / pickets / panels / mesh, concrete from the
                holes actually dug, hardware, gate kits, stain, tear-out. Hidden
                until there is fence to take off. */}
            <div className="card fs-card takeoff is-hidden" id="takeoffCard">
              <div className="ledger-head takeoff-head">
                <span>Material takeoff</span>
                <span className="takeoff-meta" id="takeoffMeta"></span>
              </div>
              <ul className="bom" id="bomList"></ul>
              <div className="takeoff-foot" id="takeoffFoot"></div>
            </div>
            </div>
        </div>

        {/* RIGHT RAIL */}
        <aside className="fs-rail">
          <div className="card tk" data-tour="fence-price">
            <div className="tk-body">
              <div className="kpi-lbl">Estimated total</div>
              <div className="tk-total" id="tkTotal" data-tour="fence-total">—</div>
              <div className="tk-sub" id="tkSub">—</div>
              {/* Before tax, and what the proposal adds — the convert writes the job state's sales tax on top
                  (lib/fence/proposalWrite), so the number here and the proposal's grand total differ by it. */}
              <div className="tk-sub tk-tax is-hidden" id="tkTax"></div>
              {/* Good / Better / Best for the picked type — three totals from
                  the same engine; tapping one picks that fence. Hidden until
                  there is fence to price. */}
              <div className="tk-tiers is-hidden" id="tkTiers" role="group" aria-label="Price options"></div>
              <ul className="tk-lines" id="tkLines"></ul>
              {/* The contractor's notes: what the package assumed and what to
                  check before the quote goes out (lib/fence/pricing fenceChecks). */}
              <ul className="tk-notes is-hidden" id="tkNotes" aria-label="Notes"></ul>
              <button className="btn btn-primary" id="convertBtn" data-tour="fence-convert">
                <svg className="ic">
                  <use href="#i-file" />
                </svg>
                Convert to proposal
              </button>
            </div>
          </div>



          <div className="card fs-card fs-types" data-tour="fence-type">
            {/* The catalog's rates are a starting point, not a quote: a
                contractor who charges $26 for cedar says so BY EDITING CEDAR —
                click the figure on the row and type the material, labor and
                walk-gate rates. Types of your own are added here too, built
                like one of the catalog's so the takeoff still counts. */}
            <div className="ledger-head ledger-head--acts">
              <span>Fence type</span>
              <div className="mats-add mats-add--head">
                {/* Types of your own and the company's defaults are managed on
                    the Inventory page since 2026-09-29; a rate typed here still
                    prices THIS estimate. */}
                <a className="btn btn-ghost btn--sm" href="/dashboard/fence-estimator/inventory#book" id="matBook" title="Add types of your own and set the company's default rates in the Fence inventory">
                  <svg className="ic">
                    <use href="#i-check" />
                  </svg>
                  Price book
                </a>
              </div>
              </div>
            <ul className="mats" id="matList"></ul>
          </div>
        </aside>
      </div>
      <div className="pmenu" id="pMenu"></div>

      <Sprite />
    </>
  );
}
