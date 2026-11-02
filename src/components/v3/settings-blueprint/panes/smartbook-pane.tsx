"use client";

// Settings blueprint — SmartBook pane (2026-10-31). The form loads and saves itself (actions/smartBookOffice); the
// phone pane mounts the same piece. Its two links inside Settings move the rail: Notifications (who hears about
// requests) and Integrations → Meta business (the Facebook Page the leads come from).

import { SmartBookSettingsForm } from "@/components/v3/smartbook/smartbook-settings";
import type { PaneProps } from "../settings-data";

export function SmartBookPane({ navigate }: PaneProps) {
  return <SmartBookSettingsForm onOpen={(where) => (where === "meta" ? navigate("integrations", "meta") : navigate("notifications"))} />;
}
