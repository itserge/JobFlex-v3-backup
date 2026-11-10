// "THIS LINK IS PAUSED" (owner, 2026-11-09) — what a public link shows while the company that sent it is on the Free
// plan (lib/publicLinks). Nothing of the company's: no name, no project, no lines — only that the link is paused.
// The portal pages have no shell above them, so the look is its own self-scoped stylesheet (link-paused.css).
import { LINK_PAUSED_TEXT, LINK_PAUSED_TITLE } from "@/lib/publicLinks";
import "./link-paused.css";

export function LinkPaused() {
  return (
    <main className="jf-linkpause" data-link-paused="">
      <section className="jf-linkpause-card" role="status">
        <svg className="jf-linkpause-ic" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="5" width="4" height="14" rx="1" />
          <rect x="14" y="5" width="4" height="14" rx="1" />
        </svg>
        <h1 className="jf-linkpause-h">{LINK_PAUSED_TITLE}</h1>
        <p className="jf-linkpause-p">{LINK_PAUSED_TEXT}</p>
      </section>
    </main>
  );
}
