"use client";

// Settings blueprint — Assistant pane (2026-11-04). The card loads and saves itself (actions/assistant); the phone
// Settings mounts the same piece (components/v3/assistant/assistant-settings).

import { AssistantSettings } from "@/components/v3/assistant/assistant-settings";

export function AssistantPane() {
  return <AssistantSettings />;
}
