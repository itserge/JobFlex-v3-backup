// ADMIN · PHONE SEARCH (2026-11-06) — the one rule for "is this query a phone
// number, and does this stored number match it". Shared by the server search
// (actions/adminUsers searchAdminUsersByPhone) and the Users & subscriptions
// page, so the field and the server never disagree about what a phone query is.
//
// Phones are stored as typed ("(425) 555-0172", "+14255550172", "425.555.0172"),
// so both sides are compared as bare digits, matched from the END: the query's
// last 7–10 digits must be the stored number's last digits. "+1 425 555 0172",
// "4255550172" and "5550172" all find "(425) 555-0172".

/** Fewest digits a phone query needs — below this a number hits too many rows. */
export const PHONE_QUERY_MIN_DIGITS = 7;
/** Most digits compared — a country code in front of the ten is dropped. */
export const PHONE_QUERY_MAX_DIGITS = 10;

/** Only what people type into a phone number: digits, spaces, ( ) + - . / */
const PHONE_SHAPE = /^[\d\s().+\-/]+$/;

/**
 * The digits to match when `query` reads as a phone number, else null.
 * Anything with a letter is a name/email search; fewer than 7 digits is too
 * short to mean one number; more than 10 keeps the last 10 (drops "+1").
 */
export function phoneQueryDigits(query: string): string | null {
  const t = query.trim();
  if (!t || !PHONE_SHAPE.test(t)) return null;
  const digits = t.replace(/\D/g, "");
  if (digits.length < PHONE_QUERY_MIN_DIGITS || digits.length > 15) return null;
  return digits.length > PHONE_QUERY_MAX_DIGITS ? digits.slice(-PHONE_QUERY_MAX_DIGITS) : digits;
}

/** The stored number ends with the query's digits (both compared as digits). */
export function phoneEndsWith(stored: string | null | undefined, digits: string): boolean {
  if (!stored) return false;
  return stored.replace(/\D/g, "").endsWith(digits);
}

/**
 * The substring every stored spelling of a match contains: the last four
 * digits are never split by formatting ("555-0172", "555 0172", "5550172"),
 * so the database narrows on them and phoneEndsWith decides.
 */
export function phoneNarrowing(digits: string): string {
  return digits.slice(-4);
}

/** "+1 425 555 0172" for a US/Canada number; anything else as stored. */
export function formatPhoneMatch(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const ten = d.length === 10 ? d : d.length === 11 && d.startsWith("1") ? d.slice(1) : null;
  if (!ten) return raw.trim();
  return `+1 ${ten.slice(0, 3)} ${ten.slice(3, 6)} ${ten.slice(6)}`;
}

/** Whose number it was: the person's own, or the company's. */
export type PhoneMatchWhose = "owner" | "member" | "account" | "company" | "twilio" | "office";

export interface AdminPhoneMatch {
  /** The number as stored. */
  phone: string;
  whose: PhoneMatchWhose;
  /** The account the number belongs to (owner / member / account), else null. */
  userId: string | null;
  /** The organization it finds — every row whose company this is shows. */
  orgId: string | null;
  /** A name to tell whose it was (the member, the office line's label). */
  who: string | null;
}

export const PHONE_WHOSE_LABEL: Record<PhoneMatchWhose, string> = {
  owner: "owner",
  member: "member",
  account: "account",
  company: "company",
  twilio: "company texting number",
  office: "office line",
};
