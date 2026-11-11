// A LEAD'S DETAILS, THE RULES (2026-11-10) — pure, so the lead page's Edit, the import, the AI Operator's update_lead
// and the checks (qa/tests/logic/lead-edit.check.ts) share them. The writes are lib/leads/edit's.
import { z } from "zod";

// A lead's address in one line: a by-hand lead or a CSV with one "address" column carries the whole thing in one
// field ("1420 Maple St, Seattle, WA 98101"). The lead keeps a street, a city, a state and a ZIP — the city line under
// the lead's name, the AI desk's call and the client record read them apart — so a line that clearly reads as a US
// address is split, and anything else stays whole in the street field, exactly as typed.
export type LeadAddress = { address: string | null; city: string | null; state: string | null; zip: string | null };

const clean = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** "1420 Maple St, Seattle, WA 98101" → its four parts; a line that doesn't read that way stays the street, whole. */
export function splitLeadAddress(line: string | null | undefined): LeadAddress {
  const t = clean(line)?.replace(/,?\s*(USA|U\.S\.A\.|United States(?: of America)?)$/i, "") ?? null;
  if (!t) return { address: null, city: null, state: null, zip: null };
  // street, city, ST 98101  ·  street, city, ST  ·  street, city ST 98101
  const m = /^(.+?),\s*([^,\d][^,]*?),?\s+([A-Za-z]{2})\.?(?:\s+(\d{5}(?:-\d{4})?))?$/.exec(t);
  if (m && m[1].trim() && m[2].trim()) {
    return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] ?? null };
  }
  return { address: t, city: null, state: null, zip: null };
}

export const LEAD_EDIT_FIELDS = ["name", "phone", "email", "address", "city", "state", "zip", "projectType"] as const;
export type LeadEditField = (typeof LEAD_EDIT_FIELDS)[number];
export type LeadPatch = Partial<Record<LeadEditField, string | null>>;

export const LEAD_EDIT_MAX: Record<LeadEditField, number> = { name: 120, phone: 40, email: 200, address: 200, city: 80, state: 40, zip: 20, projectType: 80 };

/** How each field is named in the trail and the replies. */
export const LEAD_FIELD_WORDS: Record<LeadEditField, string> = {
  name: "name",
  phone: "phone",
  email: "email",
  address: "street address",
  city: "city",
  state: "state",
  zip: "ZIP",
  projectType: "project",
};


const tidy = (v: string | null | undefined) => {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t : null;
};

/** The patch as it will be kept: trimmed, checked, "" → null. An error names the field in plain words. */
export function cleanLeadPatch(patch: LeadPatch): { ok: true; patch: LeadPatch } | { ok: false; error: string } {
  const out: LeadPatch = {};
  for (const k of LEAD_EDIT_FIELDS) {
    if (!(k in patch)) continue;
    const v = tidy(patch[k]);
    if (v && v.length > LEAD_EDIT_MAX[k]) return { ok: false, error: `The ${LEAD_FIELD_WORDS[k]} is too long (${LEAD_EDIT_MAX[k]} characters at most).` };
    out[k] = v;
  }
  if ("name" in out && !out.name) return { ok: false, error: "The lead needs a name." };
  if (out.email && !z.string().email().safeParse(out.email).success) return { ok: false, error: `"${out.email}" doesn't look like an email address.` };
  if (out.phone && out.phone.replace(/\D+/g, "").length < 7) return { ok: false, error: `"${out.phone}" looks too short for a phone number.` };
  if (out.zip && !/^[A-Za-z0-9][A-Za-z0-9 -]{1,9}$/.test(out.zip)) return { ok: false, error: `"${out.zip}" doesn't look like a ZIP code.` };
  return { ok: true, patch: out };
}

/** "added the street address and ZIP; changed the phone" — what the trail and the replies say. */
export function leadChangeWords(before: Record<LeadEditField, string | null>, after: Record<LeadEditField, string | null>, changed: LeadEditField[]): string {
  const added: string[] = [];
  const moved: string[] = [];
  const removed: string[] = [];
  for (const k of changed) {
    const w = LEAD_FIELD_WORDS[k];
    if (!before[k]) added.push(w);
    else if (!after[k]) removed.push(w);
    else moved.push(w);
  }
  const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  return [added.length ? `added the ${list(added)}` : null, moved.length ? `changed the ${list(moved)}` : null, removed.length ? `removed the ${list(removed)}` : null]
    .filter(Boolean)
    .join("; ");
}
