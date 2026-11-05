"use client";
// THE ASSISTANT · THE SIDEBAR ROW (2026-11-04). Right under SmartHelp in every
// nav. SmartHelp stays the one filled row (DESIGN.md): this one is white in an
// ink frame — a blue square holding Lucide AudioLines in white, ink "Assistant",
// a square "NEW" tag framed in blue. Flat, square, no shadow at rest.
//   desk / blueprint → opens the desk panel; the folded rail draws the square alone.
//   drawer / more    → goes to the handheld page (the host closes itself first).
// Hidden for the field crew — the Assistant is the office's (lib/assistant/roles).

import Link from "next/link";
import type { Route } from "next";
import { AudioLines } from "lucide-react";
import { useNavRole } from "@/components/v3/blueprint-shell/nav-role";
import { MOBILE_HREF, openAssistant } from "./events";
import styles from "./assistant-row.module.css";

type Variant = "desk" | "blueprint" | "drawer" | "more";

export function AssistantRow({ variant, onBeforeOpen, role }: { variant: Variant; onBeforeOpen?: () => void; role?: string | null }) {
  const navRole = useNavRole();
  if ((role ?? navRole) === "INSTALLER") return null;
  const inner = (
    <>
      <span className={styles.mark} aria-hidden="true">
        <AudioLines />
      </span>
      <span className={styles.name}>Assistant</span>
      <span className={styles.tag} aria-hidden="true">
        NEW
      </span>
    </>
  );
  const label = "Assistant — ask or tell JobFlex what to do";
  return (
    <div className={`${styles.wrap} ${styles[variant]}`} data-nest="">
      {variant === "drawer" || variant === "more" ? (
        <Link className={styles.row} href={MOBILE_HREF as Route} aria-label={label} onClick={() => onBeforeOpen?.()}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={styles.row} aria-label={label} title="Assistant" onClick={(e) => openAssistant(e.currentTarget)}>
          {inner}
        </button>
      )}
    </div>
  );
}
