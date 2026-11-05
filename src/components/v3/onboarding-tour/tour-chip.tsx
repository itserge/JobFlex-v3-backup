"use client";
// The tour's sidebar chip (2026-10-26): "First estimate · 2/6" while the tour
// is under way or paused — a press resumes it — and "Next steps · 1/3" after
// the first estimate. Mounted right under SmartHelp (owner, 2026-11-05) in the
// desk sidebar and in both handheld drawers; nothing is drawn when there is no
// tour. Its own button, not an `.sb-link` — shell-behavior.ts treats those as
// nav links — the same rule as SmartHelpRow.

import { tourDoors, useTourChip } from "./tour-store";
import styles from "./tour-chip.module.css";

export function TourChip({
  variant = "drawer",
  onPick,
}: {
  /** blueprint = the desk sidebar (folds to the count square); drawer = a handheld drawer. */
  variant?: "blueprint" | "drawer";
  onPick?: () => void;
}) {
  const chip = useTourChip();
  if (chip.kind === "none") return null;
  const first = chip.kind === "first";
  const label = first ? "First estimate" : "Next steps";
  const sub = first ? (chip.active ? "Show the step" : "Resume the tour") : `${chip.done}/${chip.total} done`;
  return (
    <div className={`${styles.wrap} ${styles[variant]}`} data-nest="">
      <button
        type="button"
        className={styles.chip}
        title={`${label} · ${chip.done}/${chip.total}`}
        onClick={() => {
          onPick?.();
          if (first) tourDoors.resume();
          else tourDoors.openNext();
        }}
      >
        <span className={styles.count} aria-hidden="true">
          {chip.done}/{chip.total}
        </span>
        <span className={styles.txt}>
          <span className={styles.name}>{label}</span>
          <span className={styles.sub}>{sub}</span>
        </span>
        <span className={styles.sr}>
          {chip.done} of {chip.total} done
        </span>
      </button>
    </div>
  );
}
