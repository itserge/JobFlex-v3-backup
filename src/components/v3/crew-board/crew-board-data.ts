// THE CREW BOARD — shapes (stage C, 2026-09-30). Pure, client-safe.
//
// What a job's days on site, its photos and videos by day, and its receipts
// look like to whoever is reading: the crew on the job (through the portal or
// the dashboard) or the office. Every string is formatted on the server; every
// file link is a short signed one minted after the reader was checked.

/** Which entrance the reader came through: the dashboard session, or the
 *  portal's magic link (every request carries the token). */
export type CrewDoor = { kind: "session" } | { kind: "token"; token: string };

export type CrewFile = {
  id: string;
  /** A short signed link (15 min) to show it; an older public row's own URL. */
  href: string;
  /** The same, asking the browser to save it. */
  downloadHref: string;
  media: "photo" | "video";
  contentType: string | null;
  /** "Before" / "Progress" / "After". */
  kind: string;
  caption: string | null;
  /** Who uploaded it; null on rows from before the uploader was kept. */
  by: string | null;
  /** "Sep 30 · 2:14 PM" */
  at: string;
  /** "edited Sep 30" when the caption was changed after upload. */
  edited: string | null;
  canEdit: boolean;
  canDelete: boolean;
  /** "12 MB" */
  size: string | null;
};

export type CrewDay = {
  id: string;
  /** "2026-09-29" */
  date: string;
  /** "Tue, Sep 29" */
  label: string;
  dayNumber: number;
  /** OPEN (today, on the clock) · PENDING (passed, needs closing) · CLOSED */
  status: "OPEN" | "PENDING" | "CLOSED";
  openedBy: string | null;
  closedBy: string | null;
  /** "5:42 PM" / "Sep 30 · 8:10 AM" when closed on a later day. */
  closedAt: string | null;
  /** Opened by the office moving the status, not by a crew press. */
  byOffice: boolean;
  note: string | null;
  /** "48–61°F, rain" — noted by itself when the day opened (2026-11-05), or null. */
  weather: string | null;
  files: CrewFile[];
};

export type CrewReceipt = {
  id: string;
  amount: number;
  vendor: string | null;
  category: string;
  note: string | null;
  /** "Sep 30" */
  spent: string;
  /** "2026-09-30", for the edit form */
  spentISO: string;
  paidBy: "WORKER" | "COMPANY";
  status: "SUBMITTED" | "APPROVED" | "REJECTED" | "REIMBURSED";
  rejectReason: string | null;
  by: string | null;
  mine: boolean;
  edited: string | null;
  file: { href: string; downloadHref: string; pdf: boolean } | null;
  canEdit: boolean;
  canDelete: boolean;
  /** The office's buttons: approve / reject / reimburse. */
  canReview: boolean;
};

export type CrewBoardData = {
  jobId: string;
  jobStatus: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELED";
  /** "2026-09-30" in the company's timezone. */
  today: string;
  /** Today's day on site, when the job has one. */
  todayDay: CrewDay | null;
  /** Days that passed without being closed, oldest first. */
  pending: CrewDay[];
  /** Every day, newest first. */
  days: CrewDay[];
  /** Files from before days were kept (or uploaded on no day). */
  looseFiles: CrewFile[];
  receipts: CrewReceipt[];
  /** May press the day buttons, add files and receipts. */
  canWork: boolean;
  /** The office: reviews receipts; its day presses are silent. */
  office: boolean;
  /** Where files go: the private store, the local dev fallback, or inline (no store yet). */
  storage: "blob" | "local" | "inline";
  /** 100 MB */
  maxBytes: number;
  /** Totals of the receipts, by what counts (lib/expenseTotals). */
  totals: { counted: number; pending: number; owedToWorkers: number };
  categories: string[];
};

export const RECEIPT_CATEGORIES = ["Materials", "Fuel", "Tools", "Equipment", "Permits", "Disposal", "Subcontractor", "Other"];

export const RECEIPT_STATUS: Record<CrewReceipt["status"], { label: string; tone: "wait" | "ok" | "no" | "done" }> = {
  SUBMITTED: { label: "On review", tone: "wait" },
  APPROVED: { label: "Approved", tone: "ok" },
  REJECTED: { label: "Rejected", tone: "no" },
  REIMBURSED: { label: "Reimbursed", tone: "done" },
};

export const money2 = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
