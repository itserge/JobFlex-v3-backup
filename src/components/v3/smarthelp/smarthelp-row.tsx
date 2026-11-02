"use client";
// SMARTHELP · THE SIDEBAR ROW (owner, 2026-10-29: "a different color … in the sidebar"; look "a" of three mockups).
// The one filled row in the sidebar: an ink block — a white square holding Sparkles in ink, white bold "SmartHelp", a
// square "ASK" tag in a 1.5px white frame — on a hard 3px accent shadow. Flat and square: DESIGN.md keeps amber for
// warnings and has no gradients or pills. First row of every nav: the classic desk sidebar, the blueprint sidebar
// (not `.sb-link` — shell-behavior.ts treats those as nav links), both handheld drawers and the tab bar's More sheet.
//   desk / blueprint → opens SmartHelp; the folded blueprint rail draws the square alone.
//   drawer / more    → the host closes itself first (onBeforeOpen), and SmartHelp opens on the next frame, as Help does
//                      from More: opened in the same tick it would come up under a drawer still sliding out.

import { Sparkles } from "lucide-react";
import { openSmartHelp } from "./events";
import styles from "./smarthelp-row.module.css";

type Variant = "desk" | "blueprint" | "drawer" | "more";

export function SmartHelpRow({
  variant,
  onBeforeOpen,
  opener,
}: {
  variant: Variant;
  /** The host's own close (a drawer, the More sheet), run before SmartHelp opens. */
  onBeforeOpen?: () => void;
  /** Where focus goes back when SmartHelp closes, when this row is about to unmount (More: its tab). */
  opener?: () => HTMLElement | null;
}) {
  return (
    <div className={`${styles.wrap} ${styles[variant]}`} data-nest="">
      <button
        type="button"
        className={styles.row}
        data-tour="smarthelp"
        aria-label="SmartHelp — ask how anything in JobFlex works"
        title="SmartHelp"
        onClick={(e) => {
          if (!onBeforeOpen) return openSmartHelp(e.currentTarget);
          const back = opener?.() ?? null;
          onBeforeOpen();
          requestAnimationFrame(() => openSmartHelp(back));
        }}
      >
        <span className={styles.mark} aria-hidden="true">
          <Sparkles />
        </span>
        <span className={styles.name}>SmartHelp</span>
        <span className={styles.ask} aria-hidden="true">
          ASK
        </span>
      </button>
    </div>
  );
}
