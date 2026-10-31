"use client";

// THE HOME PAGE'S TABS (2026-10-31): Projects · Contractors · Calendar ·
// Details are sections of one page; the tabs are anchors to them.
//
// Scroll-spy by section top: the underlined tab is the last section whose top
// has passed under this bar (the last one once the page bottoms out). On a
// desk Calendar and Details live in a sticky side column that scrolls on its
// own ([data-side]); there the spy reads the column's own scroll, so the
// window decides between Projects and Contractors and the column between
// Calendar and Details — whichever the reader moved last. A tap scrolls the
// window (or the side column) to the section — smooth unless the reader asked
// for reduced motion — and tells a folded section to open ("hp:goto"); while
// that scroll runs the tapped tab stays underlined (a short section at the
// page's foot cannot reach the bar). On a phone the row may scroll sideways,
// so the underlined tab is kept in view.

import * as React from "react";
import s from "./portal.module.css";

function sideColumn(): HTMLElement | null {
  const side = document.querySelector<HTMLElement>("[data-side]");
  return side && getComputedStyle(side).position === "sticky" ? side : null;
}

export function AnchorTabs({ tabs }: { tabs: Array<{ id: string; label: string }> }) {
  const navRef = React.useRef<HTMLElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [cur, setCur] = React.useState(tabs[0]?.id ?? "");
  const ids = tabs.map((t) => t.id).join(" ");
  // The tab just tapped, held while the scroll it started settles.
  const held = React.useRef<{ id: string; until: number } | null>(null);

  React.useEffect(() => {
    const list = ids.split(" ");
    let raf = 0;
    let from: "window" | "side" = "window";
    const lastPassed = (cands: string[], line: number) => {
      let pick = cands[0];
      for (const id of cands) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) pick = id;
      }
      return pick;
    };
    const read = () => {
      raf = 0;
      const hold = held.current;
      if (hold && performance.now() < hold.until) {
        hold.until = performance.now() + 250;
        setCur(hold.id);
        return;
      }
      held.current = null;
      const side = sideColumn();
      const inSide = (id: string) => !!side && !!document.getElementById(id)?.closest("[data-side]");
      if (side && from === "side") {
        const cands = list.filter(inSide);
        let pick = lastPassed(cands, side.getBoundingClientRect().top + 24);
        if (side.scrollTop > 0 && side.scrollTop + side.clientHeight >= side.scrollHeight - 2) pick = cands[cands.length - 1];
        setCur(pick);
        return;
      }
      const cands = list.filter((id) => !inSide(id));
      let pick = lastPassed(cands, (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24);
      const doc = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) pick = cands[cands.length - 1];
      setCur(pick);
    };
    const onWindow = () => {
      from = "window";
      if (!raf) raf = window.requestAnimationFrame(read);
    };
    const onSide = () => {
      from = "side";
      if (!raf) raf = window.requestAnimationFrame(read);
    };
    const sideEl = document.querySelector<HTMLElement>("[data-side]");
    read();
    window.addEventListener("scroll", onWindow, { passive: true });
    window.addEventListener("resize", onWindow);
    sideEl?.addEventListener("scroll", onSide, { passive: true });
    return () => {
      window.removeEventListener("scroll", onWindow);
      window.removeEventListener("resize", onWindow);
      sideEl?.removeEventListener("scroll", onSide);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [ids]);

  // Keep the underlined tab inside the sideways row (phones).
  React.useEffect(() => {
    const row = rowRef.current;
    const a = row?.querySelector<HTMLElement>(`[data-tab="${cur}"]`);
    if (!row || !a || row.scrollWidth <= row.clientWidth) return;
    if (a.offsetLeft < row.scrollLeft || a.offsetLeft + a.offsetWidth > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, a.offsetLeft - 16), behavior: "auto" });
    }
  }, [cur]);

  function go(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.dispatchEvent(new CustomEvent("hp:goto", { detail: id }));
    held.current = { id, until: e.timeStamp + 600 };
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    // A frame later, so a section that unfolds on "hp:goto" has its height when the scroll is measured.
    window.requestAnimationFrame(() => {
      const side = sideColumn();
      if (side && el.closest("[data-side]")) {
        side.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop), behavior });
        // Past the end of the sheet the sticky column rides up with it; bring it back to its pinned place.
        const lift = parseFloat(getComputedStyle(side).top) - side.getBoundingClientRect().top;
        if (lift > 1) window.scrollBy({ top: -lift, behavior });
      } else {
        const bar = navRef.current?.offsetHeight ?? 0;
        window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar - 12), behavior });
      }
    });
    window.history.replaceState(window.history.state, "", `#${id}`);
    setCur(id);
  }

  return (
    <nav ref={navRef} className={s.tabs} aria-label="Your home">
      <div ref={rowRef} className={s.tabsIn}>
        {tabs.map((t) => (
          <a key={t.id} className={s.tab} href={`#${t.id}`} data-tab={t.id} aria-current={cur === t.id ? "location" : undefined} onClick={(e) => go(e, t.id)}>
            {t.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
