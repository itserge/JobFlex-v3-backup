// WHICH COLUMN IS WHAT (2026-11-16, lib/import) — pure.
//
// Every program names its columns its own way: Housecall Pro's "Display name" and "Mobile number", Jobber's "Main
// Phone #s" and "Billing Street 1", QuickBooks' "Customer" and "Open Balance", Google's "E-mail 1 - Value". Each
// column's header is read against the names JobFlex knows for each of its fields, best match first; the contractor
// sees the result and can change any of it before anything is brought in. (A model reads the columns these rules
// leave unknown — lib/import/server — and the person still has the last word.)
//
// What a file IS follows from its columns (and its name): CLIENTS (people and places), WORK (jobs and invoices —
// dates, money, a status) or ESTIMATES (quotes).

export type FileKind = "clients" | "work" | "estimates";
export const FILE_KINDS: readonly FileKind[] = ["clients", "work", "estimates"];
export const FILE_KIND_LABEL: Record<FileKind, string> = { clients: "Clients", work: "Jobs and invoices", estimates: "Estimates and quotes" };

export type ImportField =
  // who and where
  | "name"
  | "firstName"
  | "lastName"
  | "company"
  | "email"
  | "mobile"
  | "phone"
  | "phoneOther"
  | "street"
  | "street2"
  | "city"
  | "state"
  | "zip"
  | "fullAddress"
  | "notes"
  | "tags"
  | "leadSource"
  | "clientId"
  | "doNotContact"
  | "emailOptOut"
  // the work
  | "number"
  | "title"
  | "description"
  | "status"
  | "date"
  | "endDate"
  | "doneDate"
  | "total"
  | "paid"
  | "due"
  | "paymentStatus"
  | "dueDate"
  | "paidDate"
  | "assigned"
  | "skip";

export const FIELD_LABEL: Record<ImportField, string> = {
  name: "Client name",
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  email: "Email",
  mobile: "Mobile phone",
  phone: "Phone",
  phoneOther: "Other phone",
  street: "Street",
  street2: "Apt / unit",
  city: "City",
  state: "State",
  zip: "ZIP",
  fullAddress: "Whole address",
  notes: "Notes",
  tags: "Tags",
  leadSource: "Lead source",
  clientId: "Their client number",
  doNotContact: "Do not contact",
  emailOptOut: "Unsubscribed from email",
  number: "Job / invoice number",
  title: "Job title",
  description: "Description",
  status: "Status",
  date: "Date (scheduled)",
  endDate: "End date",
  doneDate: "Date completed",
  total: "Total",
  paid: "Amount paid",
  due: "Balance due",
  paymentStatus: "Paid or not",
  dueDate: "Due date",
  paidDate: "Date paid",
  assigned: "Done by (crew)",
  skip: "Leave out",
};

/** The fields offered for each kind of file (who-and-where in every file: a job's row names its client). */
const WHO: ImportField[] = ["name", "firstName", "lastName", "company", "email", "mobile", "phone", "phoneOther", "street", "street2", "city", "state", "zip", "fullAddress", "clientId"];
export const FIELDS_FOR: Record<FileKind, readonly ImportField[]> = {
  clients: [...WHO, "notes", "tags", "leadSource", "doNotContact", "emailOptOut", "due", "skip"],
  work: [...WHO, "number", "title", "description", "status", "date", "endDate", "doneDate", "total", "paid", "due", "paymentStatus", "dueDate", "paidDate", "assigned", "notes", "skip"],
  estimates: [...WHO, "number", "title", "description", "status", "date", "total", "assigned", "notes", "skip"],
};

/** A header as the rules read it: lower case, "#" a number, every other mark a space. */
export function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/#/g, " number ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface Rule {
  field: ImportField;
  re: RegExp;
  score: number;
  /** Only in these kinds of file. */
  kinds?: FileKind[];
}

const WORKISH: FileKind[] = ["work", "estimates"];

const RULES: Rule[] = [
  // Never brought in: what JobFlex works out itself, or does not keep.
  { field: "skip", re: /^(subtotal|sub total|tax|tax amount|tax rate|sales tax|discount|discounts|fax|fax number s?|fax number|country|billing country|service country|bill country|created by|updated|updated at|last modified|modified|archived|lat|lng|latitude|longitude|map|url|link|portal link|online booking)$/, score: 99 },
  // Their number for the client.
  { field: "clientId", re: /^(customer|client|contact|account|cust) (id|number|no|ref|reference|key)$/, score: 96 },
  { field: "clientId", re: /^(jnid|customer key|client key|external id)$/, score: 90 },
  { field: "clientId", re: /^id$/, score: 50, kinds: ["clients"] },
  // The name.
  { field: "name", re: /^(display name|full name|name|customer name|client name|contact name|customer|client|contact|customer full name|client full name|account name|homeowner|homeowner name|property owner)$/, score: 95 },
  { field: "name", re: /\b(customer|client|contact|homeowner) (display )?name\b/, score: 85 },
  { field: "name", re: /^name\b/, score: 70 },
  { field: "firstName", re: /^(first name|firstname|first|given name|first name s|contact first name|customer first name|client first name)$/, score: 96 },
  { field: "lastName", re: /^(last name|lastname|last|surname|family name|contact last name|customer last name|client last name)$/, score: 96 },
  { field: "company", re: /^(company|company name|business|business name|organization|organisation|organization name|company name s|employer)$/, score: 95 },
  { field: "company", re: /\bcompany\b/, score: 65 },
  // Reach.
  { field: "doNotContact", re: /\b(do not (contact|service|call|text|email)|dnc|no contact)\b/, score: 97 },
  { field: "emailOptOut", re: /\b(unsubscribed|opted out|opt ?out|email opt ?out|marketing opt ?out|do not email|no marketing)\b/, score: 96 },
  { field: "email", re: /^(e ?mail|e ?mails|email address|email addresses|e mail address|primary email|email 1|e mail 1 value|e mail 1|e mail address|customer email|client email|contact email|billing email)$/, score: 95 },
  { field: "email", re: /\be ?mails?\b/, score: 72 },
  { field: "mobile", re: /^(mobile|mobile phone|mobile number|mobile phone number s?|mobile phone number|cell|cell phone|cell number|mobile phones|mobile phone s|customer mobile|client mobile)$/, score: 95 },
  { field: "mobile", re: /\b(mobile|cell)\b/, score: 75 },
  { field: "phone", re: /^(phone|phone number|phones|main phone|main phone number s?|main phone number|primary phone|telephone|tel|phone 1 value|phone 1|customer phone|client phone|contact phone|best phone)$/, score: 95 },
  { field: "phoneOther", re: /\b(home|work|business|office|other|alt|alternate|secondary|second) (phone|number|phone number s?|phone number)\b/, score: 88 },
  { field: "phoneOther", re: /^phone 2( value)?$/, score: 88 },
  { field: "phone", re: /\bphone\b/, score: 68 },
  // Where. A service (job site) address beats a billing one: the work happens there.
  { field: "street", re: /^(service|property|job|location|site|work) (street|street 1|address|address 1|street address|address line 1)$/, score: 97 },
  { field: "street", re: /^(address|street|street address|address 1|address line 1|street 1|street line 1|address1|address 1 street|street address line 1)$/, score: 95 },
  { field: "street", re: /^(billing|bill|mailing|bill to) (street|street 1|address|address 1|street address|address line 1)$/, score: 90 },
  { field: "street", re: /\b(street|address)\b/, score: 55 },
  { field: "street2", re: /^((service|billing|bill|property|mailing) )?(address 2|address line 2|street 2|street line 2|apt|apartment|unit|suite|address2|apt suite)$/, score: 96 },
  { field: "city", re: /^((service|billing|bill|property|location|mailing|job) )?(city|town)$|^address 1 city$/, score: 95 },
  { field: "city", re: /\bcity\b/, score: 70 },
  { field: "state", re: /^((service|billing|bill|property|location|mailing|job) )?(state|province|region|state province|state code)$|^address 1 region$/, score: 95 },
  { field: "state", re: /\b(state|province)\b/, score: 66 },
  { field: "zip", re: /^((service|billing|bill|property|location|mailing|job) )?(zip|zip code|zipcode|postal code|postcode|postal|zip postal code)$|^address 1 postal code$/, score: 95 },
  { field: "zip", re: /\b(zip|postal)\b/, score: 70 },
  { field: "fullAddress", re: /^(full address|formatted address|address 1 formatted|location address|service address|job address|property address|job site|jobsite|site address|billing address|address full)$/, score: 88 },
  // About the client.
  { field: "tags", re: /^(tags?|labels?|customer tags|client tags|groups?|customer type|client type|category)$/, score: 90, kinds: ["clients"] },
  { field: "leadSource", re: /^(lead source|source|referral source|referred by|how did you hear|how did you hear about us|marketing source|channel)$/, score: 90, kinds: ["clients"] },
  { field: "notes", re: /^(notes?|comments?|customer notes|client notes|private notes|memo|notes 1|internal notes|remarks)$/, score: 85 },
  // Money owed on a client (QuickBooks' customer list).
  { field: "due", re: /^(open balance|balance|balance due|amount due|outstanding|outstanding balance|amount owed|owed|unpaid balance)$/, score: 96 },
  // The work.
  { field: "number", re: /^(job|invoice|work order|estimate|quote|ticket|order|wo|visit|proposal) (number|no|id|num)$/, score: 96, kinds: WORKISH },
  { field: "number", re: /^(number|no|num|ref|reference|serial|job serial|invoice|estimate|quote)$/, score: 78, kinds: WORKISH },
  { field: "number", re: /^id$/, score: 50, kinds: WORKISH },
  { field: "title", re: /^(job|job title|title|job name|service|services|job type|work|subject|service type|line item|line items|item|items|product service|product|work type|trade|job category|visit title|quote title|estimate title)$/, score: 88, kinds: WORKISH },
  { field: "description", re: /^(description|job description|details|scope|scope of work|summary|work description|job notes|instructions|work performed)$/, score: 86, kinds: WORKISH },
  { field: "paymentStatus", re: /^(invoice status|payment status|paid status|payment|paid\b.*status|is paid|paid or unpaid|payment state)$/, score: 93, kinds: WORKISH },
  { field: "status", re: /^(status|job status|work status|stage|visit status|quote status|estimate status|approval status|work order status)$/, score: 90, kinds: WORKISH },
  { field: "dueDate", re: /^(due date|invoice due date|due on|payment due|payment due date|due by|due)$/, score: 97, kinds: WORKISH },
  { field: "paidDate", re: /^(paid date|paid on|date paid|payment date|paid at|last payment date|paid in full date)$/, score: 96, kinds: WORKISH },
  { field: "doneDate", re: /^(completed|completed date|completed at|completion date|finished|finished at|closed date|date completed|closed at|completed on)$/, score: 92, kinds: WORKISH },
  { field: "endDate", re: /^(scheduled end|end|end date|end time|finish|finish date|scheduled end date|end at|ends at)$/, score: 90, kinds: WORKISH },
  { field: "date", re: /^(scheduled start|scheduled start date|scheduled start time|start|start date|start time|starts at|start at)$/, score: 96, kinds: WORKISH },
  { field: "date", re: /^(job date|visit date|appointment|appointment date|scheduled|scheduled date|schedule|service date|scheduled for|date scheduled)$/, score: 93, kinds: WORKISH },
  { field: "date", re: /^(date|invoice date|issued date|issue date|issued|estimate date|quote date|sent date|date sent|created|created date|created at|date created|created on|transaction date)$/, score: 80, kinds: WORKISH },
  { field: "total", re: /^(total|job total|total amount|invoice total|grand total|total price|estimate total|quote total|total due|invoice amount|job amount|amount total)$/, score: 93, kinds: WORKISH },
  { field: "total", re: /^(amount|price|revenue|value|sales|amount billed|billed)$/, score: 84, kinds: WORKISH },
  { field: "paid", re: /^(amount paid|paid|paid amount|total paid|payments|payment amount|collected|amount collected|payments received|received)$/, score: 93, kinds: WORKISH },
  { field: "due", re: /^(balance|balance due|amount due|outstanding|outstanding balance|open balance|remaining|remaining balance|unpaid|unpaid amount|amount owed|owed|due amount)$/, score: 96, kinds: WORKISH },
  { field: "assigned", re: /^(assigned|assigned to|assigned employee|assigned employees|employee|employees|technician|technicians|tech|techs|crew|team|assigned team member|assigned team members|visit assigned to|salesperson|sales rep|rep|pro|pros|installer|lead tech)$/, score: 90, kinds: WORKISH },
];

/** The best field for one header in one kind of file, and how sure: 0 = none. */
export function fieldOf(header: string, kind: FileKind): { field: ImportField; score: number } {
  const h = normHeader(header);
  let best: { field: ImportField; score: number } = { field: "skip", score: 0 };
  if (!h) return best;
  for (const r of RULES) {
    if (r.kinds && !r.kinds.includes(kind)) continue;
    if (!FIELDS_FOR[kind].includes(r.field)) continue;
    if (r.score > best.score && r.re.test(h)) best = { field: r.field, score: r.score };
  }
  return best;
}

/** Fields a file may carry more than once (several phones, several notes) — the rest go to one column only. */
const MANY: ReadonlySet<ImportField> = new Set<ImportField>(["phoneOther", "notes", "tags", "skip", "email"]);

/**
 * Every column's field in one kind of file: each header's best, and where two columns want one field the surer one
 * keeps it (the other is left out — an alternate phone becomes "Other phone").
 */
export function mapColumns(headers: readonly string[], kind: FileKind): ImportField[] {
  const guesses = headers.map((h) => fieldOf(h, kind));
  const taken = new Map<ImportField, number>();
  guesses.forEach((g, i) => {
    if (!g.score || MANY.has(g.field)) return;
    const at = taken.get(g.field);
    if (at === undefined || guesses[at].score < g.score) taken.set(g.field, i);
  });
  return guesses.map((g, i) => {
    if (!g.score) return "skip";
    if (MANY.has(g.field)) return g.field;
    if (taken.get(g.field) === i) return g.field;
    // A second phone column is another phone; a second address is left out.
    if (g.field === "phone" || g.field === "mobile") return "phoneOther";
    return "skip";
  });
}

/** What a file is, from its name and its columns. */
export function kindOf(fileName: string, headers: readonly string[]): FileKind {
  const name = fileName.toLowerCase();
  const hs = headers.map(normHeader);
  if (/estimate|quote|proposal|\bbids?\b/.test(name) || hs.some((h) => /^(estimate|quote|proposal)\b|\b(estimate|quote) (number|status|total|date|title)\b/.test(h))) return "estimates";
  if (/invoice|\bjobs?\b|work ?orders?|visits?|tickets?|appointments?|schedule/.test(name)) return "work";
  const asWork = mapColumns(headers, "work");
  const has = (f: ImportField) => asWork.includes(f);
  const money = has("total") || has("paid") || has("paymentStatus");
  const work = has("title") || has("number") || has("status") || has("date") || has("description");
  // A client list may carry an open balance (QuickBooks): money alone does not make jobs.
  if ((money && work) || (has("date") && (has("status") || has("title")))) return "work";
  return "clients";
}

/** The fields a file of this kind cannot do without — named for the person when missing. */
export function missingFields(kind: FileKind, map: readonly ImportField[]): string[] {
  const has = (f: ImportField) => map.includes(f);
  const out: string[] = [];
  const who = has("name") || has("firstName") || has("lastName") || has("company");
  if (kind === "clients" && !who && !has("email") && !has("phone") && !has("mobile")) out.push("a client name, email or phone");
  if (kind !== "clients" && !who && !has("clientId") && !has("email") && !has("phone") && !has("mobile")) out.push("which client each row is for (a name, their client number, an email or a phone)");
  if (kind === "work" && !has("date") && !has("doneDate") && !has("total") && !has("due") && !has("paid")) out.push("a date or an amount");
  return out;
}
