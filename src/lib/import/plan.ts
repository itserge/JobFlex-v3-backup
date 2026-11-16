// WHAT COMES IN, ROW BY ROW (2026-11-16 — the owner: "offer me a plan how to move contractors' CRM base with clients
// to JobFlex from other platforms like Housecall Pro or others"; parts 1 and 2: clients, then their history) — pure.
//
// The contractor's files, read and matched (lib/import/table, columns, values), against the clients already in
// JobFlex. Nothing here writes; lib/import/server writes the plan this returns, and the preview shows its counts.
//
// CLIENTS. One client per person: a row whose phone, email, their client number, or name and street match a client
// already in JobFlex (or an earlier row) JOINS that client instead of making a second — an existing client keeps its
// own name and gets only the fields it had empty. Other phones and emails, the company, the lead source go to notes;
// the file's tags come along; "do not contact" becomes a tag, "unsubscribed" this company's email opt-out.
//
// THE WORK (a jobs or invoices file — Housecall Pro's Jobs export is both — and estimates). Each row finds its client
// the same way (a job's row names its customer; one with no client of its own makes one). Then:
//   · a job still open and dated today or later — or open with no date yet — is a JOB in JobFlex, on the calendar;
//   · everything else is the client's HISTORY (ClientHistory): what was done, when, for how much, by whom, paid or not;
//   · money still owed is an INVOICE (open, "HCP-1042"), so "who owes money" is right from day one. Owed is never
//     guessed from a total alone: a balance column, a total less what was paid, or a row marked unpaid says it.
// Nothing here sends anything, and nothing a person does on a job (a review request, a reminder) is started by it.
// A file brought in twice adds nothing twice: every job, invoice and history row carries a key from the other
// program's own number, and a key already in the book is left out ("already brought in").

import type { Table } from "./table";
import type { FileKind, ImportField } from "./columns";
import { sourceInfo, type ImportSource } from "./sources";
import { emailsIn, estimateState, instantOf, looseKey, moneyOf, payState, phoneKey, phonesIn, splitAddress, truthy, wallDateOf, workState, type WallDate } from "./values";
import { zonedInstant, zonedParts } from "../booking";

export interface ImportFile {
  name: string;
  kind: FileKind;
  /** Each column's field. */
  map: ImportField[];
  table: Table;
}

export interface ExistingClient {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
  importKey: string | null;
}

export interface PlanContext {
  source: ImportSource;
  files: ImportFile[];
  existing: ExistingClient[];
  timeZone: string;
  now: Date;
  /** The company's invoice numbers. */
  invoiceNumbers: ReadonlySet<string>;
  /** Keys already in the book (jobs, invoices, history from an earlier import). */
  keys: ReadonlySet<string>;
}

export interface ClientFields {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  notes: string | null;
}

export interface PlanClient {
  /** "n1", "n2"… for a new client; the client's id for one already in JobFlex. */
  ref: string;
  existingId: string | null;
  /** A new client's fields. */
  data: ClientFields;
  /** A client already in JobFlex: the fields it had empty that this brings. */
  fill: Partial<ClientFields>;
  importKey: string | null;
  tags: string[];
  doNotContact: boolean;
  emailOptOut: boolean;
}

export interface PlanJob {
  client: string;
  title: string;
  notes: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  importKey: string;
}

export interface PlanInvoice {
  client: string;
  number: string;
  /** What is still owed. */
  amount: number;
  /** What the client was billed, when the file says. */
  billed: number | null;
  dueDate: Date | null;
  issuedAt: Date | null;
  title: string;
  importKey: string;
}

export type HistoryKind = "JOB" | "INVOICE" | "ESTIMATE";

export interface PlanHistory {
  client: string;
  kind: HistoryKind;
  number: string | null;
  title: string;
  /** done · canceled · open · approved · declined, with paid · unpaid · partly paid. */
  status: string | null;
  amount: number | null;
  paid: number | null;
  due: number | null;
  date: Date | null;
  by: string | null;
  notes: string | null;
  importKey: string;
}

export interface PlanSkip {
  file: string;
  /** The row's number as the file shows it (the header is row 1). */
  row: number;
  why: string;
}

export interface PlanCounts {
  newClients: number;
  joined: number;
  upcoming: number;
  unscheduled: number;
  invoices: number;
  owed: number;
  history: number;
  paid: number;
  skipped: number;
  again: number;
}

export interface ImportPlan {
  clients: PlanClient[];
  jobs: PlanJob[];
  invoices: PlanInvoice[];
  history: PlanHistory[];
  skipped: PlanSkip[];
  counts: PlanCounts;
}

const LIMIT: Record<keyof ClientFields, number> = { name: 120, email: 200, phone: 40, address: 200, city: 80, state: 40, zip: 20, notes: 4000 };
const clip = (k: keyof ClientFields, v: string | null) => (v ? v.slice(0, LIMIT[k]).trim() || null : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A row's cells by field: the first that has something, or all of them. */
function reader(map: readonly ImportField[], row: readonly string[]) {
  const all = (f: ImportField) => map.flatMap((m, i) => (m === f && row[i] ? [row[i]] : []));
  return { get: (f: ImportField): string | null => all(f)[0] ?? null, all };
}

/** A small stable hash of a row's words — a key for a row with no number of its own. */
function hashOf(parts: readonly (string | null)[]): string {
  let h = 2166136261;
  for (const ch of parts.map((p) => p ?? "").join("\u0001")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

interface Contact {
  fields: ClientFields;
  phones: string[];
  emails: string[];
  clientNo: string | null;
  tags: string[];
  dnc: boolean;
  optOut: boolean;
  due: number | null;
}

/** The person a row names: their name, how to reach them, where they are. */
function contactOf(get: (f: ImportField) => string | null, all: (f: ImportField) => string[]): Contact | null {
  const emails = [...new Set(all("email").flatMap(emailsIn))];
  const phoneCells = [...all("mobile"), ...all("phone"), ...all("phoneOther")].flatMap(phonesIn);
  const phones: string[] = [];
  const seen = new Set<string>();
  for (const p of phoneCells) {
    const k = phoneKey(p);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    phones.push(p);
  }
  const first = get("firstName");
  const last = get("lastName");
  const person = [first, last].filter(Boolean).join(" ").trim() || null;
  const company = get("company");
  let name = get("name") ?? person ?? company;
  if (!name && emails[0]) name = emails[0].split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  if (!name && phones[0]) name = phones[0];
  if (!name) return null;
  const notes: string[] = [...all("notes")];
  if (company && company.toLowerCase() !== name.toLowerCase() && !name.toLowerCase().includes(company.toLowerCase())) notes.push(`Company: ${company}`);
  if (person && get("name") && person.toLowerCase() !== name.toLowerCase() && !name.toLowerCase().includes(person.toLowerCase())) notes.push(`Contact: ${person}`);
  if (phones.length > 1) notes.push(`Other phone${phones.length > 2 ? "s" : ""}: ${phones.slice(1).join(", ")}`);
  if (emails.length > 1) notes.push(`Other email${emails.length > 2 ? "s" : ""}: ${emails.slice(1).join(", ")}`);
  const source = get("leadSource");
  if (source) notes.push(`Lead source: ${source}`);
  // Where: a street (with its unit), or one cell with the whole address.
  let street = [get("street"), get("street2")].filter(Boolean).join(", ") || null;
  let city = get("city");
  let state = get("state");
  let zip = get("zip");
  const whole = get("fullAddress");
  if (whole && !street) {
    const parts = splitAddress(whole);
    if (parts) {
      street = parts.street;
      city = city ?? parts.city;
      state = state ?? parts.state;
      zip = zip ?? parts.zip;
    } else street = whole;
  } else if (street && !city) {
    const parts = splitAddress(street);
    if (parts) ({ street, city, state, zip } = { street: parts.street, city: parts.city, state: state ?? parts.state, zip: zip ?? parts.zip });
  }
  const tags = [
    ...new Set(
      all("tags")
        .flatMap((t) => t.split(/[,;|]/))
        .map((t) => t.trim())
        .filter((t) => t && t.length <= 30),
    ),
  ].slice(0, 6);
  const dnc = all("doNotContact").some(truthy);
  return {
    fields: {
      name: clip("name", name) ?? name.slice(0, 120),
      email: clip("email", emails[0] ?? null),
      phone: clip("phone", phones[0] ?? null),
      address: clip("address", street),
      city: clip("city", city),
      state: clip("state", state),
      zip: clip("zip", zip),
      notes: clip("notes", notes.join("\n") || null),
    },
    phones,
    emails,
    clientNo: get("clientId"),
    tags,
    dnc,
    optOut: dnc || all("emailOptOut").some(truthy),
    due: moneyOf(get("due")),
  };
}

/** The import: every file's rows, in order — the client files first — matched and sorted into what comes in. */
export function planImport(ctx: PlanContext): ImportPlan {
  const info = sourceInfo(ctx.source);
  const prefix = info.prefix;
  const clients: PlanClient[] = [];
  const byRef = new Map<string, PlanClient>();
  const byKey = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  const byNameStreet = new Map<string, string>();
  const byName = new Map<string, Set<string>>();
  const existingById = new Map(ctx.existing.map((e) => [e.id, e]));

  const index = (ref: string, f: { name: string; email: string | null; phone: string | null; address: string | null }, phones: string[], emails: string[], key: string | null) => {
    if (key && !byKey.has(key)) byKey.set(key, ref);
    for (const p of [f.phone, ...phones]) {
      const k = phoneKey(p);
      if (k && !byPhone.has(k)) byPhone.set(k, ref);
    }
    for (const e of [f.email, ...emails]) if (e && !byEmail.has(e.toLowerCase())) byEmail.set(e.toLowerCase(), ref);
    const n = looseKey(f.name);
    if (n && f.address) {
      const ns = `${n}|${looseKey(f.address)}`;
      if (!byNameStreet.has(ns)) byNameStreet.set(ns, ref);
    }
    if (n) byName.set(n, (byName.get(n) ?? new Set()).add(ref));
  };
  for (const e of ctx.existing) index(e.id, e, [], [], e.importKey);

  const clientKey = (no: string | null) => (no ? `${prefix}:client:${no.trim().toLowerCase()}` : null);
  /** The client a contact is: by their client number, a phone, an email, name and street — or by name alone (work rows). */
  const find = (c: Contact, byNameAlone: boolean): string | null => {
    const key = clientKey(c.clientNo);
    if (key && byKey.has(key)) return byKey.get(key)!;
    for (const p of c.phones) {
      const k = phoneKey(p);
      if (k && byPhone.has(k)) return byPhone.get(k)!;
    }
    for (const e of c.emails) if (byEmail.has(e)) return byEmail.get(e)!;
    const n = looseKey(c.fields.name);
    if (n && c.fields.address) {
      const ns = byNameStreet.get(`${n}|${looseKey(c.fields.address)}`);
      if (ns) return ns;
    }
    if (byNameAlone && n) {
      const named = byName.get(n);
      if (named && named.size === 1) return [...named][0];
    }
    return null;
  };

  let newCount = 0;
  const FILLABLE: Array<keyof ClientFields> = ["email", "phone", "address", "city", "state", "zip"];
  /** The client a row is for: one already in the plan or the book (joined), or a new one. */
  const take = (c: Contact, byNameAlone: boolean): PlanClient => {
    const ref = find(c, byNameAlone);
    if (ref) {
      let pc = byRef.get(ref);
      const existing = existingById.get(ref);
      if (!pc) {
        pc = { ref, existingId: existing ? existing.id : null, data: existing ? { ...existing } : c.fields, fill: {}, importKey: null, tags: [], doNotContact: false, emailOptOut: false };
        byRef.set(ref, pc);
        clients.push(pc);
      }
      if (pc.existingId) {
        // A client already in JobFlex keeps its own name and what it has; only its empty fields are filled.
        const ex = existingById.get(pc.existingId)!;
        for (const k of FILLABLE) if (!ex[k] && !pc.fill[k] && c.fields[k]) pc.fill[k] = c.fields[k];
        if (!pc.importKey && !ex.importKey && c.clientNo) pc.importKey = clientKey(c.clientNo);
      } else {
        for (const k of FILLABLE) if (!pc.data[k] && c.fields[k]) pc.data[k] = c.fields[k];
        if (c.fields.notes) pc.data.notes = clip("notes", [pc.data.notes, c.fields.notes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("\n"));
        pc.tags = [...new Set([...pc.tags, ...c.tags])].slice(0, 8);
        if (!pc.importKey && c.clientNo) pc.importKey = clientKey(c.clientNo);
      }
      pc.doNotContact ||= c.dnc;
      pc.emailOptOut ||= c.optOut;
      index(ref, { ...c.fields, name: pc.data.name }, c.phones, c.emails, clientKey(c.clientNo));
      return pc;
    }
    newCount++;
    const pc: PlanClient = { ref: `n${newCount}`, existingId: null, data: { ...c.fields }, fill: {}, importKey: clientKey(c.clientNo), tags: c.tags, doNotContact: c.dnc, emailOptOut: c.optOut };
    byRef.set(pc.ref, pc);
    clients.push(pc);
    index(pc.ref, c.fields, c.phones, c.emails, pc.importKey);
    return pc;
  };

  const jobs: PlanJob[] = [];
  const invoices: PlanInvoice[] = [];
  const history: PlanHistory[] = [];
  const skipped: PlanSkip[] = [];
  let again = 0;
  const usedKeys = new Set<string>();
  const usedNumbers = new Set<string>();
  /** A key unique in this import: the second row with one number is its second visit. */
  const uniqueKey = (base: string) => {
    let k = base;
    for (let n = 2; usedKeys.has(k); n++) k = `${base}#${n}`;
    usedKeys.add(k);
    return k;
  };
  const today = zonedParts(ctx.now, ctx.timeZone);
  const startOfToday = zonedInstant(today.y, today.m, today.d, 0, 0, ctx.timeZone);
  const at = (w: WallDate | null, defaultHour?: number) =>
    w ? (defaultHour !== undefined && !w.timed && !w.zoned ? zonedInstant(w.y, w.m, w.d, defaultHour, 0, ctx.timeZone) : instantOf(w, ctx.timeZone)) : null;

  // The client files first: a job's row then finds the client its customer file brought.
  const order = [...ctx.files].sort((a, b) => (a.kind === "clients" ? 0 : 1) - (b.kind === "clients" ? 0 : 1));
  let balanceNo = 0;
  for (const file of order) {
    const invoiceFile = /invoice/i.test(file.name) || (file.kind === "work" && !file.map.some((f) => f === "title" || f === "description" || f === "status" || f === "assigned" || f === "date") && file.map.some((f) => f === "due" || f === "total"));
    file.table.rows.forEach((row, i) => {
      const rowNo = file.table.lines?.[i] ?? i + 2;
      const { get, all } = reader(file.map, row);
      const c = contactOf(get, all);
      if (file.kind === "clients") {
        if (!c) {
          skipped.push({ file: file.name, row: rowNo, why: "no name, email or phone" });
          return;
        }
        const pc = take(c, false);
        // An open balance on a client list (QuickBooks) is money owed.
        if (c.due && c.due > 0.005) {
          const key = uniqueKey(`${prefix}:balance:${pc.importKey ?? looseKey(c.fields.name)}`);
          if (ctx.keys.has(key)) again++;
          else {
            balanceNo++;
            invoices.push({ client: pc.ref, number: `${prefix}-BAL-${balanceNo}`, amount: r2(c.due), billed: null, dueDate: null, issuedAt: null, title: "Opening balance", importKey: key });
          }
        }
        return;
      }
      // A row of work.
      if (!c) {
        skipped.push({ file: file.name, row: rowNo, why: "no client named on this row" });
        return;
      }
      const number = get("number");
      const desc = get("description");
      const title = (get("title") ?? (desc ? desc.split(/[.\n]/)[0].slice(0, 80) : null) ?? (file.kind === "estimates" ? "Estimate" : invoiceFile ? "Invoice" : "Job")).slice(0, 200);
      const status = get("status");
      const start = wallDateOf(get("date"));
      const end = wallDateOf(get("endDate"));
      const doneOn = wallDateOf(get("doneDate"));
      const total = moneyOf(get("total"));
      let paid = moneyOf(get("paid"));
      let due = moneyOf(get("due"));
      const pay = payState(get("paymentStatus")) ?? (invoiceFile ? payState(status) : null);
      if (due === null) {
        if (pay === "paid") due = 0;
        else if (total !== null && paid !== null) due = Math.max(0, r2(total - paid));
        else if (pay === "unpaid" && total !== null) due = total;
      }
      if (due !== null && due < 0) due = 0;
      if (paid === null) {
        if (pay === "paid" && total !== null) paid = total;
        else if (total !== null && due !== null) paid = Math.max(0, r2(total - due));
      }
      const by = all("assigned").join(", ").slice(0, 200) || null;
      if (!number && !start && !doneOn && total === null && due === null && !get("title") && !desc) {
        skipped.push({ file: file.name, row: rowNo, why: "nothing on this row to bring in" });
        return;
      }
      const pc = take(c, true);
      const base = number ? number.trim().toLowerCase() : hashOf([c.fields.name, title, get("date"), get("total"), get("due")]);

      if (file.kind === "estimates") {
        const key = uniqueKey(`${prefix}:estimate:${base}`);
        if (ctx.keys.has(key)) {
          again++;
          return;
        }
        history.push({ client: pc.ref, kind: "ESTIMATE", number, title, status: estimateState(status), amount: total, paid: null, due: null, date: at(start ?? doneOn), by, notes: desc && desc !== title ? desc.slice(0, 2000) : null, importKey: key });
        return;
      }

      const state = workState(status) ?? (pay === "paid" || doneOn ? "done" : null);
      const startAt = at(start, 8);
      const upcoming = !invoiceFile && state !== "done" && state !== "canceled" && (startAt ? startAt.getTime() >= startOfToday.getTime() : state === "open");
      if (upcoming) {
        const key = uniqueKey(`${prefix}:job:${base}`);
        if (ctx.keys.has(key)) again++;
        else {
          const endAt = at(end, 10);
          const notes = [desc && desc !== title ? desc : null, number ? `${info.label} #${number}` : null, by ? `Crew: ${by}` : null, `Brought in from ${info.label}.`].filter(Boolean).join("\n");
          jobs.push({ client: pc.ref, title, notes: notes.slice(0, 4000), startsAt: startAt, endsAt: startAt ? (endAt && endAt.getTime() > startAt.getTime() ? endAt : new Date(startAt.getTime() + 2 * 3600_000)) : null, importKey: key });
        }
      } else {
        const key = uniqueKey(`${prefix}:${invoiceFile ? "invoice-history" : "job"}:${base}`);
        if (ctx.keys.has(key)) again++;
        else {
          const words = [state ?? (invoiceFile ? null : status ? status.toLowerCase().slice(0, 40) : null), pay === "partial" || (paid !== null && due !== null && paid > 0 && due > 0) ? "partly paid" : due !== null && due > 0 ? "unpaid" : paid !== null && paid > 0 ? "paid" : null].filter(Boolean);
          history.push({ client: pc.ref, kind: invoiceFile ? "INVOICE" : "JOB", number, title, status: words.join(" · ") || null, amount: total, paid, due, date: at(state === "done" && doneOn ? doneOn : (start ?? doneOn ?? wallDateOf(get("paidDate")))), by, notes: desc && desc !== title ? desc.slice(0, 2000) : null, importKey: key });
        }
      }
      // Money still owed: an open invoice, under the other program's own number.
      if (due !== null && due > 0.005) {
        const key = uniqueKey(`${prefix}:invoice:${base}`);
        const num = `${prefix}-${(number ?? base).replace(/\s+/g, "").slice(0, 40)}`;
        if (ctx.keys.has(key) || ctx.invoiceNumbers.has(num) || usedNumbers.has(num)) again++;
        else {
          usedNumbers.add(num);
          invoices.push({ client: pc.ref, number: num, amount: r2(due), billed: total, dueDate: at(wallDateOf(get("dueDate"))), issuedAt: at(start ?? doneOn), title, importKey: key });
        }
      }
    });
  }

  const counts: PlanCounts = {
    newClients: clients.filter((c) => !c.existingId).length,
    joined: clients.filter((c) => c.existingId).length,
    upcoming: jobs.filter((j) => j.startsAt).length,
    unscheduled: jobs.filter((j) => !j.startsAt).length,
    invoices: invoices.length,
    owed: r2(invoices.reduce((a, v) => a + v.amount, 0)),
    history: history.length,
    paid: r2(history.reduce((a, h) => a + (h.paid ?? 0), 0)),
    skipped: skipped.length,
    again,
  };
  return { clients, jobs, invoices, history, skipped, counts };
}
