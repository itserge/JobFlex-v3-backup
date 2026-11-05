"use client";
// THE ASSISTANT · THE SIDEBAR ROW (2026-11-04). Right under SmartHelp in every
// nav. SmartHelp stays the one filled row (DESIGN.md): this one is white in an
// ink frame — a blue square holding Lucide AudioLines in white, ink "Assistant",
// a square "NEW" tag framed in blue. Flat, square, no shadow at rest.
//   desk / blueprint → opens the desk panel; the folded rail draws the square alone.
//   drawer / more    → goes to the handheld page (the host closes itself first).
// Drawn only for those who have the Assistant (actions/assistant assistantVisible:
// platform admins until the owner opens it, never the field crew), asked once per
// page load and hidden until the answer is yes.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AudioLines } from "lucide-react";
import { assistantVisible } from "@/actions/assistant";
import { useNavRole } from "@/components/v3/blueprint-shell/nav-role";
import { MOBILE_HREF, openAssistant } from "./events";
import styles from "./assistant-row.module.css";

type Variant = "desk" | "blueprint" | "drawer" | "more";

/** One question per page load, shared by every row on the page. */
let asked: Promise<boolean> | null = null;

function useVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let live = true;
    asked ??= assistantVisible().catch(() => false);
    void asked.then((v) => {
      if (live) setVisible(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return visible;
}

export function AssistantRow({ variant, onBeforeOpen, role }: { variant: Variant; onBeforeOpen?: () => void; role?: string | null }) {
  const navRole = useNavRole();
  const visible = useVisible();
  if (!visible || (role ?? navRole) === "INSTALLER") return null;
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
