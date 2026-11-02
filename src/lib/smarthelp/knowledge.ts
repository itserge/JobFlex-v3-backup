// SmartHelp's knowledge: the support handbook (lib/support/handbook) as a customer may read it. Every
// "### Internal — for the team (not for customers)" block — the code map, env var names, failure modes — is cut out
// up to the next heading of its level or higher, so the AI that answers contractors never sees, and never repeats,
// what is the team's. Pure — the handbook is plain text — so QA checks run it under plain tsx.
import { SUPPORT_HANDBOOK } from "@/lib/support/handbook";

const INTERNAL_HEADING = /^### Internal — for the team \(not for customers\)\s*$/;
/** A heading of the Internal block's level (###) or higher (##, #) ends the block. */
const ENDS_BLOCK = /^#{1,3} /;

/** `md` with every Internal block removed and the blank lines around a cut closed up. */
export function withoutInternal(md: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of md.split("\n")) {
    if (INTERNAL_HEADING.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && ENDS_BLOCK.test(line)) skipping = false;
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

let cached: string | null = null;

/** The handbook's customer-facing text — what SmartHelp's AI answers from. */
export function customerHandbook(): string {
  if (cached === null) cached = withoutInternal(SUPPORT_HANDBOOK);
  return cached;
}
