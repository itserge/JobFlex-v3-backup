"use client";
// "UPGRADE YOUR PLAN" — THE MENU'S LAST ROW ON THE NEW PLANS (Base + Tools, part 3a — owner, 2026-11-10: "no locks";
// the menu shows only what the shop can open, and an Upgrade your plan button at the bottom of it). A small accent
// card at the foot of the desk sidebar's list and of the handheld drawer, for the owner of a shop on the new plans
// only (nav-map showsUpgradePlan: the blocked list carries TOOLS_MARK). It goes to the Subscription page, where every
// tool, person and bigger plan the shop can add is listed. A Classic shop never draws it.
//
// Its own link, not an `.sb-link` — shell-behavior.ts treats those as nav rows (the sliding plate, the drawer's
// close) — the same rule as SmartHelpRow and TourChip. The folded desk rail draws the accent square alone.

import Link from "next/link";
import type { Route } from "next";
import { Plus } from "lucide-react";
import { UPGRADE_PLAN_HREF, showsUpgradePlan } from "./nav-map";
import { useNavLocked, useNavRole } from "./nav-role";
import styles from "./upgrade-plan-card.module.css";

export function UpgradePlanCard({ variant, onPick }: { variant: "blueprint" | "drawer"; onPick?: () => void }) {
  const role = useNavRole();
  const locked = useNavLocked();
  if (!showsUpgradePlan(role, locked)) return null;
  return (
    <div className={`${styles.wrap} ${styles[variant]}`} data-nest="" data-upgrade-plan="">
      <div className={styles.card}>
        <span className={styles.title}>Upgrade your plan</span>
        <span className={styles.line}>Add tools, people or a bigger plan.</span>
        <Link className={styles.go} href={UPGRADE_PLAN_HREF as Route} title="Upgrade your plan" onClick={() => onPick?.()}>
          <span className={styles.mark} aria-hidden="true">
            <Plus />
          </span>
          <span className={styles.goTxt}>See what you can add</span>
        </Link>
      </div>
    </div>
  );
}
