// THE ASSISTANT · THE DOOR (2026-11-04). The sidebar rows and the desk panel talk
// by event, as SmartHelp's do (components/v3/smarthelp/events): a row sits in a
// sidebar three components away from the panel it opens. On a phone there is no
// panel — the rows go to the Assistant's own page.

export const OPEN_EVENT = "jf:assistant";

/** The handheld page (app/(mobile)/mobile-assistant-v1). */
export const MOBILE_HREF = "/mobile-assistant-v1";

export type OpenDetail = { opener: HTMLElement | null; text?: string };

/** Open the desk panel from anywhere. `text` pre-fills the box. */
export function openAssistant(opener?: HTMLElement | null, text?: string): void {
  const detail: OpenDetail = { opener: opener ?? null, ...(text ? { text } : {}) };
  document.dispatchEvent(new CustomEvent<OpenDetail>(OPEN_EVENT, { detail }));
}
