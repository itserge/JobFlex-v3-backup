"use client";
// VIEWPORT SWITCH for /dashboard/pipeline (Smart CRM part 3, 2026-11-08) — the client-detail pattern, reused whole:
// above 768px the Pipeline renders inside the BlueprintShell the layout mounts; at or below it, inside the fleet's
// handheld chrome (MobileNav over a self-scrolling body), using client-detail's own .mshell classes so the tuned
// handheld shell is one implementation, not two.

import { useEffect, useSyncExternalStore } from "react";
import { Sprite } from "@/components/v3/blueprint-shell/sprite";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import proposalStyles from "@/components/v3/proposals-blueprint/proposals.module.css";
import dashboardStyles from "@/components/v3/dashboard-blueprint/blueprint.module.css";
import "@/components/v3/dashboard-blueprint/blueprint-global.css";
import shell from "@/components/v3/client-detail-blueprint/client-detail.module.css";
import { PipelineContent } from "./pipeline-content";
import type { PipelineView } from "./pipeline-load";

const HANDHELD = "(max-width: 768px)";
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
const getServerSnapshot = () => false;

export function PipelineViewportSwitch({ view }: { view: PipelineView }) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isHandheld ? <HandheldPipeline view={view} /> : <PipelineContent view={view} />;
}

function HandheldPipeline({ view }: { view: PipelineView }) {
  useEffect(() => {
    const apply = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      document.documentElement.style.removeProperty("--app-h");
    };
  }, []);
  return (
    <div className={cx("jf-blueprint", shell.mshell)} data-page="pipeline">
      <Sprite />
      <MobileNav />
      <div className={cx(proposalStyles.bp, dashboardStyles.bp, shell.mshellBody)}>
        <div className={cx("main", shell.mshellScroll)}>
          <div className="content">
            <PipelineContent view={view} />
          </div>
        </div>
      </div>
    </div>
  );
}
