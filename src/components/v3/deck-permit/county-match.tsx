"use client";
// MATCH THE COUNTY'S REQUIREMENTS (2026-11-09, the plan set's Edit, part 2). Owner: "upload his file or just a text of
// what their specific county or city wants to see … and it will remodify that current permit set … into their
// requirements", and: "make option as well look for requirements for decks or detached decks, gazebos for this or
// this city or county and the AI look at it and creates permit plans and construction plan."
//
// Three ways in — Find them for me (the department's own published list, searched online for the place and what is
// being built), upload the department's checklist (PDF, Word, Excel, a photo, a screenshot), or paste its words —
// then one review: what the set already shows (Show it), what JobFlex will add or change (ticked; untick any), and
// what is the contractor's to do (a change to the design is never made here: Change it in the studio). Apply makes
// the ticked changes as ordinary edits (one Undo) and the design figures, notes and sheet size in the panel above.
import * as React from "react";
import { createPortal } from "react-dom";
import type { Route } from "next";
import Link from "next/link";
import { checkCountyRequirements, keptCountyRequirements, type CheckResult } from "@/actions/deckCountyRequirements";
import { applyChecked, keptCheck, wordsCardHtml, type CheckItem, type CountyCheck, type FigureField, type SetSummary } from "@/lib/deck/plans/countyMatch";
import { cardWords, fingerprint, newEditId, type KeptCheck } from "@/lib/deck/plans/edits";
import { fileKind, pdfBudget, photoJpeg } from "@/lib/projectBudgetFiles";
import { usePlanEdit, type PlanEditApi } from "@/components/v3/deck-plans/plan-edit";
import type { SitePlan } from "@/lib/deck/sitePlan";
import { NEED_SHEET } from "./plan-edit-panel";
import s from "./deck-permit.module.css";
import cm from "./county-match.module.css";

export type BuildKind = "deck-attached" | "deck-free" | "covered" | "gazebo" | "pergola";
export const BUILD_LABEL: Record<BuildKind, string> = {
  "deck-attached": "Deck attached to the house",
  "deck-free": "Free-standing deck",
  covered: "Covered deck / patio cover",
  gazebo: "Gazebo or pavilion",
  pergola: "Pergola",
};
const BUILD_SHORT: Record<BuildKind, string> = { "deck-attached": "a deck attached to the house", "deck-free": "a free-standing deck", covered: "a covered deck", gazebo: "a gazebo", pergola: "a pergola" };

type Place = { state: string; county: string; city: string | null } | null;

/** The set as the model is told it: its sheets, its cards in the order they print (their words cut), its figures. */
function summaryOf(api: PlanEditApi, figures: string, paper: string, place: string): SetSummary {
  const sheets = api.sheets.map((sh) => ({ id: sh.editId.slice("sheet:".length), no: sh.no, name: sh.name, out: sh.out, need: !!NEED_SHEET[sh.kind] }));
  const byNo = new Map(api.sheets.map((sh) => [sh.no, sh.editId.slice("sheet:".length)]));
  const cards: SetSummary["cards"] = [];
  document.querySelectorAll<HTMLElement>("[data-plan-sheet] [data-card-id]").forEach((el) => {
    if (cards.length >= 160 || el.hasAttribute("data-card-out")) return;
    const id = el.dataset.cardId ?? "";
    const meta = api.metaOf(id);
    if (!meta) return;
    cards.push({
      id,
      sheet: byNo.get(meta.sheetNo) ?? id.split("/")[0],
      sheetNo: meta.sheetNo,
      label: meta.label.slice(0, 120),
      drawing: meta.drawing,
      addable: !meta.drawing && !meta.noAdd && !el.parentElement?.closest("[data-card-drawing]"),
      need: !!meta.need,
      text: cardWords(el.textContent ?? "").slice(0, meta.drawing ? 160 : 500),
    });
  });
  return { set: api.set, sheets, cards, figures: figures.slice(0, 1200), paper, place };
}

/** The two ways into it, beside Edit: the county's requirements, or the contractor's own words. */
export function CountyMatchButtons(props: { place: Place; placeWords: string | null; build: BuildKind; figures: string; paper: string; plan: SitePlan; update: (p: SitePlan) => void; studioHref: string }) {
  const api = usePlanEdit();
  const [open, setOpen] = React.useState<"county" | "ask" | null>(null);
  if (!api?.canEdit) return null;
  return (
    <>
      <button type="button" className={s.btn} onClick={() => setOpen("county")} data-county-open>
        Match county requirements
      </button>
      <button type="button" className={s.btn} onClick={() => setOpen("ask")} data-ask-open>
        Tell AI what you want
      </button>
      {open ? <CountyMatchSheet {...props} first={open} api={api} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

type Step = { at: "start" } | { at: "reading"; words: string } | { at: "review"; res: Extract<CheckResult, { ok: true }> };

function CountyMatchSheet({ api, first, place, placeWords, build: build0, figures, paper, plan, update, studioHref, onClose }: { api: PlanEditApi; first: "county" | "ask"; place: Place; placeWords: string | null; build: BuildKind; figures: string; paper: string; plan: SitePlan; update: (p: SitePlan) => void; studioHref: string; onClose: () => void }) {
  const [build, setBuild] = React.useState<BuildKind>(build0);
  const [step, setStep] = React.useState<Step>({ at: "start" });
  const [error, setError] = React.useState("");
  const [text, setText] = React.useState("");
  const [ask, setAsk] = React.useState("");
  const [ticks, setTicks] = React.useState<Record<string, boolean>>({});
  const [kept, setKept] = React.useState<{ build: BuildKind; at: string; from: string; department: string; sources: number } | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  // A list already found or uploaded for this place and build.
  React.useEffect(() => {
    let live = true;
    if (!place) return;
    keptCountyRequirements({ place, build })
      .then((r) => {
        if (live && r.ok && r.kept) setKept({ build, at: r.kept.at, from: r.kept.from, department: r.kept.department, sources: r.kept.sources.length });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [place, build]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step.at !== "reading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, step.at]);

  const run = async (mode: "upload" | "find" | "kept" | "ask", fill: (f: FormData) => Promise<void> | void, words: string, refresh = false) => {
    setError("");
    setStep({ at: "reading", words });
    try {
      const f = new FormData();
      f.set("mode", mode);
      f.set("set", JSON.stringify(summaryOf(api, figures, paper, placeWords ?? "")));
      f.set("place", JSON.stringify(place));
      f.set("build", build);
      if (refresh) f.set("refresh", "1");
      await fill(f);
      const res = await checkCountyRequirements(f);
      if (!res.ok) {
        setError(res.error);
        setStep({ at: "start" });
        return;
      }
      setTicks(Object.fromEntries(res.check.items.filter((i) => i.status === "add").map((i) => [i.id, i.on])));
      setStep({ at: "review", res });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't read that. Try again, or paste the requirements' words.");
      setStep({ at: "start" });
    }
  };
  const onFile = (file: File) => {
    const kind = fileKind(file);
    void run(
      "upload",
      async (f) => {
        f.set("source", "file");
        if (kind === "words") f.set("text", (await file.text()).slice(0, 60_000));
        else if (kind === "office") f.set("file", file);
        else if (kind === "pdf") {
          const pdf = await pdfBudget(file);
          if (pdf.text) f.set("text", pdf.text);
          pdf.images.forEach((b, i) => f.append("image", new File([b], `page-${i + 1}.jpg`, { type: "image/jpeg" })));
        } else if (kind === "picture") f.append("image", new File([await photoJpeg(file)], "photo.jpg", { type: "image/jpeg" }));
        else throw new Error("JobFlex reads PDF, Word, Excel, text and photos. Paste the requirements' words for anything else.");
      },
      `Reading ${file.name}…`,
    );
  };

  const apply = (res: Extract<CheckResult, { ok: true }>) => {
    const check = res.check;
    const chosen = check.items.filter((i) => i.status === "add" && ticks[i.id]);
    const summary = summaryOf(api, figures, paper, placeWords ?? "");
    // A card rewritten: the design's own words fingerprinted (the card itself, or the copy kept beside an edited one).
    const wasOf = (id: string) => {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
      const orig = el?.nextElementSibling?.hasAttribute("data-card-orig") ? el.nextElementSibling : el;
      return orig ? fingerprint(orig.textContent ?? "") : "";
    };
    const r = applyChecked(chosen, api.edits, summary, check.place || placeWords || "", wasOf);
    // The department's notes go to its own list on G-002 (12 at most); any past that — and every note on the crew's
    // set, which has no G-002 — a card of their own.
    const j = plan.jurisdiction;
    const room = api.set === "permit" ? Math.max(0, 12 - j.notes.length) : 0;
    const toPanel = r.notes.slice(0, room);
    const extra = r.notes.slice(room);
    let edits = r.edits;
    if (extra.length) {
      const after = api.set === "permit" ? "notes/general-notes" : "crew-cover/index";
      edits = { ...edits, added: [...edits.added, { id: newEditId("add"), after, html: wordsCardHtml(res.from === "ask" ? "Notes" : `${check.department || "Department"} notes`, extra) }] };
    }
    // The county's check is kept with the set (its to-do stays in the panel); a request in the contractor's own words is not.
    const kept: KeptCheck | null | undefined = res.from === "ask" ? api.edits.check : keptCheck(check, new Set(chosen.map((i) => i.id)), new Date().toISOString(), res.from, res.sources);
    api.change(() => ({ ...edits, check: kept ?? null }));
    const figs = r.figures as Partial<Record<FigureField, string | number>>;
    if (toPanel.length || Object.keys(figs).length || r.paper) {
      update({
        ...plan,
        jurisdiction: { ...j, ...(figs as Partial<typeof j>), notes: [...j.notes, ...toPanel] },
        sheets: r.paper ? { ...plan.sheets, paper: r.paper } : plan.sheets,
      });
    }
    onClose();
  };

  const showIt = (where: string) => {
    onClose();
    if (!api.editing) api.setEditing(true);
    if (where.startsWith("sheet:")) {
      const sh = api.sheets.find((x) => x.editId === where);
      if (sh) window.setTimeout(() => document.querySelector(`[data-plan-sheet="${sh.no}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
      return;
    }
    window.setTimeout(() => api.select(where, true), 60);
  };

  let body: React.ReactNode;
  if (step.at === "reading") {
    body = (
      <div className={cm.reading} data-county-reading>
        <div className={cm.spinner} aria-hidden />
        <b>{step.words}</b>
        <span>It reads every requirement and checks the set against it — up to a minute.</span>
      </div>
    );
  } else if (step.at === "review") {
    body = <Review res={step.res} ticks={ticks} setTicks={setTicks} showIt={showIt} studioHref={studioHref} />;
  } else {
    const where = placeWords ?? "the county";
    const askWay = (
      <div className={`${cm.way} ${cm.wayAsk}`} key="ask">
        <div className={cm.wayHead}>Tell AI what you want</div>
        <p>In your own words — what to take out, what to add, what a card should say. You see every change before it&apos;s made.</p>
        <textarea
          rows={4}
          value={ask}
          autoFocus={first === "ask"}
          onChange={(e) => setAsk(e.target.value)}
          placeholder="e.g. Take out the elevations and the materials list. Add a note: all fasteners hot-dip galvanized. Show the septic tank 40 ft behind the deck on the site plan."
          data-ask-text
        />
        <button type="button" className={`${s.btn} ${first === "ask" ? s.btnPrimary : ""}`} disabled={ask.trim().length < 3} onClick={() => run("ask", (f) => f.set("text", ask), "Working out the changes…")} data-ask-go>
          Make the changes
        </button>
      </div>
    );
    body = (
      <div className={cm.start}>
        {first === "ask" ? askWay : null}
        <label className={cm.buildRow}>
          <span>What&apos;s being built</span>
          <select value={build} onChange={(e) => setBuild(e.target.value as BuildKind)} data-county-build>
            {(Object.keys(BUILD_LABEL) as BuildKind[]).map((k) => (
              <option key={k} value={k}>{BUILD_LABEL[k]}</option>
            ))}
          </select>
        </label>
        {error ? <div className={s.alertFail} data-county-error>{error}</div> : null}
        {kept && kept.build === build ? (
          <div className={cm.kept} data-county-kept>
            <div>
              <b>{kept.department || where}&apos;s list is on file</b>
              <span>{kept.from === "online" ? `Found online` : "From your upload"} {kept.at ? `on ${new Date(kept.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}{kept.sources ? ` · ${kept.sources} source${kept.sources === 1 ? "" : "s"}` : ""}</span>
            </div>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => run("kept", () => undefined, `Checking the set against ${kept.department || where}'s list…`)} data-county-use-kept>
              Check this set against it
            </button>
          </div>
        ) : null}
        <div className={cm.ways}>
          <div className={cm.way}>
            <div className={cm.wayHead}>Find them for me</div>
            <p>JobFlex looks up {where}&apos;s own published requirements for {BUILD_SHORT[build]} — its permit guide and submittal checklist — and checks this set against them. Its sources are listed for you to confirm.</p>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={!place} onClick={() => run("find", () => undefined, `Looking up ${where}'s requirements for ${BUILD_SHORT[build]}…`, !!kept && kept.build === build)} data-county-find>
              {kept && kept.build === build ? "Search again" : "Find the requirements"}
            </button>
            {!place ? <small>Set the job&apos;s address in the studio first — the county is read from it (or type the county and state under Title block).</small> : null}
          </div>
          <div className={cm.way}>
            <div className={cm.wayHead}>Upload the department&apos;s list</div>
            <p>Its checklist, handout or the email it sent: PDF, Word, Excel, a photo or a screenshot.</p>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.htm,.html,image/*"
              className={cm.file}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onFile(f);
              }}
              data-county-file
            />
            <button type="button" className={s.btn} onClick={() => fileRef.current?.click()}>
              Choose a file or photo
            </button>
          </div>
          <div className={cm.way}>
            <div className={cm.wayHead}>Paste its words</div>
            <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste what the department asks to see on the plans…" data-county-text />
            <button type="button" className={s.btn} disabled={text.trim().length < 20} onClick={() => run("upload", (f) => f.set("text", text), "Reading what you pasted…")} data-county-paste>
              Check the set
            </button>
          </div>
        </div>
        {first === "county" ? askWay : null}
      </div>
    );
  }
  const res = step.at === "review" ? step.res : null;
  const nTicked = res ? res.check.items.filter((i) => i.status === "add" && ticks[i.id]).length : 0;
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={cm.scrim} onClick={(e) => e.target === e.currentTarget && step.at !== "reading" && onClose()} data-county-sheet>
      <div className={cm.box} role="dialog" aria-modal="true" aria-label="Match the county's requirements">
        <div className={cm.head}>
          <div>
            <span>{api.set === "crew" ? "Construction set" : "Permit set"}{placeWords ? ` · ${placeWords}` : ""}</span>
            <b>{res ? (res.from === "ask" ? "Your changes" : res.check.department || res.check.place || "The department's requirements") : first === "ask" ? "Tell AI what you want on the set" : "Match the county's requirements"}</b>
          </div>
          <button type="button" className={s.btnSm} onClick={onClose} disabled={step.at === "reading"} aria-label="Close">×</button>
        </div>
        <div className={cm.body}>{body}</div>
        {res ? (
          <div className={cm.foot}>
            <button type="button" className={s.btn} onClick={() => setStep({ at: "start" })}>Back</button>
            <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => apply(res)} data-county-apply>
              {nTicked ? `Apply ${nTicked} change${nTicked === 1 ? "" : "s"}` : "Keep the list"}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function Review({ res, ticks, setTicks, showIt, studioHref }: { res: Extract<CheckResult, { ok: true }>; ticks: Record<string, boolean>; setTicks: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; showIt: (where: string) => void; studioHref: string }) {
  const c: CountyCheck = res.check;
  const adds = c.items.filter((i) => i.status === "add");
  const ons = c.items.filter((i) => i.status === "on_set");
  const yous = c.items.filter((i) => i.status === "you");
  const fromWords = res.from === "ask" ? "What you asked" : res.from === "online" ? "Found online" : res.from === "kept" ? `The list on file${res.keptAt ? ` (${new Date(res.keptAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : ""}` : res.from === "paste" ? "What you pasted" : "Your file";
  return (
    <div className={cm.review} data-county-review>
      <p className={cm.about}>
        <b>{fromWords}.</b> {c.about} {res.from === "online" || (res.from === "kept" && res.sources.length) ? "Found on the web — confirm with the department before you submit." : ""}
      </p>
      {res.sources.length ? (
        <ul className={cm.sources} data-county-sources>
          {res.sources.map((x) => (
            <li key={x.url}>
              <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.url}</a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={cm.counts}>
        <span><b>{ons.length}</b> already on the set</span>
        <span><b>{adds.length}</b> {res.from === "ask" ? "changes" : "JobFlex can add"}</span>
        <span><b>{yous.length}</b> for you</span>
      </div>
      {adds.length ? (
        <section className={cm.group} data-county-group="add">
          <h3>JobFlex will add or change — untick any you don&apos;t want</h3>
          {adds.map((i) => (
            <label key={i.id} className={cm.item} data-county-item={i.id}>
              <input type="checkbox" checked={!!ticks[i.id]} onChange={(e) => setTicks((t) => ({ ...t, [i.id]: e.target.checked }))} />
              <span>
                <b>{i.change}</b>
                <Need i={i} />
              </span>
            </label>
          ))}
        </section>
      ) : null}
      {ons.length ? (
        <section className={cm.group} data-county-group="on">
          <h3>Already on the set</h3>
          {ons.map((i) => (
            <div key={i.id} className={cm.item}>
              <span className={cm.ok}>✓</span>
              <span>
                <b>{i.need}</b>
                {i.whereLabel ? <em>{i.whereLabel}</em> : null}
              </span>
              {i.where ? (
                <button type="button" className={s.linkBtn} onClick={() => showIt(i.where as string)}>
                  Show it
                </button>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
      {yous.length ? (
        <section className={cm.group} data-county-group="you">
          <h3>For you to do</h3>
          {yous.map((i) => (
            <div key={i.id} className={cm.item}>
              <span className={cm.todo}>!</span>
              <span>
                <b>{i.need}</b>
                {i.why ? <em>{i.why}</em> : null}
              </span>
              {i.design ? (
                <Link className={s.linkBtn} href={studioHref as Route} target="_blank">
                  Change it in the studio
                </Link>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
function Need({ i }: { i: CheckItem }) {
  return (
    <em>
      {i.need}
      {i.quote ? ` — “${i.quote}”` : ""}
    </em>
  );
}

/** What the last check found, kept with the set: its counts, its sources, and the contractor's to-do. */
export function CountyCheckSummary({ studioHref }: { studioHref: string }) {
  const api = usePlanEdit();
  const k = api?.edits.check;
  if (!api || !k) return null;
  return (
    <div className={cm.summary} data-county-summary>
      <div className={cm.summaryHead}>
        <b>{k.department || k.place || "The department's requirements"}{k.department && k.place ? ` · ${k.place}` : ""}</b>
        <span>
          Checked {k.at ? new Date(k.at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""} · {k.onSet} already on the set · {k.added} added · {k.todo.length} for you
          {k.from === "online" ? " · found online — confirm with the department" : ""}
        </span>
      </div>
      {k.todo.length ? (
        <ul className={cm.todoList}>
          {k.todo.map((t, i) => (
            <li key={i}>
              <b>{t.need}</b> {t.why}
              {t.design ? (
                <>
                  {" "}
                  <Link className={s.linkBtn} href={studioHref as Route} target="_blank">Change it in the studio</Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {k.sources.length ? (
        <div className={cm.summarySources}>
          Sources:{" "}
          {k.sources.map((x, i) => (
            <React.Fragment key={x.url}>
              {i ? " · " : ""}
              <a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.url}</a>
            </React.Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
