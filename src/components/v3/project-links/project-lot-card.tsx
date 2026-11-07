"use client";
// THE LOT (2026-11-07, part 4 of the plan "Projects: Remodel and New construction"). On a new build, under the Phases
// strip on the desk and the handheld project page: the parcel (its number, acreage, zoning, setbacks, flood zone,
// address — looked up on the county's parcel map the way the deck's site plan does, the rest typed), the utilities
// at the street (from the start questions until the office says otherwise), and the permits with their numbers and
// expiry (one past its day reads red). Every write is actions/projectLot (estimators and managers); everyone else
// reads the card.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lookupProjectLot, saveProjectLot } from "@/actions/projectLot";
import { BlueprintSheet } from "@/components/ui/BlueprintSheet";
import type { PdLot } from "@/components/v3/project-detail-blueprint/project-detail-data";
import { withDefaults, type BuildAnswers } from "@/lib/projectPhases/shared";
import s from "./project-hub.module.css";

type Permit = NonNullable<PdLot["permits"]>[number];
type ParcelDraft = { number: string; zoning: string; setbacks: string; acres: string; floodZone: string; address: string };
type PermitDraft = { index: number | null; name: string; number: string; issued: string; expires: string; status: string };
type UtilDraft = { sewer: string; water: string; power: string; gas: string; fiber: string };

const PERMIT_NAMES = ["Building", "Grading and clearing", "Septic (health district)", "Well", "Driveway approach", "Power service", "Gas service", "Fiber", "Mechanical", "Plumbing", "Electrical (L&I)"];
const dayWords = (iso: string | null | undefined) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");

/** The utilities as the start questions said them, until the office types its own. */
function utilitiesFrom(lot: PdLot, answers: BuildAnswers | null): UtilDraft {
  const a = withDefaults(answers);
  return {
    sewer: lot.utilities?.sewer ?? (a.sewer === "SEPTIC" ? "Septic" : "Sewer at the street"),
    water: lot.utilities?.water ?? (a.water === "WELL" ? "Well" : "Water at the street"),
    power: lot.utilities?.power ?? (a.power === "POLE" ? "From the pole — apply first" : "At the lot"),
    gas: lot.utilities?.gas ?? (a.gas ? "Yes" : "No — all electric"),
    fiber: lot.utilities?.fiber ?? (a.fiber ? "Yes" : "No"),
  };
}

export function ProjectLotCard({ projectId, lot, answers, clientAddress, today, canManage }: { projectId: string; lot: PdLot; answers: BuildAnswers | null; clientAddress: string | null; today: string; canManage: boolean }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [parcel, setParcel] = useState<ParcelDraft | null>(null);
  const [lookup, setLookup] = useState<string | null>(null);
  const [utils, setUtils] = useState<UtilDraft | null>(null);
  const [permit, setPermit] = useState<PermitDraft | null>(null);

  const p = lot.parcel ?? {};
  const u = utilitiesFrom(lot, answers);
  const permits = lot.permits ?? [];

  async function run(key: string, fn: () => Promise<string | null | void>) {
    setBusy(key);
    setNote(null);
    try {
      const words = await fn();
      if (typeof words === "string") setNote(words);
      startTransition(() => router.refresh());
    } catch (err) {
      setNote(err instanceof Error ? err.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  const openParcel = () => setParcel({ number: p.number ?? "", zoning: p.zoning ?? "", setbacks: p.setbacks ?? "", acres: p.acres != null ? String(p.acres) : "", floodZone: p.floodZone ?? "", address: p.address ?? clientAddress ?? "" });
  async function saveParcel() {
    if (!parcel) return;
    const d = parcel;
    setParcel(null);
    await run("parcel", async () => {
      const acres = Number(d.acres.replace(/[^\d.]/g, ""));
      await saveProjectLot(projectId, { parcel: { number: d.number || null, zoning: d.zoning || null, setbacks: d.setbacks || null, acres: d.acres.trim() && Number.isFinite(acres) ? acres : null, floodZone: d.floodZone || null, address: d.address || null } });
      return null;
    });
  }
  async function goLookup() {
    if (lookup == null) return;
    const address = lookup;
    setLookup(null);
    await run("lookup", async () => {
      const r = await lookupProjectLot(projectId, address);
      if (!r.ok) throw new Error(r.error);
      return r.said;
    });
  }
  async function saveUtils() {
    if (!utils) return;
    const d = utils;
    setUtils(null);
    await run("utils", async () => {
      await saveProjectLot(projectId, { utilities: { sewer: d.sewer || null, water: d.water || null, power: d.power || null, gas: d.gas || null, fiber: d.fiber || null } });
      return null;
    });
  }
  async function savePermit(remove = false) {
    if (!permit) return;
    const d = permit;
    setPermit(null);
    await run("permit", async () => {
      const next: Permit[] = permits.map((x) => ({ ...x }));
      const row: Permit = { name: d.name.trim(), number: d.number.trim() || null, issued: /^\d{4}-\d{2}-\d{2}$/.test(d.issued) ? d.issued : null, expires: /^\d{4}-\d{2}-\d{2}$/.test(d.expires) ? d.expires : null, status: d.status.trim() || null };
      if (d.index == null) next.push(row);
      else if (remove) next.splice(d.index, 1);
      else next[d.index] = row;
      await saveProjectLot(projectId, { permits: next.filter((x) => x.name) });
      return null;
    });
  }

  const permitTag = (x: Permit): { text: string; tone: string } => {
    if (x.expires && x.expires < today) return { text: `expired ${dayWords(x.expires)}`, tone: s.tagLate };
    if (x.expires) {
      const days = Math.round((Date.parse(`${x.expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
      if (days <= 30) return { text: `expires ${dayWords(x.expires)}`, tone: s.tagOrdered };
    }
    if (x.status) return { text: x.status, tone: /issued|approved|final/i.test(x.status) ? s.tagIn : "" };
    return { text: x.number ? "issued" : "applied for", tone: x.number ? s.tagIn : "" };
  };

  const facts: Array<{ lbl: string; val: string | null }> = [
    { lbl: "Parcel", val: p.number ?? null },
    { lbl: "Acres", val: p.acres != null ? String(p.acres) : null },
    { lbl: "Zoning", val: p.zoning ?? null },
    { lbl: "Setbacks", val: p.setbacks ?? null },
    { lbl: "Flood zone", val: p.floodZone ?? null },
    { lbl: "Address", val: p.address ?? clientAddress ?? null },
  ];
  const known = facts.filter((f) => f.val);

  return (
    <div className={s.w}>
      <section className={s.card} aria-label="The lot" data-project-lot>
        <div className={s.head}>
          <h3 className={s.title}>The lot</h3>
          <span className={s.headSub} data-lot-head>
            {p.number ? (
              <>
                parcel <b>{p.number}</b>
                {p.acres != null ? ` · ${p.acres} acres` : ""}
                {p.source ? ` · from the county's map${p.lookedUpAt ? ` ${dayWords(p.lookedUpAt)}` : ""}` : ""}
              </>
            ) : (
              "The parcel, the utilities at the street, the permits with their numbers"
            )}
          </span>
          {canManage ? (
            <div className={s.acts}>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setLookup(p.address ?? clientAddress ?? "")} data-lot-lookup>
                {busy === "lookup" ? "Looking up…" : "Look up the parcel"}
              </button>
              <button type="button" className={s.btnSm} disabled={busy !== null} onClick={openParcel} data-lot-edit>
                Edit
              </button>
            </div>
          ) : null}
        </div>
        {note ? (
          <p className={s.note} role="status" data-lot-note>
            {note}
          </p>
        ) : null}

        <div className={s.facts} data-lot-parcel>
          {(known.length ? known : facts.slice(0, 3)).map((f) => (
            <div key={f.lbl} className={s.fact}>
              <span className={s.factLbl}>{f.lbl}</span>
              <span className={s.factVal}>{f.val ?? "—"}</span>
            </div>
          ))}
        </div>
        {!p.zoning || !p.setbacks || !p.floodZone ? <p className={s.lineSub} style={{ marginTop: 8 }}>Zoning, setbacks and the flood zone are not on the county&apos;s parcel record — type them from the county&apos;s site with Edit.</p> : null}

        <div className={s.group} data-lot-utilities>
          <div className={s.groupHead}>
            <span>Utilities at the street</span>
            {canManage ? (
              <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => setUtils(u)} data-lot-utilities-edit>
                edit
              </button>
            ) : null}
          </div>
          <div className={s.facts}>
            {(
              [
                ["Sewer", u.sewer],
                ["Water", u.water],
                ["Power", u.power],
                ["Gas", u.gas],
                ["Fiber", u.fiber],
              ] as const
            ).map(([lbl, val]) => (
              <div key={lbl} className={s.fact}>
                <span className={s.factLbl}>{lbl}</span>
                <span className={s.factVal}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={s.group} data-lot-permits>
          <div className={s.groupHead}>
            <span>Permits</span>
            <span>
              {permits.length ? `· ${permits.filter((x) => x.number).length} issued of ${permits.length}` : "· none listed yet"}
              {canManage ? (
                <>
                  {" "}
                  <button type="button" className={s.lineBtn} disabled={busy !== null} onClick={() => setPermit({ index: null, name: "", number: "", issued: "", expires: "", status: "" })} data-lot-permit-add>
                    + permit
                  </button>
                </>
              ) : null}
            </span>
          </div>
          {permits.map((x, i) => {
            const tag = permitTag(x);
            return (
              <div key={`${x.name}:${i}`} className={s.line} style={{ gridTemplateColumns: "minmax(0,1fr) auto" }} data-lot-permit>
                <span className={s.lineName}>
                  {x.name}
                  <span className={`${s.tag} ${tag.tone}`} style={{ marginLeft: 8 }} data-lot-permit-tag>
                    {tag.text}
                  </span>
                  <span className={s.lineSub} style={{ display: "block" }}>
                    {[x.number ? `no. ${x.number}` : null, x.issued ? `issued ${dayWords(x.issued)}` : null, x.expires ? `expires ${dayWords(x.expires)}` : null].filter(Boolean).join(" · ") || "no number yet"}
                  </span>
                </span>
                <span className={s.rowActs}>
                  {canManage ? (
                    <button type="button" className={s.btnSm} disabled={busy !== null} onClick={() => setPermit({ index: i, name: x.name, number: x.number ?? "", issued: x.issued ?? "", expires: x.expires ?? "", status: x.status ?? "" })} aria-label={`Edit ${x.name}`} data-lot-permit-edit>
                      Edit
                    </button>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* THE PARCEL, typed — the lookup fills the number, the acreage and the address; the rest comes from the county's site. */}
      <BlueprintSheet
        open={parcel !== null}
        onClose={() => setParcel(null)}
        title="The parcel"
        description="The number, the acreage and the address come from the county's map; zoning, setbacks and the flood zone from the county's site."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setParcel(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void saveParcel()} data-lot-save>
              Save
            </button>
          </>
        }
      >
        {parcel ? (
          <div className="bps-form" data-lot-sheet>
            <label className="bps-fld">
              <span className="bps-lbl">Parcel number</span>
              <input className="bps-in" value={parcel.number} onChange={(e) => setParcel({ ...parcel, number: e.target.value })} placeholder="00531900002300" maxLength={60} autoFocus data-lot-number />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Acres</span>
              <input className="bps-in" inputMode="decimal" value={parcel.acres} onChange={(e) => setParcel({ ...parcel, acres: e.target.value })} placeholder="1.25" data-lot-acres />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Zoning</span>
              <input className="bps-in" value={parcel.zoning} onChange={(e) => setParcel({ ...parcel, zoning: e.target.value })} placeholder="R-5" maxLength={80} data-lot-zoning />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Flood zone</span>
              <input className="bps-in" value={parcel.floodZone} onChange={(e) => setParcel({ ...parcel, floodZone: e.target.value })} placeholder="X (outside the floodplain)" maxLength={80} data-lot-flood />
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Setbacks</span>
              <input className="bps-in" value={parcel.setbacks} onChange={(e) => setParcel({ ...parcel, setbacks: e.target.value })} placeholder="Front 25 ft · sides 5 ft · rear 25 ft" maxLength={200} data-lot-setbacks />
            </label>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Address</span>
              <input className="bps-in" value={parcel.address} onChange={(e) => setParcel({ ...parcel, address: e.target.value })} placeholder="12103 202nd St SE, Snohomish, WA" maxLength={200} data-lot-address-typed />
            </label>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* LOOK UP THE PARCEL — the address, then the county's map. */}
      <BlueprintSheet
        open={lookup !== null}
        onClose={() => setLookup(null)}
        title="Look up the parcel"
        description="The county's parcel map at this address: the parcel number, the acreage, the owner on record. It is read once and kept on file."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setLookup(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !lookup || lookup.trim().length < 8} onClick={() => void goLookup()} data-lot-lookup-go>
              Look it up
            </button>
          </>
        }
      >
        {lookup !== null ? (
          <div className="bps-form" data-lot-lookup-sheet>
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">The lot&apos;s address</span>
              <input className="bps-in" value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="12103 202nd St SE, Snohomish, WA" maxLength={300} autoFocus data-lot-address />
            </label>
          </div>
        ) : null}
      </BlueprintSheet>

      {/* THE UTILITIES, in the office's words. */}
      <BlueprintSheet
        open={utils !== null}
        onClose={() => setUtils(null)}
        title="Utilities at the street"
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setUtils(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null} onClick={() => void saveUtils()} data-lot-utilities-save>
              Save
            </button>
          </>
        }
      >
        {utils ? (
          <div className="bps-form" data-lot-utilities-sheet>
            {(["sewer", "water", "power", "gas", "fiber"] as const).map((k) => (
              <label key={k} className="bps-fld">
                <span className="bps-lbl">{k[0].toUpperCase() + k.slice(1)}</span>
                <input className="bps-in" value={utils[k]} onChange={(e) => setUtils({ ...utils, [k]: e.target.value })} maxLength={80} />
              </label>
            ))}
          </div>
        ) : null}
      </BlueprintSheet>

      {/* ONE PERMIT — its name, number, the days. */}
      <BlueprintSheet
        open={permit !== null}
        onClose={() => setPermit(null)}
        title={permit?.index != null ? "Edit permit" : "Permit"}
        description="The permit's number once it is issued, the day it was issued and the day it expires — the card reads red past it."
        footer={
          <>
            <button type="button" className="bps-btn bps-btn--ghost" onClick={() => setPermit(null)}>
              Cancel
            </button>
            <button type="button" className="bps-btn bps-btn--primary" disabled={busy !== null || !permit?.name.trim()} onClick={() => void savePermit()} data-lot-permit-save>
              {permit?.index != null ? "Save" : "Add"}
            </button>
          </>
        }
      >
        {permit ? (
          <div className="bps-form" data-lot-permit-sheet>
            {permit.index == null ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`} style={{ marginTop: 0 }}>
                {PERMIT_NAMES.map((n) => (
                  <button key={n} type="button" className="bps-btn bps-btn--ghost" onClick={() => setPermit({ ...permit, name: n })}>
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="bps-fld bps-fld--wide">
              <span className="bps-lbl">Permit</span>
              <input className="bps-in" value={permit.name} onChange={(e) => setPermit({ ...permit, name: e.target.value })} placeholder="Building" maxLength={120} autoFocus data-lot-permit-name />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Number</span>
              <input className="bps-in" value={permit.number} onChange={(e) => setPermit({ ...permit, number: e.target.value })} placeholder="BLD-2026-01234" maxLength={60} data-lot-permit-number />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Status</span>
              <input className="bps-in" value={permit.status} onChange={(e) => setPermit({ ...permit, status: e.target.value })} placeholder="applied · issued · final" maxLength={40} data-lot-permit-status />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Issued</span>
              <input className="bps-in" type="date" value={permit.issued} onChange={(e) => setPermit({ ...permit, issued: e.target.value })} data-lot-permit-issued />
            </label>
            <label className="bps-fld">
              <span className="bps-lbl">Expires</span>
              <input className="bps-in" type="date" value={permit.expires} onChange={(e) => setPermit({ ...permit, expires: e.target.value })} data-lot-permit-expires />
            </label>
            {permit.index != null ? (
              <div className={`bps-fld bps-fld--wide ${s.chips}`}>
                <button type="button" className="bps-btn bps-btn--ghost" disabled={busy !== null} onClick={() => void savePermit(true)} data-lot-permit-delete>
                  Remove permit
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </BlueprintSheet>
    </div>
  );
}
