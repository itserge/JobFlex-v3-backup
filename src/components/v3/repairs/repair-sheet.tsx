"use client";
// THE REPAIR SHEET (2026-11-09, the ProSmart gaps plan, part 2). Mounted once in the shell (blueprint-shell,
// mobile-nav) and opened from anywhere by `document.dispatchEvent(new CustomEvent("jf:repair", { detail }))` with
// detail { jobId } | { proposalId } | { projectId } | { clientId } — the job page, a sold proposal's action bar, a
// project, a client. Office only: the buttons are drawn for the office, and the actions refuse anyone else.
//
// ProSmart's "Schedule a repair", made for every trade and made smarter: the reason chips are the trade's (from the
// job that came back), "already booked on this job" is said first, why it came back decides whether it counts on the
// crew and whether it's billable (warranty is free by default), a billable repair sends the client a change order on
// the same contract, the first open times of the chosen installer are one tap, a same-person clash is said before
// the booking, the client's photos go with it, and "leave it on To place" books it without a time.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import { bookRepairFromSheet, getRepairOpenTimes, getRepairSheet } from "@/actions/repairs";
import { uploadJobPhoto } from "@/actions/jobMedia";
import { downscaleImage } from "@/lib/imageClient";
import {
  billableByDefault,
  DEFAULT_REPAIR_HOURS,
  familyLabel,
  needsParts,
  reasonsFor,
  REPAIR_CAUSES,
  REPAIR_HOURS,
  repairTitle,
  type RepairCause,
  type RepairFamily,
} from "@/lib/repairs/shared";
import type { BookRepairResult, RepairSheetData } from "@/lib/repairs/server";
import "./repair-sheet.css";

export type RepairOpenDetail = { jobId?: string; proposalId?: string; projectId?: string; clientId?: string };

/** Open the repair sheet from anywhere. */
export function openRepairSheet(detail: RepairOpenDetail): void {
  document.dispatchEvent(new CustomEvent("jf:repair", { detail }));
}

type Offer = { workerId: string; who: string; day: string; start: string; words: string };

// The shell and the handheld nav both mount the sheet; if both are ever on one page, only the first one listens, so
// one Repair press opens one sheet.
let listener: symbol | null = null;
type Done = Extract<BookRepairResult, { ok: true }> & { photos: number; photoFail: number };

const MAX_PHOTOS = 6;

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const num = (s: string) => {
  const v = Number.parseFloat(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(v) && v >= 0 ? v : null;
};

export function RepairSheet() {
  const router = useRouter();
  const [ref, setRef] = useState<RepairOpenDetail | null>(null);
  const [data, setData] = useState<RepairSheetData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // the form
  const [jobId, setJobId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [cause, setCause] = useState<RepairCause | null>("WORKMANSHIP");
  const [billable, setBillable] = useState(false);
  const [billTouched, setBillTouched] = useState(false);
  const [charge, setCharge] = useState("");
  const [sendCo, setSendCo] = useState(true);
  const [workerId, setWorkerId] = useState<string>("");
  const [pay, setPay] = useState("");
  const [payTouched, setPayTouched] = useState(false);
  const [later, setLater] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("09:00");
  const [hours, setHours] = useState<number>(DEFAULT_REPAIR_HOURS);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [busy, setBusy] = useState<null | "book" | "photos">(null);
  const [err, setErr] = useState<string | null>(null);
  const [clash, setClash] = useState<Array<{ name: string; what: string; when: string }> | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setData(null);
    setLoadErr(null);
    setJobId(null);
    setReasons([]);
    setNote("");
    setPhotos([]);
    setCause("WORKMANSHIP");
    setBillable(false);
    setBillTouched(false);
    setCharge("");
    setSendCo(true);
    setWorkerId("");
    setPay("");
    setPayTouched(false);
    setLater(false);
    setDay("");
    setTime("09:00");
    setHours(DEFAULT_REPAIR_HOURS);
    setOffers(null);
    setBusy(null);
    setErr(null);
    setClash(null);
    setDone(null);
  }, []);

  useEffect(() => {
    const me = Symbol("repair-sheet");
    if (listener) return;
    listener = me;
    function onOpen(e: Event) {
      const d = ((e as CustomEvent<RepairOpenDetail | undefined>).detail ?? {}) as RepairOpenDetail;
      reset();
      setRef(d);
      getRepairSheet({ jobId: d.jobId ?? null, proposalId: d.proposalId ?? null, projectId: d.projectId ?? null, clientId: d.clientId ?? null })
        .then((r) => {
          setData(r);
          setJobId(r.picked);
          setDay(plusDays(r.today, 1));
        })
        .catch((x) => setLoadErr(x instanceof Error && /manager/i.test(x.message) ? "Repairs are booked by the office — the owner or a manager." : "The repair sheet couldn't load. Try again."));
    }
    document.addEventListener("jf:repair", onOpen);
    return () => {
      document.removeEventListener("jf:repair", onOpen);
      if (listener === me) listener = null;
    };
  }, [reset]);

  const job = useMemo(() => data?.jobs.find((j) => j.id === jobId) ?? null, [data, jobId]);
  const family: RepairFamily = job?.family ?? data?.proposalOnly?.family ?? "general";
  const chips = useMemo(() => reasonsFor(family), [family]);
  const clientName = job?.client ?? data?.proposalOnly?.client ?? data?.client ?? null;
  const address = job?.address ?? data?.proposalOnly?.address ?? null;
  const hasContract = job ? job.hasContract : !!data?.proposalOnly;

  // The installer: whoever did the job (they fix their own work), else the first installer.
  useEffect(() => {
    if (!data) return;
    const did = job?.crew.find((c) => data.crew.some((w) => w.id === c.id))?.id;
    const first = data.crew.find((w) => w.role === "INSTALLER")?.id ?? "";
    setWorkerId(did ?? first);
    setReasons([]);
  }, [data, job]);

  const worker = data?.crew.find((w) => w.id === workerId) ?? null;
  useEffect(() => {
    if (payTouched) return;
    setPay(worker?.usualPay ? String(Math.round(worker.usualPay)) : "");
  }, [worker, payTouched]);

  // Warranty unless it was the client's or the weather's doing — until the office picks for itself.
  useEffect(() => {
    if (!billTouched) setBillable(billableByDefault(cause));
  }, [cause, billTouched]);

  // First open times for whoever goes (or the installers), for this length.
  useEffect(() => {
    if (!data || later) return;
    let live = true;
    setOffers(null);
    const t = window.setTimeout(() => {
      getRepairOpenTimes({ workerId: workerId || null, hours })
        .then((o) => live && setOffers(o))
        .catch(() => live && setOffers([]));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [data, workerId, hours, later]);

  const close = useCallback(() => {
    if (busy) return;
    const booked = done;
    setRef(null);
    reset();
    if (booked) router.refresh();
  }, [busy, done, reset, router]);

  const title = repairTitle(reasons, clientName);
  const partsFirst = needsParts(reasons);
  const causeHint = REPAIR_CAUSES.find((c) => c.key === cause)?.hint ?? "Nobody is counted until you say why — you can mark it on the repair later.";

  async function book(force: boolean) {
    if (!data) return;
    setErr(null);
    setBusy("book");
    try {
      const r = await bookRepairFromSheet({
        jobId: job?.id ?? null,
        proposalId: job ? null : (data.proposalOnly?.id ?? null),
        reasons,
        note: note.trim() || null,
        cause,
        billable,
        charge: billable ? num(charge) : null,
        sendChangeOrder: billable && sendCo,
        workerId: workerId || null,
        pay: num(pay),
        day: later ? null : day || null,
        time: later ? null : time || null,
        hours,
        force,
      });
      if (!r.ok) {
        setErr(r.say);
        setClash(r.conflicts?.length ? r.conflicts : null);
        setBusy(null);
        return;
      }
      setClash(null);
      // The client's photos go on the repair, where the installer sees them.
      let sent = 0;
      let failed = 0;
      if (photos.length) {
        setBusy("photos");
        for (const f of photos) {
          try {
            await uploadJobPhoto(r.jobId, await downscaleImage(f), f.name || "photo.jpg", "BEFORE");
            sent++;
          } catch {
            failed++;
          }
        }
      }
      setDone({ ...r, photos: sent, photoFail: failed });
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const open = ref !== null;
  const sheetTitle = done ? "Repair booked" : clientName ? `Repair — ${clientName}` : "Repair";
  const sub = done ? undefined : [address, job ? `${job.title} · ${job.state}` : data?.proposalOnly ? `${data.proposalOnly.title} · sold` : null].filter(Boolean).join(" · ") || undefined;
  const canBook = !!data && !data.why && (!!job || !!data.proposalOnly) && (reasons.length > 0 || note.trim().length > 0) && (later || (!!day && !!time)) && (!billable || (num(charge) ?? 0) > 0);

  const footer = done ? (
    <div className="rps-acts">
      <a className="bps-btn bps-btn--ghost" href={`/dashboard/jobs/${done.original.id}`} data-repair-open-original>
        The job that came back
      </a>
      <a className="bps-btn bps-btn--primary" href={`/dashboard/jobs/${done.jobId}`} data-repair-open>
        Open the repair
      </a>
    </div>
  ) : data && !data.why ? (
    <div className="rps-foot">
      <div className="rps-sees" data-repair-title>
        {reasons.length || note.trim() ? <>They&apos;ll see: “{title}”</> : "Tick what's wrong, or write a note."}
      </div>
      <div className="rps-acts">
        <button type="button" className="bps-btn bps-btn--ghost" disabled={!!busy} onClick={close}>
          Cancel
        </button>
        {clash ? (
          <button type="button" className="bps-btn bps-btn--ghost" disabled={!!busy} onClick={() => void book(true)} data-repair-force>
            Book anyway
          </button>
        ) : null}
        <button type="button" className="bps-btn bps-btn--primary" disabled={!canBook || !!busy} onClick={() => void book(false)} data-repair-book>
          {busy === "book" ? "Booking…" : busy === "photos" ? "Adding photos…" : worker && worker.phone && !later ? `Book and text ${worker.name.split(" ")[0]}` : "Book the repair"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <BlueprintSheet open={open} onClose={close} title={sheetTitle} description={sub} footer={footer} width="min(640px, 100%)">
      <div className="rps" data-repair-sheet>
        {loadErr ? <p className="bps-err">{loadErr}</p> : null}
        {!data && !loadErr ? <p className="bps-note">Opening…</p> : null}
        {data?.why ? <p className="bps-err" data-repair-why>{data.why}</p> : null}

        {done ? (
          <div className="rps-done" data-repair-done>
            <div className="rps-done-t">{done.title}</div>
            <ul>
              <li>{done.when ? `${done.when}${done.worker ? ` · ${done.worker}` : ""}` : `No time yet — it waits on the calendar's To place list${done.worker ? ` for ${done.worker}` : ""}.`}</li>
              {done.worker ? <li>{done.texted ? `${done.worker} gets a text with the job and the link to accept.` : `${done.worker} sees it in their jobs — no text (no phone or texts off).`}</li> : <li>Nobody is on it yet — put someone on it from the calendar.</li>}
              {done.changeOrder ? (
                <li data-repair-co>
                  Change order #{done.changeOrder.number} · {money(done.changeOrder.total)} —{" "}
                  {done.changeOrder.sent ? `sent to the client (email ${done.changeOrder.email}, text ${done.changeOrder.sms}).` : "saved as a draft on the job; send it from Change orders."}
                </li>
              ) : null}
              {done.chargeNote ? <li>{done.chargeNote}</li> : null}
              {done.photos ? <li>{done.photos} photo{done.photos === 1 ? "" : "s"} on the repair.</li> : null}
              {done.photoFail ? <li className="rps-bad">{done.photoFail} photo{done.photoFail === 1 ? "" : "s"} didn&apos;t upload — add them on the repair.</li> : null}
            </ul>
          </div>
        ) : data && !data.why ? (
          <div className="bps-form">
            {data.jobs.length > 1 ? (
              <label className="bps-fld bps-fld--wide">
                <span className="bps-lbl">Which job came back</span>
                <select className="bps-in" value={jobId ?? ""} onChange={(e) => setJobId(e.target.value)} data-repair-job>
                  {data.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} · {j.state}
                      {j.crew.length ? ` · ${j.crew.map((c) => c.name).join(", ")}` : ""}
                      {j.history.length ? ` · ${j.history.length} repair${j.history.length === 1 ? "" : "s"} already` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {data.proposalOnly && !job ? <p className="bps-note bps-fld--wide">This sold proposal has no job on file — booking files the original work as a done job, so the repair counts against it.</p> : null}

            {job?.history.length ? (
              <div className="rps-warn bps-fld--wide" data-repair-history>
                <b>
                  {job.history.length} repair{job.history.length === 1 ? "" : "s"} already on this job
                </b>
                {job.history.slice(0, 4).map((h) => (
                  <a key={h.id} href={`/dashboard/jobs/${h.id}`}>
                    {h.title} · {h.when}
                    {h.who ? ` · ${h.who}` : ""} · {h.status === "COMPLETED" ? "done" : h.status.toLowerCase().replace("_", " ")}
                  </a>
                ))}
              </div>
            ) : null}

            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">What&apos;s wrong · {familyLabel(family)}</span>
              <div className="bps-chips" data-repair-reasons>
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={`bps-chip${reasons.includes(c.key) ? " is-on" : ""}`}
                    aria-pressed={reasons.includes(c.key)}
                    onClick={() => setReasons((cur) => (cur.includes(c.key) ? cur.filter((k) => k !== c.key) : [...cur, c.key]))}
                    data-reason={c.key}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {partsFirst ? <div className="rps-tip" data-repair-parts>Usually needs a part — have it ordered and in the van before the day.</div> : null}
            </div>

            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Note for the installer</span>
              <textarea className="bps-in" rows={3} maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Back left corner over the garage drips in heavy rain. Client is home after 3." data-repair-note />
            </label>

            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Photos from the client</span>
              <div className="rps-photos">
                {photos.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="rps-photo" data-repair-photo>
                    {f.name || `photo ${i + 1}`}
                    <button type="button" aria-label="Remove" onClick={() => setPhotos((cur) => cur.filter((_, k) => k !== i))}>
                      ×
                    </button>
                  </span>
                ))}
                {photos.length < MAX_PHOTOS ? (
                  <button type="button" className="bps-btn bps-btn--ghost bps-btn--sm" onClick={() => fileRef.current?.click()} data-repair-photos-add>
                    + Add photos
                  </button>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
                    setPhotos((cur) => [...cur, ...list].slice(0, MAX_PHOTOS));
                    e.target.value = "";
                  }}
                  data-repair-photos-input
                />
              </div>
            </div>

            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Why it came back</span>
              <div className="bps-seg rps-seg" role="group" data-repair-cause>
                {REPAIR_CAUSES.map((c) => (
                  <button key={c.key} type="button" className={cause === c.key ? "is-on" : ""} aria-pressed={cause === c.key} onClick={() => setCause(c.key)} data-cause={c.key}>
                    {c.label}
                  </button>
                ))}
                <button type="button" className={cause === null ? "is-on" : ""} aria-pressed={cause === null} onClick={() => setCause(null)} data-cause="">
                  Not sure
                </button>
              </div>
              <span className="bps-hint">{causeHint}</span>
            </div>

            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Who pays</span>
              <div className="bps-seg rps-seg" role="group" data-repair-pays>
                <button
                  type="button"
                  className={!billable ? "is-on" : ""}
                  aria-pressed={!billable}
                  onClick={() => {
                    setBillable(false);
                    setBillTouched(true);
                  }}
                  data-pays="warranty"
                >
                  Warranty — free
                </button>
                <button
                  type="button"
                  className={billable ? "is-on" : ""}
                  aria-pressed={billable}
                  onClick={() => {
                    setBillable(true);
                    setBillTouched(true);
                  }}
                  data-pays="billable"
                >
                  Billable
                </button>
              </div>
              {billable ? (
                <div className="rps-bill">
                  <label className="rps-inline">
                    <span>Charge the client</span>
                    <input className="bps-in rps-money" inputMode="decimal" placeholder="250" value={charge} onChange={(e) => setCharge(e.target.value)} data-repair-charge />
                    <span className="bps-hint">before tax</span>
                  </label>
                  {hasContract ? (
                    <label className="rps-check">
                      <input type="checkbox" checked={sendCo} onChange={(e) => setSendCo(e.target.checked)} data-repair-send-co />
                      <span>Send the client a change order to approve now (else it waits as a draft on the job)</span>
                    </label>
                  ) : (
                    <span className="bps-hint">No contract on this job — the charge is noted on the repair; invoice it from Financials.</span>
                  )}
                </div>
              ) : (
                <span className="bps-hint">Free to the client. What the repair costs — the crew&apos;s pay and receipts — comes off this job&apos;s profit.</span>
              )}
            </div>

            <label className="bps-fld">
              <span className="bps-lbl">Who goes</span>
              <select
                className="bps-in"
                value={workerId}
                onChange={(e) => {
                  setWorkerId(e.target.value);
                  setPayTouched(false);
                }}
                data-repair-worker
              >
                <option value="">Nobody yet — choose on the calendar</option>
                {data.crew.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {job?.crew.some((c) => c.id === w.id) ? " · did this job" : ""}
                    {w.role !== "INSTALLER" ? ` · ${w.role.toLowerCase()}` : ""}
                    {w.usualPay ? ` · usually ${money(w.usualPay)}` : ""}
                    {!w.phone ? " · no texts" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Their pay for it</span>
              <input
                className="bps-in"
                inputMode="decimal"
                placeholder="150"
                value={pay}
                onChange={(e) => {
                  setPay(e.target.value);
                  setPayTouched(true);
                }}
                data-repair-pay
              />
            </label>

            <div className="bps-fld bps-fld--wide">
              <span className="bps-lbl">When</span>
              <div className="bps-seg rps-seg" role="group">
                <button type="button" className={!later ? "is-on" : ""} aria-pressed={!later} onClick={() => setLater(false)} data-when="time">
                  Pick a time
                </button>
                <button type="button" className={later ? "is-on" : ""} aria-pressed={later} onClick={() => setLater(true)} data-when="later">
                  Leave it on To place
                </button>
              </div>
              {later ? (
                <span className="bps-hint">It waits on the calendar&apos;s To place list under Repairs — drag it onto a day.</span>
              ) : (
                <>
                  <div className="rps-when">
                    <input className="bps-in" type="date" min={data.today} value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day" data-repair-day />
                    <input className="bps-in" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} aria-label="Time" data-repair-time />
                    <select className="bps-in" value={hours} onChange={(e) => setHours(Number(e.target.value))} aria-label="How long" data-repair-hours>
                      {REPAIR_HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h} h
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rps-offers" data-repair-offers>
                    <span className="bps-hint">{offers === null ? "Finding the first open times…" : offers.length ? `First open times${worker ? ` for ${worker.name.split(" ")[0]}` : ""}:` : "No open time in the next three weeks — pick one by hand."}</span>
                    {offers?.map((o) => (
                      <button
                        key={`${o.workerId}-${o.day}-${o.start}`}
                        type="button"
                        className={`bps-chip${day === o.day && time === o.start && (!workerId || workerId === o.workerId) ? " is-on" : ""}`}
                        onClick={() => {
                          setDay(o.day);
                          setTime(o.start);
                          if (o.workerId !== workerId) {
                            setWorkerId(o.workerId);
                            setPayTouched(false);
                          }
                        }}
                        data-repair-offer
                      >
                        {workerId ? o.words.replace(/ — [^—]+$/, "") : o.words}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {err ? (
              <div className="bps-err" role="alert" data-repair-err>
                {err}
                {clash?.map((c, i) => (
                  <div key={i} className="rps-clash">
                    {c.name}: {c.what} · {c.when}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </BlueprintSheet>
  );
}
