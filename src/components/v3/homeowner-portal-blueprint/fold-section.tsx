"use client";

// A HOME-PAGE SECTION THAT FOLDS ON A PHONE (2026-10-31): Details (your
// details, your link, documents) sits closed under its header on a phone so
// the page ends near two screens; a tap on the header opens it. It opens on
// its own when the address names it (#details, the old /details link) or a
// tab sends the reader there (AnchorTabs' "hp:goto"). On a desk it is
// always open and the header is plain — the button only shows ≤768px.

import * as React from "react";
import s from "./portal.module.css";

export function FoldSection({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const byHash = () => {
      if (window.location.hash !== `#${id}`) return;
      setOpen(true);
      // The browser scrolled to the closed section; once open, bring its head under the tabs again.
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
  }, [id]);

  return (
    <section ref={ref} id={id} className={s.section} aria-labelledby={`${id}-title`} data-fold={open ? "open" : "closed"}>
      <div className={s.secHead}>
        <h2 id={`${id}-title`} className={s.secTitle}>{title}</h2>
        <p className={s.kicker}>{kicker}</p>
        <button type="button" className={s.foldBtn} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show"}
          <span className={s.srOnly}> {title}</span>
        </button>
      </div>
      <div id={`${id}-body`} className={s.secBody}>{children}</div>
    </section>
  );
}
