"use client";
// THE DIAL BUTTON ON EVERY PHONE PAGE (2026-11-05, batch 4 — Rev 2): a blue
// square with the microphone in the corner the thumb reaches, mounted by the
// handheld nav so it is on every page (not the Operator's own, which has the
// dial). Tap: the Operator's page, listening. Hold: the sheet opens over this
// page listening while the finger stays down — let go to send, slide off to
// cancel — and the page is still there under it when the sheet closes. Drawn
// only for those who have the Operator (./assistant-row useAssistantVisible).

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Route } from "next";
import { Mic } from "lucide-react";
import { useNavRole } from "@/components/v3/blueprint-shell/nav-role";
import { useAssistantVisible } from "./assistant-row";
import { MOBILE_HREF } from "./events";
import { OperatorSheet, type OperatorHandle } from "./operator-sheet";
import { useAssistant } from "./use-assistant";
import "./operator.css";

const HOLD_MS = 300;

export function OperatorFab() {
  const visible = useAssistantVisible();
  const role = useNavRole();
  const pathname = usePathname();
  const router = useRouter();
  const state = useAssistant();
  const [open, setOpen] = useState<"hold" | null>(null);
  const [held, setHeld] = useState(false);
  const sheet = useRef<OperatorHandle>(null);
  const down = useRef<{ x: number; y: number; timer: number } | null>(null);
  const holding = useRef(false);

  if (!visible || role === "INSTALLER" || pathname === MOBILE_HREF) return null;

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    const timer = window.setTimeout(() => {
      holding.current = true;
      setHeld(true);
      setOpen("hold");
    }, HOLD_MS);
    down.current = { x: e.clientX, y: e.clientY, timer };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = down.current;
    if (!d || !holding.current) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 60) {
      holding.current = false;
      setHeld(false);
      sheet.current?.cancel();
    }
  };
  const onUp = () => {
    const d = down.current;
    down.current = null;
    if (d) window.clearTimeout(d.timer);
    if (holding.current) {
      holding.current = false;
      setHeld(false);
      sheet.current?.release();
      return;
    }
    if (!open) router.push(`${MOBILE_HREF}?talk=1` as Route);
  };

  return (
    <>
      {open ? <OperatorSheet ref={sheet} state={state} variant="overlay" start={open} onClose={() => setOpen(null)} /> : null}
      <button
        type="button"
        className={`jf-opfab ${held ? "held" : ""}`}
        aria-label="AI Operator — tap to talk, hold to talk here"
        title="AI Operator"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <Mic />
      </button>
    </>
  );
}
