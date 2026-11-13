// QA LAB TEST ADDRESSES (2026-10-14). Every address under @qa.jobflex.test
// belongs to the automated checks in qa/ (qa/README.md). `.test` is a reserved
// top-level domain, so no such mailbox can exist. These accounts are left out
// of the admin statistics (lib/statsHidden) and of PostHog — on the
// server (lib/qaTestMode) and in the browser (markQaVisitor below) — and, with
// QA_TEST_MODE=1 outside production, their codes are kept for the test
// endpoint instead of being emailed (/api/qa/otp).
//
// No "server-only" here: the browser side needs the same rule.

export const QA_EMAIL_DOMAIN = "@qa.jobflex.test";

export function isQaEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(QA_EMAIL_DOMAIN);
}

/** QA LAB TEST NUMBERS (2026-11-12, the sign-up by text): the fictional 555-0100…0199 lines under any area code
 *  (+1 NPA 555-01XX) — reserved for fiction, so no phone answers them. With QA_TEST_MODE=1 outside production their
 *  codes are kept instead of texted (lib/sms/verify); like the QA addresses, they count nowhere. */
export function isQaPhone(raw: string | null | undefined): boolean {
  const d = String(raw ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^[2-9]\d{2}55501\d{2}$/.test(ten);
}

const VISITOR_KEY = "jf_qa_visitor";

/** In the browser: once a QA address (or QA number) is typed and sent, this
 *  browser sends no analytics events any more (posthog-capture, traffic-client). */
export function markQaVisitor(email: string | null | undefined): void {
  const qa = String(email ?? "").includes("@") ? isQaEmail(email) : isQaPhone(email);
  if (!qa || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VISITOR_KEY, "1");
  } catch {
    /* storage off: this page still knows below */
  }
  (window as unknown as { __jfQaVisitor?: boolean }).__jfQaVisitor = true;
}

export function isQaVisitor(): boolean {
  if (typeof window === "undefined") return false;
  if ((window as unknown as { __jfQaVisitor?: boolean }).__jfQaVisitor) return true;
  try {
    return window.localStorage.getItem(VISITOR_KEY) === "1";
  } catch {
    return false;
  }
}
