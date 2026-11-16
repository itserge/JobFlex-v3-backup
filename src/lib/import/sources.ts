// THE PROGRAMS A CONTRACTOR COMES FROM (2026-11-16, lib/import) — pure data.
//
// Each: its name, the short mark its records keep in JobFlex (an invoice "HCP-1042", the tag "From Housecall Pro"),
// how to get the files out of it — read from each program's own help pages in November 2026 where they say it — and
// the column names that give its files away, so a dropped file can say "this looks like a Jobber export".

export type ImportSource = "HOUSECALL_PRO" | "JOBBER" | "SERVICETITAN" | "WORKIZ" | "JOBNIMBUS" | "QUICKBOOKS" | "CONTACTS" | "OTHER";

export interface SourceInfo {
  id: ImportSource;
  label: string;
  /** Before an imported invoice's own number: "HCP-1042". */
  prefix: string;
  /** The steps to get the files out, as a contractor reads them. */
  steps: string[];
  /** Which files to bring. */
  files: string;
  /** Column names (lower case) only this program's files carry; two of them name the program. */
  marks: string[];
}

export const IMPORT_SOURCES: readonly SourceInfo[] = [
  {
    id: "HOUSECALL_PRO",
    label: "Housecall Pro",
    prefix: "HCP",
    steps: [
      "Sign in to Housecall Pro as an admin (only admins can export).",
      "Customers → Actions (top right) → Export. Housecall Pro emails you the file — it can take up to an hour; check spam.",
      "Jobs → Actions → Export the same way. In Housecall Pro a job and its invoice are one record, so this file carries what each job cost and what is still owed.",
      "Estimates: from the dashboard's Estimates report → Export → Send file.",
    ],
    files: "Customers file first, then Jobs, then Estimates.",
    marks: ["customer id", "display name", "mobile number", "home number", "work number", "job #", "outstanding balance", "lead source", "customer tags"],
  },
  {
    id: "JOBBER",
    label: "Jobber",
    prefix: "JOB",
    steps: [
      "Clients → More Actions → Export Clients → CSV. Jobber emails it; more than 1,500 clients come as several files — bring them all.",
      "Reports → Invoices report → Export as CSV (what each client was billed and still owes).",
      "Reports → Jobs (or Visits) report → Export as CSV for the schedule and past work.",
      "Reports → Quotes report → Export as CSV for estimates.",
    ],
    files: "Client files first, then the Invoices, Jobs and Quotes reports.",
    marks: ["e-mails", "main phone #s", "mobile phone #s", "billing street 1", "billing zip code", "service street 1", "service property name", "client name", "visit"],
  },
  {
    id: "SERVICETITAN",
    label: "ServiceTitan",
    prefix: "ST",
    steps: [
      "Search for customers (all active ones), then the dropdown beside Search → Export to Excel or CSV. If it isn't there, ask your ServiceTitan admin to run it.",
      "Reports → a Jobs report and an Invoices report → Export (date range: everything you want to keep).",
    ],
    files: "Customers first, then Jobs and Invoices.",
    marks: ["customer name", "location address", "business unit", "job type", "technician", "invoice #", "balance"],
  },
  {
    id: "WORKIZ",
    label: "Workiz",
    prefix: "WZ",
    steps: [
      "Clients list → Export (as an admin).",
      "Jobs and Invoices lists or reports → Export. Exact menu names vary by plan; Workiz support can send the files too.",
    ],
    files: "Clients first, then Jobs and Invoices.",
    marks: ["workiz", "job serial", "client id", "sub status"],
  },
  {
    id: "JOBNIMBUS",
    label: "JobNimbus",
    prefix: "JN",
    steps: [
      "Contacts → select all → Export (or a custom Contacts report → Export).",
      "Jobs and Invoices: a custom report for each → Export.",
    ],
    files: "Contacts first, then Jobs and Invoices.",
    marks: ["jnid", "record type", "sales rep", "contact", "jobnimbus"],
  },
  {
    id: "QUICKBOOKS",
    label: "QuickBooks",
    prefix: "QB",
    steps: [
      "QuickBooks Online: Sales → Customers → the export icon above the list → Export to Excel. The Open Balance column comes in as money owed.",
      "Invoices: Reports → Open Invoices (or Invoice List) → Export to Excel.",
    ],
    files: "Customers first, then Open Invoices.",
    marks: ["open balance", "bill street", "bill city", "customer type", "full name", "customer full name"],
  },
  {
    id: "CONTACTS",
    label: "Google or Outlook contacts",
    prefix: "CT",
    steps: [
      "Google Contacts: select the people (or a label) → Export → Google CSV.",
      "Outlook: File → Open & Export → Import/Export → Export to a file → CSV.",
    ],
    files: "The contacts file.",
    marks: ["e-mail 1 - value", "phone 1 - value", "given name", "family name", "address 1 - street", "e-mail address", "mobile phone", "business phone"],
  },
  {
    id: "OTHER",
    label: "A spreadsheet or another program",
    prefix: "IMP",
    steps: [
      "Look for Export in the program's Customers (or Clients) list and choose CSV or Excel.",
      "A spreadsheet of your own works as it is: one row per client, a header row on top.",
    ],
    files: "Clients first; jobs, invoices or estimates after, if you have them.",
    marks: [],
  },
];

export const sourceInfo = (id: ImportSource): SourceInfo => IMPORT_SOURCES.find((s) => s.id === id) ?? IMPORT_SOURCES[IMPORT_SOURCES.length - 1];

export const isImportSource = (v: unknown): v is ImportSource => typeof v === "string" && IMPORT_SOURCES.some((s) => s.id === v);

/** The program a file's columns give away — two of its marks — or null. */
export function sourceOfHeaders(headers: readonly string[]): ImportSource | null {
  const have = new Set(headers.map((h) => h.trim().toLowerCase()));
  let best: { id: ImportSource; n: number } | null = null;
  for (const s of IMPORT_SOURCES) {
    const n = s.marks.filter((m) => have.has(m)).length;
    if (n >= 2 && (!best || n > best.n)) best = { id: s.id, n };
  }
  return best?.id ?? null;
}
