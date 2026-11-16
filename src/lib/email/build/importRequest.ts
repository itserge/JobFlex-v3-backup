// "DO IT FOR ME" (2026-11-16, CRM migration plan part 4; lib/import/requests). Three emails, pure, no I/O:
//   · to the platform admins when a contractor sends their files — a work item with the due day and one button;
//   · to the contractor when the team has brought them in — what came in, where to see it, how to undo it;
//   · to the contractor when the team cancels it — the reason, and the way to try again.
import type { BoxRow, EmailDoc, Lockup } from "../doc";
import { truncate } from "../fit";

const PLATFORM_LOCKUP: Lockup = { kind: "platform" };
const PLATFORM_FOOTER = { name: "JobFlex" };
const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "there";

export interface ImportAskedInput {
  orgName: string;
  askedBy: string;
  sourceLabel: string;
  files: Array<{ name: string; bytes: number }>;
  note: string | null;
  /** "Wed, Nov 18". */
  due: string;
  /** Absolute link to /admin/imports?request=<id>. */
  href: string;
}

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

export function buildImportAsked(i: ImportAskedInput): EmailDoc {
  const box: BoxRow[] = [
    { type: "field", label: "Company", value: i.orgName },
    { type: "field", label: "Asked by", value: i.askedBy },
    { type: "field", label: "Moving from", value: i.sourceLabel },
    { type: "field", label: "Files", value: i.files.map((f) => `${f.name} (${size(f.bytes)})`).join(", ").slice(0, 300) || "—" },
    { type: "cond", label: "Due", chip: i.due, tone: "warn" },
  ];
  return {
    subject: `Import request — ${i.orgName} (${i.sourceLabel}), due ${i.due}`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Do it for me", tone: "warn" },
    headline: `${i.orgName} sent their ${i.sourceLabel} files`,
    prose: [`They asked us to bring their clients in. We promised it within 2 business days.`, i.note ? `Their note: “${truncate(i.note, 400)}”` : "They left no note."],
    box,
    cta: { label: "Open the request", href: i.href },
    after: ["Open it in Admin → Imports, check the columns and bring it in for them. They are emailed when it's done, and the files are deleted from storage."],
    footer: PLATFORM_FOOTER,
  };
}

export interface ImportDoneInput {
  name: string | null;
  sourceLabel: string;
  /** What came in, line by line ("412 new clients", "18 open invoices · $9,240 owed"…). */
  lines: string[];
  /** Absolute link to /dashboard/clients. */
  clientsHref: string;
  /** Absolute link to /dashboard/clients/import (Your imports, with Undo). */
  importsHref: string;
}

export function buildImportDone(i: ImportDoneInput): EmailDoc {
  return {
    subject: `Your ${i.sourceLabel} clients are in JobFlex`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Your clients are in", tone: "ok" },
    headline: `Hi ${firstName(i.name)} — your clients from ${i.sourceLabel} are in JobFlex`,
    prose: [
      "We brought in the files you sent. Here's what came in:",
      i.lines.length ? i.lines.map((l) => `• ${l}`).join("\n") : "• Your clients",
      "Nothing was sent to your clients — no texts, emails or reminders. New clients are tagged “From " + i.sourceLabel + "”, so you can find them in one click.",
    ],
    cta: { label: "See your clients", href: i.clientsHref },
    after: [`Something not right? Clients → Bring your clients → Your imports → Undo takes it all back (anything you've worked on since stays). Or just reply to this email.`, `Your files have been deleted from our storage. Manage it here: ${i.importsHref}`],
    footer: PLATFORM_FOOTER,
  };
}

export interface ImportCanceledInput {
  name: string | null;
  sourceLabel: string;
  reason: string;
  /** Absolute link to /dashboard/clients/import. */
  href: string;
}

export function buildImportCanceled(i: ImportCanceledInput): EmailDoc {
  return {
    subject: `About your ${i.sourceLabel} import`,
    lockup: PLATFORM_LOCKUP,
    kicker: { text: "Your import", tone: "warn" },
    headline: `Hi ${firstName(i.name)} — we couldn't bring in your ${i.sourceLabel} files yet`,
    prose: [`What we found: “${truncate(i.reason, 400)}”`, "Your files have been deleted from our storage. Send them again when you're ready — or bring them in yourself in about 10 minutes."],
    cta: { label: "Bring your clients", href: i.href },
    after: ["Questions? Just reply to this email."],
    footer: PLATFORM_FOOTER,
  };
}
