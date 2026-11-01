"use client";

// THE HOME PAGE'S TABS: Projects · Contractors · Calendar · Details are
// sections of one page; the tabs are anchors to them.
//
// Scroll-spy by section top: the underlined tab is the last section whose top
// has passed under this bar (the last one once the page bottoms out). On a
// desk Calendar and Details sit in the side column beside Projects, so their
// tops say nothing about where the reader is; there the spy follows the main
// column only, and a tap on Calendar or Details underlines that tab until the
// reader scrolls on. A tap scrolls to the section — smooth unless the reader
// asked for reduced motion — and tells a folded card to open ("hp:goto");
// while that scroll runs the tapped tab stays underlined. On a phone the row
// may scroll sideways, so the underlined tab is kept in view.

import * as React from "react";
import s from "./portal.module.css";

/** True when the side column stands beside the main one (a desk), not under it. */
function sideBeside(el: Element | null): boolean {
  const side = el?.closest("aside");
  const main = side?.parentElement?.firstElementChild;
  return !!side && !!main && main !== side && Math.abs(side.getBoundingClientRect().top - main.getBoundingClientRect().top) < 2;
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
    const read = () => {
      raf = 0;
      const hold = held.current;
      if (hold && performance.now() < hold.until) {
        hold.until = performance.now() + 250;
        setCur(hold.id);
        return;
      }
      held.current = null;
      const present = list.filter((id) => document.getElementById(id));
      const cands = present.filter((id) => !sideBeside(document.getElementById(id)));
      if (!cands.length) return;
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let pick = cands[0];
      for (const id of cands) {
        if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= line) pick = id;
      }
      const doc = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) pick = cands[cands.length - 1];
      setCur(pick);
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
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
    // A frame later, so a card that unfolds on "hp:goto" has its height when the scroll is measured.
    window.requestAnimationFrame(() => {
      const bar = navRef.current?.offsetHeight ?? 0;
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar - 12), behavior });
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
