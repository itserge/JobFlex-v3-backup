// Blueprint shell — the donor behaviors that belong to the PERSISTENT chrome:
// FLUID SCALE, the mobile nav drawer, the sidebar entry cascade, the sliding
// active-item indicator, the graph-paper parallax, and press feedback on
// shell controls. Every duration, easing and stagger is the donor's exact
// value.
//
// These run ONCE, from the shared layout. Because the shell no longer
// unmounts on navigation, the sidebar cascade plays on first load only —
// which is the whole point: moving between blueprint pages now animates the
// content, not the furniture.
//
// Page-level motion (reveal, count-up, row stagger) lives in page-motion.ts
// and re-runs per page.

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

export type ShellHandle = {
  /** Tear down every listener/observer this module registered. */
  destroy: () => void;
  /** Re-point the sliding plate at whichever item React marked `active`. */
  syncIndicator: () => void;
};

/** READABLE (owner, 2026-10-02: "hard to read, too small — 7%", then
 *  "another 7% everywhere"): every blueprint shell multiplies its fluid
 *  scale by this; the admin console doubles it (admin-shell ADMIN_SCALE).
 *  Above 860px only — a phone-width window stays at zoom 1. */
export const READABLE_SCALE = 1.07;

export function initBlueprintShell(root: HTMLElement, opts: {
  /** Multiplies the fluid scale below; READABLE_SCALE unless a shell says otherwise. */
  scale?: number;
} = {}): ShellHandle {
  const scale = opts.scale ?? READABLE_SCALE;
  const disposers: Array<() => void> = [];
  const on = (t: EventTarget, ev: string, fn: EventListener, o?: AddEventListenerOptions) => {
    t.addEventListener(ev, fn, o);
    disposers.push(() => t.removeEventListener(ev, fn, o));
  };
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // ================= MOBILE NAV DRAWER =================
  (function () {
    const burger = $("#navBurger");
    const sb = $(".sb");
    const overlay = $("#sbOverlay");
    if (!burger || !sb || !overlay) return;
    const setNav = (open: boolean) => {
      sb.classList.toggle("open", open);
      overlay.classList.toggle("on", open);
    };
    // Through `on()`, so destroy() removes them: React's development mode
    // runs this setup twice, and a burger holding two listeners opened the
    // drawer and shut it again on the same tap.
    on(burger, "click", () => setNav(!sb.classList.contains("open")));
    on(overlay, "click", () => setNav(false));
    on(sb, "click", (e) => {
      if ((e.target as HTMLElement).closest(".sb-link")) setNav(false);
    });
  })();

  // ================= FLUID SCALE =================
  // Reference composition — MacBook 16" (1728 CSS px viewport). On any other
  // screen the whole interface scales proportionally: typography, components,
  // spacing and the sidebar keep the same ratios. Zoom is applied to the shell
  // root (not documentElement) so it cannot leak into the rest of the app.
  (function () {
    const BASE = 1728,
      MIN = 0.78,
      MAX = 1.35;
    const applyScale = () => {
      // A phone-width window is NOT scaled at all — not even by `scale`. The
      // ≤860px rules are written in true pixels, and READABLE_SCALE reaching
      // them (2026-10-02 → 10-03) put the whole phone layout under zoom 1.07 —
      // the 12px topbar edges became 12.8, the 40px buttons 42.8 — which the
      // 7% change never meant to do (owner's iPhone, 2026-10-03).
      if (window.innerWidth <= 860) {
        root.style.setProperty("zoom", "1");
        root.style.setProperty("--logo-z", "1");
        root.style.setProperty("--app-h", window.innerHeight + "px");
        return;
      }
      const raw = Math.min(MAX, Math.max(MIN, window.innerWidth / BASE));
      // Sharpness (owner, 2026-08-18): a zoom like 1.0098 (1745px window) puts
      // EVERY font on a fractional pixel size and softens all type, while the
      // ≤2% size difference from true 1:1 is imperceptible. Snap the band to 1
      // so near-reference windows rasterize text on exact pixels.
      const z = (Math.abs(raw - 1) < 0.02 ? 1 : raw) * scale;
      root.style.setProperty("zoom", String(z));
      // 100vh diverges from the real window under zoom != 1 — set it explicitly
      root.style.setProperty("--app-h", window.innerHeight / z + "px");
    };
    applyScale();
    on(window, "resize", applyScale);
    disposers.push(() => {
      root.style.removeProperty("zoom");
      root.style.removeProperty("--app-h");
    });
  })();

  // ================= SIDEBAR CASCADE + PARALLAX + PRESS =================
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Sidebar cascade — first mount only, by construction.
    $$(".sb-sec-label, .sb-link").forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateX(-8px)";
      el.style.transition =
        "opacity 320ms " + EASE + " " + i * 22 + "ms, transform 320ms " + EASE + " " + i * 22 + "ms";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          el.style.opacity = "";
          el.style.transform = "";
        }),
      );
      el.addEventListener("transitionend", () => { el.style.transition = ""; }, { once: true });
    });

    // Press feedback on shell controls
    $$(".topbar .btn, .icon-btn, .sb-foot-ic, .sb-foot-acc").forEach((el) => {
      el.addEventListener("click", () => {
        el.classList.remove("pressed");
        void el.offsetWidth;
        el.classList.add("pressed");
      });
      el.addEventListener("animationend", () => el.classList.remove("pressed"));
    });

    // Graph-paper parallax
    const mainEl = $(".main");
    if (mainEl) {
      let ticking = false;
      let scrolled = 0;
      mainEl.addEventListener(
        "scroll",
        () => {
          // Read here, where layout is already clean; the frame only writes (2026-10-18, perf: read in the
          // frame, after a page had set styles in the same frame, it forced a full layout every frame).
          scrolled = mainEl.scrollTop;
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => {
            // Write background-position itself, not a `--gy` custom property: custom properties inherit,
            // so setting one on .main restyled every node in the page on every scroll frame (2026-10-30,
            // perf: ~23ms of style recalc per frame on /dashboard/proposals, scrolling ran under 45fps).
            mainEl.style.backgroundPosition = "0 " + (-(scrolled * 0.06)).toFixed(1) + "px";
            ticking = false;
          });
        },
        { passive: true },
      );
    }
  }

  // ================= SLIDING ACTIVE INDICATOR =================
  const sbIndicator = $("#sbIndicator");
  // A SLIDE IS A CLICK OR A ROUTE CHANGE; everything else follows the row
  // (2026-10-11). Until `slideUntil` a re-measure retargets the running slide;
  // after it, a re-measure (the fold, a resize, a badge, a web font) puts the
  // plate on its row in the same frame. Re-measured with its transition on,
  // the plate restarted a 320ms slide on every frame of the fold and trailed
  // the rail by a quarter of a second, a second motion after the first.
  const SLIDE_MS = 450;
  let slideUntil = 0;
  const moveIndicator = (link: HTMLElement | null, slide = false) => {
    if (!link || !sbIndicator) return;
    if (slide) slideUntil = performance.now() + SLIDE_MS;
    const snap = performance.now() > slideUntil;
    // A folded subtree keeps the current page selected, with its parent
    // carrying the visible outline until the subpages are opened again.
    if (!link.offsetHeight) {
      link = link.closest(".sb-tree")?.querySelector<HTMLElement>(".sb-parent .sb-link") ?? null;
      if (!link) return;
    }
    // Estimator links sit inside positioned .sb-parent wrappers. Sum their
    // offsets up to the plate's container, keeping CSS coordinates so shell
    // zoom and scrolling do not change the alignment.
    const container = sbIndicator.offsetParent;
    let top = 0;
    let left = 0;
    let node: HTMLElement | null = link;
    while (node && node !== container) {
      top += node.offsetTop;
      left += node.offsetLeft;
      node = node.offsetParent as HTMLElement | null;
    }
    const width = link.offsetWidth;
    const height = link.offsetHeight;
    if (snap) sbIndicator.style.transition = "none";
    sbIndicator.style.transform = `translateY(${top}px)`;
    sbIndicator.style.left = left + "px";
    sbIndicator.style.width = width + "px";
    sbIndicator.style.height = height + "px";
    if (snap) {
      void sbIndicator.offsetWidth; // commit the jump before the transition comes back
      sbIndicator.style.transition = "";
    }
  };
  // Real routes navigate; only the donor's dead "#" links swallow the click.
  // The plate slides either way, so the animation plays on every item — on a
  // real navigation it gives instant feedback while the next page streams in,
  // and React then re-renders `active` onto the matching item.
  // On the WINDOW, so it runs after React's own click handler: the sidebar
  // commits the clicked row (and the trees it opens or closes) inside the
  // click, and the plate is measured against that layout, not the old one.
  const sbNav = sbIndicator?.parentElement ?? null;
  if (sbNav) {
    on(window, "click", (e) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLElement>(".sb-link") : null;
      if (!link || !sbNav.contains(link)) return;
      if (link.getAttribute("href") === "#") e.preventDefault();
      // A sub-page (an estimator's inventory) keeps the plate on its estimator;
      // the sub-row marks itself once React renders it (2026-10-10).
      const plateFor = link.closest(".sb-sub") ? link.closest(".sb-tree")?.querySelector<HTMLElement>(".sb-parent .sb-link") ?? link : link;
      $$(".sb-link").forEach((l) => l.classList.remove("active"));
      plateFor.classList.add("active");
      moveIndicator(plateFor, true);
    });
  }
  moveIndicator($(".sb-link.active"));
  requestAnimationFrame(() => sbIndicator && sbIndicator.classList.add("ready"));
  on(window, "load", () => moveIndicator($(".sb-link.active")));
  document.fonts?.ready.then(() => moveIndicator($(".sb-link.active")));
  /* THE PLATE FOLLOWS THE ROW. A plan change re-renders the nav in place —
     quota pills and padlocks appear or vanish, rows wrap differently — and
     the measured `top` went stale, leaving the frame a few pixels off its
     item (owner's screenshot, 2026-09-02). Re-measure on any size change in
     the nav and on any DOM change inside it. */
  if (sbNav) {
    const remeasure = () => moveIndicator($(".sb-link.active"));
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(remeasure);
      ro.observe(sbNav);
      $$(".sb-link").forEach((l) => ro.observe(l));
      disposers.push(() => ro.disconnect());
    }
    if (typeof MutationObserver !== "undefined") {
      const mo = new MutationObserver(() => requestAnimationFrame(remeasure));
      mo.observe(sbNav, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
      disposers.push(() => mo.disconnect());
    }
  }

  return {
    destroy: () => disposers.forEach((d) => d()),
    // After a route change React swaps which item carries `active`; the plate
    // follows it, and because .ready carries the transition it reads as a slide.
    syncIndicator: () => moveIndicator($(".sb-link.active"), true),
  };
}
