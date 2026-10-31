"use client";

// THE HOME PAGE'S TABS (2026-10-31): Projects · Contractors · Calendar ·
// Details are sections of one page; the tabs are anchors to them. Scroll-spy
// underlines the section the reader is in (the last one whose top has passed
// under the bar; the last section once the page bottoms out); a tap scrolls to
// the section — smooth unless the reader asked for reduced motion — and the
// sections' scroll-margin keeps their heads clear of this sticky bar. On a
// phone the row scrolls sideways, so the underlined tab is kept in view.

import * as React from "react";
import s from "./portal.module.css";

export function AnchorTabs({ tabs }: { tabs: Array<{ id: string; label: string }> }) {
  const navRef = React.useRef<HTMLElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [cur, setCur] = React.useState(tabs[0]?.id ?? "");
  const ids = tabs.map((t) => t.id).join(" ");

  React.useEffect(() => {
    const list = ids.split(" ");
    let raf = 0;
    const read = () => {
      raf = 0;
      const line = (navRef.current?.getBoundingClientRect().bottom ?? 0) + 24;
      let pick = list[0];
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) pick = id;
      }
      const doc = document.documentElement;
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= doc.scrollHeight - 2) pick = list[list.length - 1];
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const bar = navRef.current?.offsetHeight ?? 0;
    const top = el.getBoundingClientRect().top + window.scrollY - bar - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
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
