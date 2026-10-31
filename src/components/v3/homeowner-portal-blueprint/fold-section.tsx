"use client";

// A SIDE CARD OF THE HOME PAGE (2026-10-31): Calendar and Details are one
// card each — the card's title row is the section's head, so the tabs' anchors
// (#calendar, #details) land on it. With `fold`, the card sits closed under
// its title on a phone so the page stays short; a tap on Show opens it. It
// opens on its own when the address names it (#details, the old /details
// link) or a tab sends the reader there (AnchorTabs' "hp:goto"). On a desk it
// is always open and the Show/Hide button is hidden.

import * as React from "react";
import s from "./portal.module.css";

export function SideCard({ id, title, action, fold = false, children }: { id: string; title: string; action?: React.ReactNode; fold?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(!fold);
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!fold) return;
    const byHash = () => {
      if (window.location.hash !== `#${id}`) return;
      setOpen(true);
      // The browser scrolled to the closed card; once open, bring its head under the tabs again.
      window.requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
    };
    const byTab = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) setOpen(true);
    };
    byHash();
    window.addEventListener("hashchange", byHash);
    window.addEventListener("hp:goto", byTab);
    return () => {
      window.removeEventListener("hashchange", byHash);
      window.removeEventListener("hp:goto", byTab);
    };
  }, [id, fold]);

  return (
    <section ref={ref} id={id} className={`${s.card} ${s.sideCard}`} aria-labelledby={`${id}-title`} data-fold={fold ? (open ? "open" : "closed") : undefined}>
      <div className={s.cardHead}>
        <h2 id={`${id}-title`} className={s.h2}>{title}</h2>
        {action}
        {fold && (
          <button type="button" className={s.foldBtn} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"}
            <span className={s.srOnly}> {title}</span>
          </button>
        )}
      </div>
      <div id={`${id}-body`} className={s.sideBody}>{children}</div>
    </section>
  );
}
