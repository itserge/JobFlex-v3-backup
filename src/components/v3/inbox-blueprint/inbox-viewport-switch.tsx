"use client";
// VIEWPORT SWITCH for /dashboard/inbox (Smart CRM part 2, 2026-11-08) — the client-detail pattern, reused whole:
// above 768px the Inbox renders inside the BlueprintShell the layout mounts; at or below it, inside the fleet's
// handheld chrome (MobileNav over a self-scrolling body), using client-detail's own .mshell classes so the tuned
// handheld shell is one implementation, not two.

import { useEffect, useSyncExternalStore } from "react";
import { Sprite } from "@/components/v3/blueprint-shell/sprite";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import proposalStyles from "@/components/v3/proposals-blueprint/proposals.module.css";
import dashboardStyles from "@/components/v3/dashboard-blueprint/blueprint.module.css";
import "@/components/v3/dashboard-blueprint/blueprint-global.css";
import shell from "@/components/v3/client-detail-blueprint/client-detail.module.css";
import { InboxContent } from "./inbox-content";
import type { InboxView } from "./inbox-load";

const HANDHELD = "(max-width: 768px)";
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

function subscribe(onStoreChange: () => void) {
  const mq = window.matchMedia(HANDHELD);
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
const getSnapshot = () => window.matchMedia(HANDHELD).matches;
const getServerSnapshot = () => false;

export function InboxViewportSwitch({ view }: { view: InboxView }) {
  const isHandheld = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return isHandheld ? <HandheldInbox view={view} /> : <InboxContent view={view} />;
}

function HandheldInbox({ view }: { view: InboxView }) {
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
    <div className={cx("jf-blueprint", shell.mshell)} data-page="inbox">
      <Sprite />
      <MobileNav />
      <div className={cx(proposalStyles.bp, dashboardStyles.bp, shell.mshellBody)}>
        <div className={cx("main", shell.mshellScroll)}>
          <div className="content">
            <InboxContent view={view} />
          </div>
        </div>
      </div>
    </div>
  );
}
