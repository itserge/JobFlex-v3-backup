"use client";
// BRING CLIENTS BACK (Smart CRM part 6, 2026-11-10) — the CRM's Win back tab, on the desk and on the phone.
// Top to bottom it is one job: say who (your own words, a ready list, or a saved one) → see exactly who that is and
// who would be left out → write them one email (AI drafts it, a person reads it) → send, and watch what came of it.
// Under that, the house facts the "older homes" kind of list runs on.
//
// Everything is asked for when the section first comes into view (the desk's panel is in the page but hidden until
// its tab is opened). Nothing here sends on one press: Send saves the draft, then asks once more with the count.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  deleteCampaignDraft,
  deleteClientList,
  draftCampaign,
  findClients,
  getWinBack,
  lookUpClientHouses,
  previewClients,
  saveCampaignDraft,
  saveClientHouse,
  saveClientList,
  sendCampaign,
  sendCampaignTest,
  stopCampaignNow,
  type WinBackData,
} from "@/actions/winback";
import {
  BODY_MAX,
  HOUSE_BATCH,
  HOUSE_SOURCE_WORDS,
  MERGE_TAGS,
  SUBJECT_MAX,
  campaignFine,
  fillWords,
  filterParts,
  isEmptyFilter,
  outcomeWords,
  paceWords,
  withoutPart,
  type CampaignStatus,
  type FilterPart,
  type ListFilter,
} from "@/lib/winback/shared";
import type { CampaignRow, ListPreview } from "@/lib/winback/server";
import type { HouseRow } from "@/lib/winback/house";
import w from "./win-back.module.css";

type Where = "who" | "list" | "mail" | "camps" | "house";
type No = { ok: false; error: string };
interface Note {
  where: Where;
  bad: boolean;
  text: string;
}
interface OpenList {
  preview: ListPreview;
  /** The ready or saved list's name (or the draft's), when it has one. */
  name: string | null;
  listId: string | null;
  /** What was typed to find it. */
  words: string | null;
}
interface Mail {
  /** The saved draft, once there is one. */
  id: string | null;
  subject: string;
  body: string;
  by: "ai" | "rules" | "person";
  about: string;
}

const STATUS: Record<CampaignStatus, { label: string; cls: string }> = {
  DRAFT: { label: "Draft", cls: w.sDraft },
  SENDING: { label: "Sending", cls: w.sSending },
  SENT: { label: "Sent", cls: w.sSent },
  CANCELED: { label: "Stopped", cls: w.sCanceled },
};

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const monthOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null);
const dayOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null);
const whole = (s: string): number | null | "bad" => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  return /^\d{1,6}$/.test(t) ? Number(t) : "bad";
};
const bring = (ref: RefObject<HTMLElement | null>) => requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "nearest" }));

function campaignWhen(c: CampaignRow): string {
  if (c.status === "DRAFT") return `Made ${dayOf(c.createdAt)}`;
  if (c.status === "SENDING") return `Started ${dayOf(c.startedAt ?? c.createdAt)}`;
  if (c.status === "SENT") return `Finished ${dayOf(c.finishedAt ?? c.startedAt ?? c.createdAt)}`;
  return `Stopped ${dayOf(c.finishedAt ?? c.startedAt ?? c.createdAt)}`;
}

export function WinBackPanel() {
  const root = useRef<HTMLElement>(null);
  const asked = useRef(0);
  const again = useRef<ReturnType<typeof setTimeout> | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<"subject" | "body">("body");
  const listRef = useRef<HTMLDivElement>(null);
  const mailRef = useRef<HTMLDivElement>(null);
  const campsRef = useRef<HTMLDivElement>(null);

  const [data, setData] = useState<WinBackData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  /** The delete / stop button pressed once: the second press does it. */
  const [arm, setArm] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const [list, setList] = useState<OpenList | null>(null);
  const [naming, setNaming] = useState(false);
  const [listName, setListName] = useState("");
  const [mail, setMail] = useState<Mail | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState<Record<string, { year?: string; sqft?: string }>>({});

  const load = useCallback(async () => {
    const mine = ++asked.current;
    setLoading(true);
    const res = await getWinBack().catch(() => ({ ok: false as const, error: "Couldn't read the client list. Try again." }));
    // A slower answer to an older ask never lands on top of a newer one.
    if (mine !== asked.current) return;
    setLoading(false);
    if (!res.ok) return setErr(res.error);
    setErr(null);
    setData(res.data);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el || asked.current) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => void load(), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (asked.current || !entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void load();
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load]);

  useEffect(
    () => () => {
      if (again.current) clearTimeout(again.current);
    },
    [],
  );

  /** One press: mark it busy, clear the old note, and turn a refusal into a note where the person is looking. */
  const run = async <T extends { ok: true }>(key: string, where: Where, job: () => Promise<T | No>): Promise<T | null> => {
    setBusy(key);
    setNote(null);
    setArm(null);
    const res = await job().catch((): No => ({ ok: false, error: "That didn't go through. Try again." }));
    setBusy(null);
    if (!res.ok) {
      setNote({ where, bad: true, text: res.error });
      return null;
    }
    return res;
  };
  const twice = (key: string, job: () => void) => {
    if (arm !== key) return setArm(key);
    setArm(null);
    job();
  };

  // ── who ──
  const show = (preview: ListPreview, name: string | null, listId: string | null, said: string | null) => {
    setList({ preview, name, listId, words: said });
    setListName(name ?? "");
    setNaming(false);
    setMail(null);
    setConfirm(false);
    bring(listRef);
  };
  const find = async () => {
    const res = await run("find", "who", () => findClients(words));
    if (!res) return;
    if (!res.understood) return setNote({ where: "who", bad: true, text: 'I couldn\'t tell who you mean. Try it another way, like "bought a deck and quiet for two years" or "got a quote in Tacoma and never bought".' });
    show(res.preview, null, null, words.trim());
  };
  const open = async (key: string, filter: ListFilter, name: string, listId: string | null) => {
    const res = await run(key, "who", () => previewClients(filter));
    if (res) show(res.preview, name, listId, null);
  };
  const removeList = async (id: string) => {
    const res = await run(`dl:${id}`, "who", () => deleteClientList(id));
    if (!res) return;
    setList((l) => (l && l.listId === id ? { ...l, listId: null } : l));
    void load();
  };

  // ── the list ──
  const shut = () => {
    setList(null);
    setMail(null);
    setConfirm(false);
  };
  const drop = async (part: FilterPart) => {
    if (!list) return;
    const next = withoutPart(list.preview.filter, part);
    if (isEmptyFilter(next)) return shut();
    const res = await run("chip", "list", () => previewClients(next));
    if (!res) return;
    setList({ preview: res.preview, name: null, listId: null, words: null });
    setConfirm(false);
  };
  const keep = async () => {
    if (!list) return;
    const name = listName.replace(/\s+/g, " ").trim();
    const res = await run("keep", "list", () => saveClientList({ name, filter: list.preview.filter, words: list.words }));
    if (!res) return;
    setList({ ...list, name, listId: res.id });
    setNaming(false);
    setNote({ where: "list", bad: false, text: `Saved as "${name}". It is counted fresh every time you open it.` });
    void load();
  };

  // ── the email ──
  const write = async (about: string) => {
    if (!list) return;
    const res = await run("write", mail ? "mail" : "list", () => draftCampaign({ filter: list.preview.filter, listName: list.name, about: about.trim() || null }));
    if (!res) return;
    setMail({ id: mail?.id ?? null, subject: res.subject, body: res.body, by: res.by, about });
    setConfirm(false);
    bring(mailRef);
  };
  const edit = (patch: Partial<Pick<Mail, "subject" | "body">>) => {
    setMail((m) => (m ? { ...m, ...patch, by: "person" } : m));
    setConfirm(false);
  };
  const insert = (tag: string) => {
    if (!mail) return;
    const onSubject = lastField.current === "subject";
    const el = onSubject ? subjectRef.current : bodyRef.current;
    const text = onSubject ? mail.subject : mail.body;
    const at = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? at;
    const next = text.slice(0, at) + tag + text.slice(to);
    edit(onSubject ? { subject: next.slice(0, SUBJECT_MAX) } : { body: next.slice(0, BODY_MAX) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + tag.length, at + tag.length);
    });
  };
  /** Save the words as a draft (a new one, or the one that is open). Send goes through here first. */
  const store = async (key: string): Promise<string | null> => {
    if (!list || !mail) return null;
    const res = await run(key, "mail", () => saveCampaignDraft({ id: mail.id, name: list.name, filter: list.preview.filter, listId: list.listId, subject: mail.subject, body: mail.body, writtenBy: mail.by }));
    if (!res) return null;
    setMail((m) => (m ? { ...m, id: res.id } : m));
    void load();
    return res.id;
  };
  const saveDraft = async () => {
    if (await store("save")) setNote({ where: "mail", bad: false, text: "Draft saved. Nothing has been sent." });
  };
  const askSend = async () => {
    if (await store("ask")) setConfirm(true);
  };
  const test = async () => {
    if (!mail) return;
    const res = await run("test", "mail", () => sendCampaignTest({ subject: mail.subject, body: mail.body }));
    if (res) setNote({ where: "mail", bad: false, text: `Test sent to ${res.to}. It reads the way one client would get it.` });
  };
  const send = async () => {
    const id = mail?.id;
    if (!id) return;
    const res = await run("send", "mail", () => sendCampaign(id));
    if (!res) return;
    shut();
    setNote({
      where: "camps",
      bad: false,
      text: `On its way to ${count(res.queued, "client")}. ${res.waits ? "It is outside sending hours, so the first emails leave after 8 AM your time." : paceWords(res.queued)} You can stop it here while it is going.`,
    });
    bring(campsRef);
    void load();
    // The first batch leaves once the answer is back; count it a moment later.
    if (again.current) clearTimeout(again.current);
    again.current = setTimeout(() => void load(), 12_000);
  };

  // ── campaigns ──
  const openDraft = async (c: CampaignRow) => {
    const res = await run(`open:${c.id}`, "camps", () => previewClients(c.filter));
    if (!res) return;
    setList({ preview: res.preview, name: c.name, listId: null, words: null });
    setListName("");
    setNaming(false);
    setMail({ id: c.id, subject: c.subject, body: c.body, by: c.writtenBy === "ai" || c.writtenBy === "rules" ? c.writtenBy : "person", about: "" });
    setConfirm(false);
    bring(listRef);
  };
  const removeDraft = async (c: CampaignRow) => {
    const res = await run(`dc:${c.id}`, "camps", () => deleteCampaignDraft(c.id));
    if (!res) return;
    if (mail?.id === c.id) shut();
    void load();
  };
  const stop = async (c: CampaignRow) => {
    const res = await run(`st:${c.id}`, "camps", () => stopCampaignNow(c.id));
    if (!res) return;
    setNote({ where: "camps", bad: false, text: res.stopped ? `Stopped. ${count(res.stopped, "email")} that had not left will not go.` : "Stopped. Every email had already left." });
    void load();
  };

  // ── house facts ──
  const lookUp = async () => {
    const res = await run("houses", "house", () => lookUpClientHouses());
    if (!res) return;
    setNote({ where: "house", bad: false, text: res.checked === 0 ? "Nothing left to look up right now." : `Looked up ${count(res.checked, "home")}: found ${res.found}.${res.left ? ` ${res.left.toLocaleString("en-US")} still to go.` : ""}` });
    void load();
  };
  const saveHouse = async (row: HouseRow) => {
    const t = typed[row.clientId] ?? {};
    const yearBuilt = whole(t.year ?? String(row.yearBuilt ?? ""));
    const livingSqft = whole(t.sqft ?? String(row.livingSqft ?? ""));
    if (yearBuilt === "bad" || livingSqft === "bad") return setNote({ where: "house", bad: true, text: "Use plain numbers, like 1987 and 2,150." });
    if (yearBuilt === null && livingSqft === null) return setNote({ where: "house", bad: true, text: "Type the year it was built or its size first." });
    const res = await run(`h:${row.clientId}`, "house", () => saveClientHouse(row.clientId, { yearBuilt, livingSqft }));
    if (!res) return;
    setTyped((all) => {
      const next = { ...all };
      delete next[row.clientId];
      return next;
    });
    setNote({ where: "house", bad: false, text: `Saved for ${row.name}.` });
    void load();
  };

  const noteAt = (where: Where) =>
    note?.where === where ? (
      <div className={note.bad ? w.err : w.flash} role={note.bad ? "alert" : "status"} data-wb-note={where}>
        {note.text}
      </div>
    ) : null;

  const parts = list ? filterParts(list.preview.filter) : [];
  const first = list?.preview.people.find((p) => p.email) ?? list?.preview.people[0] ?? null;
  const sample = { name: first?.name ?? "Alex Sample", company: data?.company ?? "", lastJob: first?.lastJob ?? null };
  const cantSend = data?.sendingProblem ?? (list && list.preview.willSend === 0 ? "Nobody on this list can get an email right now." : null);
  const more = list ? list.preview.total - list.preview.people.length : 0;

  return (
    <section className={w.wb} ref={root} data-nest data-win-back aria-busy={loading || busy !== null}>
      <header className={w.head}>
        <h2 className={w.title}>Bring clients back</h2>
        <p className={w.lede}>Say who you want to hear from again. JobFlex finds them in your own records, writes them one email in your name, and shows what came of it.</p>
        {data ? (
          <ul className={w.facts} data-wb-facts>
            <li>
              <b>{data.clients.toLocaleString("en-US")}</b> {data.clients === 1 ? "client" : "clients"} on file
            </li>
            <li>
              <b>{data.withEmail.toLocaleString("en-US")}</b> with an email
            </li>
            {data.optedOut ? (
              <li>
                <b>{data.optedOut.toLocaleString("en-US")}</b> unsubscribed
              </li>
            ) : null}
          </ul>
        ) : null}
      </header>

      {err ? (
        <div className={w.err} role="alert" data-wb-error>
          {err}{" "}
          <button type="button" className={w.mini} onClick={() => void load()} disabled={loading}>
            Try again
          </button>
        </div>
      ) : null}
      {!data && !err ? <div className={w.wait}>{loading ? "Counting your clients…" : "Your client lists open here."}</div> : null}

      {data ? (
        <>
          {data.sendingProblem ? (
            <div className={w.setup} role="note" data-wb-setup>
              <b>One thing before you can send</b>
              {data.sendingProblem} <a href="/dashboard/company">Open the Company page</a>
            </div>
          ) : null}

          {data.clients === 0 ? (
            <div className={w.none}>
              <b>No clients on file yet</b>
              Once you have clients with finished jobs or quotes, this is where you bring them back.
            </div>
          ) : (
            <>
              {/* ── who ── */}
              <section className={w.sec} data-wb-who>
                <h3 className={w.secH}>Who</h3>
                <form
                  className={w.ask}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void find();
                  }}
                >
                  <input
                    type="text"
                    value={words}
                    maxLength={400}
                    onChange={(e) => setWords(e.target.value)}
                    placeholder="deck clients we haven't heard from in two years"
                    aria-label="Who are you looking for, in your own words"
                    enterKeyHint="search"
                    data-wb-words
                  />
                  <button type="submit" className={w.cta} disabled={busy !== null || words.trim().length < 3} data-wb-find>
                    {busy === "find" ? "Looking…" : "Find them"}
                  </button>
                </form>
                {noteAt("who")}

                <ul className={w.readyGrid}>
                  {data.ready.map((r) => (
                    <li key={r.key}>
                      <button type="button" className={`${w.ready} ${list?.name === r.name ? w.readyOn : ""}`} disabled={busy !== null || r.count === 0} onClick={() => void open(`r:${r.key}`, r.filter, r.name, null)} data-wb-ready={r.key}>
                        <span className={w.readyT}>{r.name}</span>
                        <span className={w.readyW}>{r.why}</span>
                        <span className={w.readyN}>{busy === `r:${r.key}` ? "…" : r.count.toLocaleString("en-US")}</span>
                      </button>
                    </li>
                  ))}
                </ul>

                {data.saved.length ? (
                  <div className={w.savedRow} data-wb-saved>
                    <span className={w.lbl}>Your lists</span>
                    {data.saved.map((s) => (
                      <span className={w.savedWrap} key={s.id}>
                        <button type="button" className={w.saved} title={s.words} disabled={busy !== null} onClick={() => void open(`s:${s.id}`, s.filter, s.name, s.id)}>
                          {s.name}
                          <b>{s.count.toLocaleString("en-US")}</b>
                        </button>
                        <button type="button" className={w.x} aria-label={arm === `dl:${s.id}` ? `Press again to delete the list ${s.name}` : `Delete the list ${s.name}`} disabled={busy !== null} onClick={() => twice(`dl:${s.id}`, () => void removeList(s.id))}>
                          {arm === `dl:${s.id}` ? "Delete?" : "×"}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>

              {/* ── the list ── */}
              {list ? (
                <section className={w.sec} data-wb-list>
                  <div className={w.secHead}>
                    <h3 className={w.secH}>
                      The list
                      {list.name ? <span className={w.secN}>{list.name}</span> : null}
                    </h3>
                    <button type="button" className={w.mini} onClick={shut} disabled={busy !== null}>
                      Close
                    </button>
                  </div>
                  <div className={`${w.box} ${w.boxIn}`} ref={listRef}>
                    <div className={w.chips}>
                      {parts.map((p) => (
                        <span className={w.chip} key={p.key}>
                          <span>{p.text}</span>
                          <button type="button" className={w.x} aria-label={`Take off: ${p.text}`} disabled={busy !== null} onClick={() => void drop(p)}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className={w.tally}>
                      <span data-wb-total>
                        <span className={w.tallyN}>{list.preview.total.toLocaleString("en-US")}</span>
                        <span className={w.tallyL}>{list.preview.total === 1 ? "client" : "clients"}</span>
                      </span>
                      <span className={w.tallyGo} data-wb-will>
                        <span className={w.tallyN}>{list.preview.willSend.toLocaleString("en-US")}</span>
                        <span className={w.tallyL}>would get the email</span>
                      </span>
                    </div>
                    {list.preview.leftOut.length ? <p className={w.left}>Left out: {list.preview.leftOut.join(" · ")}.</p> : null}
                    {list.preview.houseUnknown ? (
                      <p className={w.left}>
                        This list asks about the house. {count(list.preview.houseUnknown, "client has", "clients have")} no house facts yet, so they can&apos;t be on it. Look them up under House facts below.
                      </p>
                    ) : null}
                    {noteAt("list")}

                    {list.preview.people.length ? (
                      <>
                        <ul className={w.people}>
                          {list.preview.people.map((p) => (
                            <li className={`${w.person} ${p.out ? w.personOut : ""}`} key={p.id}>
                              <span className={w.pName}>{p.name}</span>
                              <span className={w.pSub}>
                                {[p.lastJob, p.city, p.email ?? (p.out ? null : "no email")].filter(Boolean).join(" · ")}
                                {p.out ? <span className={w.pOut}>Left out: {p.out}</span> : null}
                              </span>
                              <span className={w.pPaid}>{p.paid > 0 ? usd(p.paid) : "—"}</span>
                              <span className={w.pWhen}>{monthOf(p.lastAt) ?? ""}</span>
                            </li>
                          ))}
                        </ul>
                        {more > 0 ? <span className={w.more}>and {more.toLocaleString("en-US")} more, best clients first.</span> : null}
                      </>
                    ) : (
                      <div className={w.none}>
                        <b>Nobody matches</b>
                        Take a rule off above, or try other words.
                      </div>
                    )}

                    {naming ? (
                      <form
                        className={w.saveRow}
                        onSubmit={(e) => {
                          e.preventDefault();
                          void keep();
                        }}
                      >
                        <label className={w.field}>
                          <span>Name this list</span>
                          <input type="text" value={listName} maxLength={80} onChange={(e) => setListName(e.target.value)} placeholder="Deck clients, quiet two years" autoFocus data-wb-list-name />
                        </label>
                        <button type="submit" className={w.cta} disabled={busy !== null || !listName.trim()}>
                          {busy === "keep" ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className={w.ghost} onClick={() => setNaming(false)}>
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className={w.foot}>
                        {mail ? null : (
                          <button type="button" className={w.cta} disabled={busy !== null || list.preview.willSend === 0} title={list.preview.total > 0 && list.preview.willSend === 0 ? "Nobody on this list can get an email right now." : undefined} onClick={() => void write("")} data-wb-write>
                            {busy === "write" ? "Writing…" : "Write them an email"}
                          </button>
                        )}
                        {list.listId ? null : (
                          <button type="button" className={w.ghost} disabled={busy !== null || list.preview.total === 0} onClick={() => setNaming(true)} data-wb-keep>
                            Save this list
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {/* ── the email ── */}
              {list && mail ? (
                <section className={w.sec} data-wb-mail>
                  <h3 className={w.secH}>The email</h3>
                  <p className={w.secSub}>
                    {mail.by === "ai" ? "A first draft, written from the list. Read it and change anything before it goes." : mail.by === "rules" ? "These are the standard words. Change anything." : "Your words. Each client gets their own copy."}
                  </p>
                  <div className={`${w.box} ${w.boxIn}`} ref={mailRef}>
                    <div className={w.mailGrid}>
                      <div className={w.mailSide}>
                        <label className={w.field}>
                          <span>Subject</span>
                          <input ref={subjectRef} type="text" value={mail.subject} maxLength={SUBJECT_MAX} onFocus={() => (lastField.current = "subject")} onChange={(e) => edit({ subject: e.target.value })} data-wb-subject />
                        </label>
                        <label className={w.field}>
                          <span>The email</span>
                          <textarea ref={bodyRef} value={mail.body} maxLength={BODY_MAX} rows={10} onFocus={() => (lastField.current = "body")} onChange={(e) => edit({ body: e.target.value })} data-wb-body />
                          <span className={w.count}>
                            {mail.body.length.toLocaleString("en-US")} / {BODY_MAX.toLocaleString("en-US")}
                          </span>
                        </label>
                        <div className={w.tags}>
                          <span className={w.lbl}>Put in</span>
                          {MERGE_TAGS.map((t) => (
                            <button type="button" className={w.tag} key={t} onClick={() => insert(t)}>
                              {t}
                            </button>
                          ))}
                        </div>
                        <form
                          className={w.aboutRow}
                          onSubmit={(e) => {
                            e.preventDefault();
                            void write(mail.about);
                          }}
                        >
                          <label className={w.field}>
                            <span>What should it say? (optional)</span>
                            <input type="text" value={mail.about} maxLength={300} onChange={(e) => setMail({ ...mail, about: e.target.value })} placeholder="we now build covered patios; spring spots are open" data-wb-about />
                          </label>
                          <button type="submit" className={w.ghost} disabled={busy !== null} data-wb-rewrite>
                            {busy === "write" ? "Writing…" : "Write it again"}
                          </button>
                        </form>
                      </div>

                      <div className={w.mailSide}>
                        <span className={w.lbl}>How {first ? first.name : "a client"} will read it</span>
                        <div className={w.letter} data-wb-preview>
                          <div className={w.letterTo}>
                            From {data.company} via JobFlex{first?.email ? ` · to ${first.email}` : ""}
                          </div>
                          <div className={w.letterS}>{fillWords(mail.subject, sample) || "(no subject yet)"}</div>
                          <div className={w.letterB}>{fillWords(mail.body, sample)}</div>
                          <div className={w.letterF}>
                            {data.address ? campaignFine({ name: data.company, address: data.address }) : "Your company's mailing address goes here."} <u>Unsubscribe</u>
                          </div>
                        </div>
                      </div>
                    </div>

                    {noteAt("mail")}

                    {confirm ? (
                      <div className={w.confirm} role="group" aria-label="Send this email" data-wb-confirm>
                        <p>
                          <b>Email {count(list.preview.willSend, "client")}?</b> {data.open ? paceWords(list.preview.willSend) : "It is outside sending hours now, so the first emails leave after 8 AM your time."} The list is counted once more at this moment, each email carries your address and an unsubscribe link, and nobody gets it twice.
                        </p>
                        <div className={w.foot}>
                          <button type="button" className={`${w.cta} ${w.ctaGo}`} disabled={busy !== null} onClick={() => void send()} data-wb-send-yes>
                            {busy === "send" ? "Sending…" : `Yes, send to ${list.preview.willSend.toLocaleString("en-US")}`}
                          </button>
                          <button type="button" className={w.ghost} disabled={busy !== null} onClick={() => setConfirm(false)}>
                            Not yet
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={w.foot}>
                        <button type="button" className={`${w.cta} ${w.ctaGo}`} disabled={busy !== null || cantSend !== null} title={cantSend ?? undefined} onClick={() => void askSend()} data-wb-send>
                          {busy === "ask" ? "One moment…" : `Send to ${count(list.preview.willSend, "client")}`}
                        </button>
                        <button type="button" className={w.ghost} disabled={busy !== null || data.sendingProblem !== null} onClick={() => void test()} data-wb-test>
                          {busy === "test" ? "Sending…" : "Send me a test"}
                        </button>
                        <button type="button" className={w.ghost} disabled={busy !== null} onClick={() => void saveDraft()} data-wb-save>
                          {busy === "save" ? "Saving…" : "Save draft"}
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              ) : null}

              {/* ── campaigns ── */}
              <section className={w.sec} data-wb-campaigns>
                <div className={w.secHead} ref={campsRef}>
                  <h3 className={w.secH}>
                    Campaigns
                    {data.campaigns.length ? <span className={w.secN}>{data.campaigns.length}</span> : null}
                  </h3>
                  <button type="button" className={w.mini} onClick={() => void load()} disabled={loading}>
                    {loading ? "Counting…" : "Refresh"}
                  </button>
                </div>
                {noteAt("camps")}
                {data.campaigns.length ? (
                  <ul className={w.camps}>
                    {data.campaigns.map((c) => (
                      <li className={`${w.camp} ${STATUS[c.status].cls}`} key={c.id} data-wb-campaign={c.status}>
                        <div className={w.campTop}>
                          <span className={w.campT}>{c.name}</span>
                          <span className={w.badge}>{STATUS[c.status].label}</span>
                          <span className={w.campWhen}>{campaignWhen(c)}</span>
                        </div>
                        <div className={w.campTo}>{c.audience}</div>
                        <div className={w.campOut}>{c.status === "DRAFT" ? "Not sent yet." : outcomeWords(c.counts)}</div>
                        {c.leftOut.length ? <div className={w.campTo}>Left out: {c.leftOut.join(" · ")}.</div> : null}
                        {c.status === "DRAFT" ? (
                          <div className={w.foot}>
                            <button type="button" className={w.mini} disabled={busy !== null} onClick={() => void openDraft(c)}>
                              {busy === `open:${c.id}` ? "Opening…" : "Open"}
                            </button>
                            <button type="button" className={`${w.mini} ${arm === `dc:${c.id}` ? w.miniStop : ""}`} disabled={busy !== null} onClick={() => twice(`dc:${c.id}`, () => void removeDraft(c))}>
                              {arm === `dc:${c.id}` ? "Press again to delete" : "Delete"}
                            </button>
                          </div>
                        ) : null}
                        {c.status === "SENDING" ? (
                          <div className={w.foot}>
                            <button type="button" className={`${w.mini} ${w.miniStop}`} disabled={busy !== null} onClick={() => twice(`st:${c.id}`, () => void stop(c))} data-wb-stop>
                              {arm === `st:${c.id}` ? "Press again to stop it" : "Stop sending"}
                            </button>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={w.none}>
                    <b>Nothing sent yet</b>
                    Pick a list above and write them an email. What came of it shows here: who wrote back, who came back, who bought.
                  </div>
                )}
              </section>

              {/* ── house facts ── */}
              <section className={w.sec} data-wb-house>
                <h3 className={w.secH}>House facts</h3>
                <p className={w.secSub}>The year a home was built and its size, from free public records. Lists like &ldquo;Older homes&rdquo; run on them.</p>
                <div className={w.box}>
                  <ul className={w.facts}>
                    <li>
                      <b>{data.house.known.toLocaleString("en-US")}</b> of {data.house.withAddress.toLocaleString("en-US")} homes known
                    </li>
                    {data.house.notFound ? (
                      <li>
                        <b>{data.house.notFound.toLocaleString("en-US")}</b> not in the records
                      </li>
                    ) : null}
                    {data.house.unchecked ? (
                      <li>
                        <b>{data.house.unchecked.toLocaleString("en-US")}</b> not looked up yet
                      </li>
                    ) : null}
                  </ul>
                  {noteAt("house")}
                  {data.house.unchecked ? (
                    <div className={w.foot}>
                      <button type="button" className={w.cta} disabled={busy !== null} onClick={() => void lookUp()} data-wb-lookup>
                        {busy === "houses" ? "Looking them up…" : `Look up ${Math.min(HOUSE_BATCH, data.house.unchecked)} ${data.house.known + data.house.notFound ? "more" : "homes"}`}
                      </button>
                    </div>
                  ) : null}
                  {data.housesToFill.length ? (
                    <>
                      <span className={w.lbl}>Type one in</span>
                      <ul className={w.hRows}>
                        {data.housesToFill.map((h) => (
                          <li className={w.hRow} key={h.clientId}>
                            <span className={w.hWho}>
                              <b>{h.name}</b>
                              <span>
                                {h.address}
                                {h.source ? ` · ${HOUSE_SOURCE_WORDS[h.source]}` : ""}
                              </span>
                            </span>
                            <input type="text" inputMode="numeric" maxLength={4} placeholder="Year built" aria-label={`Year built, ${h.name}`} value={typed[h.clientId]?.year ?? String(h.yearBuilt ?? "")} onChange={(e) => setTyped((all) => ({ ...all, [h.clientId]: { ...all[h.clientId], year: e.target.value } }))} />
                            <input type="text" inputMode="numeric" maxLength={7} placeholder="Sq ft" aria-label={`Size in square feet, ${h.name}`} value={typed[h.clientId]?.sqft ?? String(h.livingSqft ?? "")} onChange={(e) => setTyped((all) => ({ ...all, [h.clientId]: { ...all[h.clientId], sqft: e.target.value } }))} />
                            <button type="button" className={w.mini} disabled={busy !== null} onClick={() => void saveHouse(h)}>
                              {busy === `h:${h.clientId}` ? "Saving…" : "Save"}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </section>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
