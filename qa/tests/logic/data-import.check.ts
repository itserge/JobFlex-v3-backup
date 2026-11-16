// BRING YOUR CLIENTS (2026-11-16; lib/import) — the owner: "offer me a plan how to move contractors' CRM base with
// clients to JobFlex from other platforms like Housecall Pro or others"; parts 1 + 2 built: a contractor's exported
// files (CSV or Excel, from Housecall Pro, Jobber, ServiceTitan, QuickBooks, Google Contacts or a spreadsheet) read
// into clients — one per person, joined to clients already in JobFlex — and their work: upcoming jobs on the calendar,
// money still owed as open invoices, the rest as each client's history. The pure rules, proved here.
//   npx --no-install tsx --tsconfig tsconfig.json qa/tests/logic/data-import.check.ts
import { MAX_TABLE_ROWS, parseDelimited, tableOf } from "@/lib/import/table";
import { fieldOf, kindOf, mapColumns, missingFields, normHeader } from "@/lib/import/columns";
import { emailsIn, estimateState, moneyOf, payState, phoneKey, phonesIn, splitAddress, wallDateOf, workState } from "@/lib/import/values";
import { sourceOfHeaders } from "@/lib/import/sources";
import { planImport, type ExistingClient, type ImportFile, type PlanContext } from "@/lib/import/plan";

let bad = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || detail === "" ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

/* ── 1. A file as a table ──────────────────────────────────────────────── */
{
  const t = parseDelimited('﻿Name,Notes,Phone\r\n"Smith, John","Said ""call after 5""\nGate code 1234",555-201-3344\r\n\r\nAna Diaz,,(555) 201-9988\r\n');
  check("CSV: the byte-order mark gone, a comma and a line break inside quotes kept, doubled quotes read as one, empty rows dropped", t.headers.join("|") === "Name|Notes|Phone" && t.rows.length === 2 && t.rows[0][0] === "Smith, John" && t.rows[0][1] === 'Said "call after 5" Gate code 1234' && t.rows[1][2] === "(555) 201-9988", t);
  const semi = parseDelimited("Client;Email;Balance\nBob Lee;bob@x.com;1.250,00\n");
  check("a semicolon file (Europe's Excel) is found to be one", semi.headers.length === 3 && semi.rows[0][1] === "bob@x.com");
  const report = parseDelimited("Jobs report\nNov 1 2026 - Nov 30 2026\n\nJob #,Customer,Total,Status\n101,Ann Fox,$450.00,Completed\nJob #,Customer,Total,Status\n102,Bo Diaz,$90,Scheduled\n");
  check("a report's title lines above the table are stepped over, and a header printed again on a later page is no row", report.headers.join("|") === "Job #|Customer|Total|Status" && report.rows.length === 2 && report.rows[1][1] === "Bo Diaz", report);
  const ragged = tableOf([["First", "Last", "Email", ""], ["Al", "Ng", "al@x.com"], ["Bea", "Ott", "", ""]]);
  check("rows padded to the header's width; an empty last header with nothing under it is no column", ragged.headers.length === 3 && ragged.rows.every((r) => r.length === 3));
  const dup = tableOf([["Phone", "Phone", "Name"], ["1", "2", "x"]]);
  check("two columns of one name are told apart", dup.headers[1] === "Phone (2)");
  const lines = (n: number) => `Name,Phone\n${Array.from({ length: n }, (_, i) => `P${i},555-201-${String(i % 10000).padStart(4, "0")}`).join("\n")}\n`;
  const long = parseDelimited(lines(MAX_TABLE_ROWS + 10));
  const exact = parseDelimited(lines(MAX_TABLE_ROWS));
  check("a file longer than one import reads: the first rows read, and the table says there are more (never cut silently)", long.rows.length === MAX_TABLE_ROWS && long.more === true && exact.rows.length === MAX_TABLE_ROWS && !exact.more, { long: long.rows.length, more: long.more, exact: exact.more });
}

/* ── 2. Which column is what ───────────────────────────────────────────── */
{
  const hcp = ["Customer ID", "Display name", "First name", "Last name", "Company", "Mobile number", "Home number", "Email", "Street", "Street line 2", "City", "State", "Zip", "Customer tags", "Lead source", "Notes"];
  const m = mapColumns(hcp, "clients");
  check("a Housecall Pro customer list: its number, name, phones (the second an other phone), address, tags, lead source, notes", m.join() === "clientId,name,firstName,lastName,company,mobile,phoneOther,email,street,street2,city,state,zip,tags,leadSource,notes", m);
  const jobber = ["Display Name", "Company Name", "First Name", "Last Name", "E-mails", "Main Phone #s", "Mobile Phone #s", "Billing Street 1", "Billing City", "Billing State", "Billing Zip code", "Service Street 1", "Service City", "Tags"];
  const jm = mapColumns(jobber, "clients");
  check("a Jobber client list: E-mails, Main and Mobile phone #s; the SERVICE street wins over the billing one (the work is done there)", jm[4] === "email" && jm[5] === "phone" && jm[6] === "mobile" && jm[11] === "street" && jm[7] === "skip" && jm[13] === "tags", jm);
  const qb = ["Customer", "Company", "Phone", "Email", "Bill Street", "Bill City", "Bill State", "Bill Zip", "Open Balance"];
  check("QuickBooks: Customer is the name, Open Balance money owed", mapColumns(qb, "clients").join() === "name,company,phone,email,street,city,state,zip,due");
  const google = ["Given Name", "Family Name", "E-mail 1 - Value", "Phone 1 - Value", "Address 1 - Street", "Address 1 - City", "Address 1 - Region", "Address 1 - Postal Code"];
  check("Google Contacts' own column names", mapColumns(google, "clients").join() === "firstName,lastName,email,phone,street,city,state,zip");
  const jobs = ["Job #", "Customer", "Customer email", "Job description", "Scheduled start", "Scheduled end", "Completed date", "Status", "Assigned employees", "Total amount", "Amount paid", "Outstanding balance", "Due date", "Subtotal", "Tax"];
  const w = mapColumns(jobs, "work");
  check("a jobs export: number, client, dates, status, crew, total, paid, balance, due date — subtotal and tax left out", w.join() === "number,name,email,description,date,endDate,doneDate,status,assigned,total,paid,due,dueDate,skip,skip", w);
  check("a work file's \"State\" is the address's, not the job's status", fieldOf("State", "work").field === "state" && fieldOf("Status", "work").field === "status");
  check("the header read loosely: \"Main Phone #s\" → \"main phone number s\"", normHeader("Main Phone #s") === "main phone number s");
  check("what a file is, by its name or its columns: customers / jobs / estimates", kindOf("customers.csv", hcp) === "clients" && kindOf("export.csv", jobs) === "work" && kindOf("estimates-2026.csv", ["Customer", "Total"]) === "estimates" && kindOf("data.csv", ["Quote #", "Client name", "Total"]) === "estimates" && kindOf("Invoice List.csv", ["Customer", "Amount"]) === "work");
  check("a client list with an open balance is still a client list", kindOf("customers.xlsx", qb) === "clients");
  check("what a file cannot do without is named", missingFields("clients", ["notes", "skip"]).length === 1 && missingFields("work", ["total", "date"])[0].startsWith("which client") && missingFields("work", ["name", "status"])[0] === "a date or an amount");
  check("the program a file comes from, by two of its own column names", sourceOfHeaders(jobber) === "JOBBER" && sourceOfHeaders(hcp) === "HOUSECALL_PRO" && sourceOfHeaders(google) === "CONTACTS" && sourceOfHeaders(["Name", "Phone"]) === null);
}

/* ── 3. A cell's value ─────────────────────────────────────────────────── */
{
  check("a phone's last ten digits; with or without its 1", phoneKey("+1 (555) 201-3344") === "5552013344" && phoneKey("555.201.3344") === "5552013344" && phoneKey("12") === null);
  check("several phones in one cell, labels gone, an extension kept with its number", JSON.stringify(phonesIn("Mobile: (555) 201-3344, Home: 555-201-9988")) === JSON.stringify(["(555) 201-3344", "555-201-9988"]) && phonesIn("555-201-3344 ext 12").length === 1);
  check("several emails in one cell, lower case", JSON.stringify(emailsIn("Bob@X.com; ann.lee@y.co")) === JSON.stringify(["bob@x.com", "ann.lee@y.co"]));
  check("money: $1,234.50 · 1234.5 · (250.00) owed back · nothing", moneyOf("$1,234.50") === 1234.5 && moneyOf("1234.5") === 1234.5 && moneyOf("(250.00)") === -250 && moneyOf("") === null && moneyOf("n/a") === null);
  const d = (s: string) => {
    const w = wallDateOf(s);
    return w ? `${w.y}-${w.m}-${w.d}${w.timed ? ` ${w.h}:${w.min}` : ""}` : null;
  };
  check("dates as the programs write them", d("2026-11-20") === "2026-11-20" && d("11/20/2026 9:00 AM") === "2026-11-20 9:0" && d("11/20/26") === "2026-11-20" && d("Nov 20, 2026") === "2026-11-20" && d("Friday, November 20th 2026 at 2:30 PM") === "2026-11-20 14:30" && d("20 Nov 2026") === "2026-11-20" && d("46346") === "2026-11-20" && d("tomorrow") === null && d("13/45/2026") === null, [d("Friday, November 20th 2026 at 2:30 PM"), d("46346")]);
  check("a job's state from its status words", workState("Completed") === "done" && workState("Scheduled") === "open" && workState("In progress") === "open" && workState("Canceled") === "canceled" && workState("Needs scheduling") === "open" && workState("") === null);
  check("paid or not", payState("Paid") === "paid" && payState("Unpaid") === "unpaid" && payState("Partially paid") === "partial" && payState("Overdue") === "unpaid" && payState("Yes") === "paid");
  check("an estimate's outcome", estimateState("Approved") === "approved" && estimateState("Converted to job") === "approved" && estimateState("Declined") === "declined" && estimateState("Sent") === "open");
  check("a whole address in one cell, split", JSON.stringify(splitAddress("123 Main St, Springfield, IL 62704")) === JSON.stringify({ street: "123 Main St", city: "Springfield", state: "IL", zip: "62704" }) && splitAddress("Lot 4 by the barn") === null);
}

/* ── 4. What comes in ──────────────────────────────────────────────────── */
const NOW = new Date("2026-11-16T15:00:00Z");
const file = (name: string, kind: ImportFile["kind"], rows: string[][]): ImportFile => {
  const t = tableOf(rows);
  return { name, kind, map: mapColumns(t.headers, kind), table: t };
};
const existing: ExistingClient[] = [{ id: "cEXIST1", name: "Maria Lopez", email: "maria@lopez.com", phone: null, address: null, city: null, state: null, zip: null, notes: null, importKey: null }];
const ctx = (files: ImportFile[], over: Partial<PlanContext> = {}): PlanContext => ({ source: "HOUSECALL_PRO", files, existing, timeZone: "America/Chicago", now: NOW, invoiceNumbers: new Set(), keys: new Set(), ...over });

const customers = file("customers.csv", "clients", [
  ["Customer ID", "Display name", "Company", "Mobile number", "Home number", "Email", "Street", "City", "State", "Zip", "Customer tags", "Notes", "Do not service"],
  ["1001", "John Smith", "", "(555) 201-3344", "555-201-0000", "john@smith.com", "12 Oak St", "Austin", "TX", "78701", "VIP, Repeat", "Dog in yard", ""],
  ["1002", "Maria Lopez", "", "555-301-4455", "", "MARIA@lopez.com", "8 Elm Rd", "Austin", "TX", "78702", "", "", ""],
  ["1003", "J. Smith", "", "+1 555 201 3344", "", "", "", "", "", "", "", "Same phone as John", ""],
  ["1004", "Lake HOA", "Lake HOA", "555-401-1212", "", "board@lakehoa.org", "1 Lake Dr", "Round Rock", "TX", "78664", "Commercial", "", "yes"],
  ["", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["1005", "", "", "", "", "", "", "", "", "", "", "orphan note", ""],
]);
const jobsFile = file("jobs.csv", "work", [
  ["Job #", "Customer ID", "Customer", "Customer phone", "Job description", "Scheduled start", "Scheduled end", "Completed date", "Status", "Assigned employees", "Total amount", "Amount paid", "Outstanding balance", "Due date"],
  ["H-101", "1001", "John Smith", "", "Water heater install", "10/02/2026 8:00 AM", "", "10/02/2026", "Completed", "Mike", "$2,450.00", "$2,450.00", "$0.00", ""],
  ["H-102", "1001", "John Smith", "", "Drain repair", "10/20/2026", "", "10/21/2026", "Completed", "Mike, Ana", "$800", "$300", "$500", "11/05/2026"],
  ["H-103", "1002", "Maria Lopez", "", "Annual tune-up", "11/20/2026 9:00 AM", "11/20/2026 11:30 AM", "", "Scheduled", "Ana", "$189", "", "", ""],
  ["H-104", "", "Pat Green", "555-777-8888", "Roof leak check", "", "", "", "Needs scheduling", "", "", "", "", ""],
  ["H-105", "1004", "Lake HOA", "", "Gutter clean", "09/01/2026", "", "", "Canceled", "", "$300", "", "", ""],
  ["H-106", "", "", "", "Mystery", "09/02/2026", "", "", "Completed", "", "$50", "", "", ""],
  ["H-107", "", "Maria Lopez", "", "Faucet", "08/01/2026", "", "08/01/2026", "Completed", "", "$120", "", "", ""],
]);
const plan = planImport(ctx([jobsFile, customers]));
const byName = (n: string) => plan.clients.find((c) => c.data.name === n || (c.existingId && c.data.name === n));
const john = byName("John Smith");
const maria = plan.clients.find((c) => c.existingId === "cEXIST1");
const hoa = byName("Lake HOA");
check("the customer file read first (whatever order the files came in): John, Lake HOA and Pat (from a job row) are new", plan.counts.newClients === 3 && !!john && !!hoa && !!byName("Pat Green"), plan.clients.map((c) => c.data.name));
check("\"J. Smith\" with John's phone is John — one client, his notes added", !byName("J. Smith") && (john?.data.notes ?? "").includes("Same phone as John") && (john?.data.notes ?? "").includes("Dog in yard"), john?.data.notes);
check("Maria, already in JobFlex (her email, any case), is JOINED: keeps her record, gets only her empty fields", plan.counts.joined === 1 && !!maria && maria.fill.phone === "555-301-4455" && maria.fill.address === "8 Elm Rd" && maria.fill.email === undefined && maria.importKey === "HCP:client:1002", maria);
check("John: his mobile first, his home phone in notes, tags kept, his number in the other program kept", john?.data.phone === "(555) 201-3344" && (john?.data.notes ?? "").includes("Other phone: 555-201-0000") && JSON.stringify(john?.tags) === JSON.stringify(["VIP", "Repeat"]) && john?.importKey === "HCP:client:1001", john);
check("\"Do not service: yes\" → do not contact, and off this company's email list", !!hoa?.doNotContact && !!hoa?.emailOptOut);
check("an empty row is dropped; a row with no name, email or phone is skipped and said why, by its line in the file", plan.skipped.some((s) => s.file === "customers.csv" && s.row === 7 && /no name/.test(s.why)) && plan.skipped.filter((s) => s.file === "customers.csv").length === 1, plan.skipped);
const hist = (n: string | null) => plan.history.find((h) => h.number === n);
check("a past job, done and paid: John's history — paid $2,450, done by Mike, dated the day it was done", hist("H-101")?.client === john?.ref && hist("H-101")?.paid === 2450 && hist("H-101")?.due === 0 && hist("H-101")?.by === "Mike" && hist("H-101")?.status === "done · paid" && hist("H-101")?.date?.toISOString() === "2026-10-02T17:00:00.000Z", hist("H-101"));
const inv = plan.invoices.find((v) => v.number === "HCP-H-102");
check("a past job with a balance: history (partly paid) AND an open invoice for what is still owed, under its own number", hist("H-102")?.status === "done · partly paid" && !!inv && inv.amount === 500 && inv.billed === 800 && inv.client === john?.ref && inv.dueDate?.toISOString() === "2026-11-05T18:00:00.000Z", [hist("H-102"), inv]);
const tune = plan.jobs.find((j) => j.title === "Annual tune-up");
check("a job scheduled ahead: a JOB on Maria's calendar, 9:00–11:30 on the company's clock (Chicago)", !!tune && tune.client === "cEXIST1" && tune.startsAt?.toISOString() === "2026-11-20T15:00:00.000Z" && tune.endsAt?.toISOString() === "2026-11-20T17:30:00.000Z" && /Ana/.test(tune.notes ?? "") && /Housecall Pro #H-103/.test(tune.notes ?? ""), tune);
const leak = plan.jobs.find((j) => j.title === "Roof leak check");
check("an open job with no date yet: a job, not scheduled — for Pat, a new client from the row's own name and phone", !!leak && leak.startsAt === null && leak.client === byName("Pat Green")?.ref && byName("Pat Green")?.data.phone === "555-777-8888");
check("a canceled job is history, canceled — never owed", hist("H-105")?.status === "canceled" && !plan.invoices.some((v) => v.number === "HCP-H-105"));
check("a row with no client is skipped and said why", plan.skipped.some((s) => s.file === "jobs.csv" && /no client/.test(s.why)));
check("owed is never guessed from a total alone: a done job with only a total is history, no invoice", hist("H-107")?.client === "cEXIST1" && hist("H-107")?.due === null && !plan.invoices.some((v) => v.number === "HCP-H-107"), hist("H-107"));
check("the counts", plan.counts.upcoming === 1 && plan.counts.unscheduled === 1 && plan.counts.invoices === 1 && plan.counts.owed === 500 && plan.counts.history === 4 && plan.counts.paid === 2750, plan.counts);

/* ── 5. The same files again ───────────────────────────────────────────── */
{
  const keys = new Set([...plan.jobs, ...plan.invoices, ...plan.history].map((x) => x.importKey));
  const ex2: ExistingClient[] = [...existing, ...plan.clients.filter((c) => !c.existingId).map((c, i) => ({ id: `cNEW${i}`, ...c.data, importKey: c.importKey }))];
  const again = planImport(ctx([customers, jobsFile], { existing: ex2, keys, invoiceNumbers: new Set(plan.invoices.map((v) => v.number)) }));
  check("brought in twice: no new clients, no job, invoice or history twice — every row \"already brought in\"", again.counts.newClients === 0 && again.jobs.length === 0 && again.invoices.length === 0 && again.history.length === 0 && again.counts.again === 7, again.counts);
  const clash = planImport(ctx([jobsFile], { invoiceNumbers: new Set(["HCP-H-102"]) }));
  check("an invoice number the company already has is never written twice", !clash.invoices.some((v) => v.number === "HCP-H-102"));
}

/* ── 6. Estimates, invoices, a QuickBooks list ─────────────────────────── */
{
  const est = file("estimates.csv", "estimates", [
    ["Estimate #", "Customer", "Email", "Status", "Total", "Created"],
    ["E-9", "Ann Fox", "ann@fox.com", "Approved", "$12,000", "06/01/2026"],
    ["E-10", "Ann Fox", "ann@fox.com", "Declined", "$3,000", "06/05/2026"],
  ]);
  const p = planImport(ctx([est], { source: "JOBBER" }));
  check("estimates: each the client's history, approved or declined, with its total — one client for both rows", p.history.length === 2 && p.history[0].kind === "ESTIMATE" && p.history[0].status === "approved" && p.history[1].status === "declined" && p.history[0].amount === 12000 && p.counts.newClients === 1 && p.invoices.length === 0);
  const invFile = file("Invoices report.csv", "work", [
    ["Invoice #", "Client name", "Issued date", "Due date", "Total", "Balance", "Status"],
    ["1201", "Bob Lee", "10/01/2026", "10/31/2026", "$900.00", "$900.00", "Awaiting payment"],
    ["1202", "Bob Lee", "09/01/2026", "09/30/2026", "$400.00", "$0.00", "Paid"],
  ]);
  const q = planImport(ctx([invFile], { source: "JOBBER" }));
  check("an invoices report: an unpaid invoice is open in JobFlex (JOB-1201, $900); a paid one is history — no job is made", q.invoices.length === 1 && q.invoices[0].number === "JOB-1201" && q.invoices[0].amount === 900 && q.history.length === 2 && q.history.every((h) => h.kind === "INVOICE") && q.jobs.length === 0, [q.invoices, q.history.map((h) => h.status)]);
  const qbFile = file("Customers.csv", "clients", [
    ["Customer", "Phone", "Email", "Open Balance"],
    ["Dana Kim", "555-900-1000", "dana@kim.com", "1,250.00"],
    ["Eli Ross", "555-900-2000", "", "0.00"],
  ]);
  const r = planImport(ctx([qbFile], { source: "QUICKBOOKS" }));
  check("a QuickBooks customer list's open balance is money owed: one opening-balance invoice, none for $0", r.invoices.length === 1 && r.invoices[0].amount === 1250 && r.invoices[0].number === "QB-BAL-1" && r.invoices[0].title === "Opening balance");
  const plain = file("my clients.csv", "clients", [["Name", "Cell", "Address"], ["Gus Hall", "555 123 4567", "77 Pine Ave, Dallas, TX 75201"]]);
  const s = planImport(ctx([plain], { source: "OTHER" }));
  check("a spreadsheet of the contractor's own: the whole address in one cell split into street, city, state, ZIP", s.clients[0]?.data.address === "77 Pine Ave" && s.clients[0]?.data.city === "Dallas" && s.clients[0]?.data.state === "TX" && s.clients[0]?.data.zip === "75201", s.clients[0]);
}

console.log(bad ? `\n${bad} FAILED` : "\nALL PASS");
process.exit(bad ? 1 : 0);
