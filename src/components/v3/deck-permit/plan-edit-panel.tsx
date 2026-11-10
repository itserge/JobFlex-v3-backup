"use client";
// THE PLAN SET'S EDIT, ON SCREEN (2026-11-09) — the panel above the sheets
// (what was changed, the sheets in the set, a sheet to add, a card whose
// design changed, a sheet that runs past its edge) and the bar along the foot
// of the screen that acts on the card picked (type into it, take it out, add a
// card after it, bring it back, back to the design's own words). Nothing here
// prints. The edits themselves: components/v3/deck-plans/plan-edit.
import * as React from "react";
import { bringBack as bringSheetBack, dropSheet, editCount, isBlank, isOut, takeOut as takeSheetOut, type EditedSheet } from "@/lib/deck/plans/edits";
import { ToolButtons, usePlanEdit, type PlanEditApi } from "@/components/v3/deck-plans/plan-edit";
import ps from "@/components/v3/deck-plans/plan-set.module.css";
import s from "./deck-permit.module.css";

/** The sheets a building department nearly always asks for: a heads-up before one is taken out. */
export const NEED_SHEET: Partial<Record<EditedSheet["kind"], string>> = {
  site: "Every building department asks for the site plan.",
  foundation: "Every building department asks for the foundation plan.",
  framing: "Every building department asks for the framing plan.",
  sections: "Most building departments ask for a section through the deck.",
  details: "Most building departments ask for the ledger, post and guard details.",
  notes: "Most building departments ask for the general notes and the code compliance.",
};

/** How many times the other sheets mention a sheet's number ("detail 1/S-501") — not counting the sheet lists. */
function mentionsOf(no: string): number {
  const re = new RegExp(`(^|[^A-Z0-9-])${no.replace(/[-]/g, "\\-")}(?![0-9])`, "g");
  let n = 0;
  document.querySelectorAll<HTMLElement>("[data-plan-sheet]").forEach((sec) => {
    if (sec.dataset.planSheet === no) return;
    const field = sec.querySelector(`.${ps.field}`);
    if (!field) return;
    const copy = field.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[data-card-id$="/index"], [data-card-orig]').forEach((el) => el.remove());
    n += (copy.textContent ?? "").match(re)?.length ?? 0;
  });
  return n;
}

/* ── The panel ──────────────────────────────────────────────────────────── */
export function PlanEditPanel() {
  const api = usePlanEdit();
  if (!api) return null;
  const stale = Object.entries(api.stale);
  const count = editCount(api.edits);
  if (!api.editing) {
    if (!stale.length && !count) return null;
    return (
      <div className={s.editPanel} data-plan-edit-summary>
        <div className={s.editLine}>
          <span>
            {count ? `This ${api.set === "crew" ? "construction" : "permit"} set has ${count} change${count === 1 ? "" : "s"} of yours on it.` : ""}
            {api.status ? <span className={s.editStatus}> {api.status}</span> : null}
          </span>
          {api.canEdit ? (
            <button type="button" className={s.btn} onClick={() => api.setEditing(true)}>
              Edit
            </button>
          ) : null}
        </div>
        <StaleList api={api} items={stale} />
      </div>
    );
  }
  return (
    <div className={s.editPanel} data-plan-edit-panel>
      <div className={s.editHead}>
        <div>
          <div className={s.siteGroupTitle}>Editing the {api.set === "crew" ? "construction set" : "permit set"}</div>
          <p className={s.siteSaid}>
            Tap a card on the sheets to pick it, tap it again to type in it. Take out what your building department does not need; add a card or a sheet for what it asks for. The drawings come from the design — change those in the studio. Every change is kept for this deck{api.status ? ` · ${api.status}` : ""}.
          </p>
        </div>
        <div className={s.panelActions}>
          <button type="button" className={s.btn} disabled={!api.canUndo} onClick={api.undo} data-plan-undo>
            Undo
          </button>
          <ResetButton api={api} />
        </div>
      </div>
      <StaleList api={api} items={stale} />
      {Object.keys(api.overflow).length ? (
        <div className={s.alerts} data-plan-overflow>
          {Object.entries(api.overflow).map(([no, name]) => (
            <div key={no} className={s.alertWarn}>
              <b>{no} · {name}:</b> something on this sheet runs past its edge — the bottom would print cut off. Shorten a card, take one out, or move the words to an added sheet.
            </div>
          ))}
        </div>
      ) : null}
      <SheetList api={api} />
    </div>
  );
}

function StaleList({ api, items }: { api: PlanEditApi; items: Array<[string, { label: string; sheetNo: string }]> }) {
  if (!items.length) return null;
  return (
    <div className={s.alerts} data-plan-stale>
      {items.map(([id, v]) => (
        <div key={id} className={s.alertWarn}>
          <b>{v.sheetNo} · {v.label}:</b> the design changed since you edited this card, so your words may hold old figures.{" "}
          <button
            type="button"
            className={s.linkBtn}
            onClick={() => {
              if (!api.editing) api.setEditing(true);
              window.setTimeout(() => api.select(id, true), 0);
            }}
          >
            Show it
          </button>
        </div>
      ))}
    </div>
  );
}

function ResetButton({ api }: { api: PlanEditApi }) {
  const [ask, setAsk] = React.useState(false);
  if (isBlank(api.edits)) return null;
  if (ask) {
    return (
      <span className={s.askRow}>
        <span>Put every sheet back the way the studio drew it?</span>
        <button type="button" className={s.btn} onClick={() => setAsk(false)}>Keep my edits</button>
        <button
          type="button"
          className={`${s.btn} ${s.btnDanger}`}
          onClick={() => {
            setAsk(false);
            api.resetSet();
          }}
          data-plan-reset-yes
        >
          Start over
        </button>
      </span>
    );
  }
  return (
    <button type="button" className={s.btn} onClick={() => setAsk(true)} data-plan-reset>
      Start over
    </button>
  );
}

function SheetList({ api }: { api: PlanEditApi }) {
  return (
    <div className={s.siteGroup} data-plan-sheet-list>
      <div className={s.siteGroupTitle}>The sheets in this set</div>
      <p className={s.siteSaid}>Untick a sheet to take it out (it comes back with a tick). Type over a name to rename it. Sheets keep their numbers, so the notes that point at them stay right.</p>
      <div className={s.sheetRows}>
        {api.sheets.map((sh) => (
          <SheetRow key={`${sh.editId}|${sh.name}`} api={api} sh={sh} />
        ))}
      </div>
      <div className={s.siteBtns}>
        <button type="button" className={s.btn} onClick={api.addSheet} data-plan-add-sheet>
          + Add a sheet
        </button>
      </div>
    </div>
  );
}

function SheetRow({ api, sh }: { api: PlanEditApi; sh: EditedSheet }) {
  const [name, setName] = React.useState(sh.name);
  const [ask, setAsk] = React.useState<string | null>(null);
  const id = sh.editId.slice("sheet:".length);
  const own = sh.ownName ?? (sh.kind === "extra" ? null : sh.name);
  const saveName = () => {
    const t = name.replace(/\s+/g, " ").trim();
    api.change((e) => {
      const names = { ...e.names };
      if (sh.kind === "extra") return { ...e, sheets: e.sheets.map((x) => (x.id === sh.extraId ? { ...x, name: t || "Additional notes" } : x)) };
      if (!t || t === own) delete names[id];
      else names[id] = t.slice(0, 80);
      return { ...e, names };
    });
  };
  const takeOut = () => api.change((e) => takeSheetOut(e, sh.editId));
  const bringBack = () => api.change((e) => bringSheetBack(e, sh.editId));
  const onTick = (on: boolean) => {
    if (on) return bringBack();
    const refs = mentionsOf(sh.no);
    const need = NEED_SHEET[sh.kind];
    if (refs || need) setAsk([need, refs ? `The other sheets mention ${sh.no} in ${refs} place${refs === 1 ? "" : "s"} — the reviewer will look for it.` : ""].filter(Boolean).join(" "));
    else takeOut();
  };
  return (
    <div className={`${s.sheetRow} ${sh.out ? s.sheetOut : ""}`} data-plan-sheet-row={sh.no}>
      <label className={s.sheetTick}>
        <input type="checkbox" checked={!sh.out} onChange={(e) => onTick(e.target.checked)} aria-label={`${sh.no} in the set`} />
        <b>{sh.no}</b>
      </label>
      <input
        type="text"
        className={s.sheetName}
        value={name}
        placeholder={own ?? "Sheet name"}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        aria-label={`${sh.no} name`}
        data-plan-sheet-name={sh.no}
      />
      {sh.kind === "extra" ? (
        <button type="button" className={s.btn} onClick={() => api.change((e) => dropSheet(e, sh.extraId ?? ""))} data-plan-sheet-delete={sh.no}>
          Delete
        </button>
      ) : sh.out ? (
        <span className={s.sheetMark}>taken out</span>
      ) : null}
      {ask ? (
        <div className={s.askRow} data-plan-sheet-ask>
          <span>{ask} Take it out anyway?</span>
          <button type="button" className={s.btn} onClick={() => setAsk(null)}>Keep it</button>
          <button
            type="button"
            className={`${s.btn} ${s.btnDanger}`}
            onClick={() => {
              setAsk(null);
              takeOut();
            }}
            data-plan-sheet-out
          >
            Take it out
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── The bar along the foot of the screen ───────────────────────────────── */
export function PlanEditBar() {
  const api = usePlanEdit();
  // The heads-up before a card most departments want is deleted — for the card it was asked about only.
  const [asked, setAsked] = React.useState<{ id: string; text: string } | null>(null);
  if (!api?.editing) return null;
  const id = api.selected;
  const ask = asked && asked.id === id ? asked.text : null;
  const setAsk = (text: string | null) => setAsked(text && id ? { id, text } : null);
  const meta = id ? api.metaOf(id) : null;
  const typing = api.typing && !api.typing.full ? api.typing : null;
  let body: React.ReactNode;
  if (typing) {
    const tm = api.metaOf(typing.id);
    body = (
      <>
        <div className={s.barWhat}>
          <span>{tm ? `${tm.sheetNo} · typing` : "Typing"}</span>
          <b>{tm?.label ?? "Card"}</b>
        </div>
        <div className={s.barActs}>
          <ToolButtons api={api} className={s.btn} />
          <button type="button" className={s.btn} onMouseDown={(e) => e.preventDefault()} onClick={() => api.finishTyping(false)} data-plan-bar="cancel">
            Cancel
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onMouseDown={(e) => e.preventDefault()} onClick={() => api.finishTyping(true)} data-plan-bar="done">
            Done
          </button>
        </div>
      </>
    );
  } else if (id && meta) {
    const hidden = isOut(api.edits, id);
    const edited = !!api.edits.cards[id];
    const stale = !!api.stale[id];
    let acts: React.ReactNode;
    let note: string | null = null;
    if (hidden) {
      note = "Taken out — it does not print.";
      acts = (
        <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => api.restoreCard(id)} data-plan-bar="restore">
          Bring it back
        </button>
      );
    } else if (ask) {
      note = `${ask} Delete it anyway?`;
      acts = (
        <>
          <button type="button" className={s.btn} onClick={() => setAsk(null)}>Keep it</button>
          <button
            type="button"
            className={`${s.btn} ${s.btnDanger}`}
            onClick={() => {
              setAsk(null);
              api.deleteCard(id);
            }}
            data-plan-bar="delete-yes"
          >
            Delete
          </button>
        </>
      );
    } else {
      if (stale) note = "The design changed since you edited this card — your words may hold old figures.";
      else if (meta.drawing) note = "A drawing: its lines come from the design — change them in the studio.";
      acts = (
        <>
          {stale ? (
            <>
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => api.originalCard(id)} data-plan-bar="use-new">
                Use the new
              </button>
              <button type="button" className={s.btn} onClick={() => api.keepMine(id)} data-plan-bar="keep-mine">
                Keep mine
              </button>
            </>
          ) : null}
          {!meta.drawing ? (
            <button type="button" className={`${s.btn} ${stale ? "" : s.btnPrimary}`} onClick={() => api.startTyping(id)} data-plan-bar="type">
              Edit text
            </button>
          ) : null}
          <button type="button" className={s.btn} onClick={() => (meta.need ? setAsk(meta.need) : api.deleteCard(id))} data-plan-bar="delete">
            Delete
          </button>
          {!meta.noAdd ? (
            <button type="button" className={s.btn} onClick={() => api.addCardAfter(id)} data-plan-bar="add">
              + Card below
            </button>
          ) : null}
          {edited && !stale ? (
            <button type="button" className={s.btn} onClick={() => api.originalCard(id)} data-plan-bar="original">
              Back to the original
            </button>
          ) : null}
        </>
      );
    }
    body = (
      <>
        <div className={s.barWhat}>
          <span>
            {meta.sheetNo} · {meta.sheetName}
            {edited ? " · edited" : ""}
            {meta.added ? " · added" : ""}
          </span>
          <b>{meta.label}</b>
          {note ? <em>{note}</em> : null}
        </div>
        <div className={s.barActs}>
          {acts}
          <button type="button" className={s.btnSm} onClick={() => api.select(null)} aria-label="Put the card down" data-plan-bar="close">
            ×
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <div className={s.barWhat}>
          <span>Editing</span>
          <b>Tap a card to pick it</b>
        </div>
        <div className={s.barActs}>
          <button type="button" className={s.btn} disabled={!api.canUndo} onClick={api.undo}>
            Undo
          </button>
          <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => api.setEditing(false)} data-plan-bar="finish">
            Done editing
          </button>
        </div>
      </>
    );
  }
  return (
    <div className={s.editBar} role="toolbar" aria-label="Edit the card" data-plan-edit-bar>
      {body}
    </div>
  );
}
