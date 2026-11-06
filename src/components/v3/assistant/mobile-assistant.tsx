"use client";
// THE AI OPERATOR · THE HANDHELD PAGE (2026-11-04; Rev 2 on 2026-11-05) — /mobile-assistant-v1,
// where the phone drawers' AI Operator row goes. The shared handheld chrome (MobileNav)
// and, filling the rest, the Operator sheet (./operator-sheet): the blueprint with
// the dial, Talk and Tasks. `?talk=1` (the dial button on another page, tapped)
// opens it listening. The conversation is read from the database when the page
// opens, so it is the one on the desk too.

import { useSearchParams } from "next/navigation";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { OperatorSheet } from "./operator-sheet";
import { useAssistant } from "./use-assistant";
import "./mobile-assistant.css";

export function MobileAssistant() {
  const state = useAssistant();
  const talk = useSearchParams().get("talk") === "1";

  return (
    <div className="jf-mobile-assistant">
      <MobileNav />
      <main className="mas-main op-host">
        <OperatorSheet state={state} variant="page" start={talk ? "tap" : null} />
      </main>
    </div>
  );
}
