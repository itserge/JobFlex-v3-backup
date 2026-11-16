// THE PROGRAMS A CONTRACTOR COMES FROM (2026-11-16, lib/import) — pure data.
//
// Each: its name, the short mark its records keep in JobFlex (an invoice "HCP-1042", the tag "From Housecall Pro"),
// how to get the files out of it, and the column names that give its files away, so a dropped file can say "this
// looks like a Jobber export". The steps were checked on 2026-11-16 against each program's OWN help center only (the
// pages are listed under `docs`); where the vendor documents no way, the steps say so and point to "Do it for me".
// The same steps show on the import page and on the public /switch/<slug> pages — change them here, in one place.

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
  /** The public page's address (/switch/<slug>); null = no switch page (contacts). */
  slug: string | null;
  /** What the vendor's own help center confirms: everything, part of it, or no file export of the client list. */
  checked: "yes" | "partly" | "no-client-export" | null;
  /** The vendor help pages the steps were read from (for whoever updates them). */
  docs: string[];
}

export const IMPORT_SOURCES: readonly SourceInfo[] = [
  {
    id: "HOUSECALL_PRO",
    label: "Housecall Pro",
    prefix: "HCP",
    steps: [
      "Sign in to Housecall Pro as an admin — only admins can export customers and jobs.",
      "Customers (left menu) → Actions (right) → Export → confirm your email → Send file. The CSV comes by email from notifications@housecallpro.com; if it hasn't arrived within an hour, check spam.",
      "Jobs → Actions → Export → Send file. This file carries your jobs and their invoices — what each cost and what is still owed.",
      "Estimates (left menu) → Actions → Export → Send file.",
    ],
    files: "Customers file first, then Jobs, then Estimates.",
    marks: ["customer id", "display name", "mobile number", "home number", "work number", "job #", "outstanding balance", "lead source", "customer tags"],
    slug: "housecall-pro",
    checked: "yes",
    docs: ["https://help.housecallpro.com/en/articles/6797101", "https://help.housecallpro.com/en/articles/8241575", "https://help.housecallpro.com/en/articles/4439447"],
  },
  {
    id: "JOBBER",
    label: "Jobber",
    prefix: "JOB",
    steps: [
      "Clients → More Actions (top right) → Export Clients → CSV → Export. Jobber emails it (admins only); more than 1,499 clients arrive as several files in one email — bring them all.",
      "Insights → Reports → Financial reports → Invoices → Export to CSV (all columns): what each client was billed and still owes.",
      "Insights → Reports → Work reports → Visits (and One-off jobs) → Export to CSV: the schedule and past work.",
      "Insights → Reports → Work reports → Quotes → Export to CSV: your estimates. Report files go to your login email.",
    ],
    files: "Client files first, then the Invoices, Visits and Quotes reports.",
    marks: ["e-mails", "main phone #s", "mobile phone #s", "billing street 1", "billing zip code", "service street 1", "service property name", "client name", "visit"],
    slug: "jobber",
    checked: "yes",
    docs: ["https://help.getjobber.com/en/articles/export-client-information/", "https://help.getjobber.com/en/articles/invoices-report/", "https://help.getjobber.com/en/articles/visits-report/", "https://help.getjobber.com/en/articles/quotes-report/"],
  },
  {
    id: "SERVICETITAN",
    label: "ServiceTitan",
    prefix: "ST",
    steps: [
      "Search → Customers, with no filters → the dropdown beside Search → Export to CSV (or Excel). If the export is refused, an administrator has to give you the permission.",
      "Jobs and invoices: Reports → a report built on the Jobs (or Invoices) template → Run Report → Export → XLSX. On plans without custom reports, the built-in Customer List exports to XLSX.",
    ],
    files: "Customers first, then the Jobs and Invoices reports.",
    marks: ["customer name", "location address", "business unit", "job type", "technician", "invoice #", "balance"],
    slug: "servicetitan",
    checked: "partly",
    docs: ["https://help.servicetitan.com/problem-solution/what-is-the-process-for-exporting-a-list-of-customers-to-excel-in", "https://help.servicetitan.com/docs/run-report", "https://help.servicetitan.com/how-to/built-in-customer-list"],
  },
  {
    id: "WORKIZ",
    label: "Workiz",
    prefix: "WZ",
    steps: [
      "Workiz's help center shows no export of the client list to a file — so take your clients out with your jobs:",
      "Reports → Add report → Jobs; add the client fields (name, phone, email, address) and the job and money fields → Save.",
      "Open the report → Actions → Export as → CSV. Every client with a job comes in from it.",
      "Stuck? Use “Do it for me” below and send us what you have.",
    ],
    files: "The Jobs report (with the client fields).",
    marks: ["workiz", "job serial", "client id", "sub status"],
    slug: "workiz",
    checked: "no-client-export",
    docs: ["https://help.workiz.com/hc/en-us/articles/43912487947025"],
  },
  {
    id: "JOBNIMBUS",
    label: "JobNimbus",
    prefix: "JN",
    steps: [
      "Insights → Classic Reports (top right) → the three dots beside My Saved Reports → a Contact report; add the columns (name, phones, email, address) → Save.",
      "The three dots next to the report's title → Export to CSV (or Excel). You need “Export” in your access profile.",
      "Do the same with a Job, an Estimate and an Invoice report. JobNimbus has no whole-account export — a report holds only its own records.",
    ],
    files: "The Contact report first, then Job, Estimate and Invoice reports.",
    marks: ["jnid", "record type", "sales rep", "contact", "jobnimbus"],
    slug: "jobnimbus",
    checked: "partly",
    docs: ["https://support.jobnimbus.com/is-there-a-way-to-export-my-custom-reports", "https://support.jobnimbus.com/what-are-the-different-classic-reports-i-can-create", "https://support.jobnimbus.com/backup-or-copy-account-data"],
  },
  {
    id: "QUICKBOOKS",
    label: "QuickBooks",
    prefix: "QB",
    steps: [
      "QuickBooks Online: All apps → Customer Hub → Customers & leads → the Export icon (next to Print) → Export to Excel. The Balance column comes in as money owed.",
      "Estimates: All apps → Sales & Get Paid → Sales transactions → Type: Estimates, a date range → Export to Excel.",
      "Invoices: Settings ⚙ → Export data → pick a reason → Continue → the dates → Export to Excel. It comes as a .zip of Excel files — bring the invoices file from it (or send the .zip with “Do it for me”).",
    ],
    files: "Customers first, then Estimates and Invoices.",
    marks: ["open balance", "bill street", "bill city", "customer type", "full name", "customer full name"],
    slug: "quickbooks",
    checked: "partly",
    docs: ["https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/export-customer-data-excel/L0ZerVWiO_US_en_US", "https://quickbooks.intuit.com/learn-support/en-us/help-article/list-management/export-reports-lists-data-quickbooks-online/L1xleDrLp_US_en_US"],
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
    slug: null,
    checked: null,
    docs: [],
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
    slug: "spreadsheet",
    checked: null,
    docs: [],
  },
];

export const sourceInfo = (id: ImportSource): SourceInfo => IMPORT_SOURCES.find((s) => s.id === id) ?? IMPORT_SOURCES[IMPORT_SOURCES.length - 1];

export const isImportSource = (v: unknown): v is ImportSource => typeof v === "string" && IMPORT_SOURCES.some((s) => s.id === v);

/** Set by a "Switch to JobFlex" page (the program's id, 30 days): the Welcome page's "Moving from…" card reads it. */
export const MOVING_COOKIE = "jf_moving_from";

/** The program a public page's address names (/switch/housecall-pro), or null. */
export const sourceBySlug = (slug: string): SourceInfo | null => IMPORT_SOURCES.find((s) => s.slug === slug) ?? null;

/** The programs with a public /switch page, in their order. */
export const SWITCH_SOURCES: readonly SourceInfo[] = IMPORT_SOURCES.filter((s) => s.slug);

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
