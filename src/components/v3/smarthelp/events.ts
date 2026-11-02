// SMARTHELP · THE DOOR (2026-10-30). The sidebar rows and the panel talk by event, not by props — the same
// arrangement as the Help composer (`jf:support`): a row sits in a sidebar three components away from the panel it
// opens. Tiny on purpose, so a sidebar doesn't pull the panel in to draw its row.

export const OPEN_EVENT = "jf:smarthelp";

export type OpenDetail = { opener: HTMLElement | null };

/** Open SmartHelp from anywhere. `opener` gets focus back when the panel closes — pass it when the host tears its own
 *  chrome down on the way (a drawer that closes as SmartHelp opens). */
export function openSmartHelp(opener?: HTMLElement | null): void {
  const detail: OpenDetail = { opener: opener ?? null };
  document.dispatchEvent(new CustomEvent<OpenDetail>(OPEN_EVENT, { detail }));
}
