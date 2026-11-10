"use client";
// THE PLAN SET (2026-10-23) — the building department's set on 11 × 17 and the
// crew's set on letter, drawn from the engine (lib/deck) through the plan
// set's drafting (lib/deck/plans). Owner, with a competitor's sample sets in
// hand: "make something like this in our deck studio, but even better and
// more professional. Make it smart. Wow."
//
// Every sheet has the same frame: a binding margin on the left, the title
// block down the right (the contractor, the project, the sheet index, the
// revisions, a box kept clear for the building department's stamp, the sheet's
// name and number). Every view is drawn to a real architect's scale and
// titled the professional way: its number in a bubble, its name over a rule,
// its scale under it.
import * as React from "react";
import type { DeckStructure } from "@/lib/deck/structure";
import type { DeckCheck } from "@/lib/deck/checks";
import { fitView, inFrac, ftInFrac, type View } from "@/lib/deck/plans/draft";
import { planModel, type PlanModel } from "@/lib/deck/plans/model";
import { foundationPlan } from "@/lib/deck/plans/foundation";
import { framingPlan } from "@/lib/deck/plans/framing";
import { elevationView, sectionView, ELEVATION_NAME } from "@/lib/deck/plans/project";
import { floorDetails, stairSection, type PlanDetail } from "@/lib/deck/plans/details";
import { deckScene, type DeckScene } from "@/lib/deck/scene";
import { isoDrawing, isoMarkup, type IsoMaterials } from "@/lib/deck/iso";
import { deckingProduct } from "@/lib/deck/catalog";
import { priceStructure } from "@/lib/deck/pricing";
import { materialList, type MaterialList } from "@/lib/deck/materialList";
import { structureWords, PLACEMENT_LABEL } from "@/lib/deck/design";
import { legendView } from "@/lib/deck/plans/legend";
import { buildSequence, cutList, stringerLayout, stringerView } from "@/lib/deck/plans/crew";
import { lateralDevices } from "@/lib/deck/permit";
import { LEDGER_FASTENER_LABEL, RULE } from "@/lib/deck/codeTables";
import { railNamed } from "@/lib/deck/rails";
import { permitSheetList, crewSheetList, type PlanSheet } from "@/lib/deck/plans/sheets";
import { PAPERS, fitOn, type Paper, type PaperKey } from "@/lib/deck/plans/paper";
import { PlanSvg } from "./plan-svg";
import s from "./plan-set.module.css";

export interface PlanShop {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}
export interface PlanProject {
  /** The deck in words, for the title block. */
  title: string;
  address: string | null;
  owner: string;
  parcel: string | null;
  county: string | null;
  licence: string;
  date: string;
  /** "WSRC 2021" — the short form of the code the deck is checked against. */
  code: string;
}
export interface PlanCriteriaRow {
  label: string;
  value: string;
  source: string;
  short?: boolean;
}
export interface PlanSetProps {
  structure: DeckStructure;
  /** The county's and the state's design criteria (lib/deck/countyCodes designCriteria). */
  criteria?: PlanCriteriaRow[];
  /** The general notes (lib/deck/permit permitNotes, with the county's own). */
  notes?: string[];
  checks: DeckCheck[];
  shop: PlanShop;
  project: PlanProject;
  set: "permit" | "crew";
  /** The permit set's sheet size (lib/deck/plans/paper): 11 × 17 unless the department asks for more room. */
  paper?: PaperKey;
  /** Sheets the caller draws itself (the site plan, with its own panel), by kind. */
  slots?: Partial<Record<PlanSheet["kind"], (sheet: PlanSheet, frame: (children: React.ReactNode, className?: string) => React.ReactNode) => React.ReactNode>>;
}

/* The sheets are drawn in the browser only: thousands of coordinates out of trigonometry round a hair differently on
   the server, and a server render of a 9-sheet set is weight the page does not need before it can print. */
const noSubscribe = () => () => {};
const useInBrowser = () => React.useSyncExternalStore(noSubscribe, () => true, () => false);

/** The sheet the set is drawn on: every permit view fits its frame on it (fitOn). */
const PaperCtx = React.createContext<Paper>(PAPERS.B);
const usePaper = () => React.useContext(PaperCtx);

export function PlanSet(props: PlanSetProps) {
  const inBrowser = useInBrowser();
  if (!inBrowser) return <div className={s.set} data-plan-set={props.set}><div className={s.drawing}>Drawing the sheets…</div></div>;
  return <PlanSetSheets {...props} />;
}

function PlanSetSheets(props: PlanSetProps) {
  const { structure, set } = props;
  const m = React.useMemo(() => planModel(structure), [structure]);
  const scene = React.useMemo(() => deckScene(structure), [structure]);
  const list = React.useMemo(() => materialList(priceStructure(structure)), [structure]);
  const split = React.useMemo(() => splitCompliance(props.checks), [props.checks]);
  const paper = PAPERS[props.paper ?? "B"];
  const sheets = React.useMemo(() => (set === "crew" ? crewSheetList(structure) : permitSheetList(structure, { complianceMore: split[1].length > 0, paper: paper.key })), [structure, set, split, paper]);
  return (
    <PaperCtx.Provider value={paper}>
      <div className={s.set} data-plan-set={set} data-plan-paper={set === "crew" ? "A" : paper.key}>
        {sheets.map((sh, i) => (
          <SheetOf key={sh.no} sheet={sh} index={i} sheets={sheets} m={m} scene={scene} list={list} split={split} {...props} />
        ))}
      </div>
    </PaperCtx.Provider>
  );
}

function SheetOf(p: PlanSetProps & { sheet: PlanSheet; index: number; sheets: PlanSheet[]; m: PlanModel | null; scene: DeckScene; list: MaterialList; split: [DeckCheck[], DeckCheck[]] }) {
  const { sheet, m, scene, list, split } = p;
  const frame = (children: React.ReactNode, className?: string) => (
    <section className={`${s.sheet} ${sheet.paper === "A" ? s.a : sheet.paper === "C" ? s.c : sheet.paper === "D" ? s.d : s.b}`} data-plan-sheet={sheet.no} data-plan-kind={sheet.kind}>
      <div className={s.frame}>
        <div className={`${s.field} ${className ?? ""}`}>{children}</div>
        {sheet.paper !== "A" ? <TitleBlock {...p} /> : <CrewStrip {...p} />}
      </div>
    </section>
  );
  const slot = p.slots?.[sheet.kind];
  if (slot) return <>{slot(sheet, frame)}</>;
  switch (sheet.kind) {
    case "foundation":
      return m ? <>{frame(<FoundationSheet m={m} />, s.foundation)}</> : null;
    case "framing":
      return m ? <>{frame(<FramingSheet m={m} />, s.foundation)}</> : null;
    case "elevations":
      return m ? <>{frame(<ElevationsSheet m={m} scene={scene} />, s.stack2)}</> : null;
    case "sections":
      return m ? <>{frame(<SectionsSheet m={m} scene={scene} />, s.sections)}</> : null;
    case "details":
      return m ? <>{frame(<DetailsSheet m={m} />, s.details)}</> : null;
    case "cover":
      return <>{frame(<CoverSheet {...p} />, s.cover)}</>;
    case "crew-cover":
      return <>{frame(<CrewCover {...p} />, s.crewCover)}</>;
    case "crew-layout":
      return m ? <>{frame(<CrewLayout m={m} />, s.crewCol)}</> : null;
    case "crew-framing":
      return m ? <>{frame(<CrewFraming m={m} />, s.crewCol)}</> : null;
    case "crew-stairs":
      return m ? <>{frame(<CrewStairs m={m} />, s.crewCol)}</> : null;
    case "crew-materials":
      return <>{frame(<CrewMaterials list={list} />, s.crewCol)}</>;
    case "crew-sequence":
      return m ? <>{frame(<CrewSequence m={m} list={list} />, s.crewCol)}</> : null;
    case "notes":
      return <>{frame(<NotesSheet {...p} checks={split[0]} more={split[1].length > 0} />, s.notesSheet)}</>;
    case "notes2":
      return <>{frame(<ComplianceMore checks={split[1]} code={p.structure.code.short} />, s.notesSheet)}</>;
    case "schedules":
      return <>{frame(<SchedulesSheet list={list} m={m} />, s.schedules)}</>;
    default:
      return <>{frame(<div className={s.small}>{sheet.name} — drawn in the next step.</div>)}</>;
  }
}

/* ── The title block ─────────────────────────────────────────────────── */
function TitleBlock({ sheet, sheets, index, shop, project }: PlanSetProps & { sheet: PlanSheet; sheets: PlanSheet[]; index: number }) {
  return (
    <aside className={s.tb} data-plan-titleblock>
      <div className={s.tbCell}>
        <div className={s.tbKick}>Prepared by</div>
        <div className={s.tbShop}>{shop.name || "Contractor"}</div>
        {shop.address ? <div className={s.tbLine}>{shop.address}</div> : null}
        <div className={s.tbLine}>{[shop.phone, shop.email].filter(Boolean).join(" · ") || " "}</div>
        <div className={s.tbLine}>License no. {project.licence || "________________"}</div>
      </div>
      <div className={s.tbCell}>
        <div className={s.tbKick}>Project</div>
        <div className={s.tbProject}>{project.title}</div>
        <div className={s.tbLine}>{project.address ?? "Job address"}</div>
        {project.county ? <div className={s.tbLine}>{project.county}</div> : null}
        {project.parcel ? <div className={s.tbLine}>Parcel {project.parcel}</div> : null}
        <div className={s.tbLine}>Owner: {project.owner || "________________"}</div>
      </div>
      <div className={s.tbCell}>
        <div className={s.tbKick}>Sheet index</div>
        <div className={s.tbIndex}>
          {sheets.map((x) => (
            <React.Fragment key={x.no}>
              <b className={x.no === sheet.no ? s.on : undefined}>{x.no}</b>
              <span className={x.no === sheet.no ? s.on : undefined}>{x.name}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className={s.tbCell} style={{ borderBottom: 0 }}>
        <div className={s.tbKick}>Revisions</div>
        <table className={s.tbRev}>
          <thead>
            <tr><th>No.</th><th>Date</th><th>Description</th></tr>
          </thead>
          <tbody>
            <tr><td>0</td><td>{project.date}</td><td>Issued for permit</td></tr>
            <tr><td /><td /><td /></tr>
            <tr><td /><td /><td /></tr>
          </tbody>
        </table>
      </div>
      <div className={s.tbStamp} aria-label="Reserved for the building department's stamp">Reserved for<br />building department<br />approval stamp</div>
      <div className={s.tbCell}>
        <div className={s.tbMeta}>
          <span>Date</span><b>{project.date}</b>
          <span>Code</span><b>{project.code}</b>
          <span>Drawn</span><b>{shop.name ? initials(shop.name) : "—"} · JobFlex Deck Studio</b>
        </div>
      </div>
      <div className={s.tbSheet}>
        <div className={s.tbSheetName}>{sheet.name}</div>
        <div className={s.tbSheetNo}>{sheet.no}</div>
        <div className={s.tbOf}>Sheet {index + 1} of {sheets.length}</div>
      </div>
      <div className={s.tbFine}>
        Prescriptive deck design to the <b>{project.code} R507</b> deck provisions and the AWC <b>DCA 6</b> tables as adopted, drawn from the contractor&apos;s design. The building department&apos;s review governs. Do not scale the drawings; dimensions govern.
      </div>
    </aside>
  );
}
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

/* ── A view and its title ────────────────────────────────────────────── */
/** A figure titled the professional way: its number over the sheet in a bubble, its name over a rule, its scale under. */
export function ViewFrame({ no, sheetNo, title, scaleLabel, note, children, id, style }: { no: number; sheetNo: string; title: string; scaleLabel: string; note?: string; children: React.ReactNode; id?: string; style?: React.CSSProperties }) {
  return (
    <figure className={s.view} style={{ margin: 0, ...style }} data-plan-figure={id}>
      <div className={s.viewBody}>{children}</div>
      <figcaption className={s.viewTitle}>
        <span className={s.viewNo}>
          <span>{no}</span>
          <i>{sheetNo}</i>
        </span>
        <span>
          <span className={s.viewName}>
            <span>{title}</span>
            {note ? <span className={s.viewScale}>{note}</span> : null}
          </span>
          <span className={s.viewScale}>Scale: {scaleLabel}</span>
        </span>
      </figcaption>
    </figure>
  );
}
function ViewBox({ view, no, sheetNo, style, note }: { view: View; no: number; sheetNo: string; style?: React.CSSProperties; note?: string }) {
  return (
    <ViewFrame no={no} sheetNo={sheetNo} title={view.title} scaleLabel={view.scaleLabel} note={note} id={view.id} style={style}>
      <PlanSvg view={view} />
    </ViewFrame>
  );
}

/* ── S-101 · the foundation plan ─────────────────────────────────────── */
function FoundationSheet({ m }: { m: PlanModel }) {
  const paper = usePaper();
  const view = React.useMemo(() => fitOn(paper, (sc) => foundationPlan(m, sc, {}), 8.9, 9.45), [m, paper]);
  const d = m.s.design;
  const worst = m.bearing.reduce((a, b) => Math.max(a, b.ratio), 0);
  return (
    <>
      <ViewBox view={view} no={1} sheetNo="S-101" />
      <div className={s.side}>
        <div>
          <div className={s.h}>Footing schedule<span>{m.footings.reduce((n, f) => n + f.at.length, 0)} footings</span></div>
          <table className={s.t} data-plan-footing-schedule>
            <thead>
              <tr><th>Tag</th><th className={s.n}>Qty</th><th>Pad</th><th>Pier</th><th className={s.n}>Bottom</th><th>Post</th><th>Basis</th></tr>
            </thead>
            <tbody>
              {m.footings.map((f) => (
                <tr key={f.tag}>
                  <td className={s.k}>{f.tag}</td>
                  <td className={s.n}>{f.at.length}</td>
                  {f.kind === "stair-pad" ? (
                    <td colSpan={2}>Landing pad, {inFrac(f.thickIn)} thick</td>
                  ) : f.type === "poured" ? (
                    <>
                      <td>{inFrac(f.padIn)} Ø × {inFrac(f.thickIn)}</td>
                      <td>{inFrac(f.pierIn)} Ø</td>
                    </>
                  ) : (
                    <td colSpan={2}>Precast pier block</td>
                  )}
                  <td className={s.n}>{f.depthIn ? `${inFrac(f.depthIn)} b.g.` : "on grade"}</td>
                  <td>{f.post ?? "—"}</td>
                  <td className={s.rule}>{f.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className={s.h}>Bearing check<span>{d.soilPsf.toLocaleString("en-US")} psf soil</span></div>
          <table className={s.t} data-plan-bearing>
            <thead>
              <tr><th>Post</th><th>Tag</th><th className={s.n}>Carries</th><th className={s.n}>Load</th><th className={s.n}>Needs</th><th className={s.n}>Pad</th><th>Ratio</th></tr>
            </thead>
            <tbody>
              {m.bearing.map((b, i) => (
                <tr key={`${b.grid}-${i}`}>
                  <td className={s.k}>{b.grid}</td>
                  <td className={s.k}>{b.tag}</td>
                  <td className={s.n}>{b.tribSqFt.toFixed(1)} sf</td>
                  <td className={s.n}>{b.totalLb.toLocaleString("en-US")} lb</td>
                  <td className={s.n}>{b.reqAreaSqFt.toFixed(2)} sf · {inFrac(Math.ceil(b.reqDiaIn))}</td>
                  <td className={s.n}>{b.padAreaSqFt.toFixed(2)} sf · {inFrac(b.padIn)}</td>
                  <td>
                    <span className={s.bar}><i className={b.ratio > 0.9 ? s.hi : undefined} style={{ width: `${Math.min(100, b.ratio * 100)}%` }} /></span>
                    <span className={b.ok ? s.ok : s.bad}>{b.ratio.toFixed(2)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s.small} style={{ marginTop: 3 }}>
            Load = the deck each post carries (shaded on the plan) × ({m.f.load} psf live + 10 psf dead). Needs = load ÷ {d.soilPsf.toLocaleString("en-US")} psf presumptive soil bearing (IRC Table R401.4.1). Highest ratio {worst.toFixed(2)}{worst <= 1.0001 ? " — every footing bears." : " — a pad over 1.00 needs to be wider before submitting."}
          </div>
        </div>
        <div>
          <div className={s.h}>Layout<span>to post centres</span></div>
          <table className={s.t} data-plan-layout>
            <thead>
              <tr><th>Point</th><th className={s.n}>Along the house</th><th className={s.n}>Out from it</th><th>What</th></tr>
            </thead>
            <tbody>
              {m.layout.points.map((pt, i) => (
                <tr key={`${pt.name}-${i}`}>
                  <td className={s.k}>{pt.name}</td>
                  <td className={s.n}>{ftInFrac(pt.x, 8)}</td>
                  <td className={s.n}>{ftInFrac(pt.y, 8)}</td>
                  <td>{pt.what}</td>
                </tr>
              ))}
              {m.layout.diagonals.map((dg) => (
                <tr key={`${dg.from}-${dg.to}`} className={s.sub}>
                  <td colSpan={2}>Diagonal {dg.from} → {dg.to}</td>
                  <td className={s.n}>{ftInFrac(dg.lengthIn, 8)}</td>
                  <td>square check</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s.small} style={{ marginTop: 3 }}>Datum: {m.layout.origin}. Square the layout when the two diagonals read their figures.</div>
        </div>
        <div>
          <div className={s.h}>Foundation notes</div>
          <ol className={s.notes}>
            <li>Footings bear on undisturbed soil, the bottom at least {inFrac(d.frostIn)} below grade — the frost depth used for this design; the building department may set a deeper one.</li>
            <li>Concrete 2,500 psi at 28 days, minimum. Piers formed with round tubes, the top at least 1&quot; above grade under each post base.</li>
            <li>Posts {m.f.posts[0]?.size ?? "6x6"} preservative-treated for ground contact, on a metal post base anchored to the pier; no post buried in the soil.</li>
            <li>Call 811 at least two business days before digging. Verify every footing location against the layout before pouring.</li>
            <li>Footing inspection before concrete is placed, where the building department requires it.</li>
          </ol>
        </div>
      </div>
    </>
  );
}



/* ── S-102 · the deck framing plan ───────────────────────────────────── */
/** The details on S-501, numbered in the order the sheet draws them. */
export const DETAIL_NO = { ledger: 1, lateral: 2, post: 3, guard: 4, pattern: 5, stringer: 6, bracing: 7, roof: 8, uplift: 9, roofBracing: 10 } as const;
/** Where the building section cuts: the post line nearest the middle of the deck. */
const sectionX = (m: PlanModel) => (m.cols.length ? m.cols[Math.floor((m.cols.length - 1) / 2)].at : m.W / 2);

function FramingSheet({ m }: { m: PlanModel }) {
  const paper = usePaper();
  const view = React.useMemo(
    () => fitOn(paper, (sc) => framingPlan(m, sc, { ledger: m.attached ? DETAIL_NO.ledger : undefined, lateral: m.attached ? DETAIL_NO.lateral : undefined, post: DETAIL_NO.post, guard: m.s.rails.on ? DETAIL_NO.guard : undefined, section: 1, stair: 2, sectionX: sectionX(m) }), 8.9, 9.45),
    [m, paper],
  );
  const f = m.f;
  const d = m.s.design;
  const hw = f.hardware;
  const devices = m.attached ? lateralDevices(f) : [];
  const connectors: Array<[string, string, string, number]> = [
    ["Joist hanger", `${f.joistSize} face-mount`, "Every joist end on the ledger or a flush beam", hw.hangers],
    ["Double hanger", `(2) ${f.joistSize}`, "The doubled outside joists", hw.doubleHangers],
    ["Hurricane tie", "Joist to beam", "Every joist on a dropped beam", hw.ties],
    ["Post cap", `${d.framing.post} to beam`, "Every post", hw.postCaps],
    ["Post base", `${d.framing.post}, standoff`, "Every post, 1\" above the concrete", hw.postBases],
    ["Lateral device", devices.length ? `${devices[0].lb.toLocaleString("en-US")} lb hold-down` : "—", RULE.lateral, devices.length],
    ["Ledger fastener", d.placement === "attached" ? LEDGER_FASTENER_LABEL[d.ledger.fastener] : "—", f.ledgers[0] ? `${f.ledgers[0].spacingIn}\" o.c., 2 rows staggered` : "—", f.ledgers.reduce((a, l) => a + l.fasteners, 0)],
    ["Rim screw", "Structural screw", "Three in each joist end", hw.rimScrews],
    ["Knee brace", "2x4, 1/2\" lags", "Corner posts over 2 ft", hw.braces],
  ];
  return (
    <>
      <ViewBox view={view} no={1} sheetNo="S-102" />
      <div className={s.side}>
        <div>
          <div className={s.h}>Framing schedule<span>{f.species.short}</span></div>
          <table className={s.t} data-plan-framing-schedule>
            <thead>
              <tr><th>Tag</th><th>Member</th><th>Size</th><th className={s.n}>Span</th><th className={s.n}>Allowed</th><th>Use</th><th>Table</th></tr>
            </thead>
            <tbody>
              {m.tags.map((t) => (
                <tr key={t.tag}>
                  <td className={s.k}>{t.tag}</td>
                  <td>{t.member}</td>
                  <td>{t.spec}</td>
                  <td className={s.n}>{t.check?.actual ?? "—"}</td>
                  <td className={s.n}>{t.check?.allowed ?? "—"}</td>
                  <td>
                    {t.check && !t.check.byTable ? (
                      <>
                        <span className={s.bar}><i className={t.check.ratio > 0.95 ? s.hi : undefined} style={{ width: `${Math.min(100, t.check.ratio * 100)}%` }} /></span>
                        <span className={t.check.ratio <= 1.0001 ? s.ok : s.bad}>{Math.round(t.check.ratio * 100)}%</span>
                      </>
                    ) : t.check ? <span className={s.ok}>TABLE</span> : null}
                  </td>
                  <td className={s.rule}>{t.check?.rule ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={s.small} style={{ marginTop: 3 }}>Span = the longest clear span on this deck; Allowed = the table&apos;s figure for this size, spacing, species and {f.load} psf. Use = span ÷ allowed.</div>
        </div>
        <div>
          <div className={s.h}>Connector schedule<span>hot-dip galvanized or stainless</span></div>
          <table className={s.t} data-plan-connectors>
            <thead>
              <tr><th>Connector</th><th>Type</th><th>Where</th><th className={s.n}>Qty</th></tr>
            </thead>
            <tbody>
              {connectors.filter((c) => c[3] > 0).map((c) => (
                <tr key={c[0]}><td>{c[0]}</td><td>{c[1]}</td><td>{c[2]}</td><td className={s.n}>{c[3]}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <div className={s.h}>Framing notes</div>
          <ol className={s.notes}>
            <li>Lumber {f.species.label.toLowerCase()}, No. 2 or better, preservative-treated: ground-contact for posts, beams and the ledger, above-ground elsewhere (AWPA U1).</li>
            <li>Joists {f.joistSize} at {f.spacingIn}&quot; on centre, crowned up; {d.framing.doubleRim ? "outside joists and rim doubled" : "single rim"}; full-depth blocking where tagged BK.</li>
            <li>Every joist end on the ledger in a face-mount hanger with every nail hole filled with the maker&apos;s fasteners; joists on a dropped beam tied to it.</li>
            {m.attached ? <li>Ledger to the house band joist only — never to brick veneer, a cantilevered floor or siding alone — with metal flashing over it and membrane behind (detail {DETAIL_NO.ledger}/S-501).</li> : <li>Free-standing: braced at the corner posts both ways; no load on the house.</li>}
            {devices.length ? <li>Lateral load: {devices.length} hold-down devices of {devices[0].lb.toLocaleString("en-US")} lb within 24&quot; of each end, LD-1 to LD-{devices.length} on the plan ({RULE.lateral}; detail {DETAIL_NO.lateral}/S-501).</li> : null}
            {d.framing.joistTape ? <li>Butyl joist tape over the tops of the joists, rim, ledger and beams before the decking.</li> : null}
            <li>Decking: {f.decking.label}, fastened per its maker&apos;s guide; joists no farther apart than {f.deckingMaxSpacingIn}&quot; for these boards laid as drawn.</li>
          </ol>
        </div>
      </div>
    </>
  );
}

/* ── S-201 · elevations ──────────────────────────────────────────────── */
function ElevationsSheet({ m, scene }: { m: PlanModel; scene: DeckScene }) {
  const paper = usePaper();
  const side = m.s.stairs.some((st) => st.design.side === "left") ? "right" : "left";
  const front = React.useMemo(() => fitOn(paper, (sc) => elevationView(m, scene, "front", sc), 12.9, 4.15), [m, scene, paper]);
  const other = React.useMemo(() => fitOn(paper, (sc) => elevationView(m, scene, side, sc), 12.9, 4.15), [m, scene, side, paper]);
  return (
    <>
      <ViewBox view={front} no={1} sheetNo="S-201" note={ELEVATION_NAME.front === front.title ? undefined : undefined} />
      <ViewBox view={other} no={2} sheetNo="S-201" note="Grade drawn level — verify in the field" />
    </>
  );
}

/* ── S-301 · the building section and the stairs ─────────────────────── */
function SectionsSheet({ m, scene }: { m: PlanModel; scene: DeckScene }) {
  const paper = usePaper();
  const section = React.useMemo(() => fitOn(paper, (sc) => sectionView(m, scene, sectionX(m), sc), 8.0, 8.9, 1 / 12), [m, scene, paper]);
  const flights = m.s.stairs.filter((st) => st.level === "upper" && st.kind === "flight" && st.risers > 0);
  const stairViews = React.useMemo(() => flights.slice(0, 2).map((st, i) => fitOn(paper, (sc) => stairSection(m, st, i + 1, sc), 5.15, flights.length > 1 ? 3.9 : 6.6, 1 / 12)), [m, flights, paper]);
  return (
    <>
      <ViewBox view={section} no={1} sheetNo="S-301" note={`Cut on grid ${m.cols[Math.floor((m.cols.length - 1) / 2)]?.label ?? ""}, looking along the house`} />
      <div className={s.side} style={{ alignContent: "space-between" }}>
        {stairViews.map((v, i) => (
          <ViewBox key={v.id} view={v} no={i + 2} sheetNo="S-301" />
        ))}
        {flights.length ? (
          <div>
            <div className={s.h}>Stair schedule<span>{m.s.code.short}</span></div>
            <table className={s.t} data-plan-stairs>
              <thead>
                <tr><th>Stair</th><th className={s.n}>Risers</th><th className={s.n}>Rise</th><th className={s.n}>Tread</th><th className={s.n}>Width</th><th>Stringers</th><th>Rail</th></tr>
              </thead>
              <tbody>
                {flights.map((st, i) => (
                  <tr key={st.design.id}>
                    <td className={s.k}>{i + 1} · {st.design.side}</td>
                    <td className={s.n}>{st.risers}</td>
                    <td className={s.n}>{inFrac(st.riserIn)} ≤ {inFrac(m.s.code.riserMaxIn)}</td>
                    <td className={s.n}>{inFrac(st.runIn + 1)} ≥ {inFrac(m.s.code.treadMinIn)}</td>
                    <td className={s.n}>{inFrac(st.widthIn)}</td>
                    <td>({st.stringers.count}) {st.stringers.nominal} @ {st.stringers.spacingIn}&quot;</td>
                    <td>{st.rail.sides ? `${st.rail.sides} side${st.rail.sides > 1 ? "s" : ""}, 34"–38"` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={s.small} style={{ marginTop: 3 }}>Riser heights uniform within 3/8&quot;; a nosing of 3/4&quot;–1-1/4&quot; where the treads are under 11&quot;; a handrail on any stair of four or more risers; a light at the top of the stair ({m.s.code.short} R311.7, R303.8).</div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ── S-501 · details ─────────────────────────────────────────────────── */
function DetailsSheet({ m }: { m: PlanModel }) {
  const details = React.useMemo(() => floorDetails(m), [m]);
  const cols = details.length > 6 ? 4 : 3;
  const w = cols === 4 ? 3.1 : 4.15;
  return (
    <>
      {details.map((dt) => (
        <DetailCell key={dt.key} dt={dt} w={w} />
      ))}
    </>
  );
}
function DetailCell({ dt, w }: { dt: PlanDetail; w: number }) {
  const paper = usePaper();
  const view = React.useMemo(() => fitOn(paper, dt.build, w, 3.3, 1.5 / 12), [dt, w, paper]);
  const no = DETAIL_NO[dt.key as keyof typeof DETAIL_NO] ?? 0;
  return (
    <div className={s.detail} data-plan-detail={dt.key}>
      <ViewBox view={view} no={no} sheetNo="S-501" />
      <ol className={s.notes}>
        {dt.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ol>
    </div>
  );
}

/* ── G-001 · the cover ───────────────────────────────────────────────── */
function IsoPicture({ scene, structure, yawDeg, skip, label, className }: { scene: DeckScene; structure: DeckStructure; yawDeg: number; skip?: string[]; label: string; className?: string }) {
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const pic = React.useMemo(() => {
    const d = structure.design;
    const family = deckingProduct(d.decking.product).family;
    const decking: IsoMaterials["decking"] = family === "treated" || family === "softwood" ? "wood" : family === "hardwood" || family === "modified" ? "hardwood" : family;
    // The joists stay out of the finished picture: under the boards they only fight them in the paint order (the kind
    // picker drops them past its 2,400 solids for the same reason); the framing picture shows them without the boards.
    const drawing = isoDrawing(scene, { materials: { decking, roofing: d.roof.roofing, rail: d.rail.type }, yawDeg, maxSolids: 6000, skip: (skip ?? ["wire", "hardware", "blocking", "footing", "joist"]) as never });
    return { viewBox: drawing.viewBox, inner: `<style>path{stroke-width:.45;stroke-linejoin:round;vector-effect:non-scaling-stroke}</style>${isoMarkup(drawing, { prefix: `cov${uid}`, layerClass: "s" })}` };
  }, [scene, structure, yawDeg, skip, uid]);
  // On paper the picture is a JPEG: its soft shadows and grass are filters, which Chrome prints as 300-dpi pictures of
  // themselves on top of thousands of paths (6.8 MB for the cover); drawn once to a canvas it is a few hundred KB.
  const [jpeg, setJpeg] = React.useState<{ key: string; src: string } | null>(null);
  React.useEffect(() => {
    let live = true;
    const [, , vw, vh] = pic.viewBox.split(/\s+/).map(Number);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${pic.viewBox}" width="${vw}" height="${vh}">${pic.inner}</svg>`;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const W = 2400;
      const H = Math.round((W * vh) / vw);
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);
      setJpeg({ key: pic.inner.length + pic.viewBox, src: c.toDataURL("image/jpeg", 0.86) });
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return () => {
      live = false;
    };
  }, [pic]);
  if (jpeg && jpeg.key === pic.inner.length + pic.viewBox) {
    // eslint-disable-next-line @next/next/no-img-element -- a data URL drawn here, nothing for next/image to optimize
    return <img className={className} src={jpeg.src} alt={label} style={{ objectFit: "contain" }} data-plan-iso="jpeg" />;
  }
  return <svg className={className} viewBox={pic.viewBox} role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: pic.inner }} data-plan-iso="svg" />;
}

function CoverSheet(p: PlanSetProps & { sheets: PlanSheet[]; m: PlanModel | null; scene: DeckScene }) {
  const paper = usePaper();
  const { structure: st, project, shop, checks, sheets, m, scene, criteria } = p;
  const d = st.design;
  const f = st.frame;
  const fails = checks.filter((c) => c.level === "fail");
  const passes = checks.filter((c) => c.level === "pass");
  const worstFooting = m ? m.bearing.reduce((a, b) => Math.max(a, b.ratio), 0) : 0;
  const rows: Array<[string, string]> = [];
  rows.push(["Scope", `New ${structureWords(d).toLowerCase()}`]);
  // What a California cover sheet is checked for (Sacramento County PR-11, 2026-10-28) and most offices read the same way.
  rows.push(["Occupancy · type", "R-3 dwelling, accessory to it (U) · Type V-B wood frame"]);
  rows.push(["Fire sprinklers", "None — an open deck needs none"]);
  if (st.code.state === "CA") rows.push(["Fire hazard zone", "Confirm the lot on CAL FIRE's Fire Hazard Severity Zone map; in a zone, decking and framing per the 2025 CWUIC / CRC R337"]);
  if (f) {
    rows.push(["Deck area", `${Math.round(f.areaSqFt)} sq ft`]);
    rows.push(["Walking surface", `${ftInFrac(f.surfaceIn, 8)} above grade`]);
    rows.push(["Support", PLACEMENT_LABEL[d.placement]]);
    rows.push(["Framing", `${f.species.label}, ${f.joistSize} joists @ ${f.spacingIn}" o.c.`]);
    rows.push(["Beams · posts", `${m ? m.tags.filter((t) => t.tag.startsWith("B") && t.tag !== "BK").map((t) => t.spec.split(",")[0]).join(", ") : ""} · ${d.framing.post} posts`]);
    rows.push(["Footings", m ? `${m.posts.length} poured, ${m.footings.filter((x) => x.kind === "post").map((x) => `${x.tag} ${inFrac(x.padIn)} Ø`).join(", ")} · ${inFrac(d.frostIn)} below grade` : ""]);
    rows.push(["Decking", f.decking.label]);
  }
  if (st.rails.on) rows.push(["Guard", `${railNamed(st.rails)}, ${st.rails.heightIn}" · ${Math.round(st.rails.totalLf)} ft`]);
  if (st.stairs.length) rows.push(["Stairs", st.stairs.map((x, i) => `${i + 1}: ${x.risers} risers @ ${inFrac(x.riserIn)}, ${inFrac(x.widthIn)} wide`).join(" · ")]);
  if (st.roof) rows.push(["Roof", st.roof.kind === "pergola" ? "Pergola over the deck" : `${st.roof.kind} roof, ${st.roof.roof.pitch}:12`]);
  const summary: Array<[string, string, boolean]> = [];
  if (m) {
    const j = m.tags.find((t) => t.tag === "J1")?.check;
    if (j) summary.push(["Joist span", `${j.actual} of ${j.allowed} allowed`, j.ratio <= 1]);
    for (const t of m.tags.filter((x) => /^B\d/.test(x.tag))) if (t.check) summary.push([`Beam ${t.tag}`, `${t.check.actual} of ${t.check.allowed} between posts`, t.check.ratio <= 1.0001]);
    const pt = m.tags.find((t) => t.tag === "P1")?.check;
    if (pt) summary.push(["Post height", `${pt.actual} of ${pt.allowed}`, pt.ratio <= 1]);
    summary.push(["Footings", `bearing ratio ${worstFooting.toFixed(2)} at most`, worstFooting <= 1.0001]);
    if (m.attached) summary.push(["Ledger", `${m.f.ledgers.reduce((a, l) => a + l.fasteners, 0)} fasteners by the table, flashed`, true]);
    if (m.attached) summary.push(["Lateral", "2 hold-downs, 1,500 lb, within 24\" of each end", true]);
  }
  if (st.rails.on) summary.push(["Guard", `${st.rails.heightIn}" where the deck is over 30" up`, st.rails.heightIn >= st.code.guardIn]);
  for (const x of st.stairs.filter((y) => y.kind === "flight")) summary.push(["Stair", `${inFrac(x.riserIn)} risers ≤ ${inFrac(st.code.riserMaxIn)} · ${inFrac(x.runIn + 1)} treads ≥ ${inFrac(st.code.treadMinIn)}`, x.riserIn <= st.code.riserMaxIn + 1e-6]);
  return (
    <>
      <div className={s.coverMain}>
        <div className={s.coverKick}>Deck permit set · issued for permit · {project.date}</div>
        <div className={s.coverTitle}>{project.title}</div>
        <div className={s.coverAddr}>{project.address ?? "Job address"}{project.county ? ` · ${project.county}` : ""}</div>
        <div className={s.coverPic}>
          <IsoPicture scene={scene} structure={st} yawDeg={-32} label="The deck, rendered from the engine's 3D model" className={s.coverIso} />
          <div className={s.coverPicNote}>Rendered from the same 3D model the plans are drawn from — every member as framed.</div>
        </div>
        <div className={s.coverRow}>
          <div className={s.coverFrame}>
            <IsoPicture scene={scene} structure={st} yawDeg={-32} skip={["decking", "rail", "glass", "screen", "wall", "light", "wire", "hardware", "fascia"]} label="The framing, without the decking and the guard" className={s.coverIsoSmall} />
            <div className={s.coverPicNote}>The framing under the boards.</div>
          </div>
          <div style={{ minWidth: 0 }}>
            <div className={s.h}>Sheet index<span>{sheets.length} sheets · {paper.name}</span></div>
            <table className={s.t}>
              <tbody>
                {sheets.map((x) => (
                  <tr key={x.no}><td className={s.k}>{x.no}</td><td>{x.name}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className={s.side}>
        <div>
          <div className={s.h}>Project data</div>
          <table className={s.kv}>
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}><th>{k}</th><td>{v}</td></tr>
              ))}
              <tr><th>Owner</th><td>{project.owner || "—"}</td></tr>
              <tr><th>Contractor</th><td>{shop.name || "—"}{project.licence ? ` · lic. ${project.licence}` : ""}</td></tr>
            </tbody>
          </table>
        </div>
        {criteria?.length ? (
          <div>
            <div className={s.h}>Design criteria</div>
            <table className={s.t} data-plan-criteria>
              <tbody>
                {criteria.map((r) => (
                  <tr key={r.label} className={r.short ? s.warnRow : undefined}><td className={s.k}>{r.label}</td><td>{r.value}</td><td className={s.rule}>{r.source}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <div>
          <div className={s.h}>Code check<span>{passes.length} pass · {fails.length ? `${fails.length} to fix` : "none to fix"}</span></div>
          <table className={s.t} data-plan-summary>
            <tbody>
              {summary.map(([k, v, ok], i) => (
                <tr key={`${k}-${i}`}><td className={s.k}>{k}</td><td>{v}</td><td className={s.n}><span className={ok ? s.ok : s.bad}>{ok ? "✓ PASS" : "FIX"}</span></td></tr>
              ))}
            </tbody>
          </table>
          <div className={s.small} style={{ marginTop: 3 }}>Every figure from {st.code.short} R507 and the AWC DCA 6 tables, checked by the studio — the full list with each rule on G-002.</div>
        </div>
      </div>
    </>
  );
}

/* ── G-002 · general notes and code compliance ───────────────────────── */
/**
 * The code compliance table split where the notes sheet's column fills: a row's height read off its words (the
 * "as designed" column holds about 82 characters a line at 6.6 pt, the basis column 34), the column about 690 pt.
 */
function splitCompliance(checks: DeckCheck[], capacityPt = 690): [DeckCheck[], DeckCheck[]] {
  let used = 0;
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const lines = Math.max(1, Math.ceil(c.text.length / 82), Math.ceil((c.rule ?? "").length / 34));
    used += lines * 8.5 + 3.5;
    if (used > capacityPt) return [checks.slice(0, i), checks.slice(i)];
  }
  return [checks, []];
}

function NotesSheet(p: PlanSetProps & { m: PlanModel | null; more?: boolean }) {
  const { checks, notes, structure: st, more } = p;
  const legend = React.useMemo(() => legendView(), []);
  return (
    <>
      <div className={s.notesCol}>
        <div className={s.h}>General notes</div>
        <ol className={`${s.notes} ${s.notes2}`} data-plan-notes>
          {(notes ?? []).map((n, i) => (
            <li key={i}>{n}</li>
          ))}
          <li>The contractor verifies every dimension, the house&apos;s band joist and the site before ordering or cutting; report any difference to the designer before building.</li>
          <li>Inspections, where the building department requires them: footings before concrete; framing before the decking is laid; final when the guards and stairs are complete.</li>
          <li>Keep this set and the approved permit on site until the final inspection.</li>
        </ol>
        <div className={s.h} style={{ marginTop: 6 }}>Symbols</div>
        <div className={s.legendBox}>
          <PlanSvg view={legend} />
        </div>
        <div className={s.h} style={{ marginTop: 6 }}>Abbreviations</div>
        <div className={s.abbr}>
          {ABBR.map(([a, b]) => (
            <React.Fragment key={a}>
              <b>{a}</b>
              <span>{b}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className={s.side}>
        <div className={s.h}>Code compliance<span>{st.code.short}{more ? " · continued on G-003" : ""}</span></div>
        <ComplianceTable checks={checks} />
      </div>
    </>
  );
}

const LEVEL: Record<string, [string, string]> = { pass: ["PASS", s.ok], fail: ["FIX", s.bad], warn: ["CHECK", s.warn], info: ["NOTE", s.mut] };
function ComplianceTable({ checks }: { checks: DeckCheck[] }) {
  return (
        <table className={s.t} data-plan-compliance>
          <thead>
            <tr><th>Item</th><th>As designed</th><th>Basis</th><th className={s.c}>Status</th></tr>
          </thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td className={s.k}>{c.part}</td>
                <td>{c.text}</td>
                <td className={s.rule}>{c.rule ?? ""}</td>
                <td className={s.c}><span className={LEVEL[c.level]?.[1]}>{LEVEL[c.level]?.[0] ?? c.level}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
  );
}

/* ── G-003 · the code compliance, continued ─────────────────────────── */
function ComplianceMore({ checks, code }: { checks: DeckCheck[]; code: string }) {
  const half = Math.ceil(checks.length / 2);
  return (
    <>
      <div style={{ minWidth: 0 }}>
        <div className={s.h}>Code compliance, continued<span>{code}</span></div>
        <ComplianceTable checks={checks.slice(0, half)} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className={s.h}>&nbsp;<span>continued</span></div>
        <ComplianceTable checks={checks.slice(half)} />
      </div>
    </>
  );
}
const ABBR: Array<[string, string]> = [
  ["A.F.G.", "above finished grade"], ["B.G.", "below grade"], ["B.O.", "bottom of"], ["CONC.", "concrete"], ["DIA. / Ø", "diameter"], ["(E)", "existing"], ["EQ.", "equal"], ["FTG.", "footing"], ["GALV.", "galvanized (G185 / hot-dip)"], ["LD", "lateral load device"], ["MAX. / MIN.", "maximum / minimum"], ["O.C.", "on centre"], ["P.T.", "preservative-treated"], ["R", "risers"], ["SF", "square feet"], ["T.O.", "top of"], ["TYP.", "typical"], ["U.N.O.", "unless noted otherwise"],
];

/* ── S-601 · schedules and materials ─────────────────────────────────── */
const PART_PREFIX: Record<string, string> = { footings: "FT", ledger: "LG", framing: "FR", decking: "DK", fascia: "FA", stairs: "ST", rails: "RL", railing: "RL", electrical: "EL", roof: "RF", lower: "LL", demo: "DM", extras: "EX" };
function SchedulesSheet({ list, m }: { list: MaterialList; m: PlanModel | null }) {
  const groups = list.groups.filter((g) => g.lines.some((l) => !l.byClient));
  const half = Math.ceil(groups.reduce((n, g) => n + g.lines.length + 2, 0) / 2);
  const colA: typeof groups = [];
  const colB: typeof groups = [];
  let n = 0;
  for (const g of groups) {
    (n < half ? colA : colB).push(g);
    n += g.lines.length + 2;
  }
  const table = (gs: typeof groups) => (
    <table className={s.t} data-plan-materials>
      <thead>
        <tr><th>Part</th><th>Description</th><th className={s.n}>Qty</th></tr>
      </thead>
      <tbody>
        {gs.map((g) => (
          <React.Fragment key={g.step}>
            <tr className={s.sub}><td colSpan={3}>{g.label}</td></tr>
            {g.lines.filter((l) => !l.byClient).map((l, i) => (
              <tr key={`${g.step}-${i}`}>
                <td className={s.k}>{(PART_PREFIX[g.step] ?? g.step.slice(0, 2).toUpperCase())}-{String(i + 1).padStart(2, "0")}</td>
                <td>{l.label}{l.note ? <span className={s.mutText}> — {l.note}</span> : null}</td>
                <td className={s.n}>{fmtQty(l.qty)} {l.unit}</td>
              </tr>
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <div style={{ minWidth: 0 }}>
        <div className={s.h}>Materials schedule<span>{list.count} lines · keyed by part</span></div>
        {table(colA)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className={s.h}>&nbsp;<span>continued</span></div>
        {table(colB)}
      </div>
      <div className={s.side}>
        {m ? (
          <div>
            <div className={s.h}>Concrete<span>80-lb bags</span></div>
            <table className={s.t}>
              <thead><tr><th>Footing</th><th className={s.n}>Each</th><th className={s.n}>No.</th></tr></thead>
              <tbody>
                {m.footings.filter((x) => x.kind !== "stair-pad").map((x) => {
                  const ft = m.posts.find((pp) => pp.tag === x.tag)?.post.footing ?? m.stairFootings.find((sf) => sf.tag === x.tag)?.footing;
                  return <tr key={x.tag}><td className={s.k}>{x.tag}</td><td className={s.n}>{ft ? `${ft.cuFt.toFixed(2)} cu ft · ${ft.bags} bags` : "—"}</td><td className={s.n}>{x.at.length}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        {m ? <InspectionRecord m={m} /> : null}
        <div>
          <div className={s.h}>Material notes</div>
          <ol className={s.notes}>
            <li>Quantities are the studio&apos;s takeoff of this design, waste included where noted. Confirm counts against the site before ordering.</li>
            <li>Treated lumber: ground-contact (UC4A) for posts, beams, the ledger and anything within 6&quot; of the soil; above-ground (UC3B) elsewhere.</li>
            <li>Connectors and fasteners hot-dip galvanized (G185) or stainless where in contact with treated lumber; stainless within 300 ft of salt water.</li>
            <li>A substitution matches or exceeds the size, grade, species and corrosion resistance named here.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
const fmtQty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

/* ── The crew's set, on letter ──────────────────────────────────────── */
function CrewStrip({ sheet, sheets, index, shop, project }: PlanSetProps & { sheet: PlanSheet; sheets: PlanSheet[]; index: number }) {
  return (
    <div className={s.strip} data-plan-strip>
      <div>
        <div className={s.tbKick}>Construction set · for the crew</div>
        <div className={s.stripShop}>{shop.name || "Contractor"}</div>
        <div className={s.tbLine}>{shop.phone ?? ""}</div>
      </div>
      <div>
        <div className={s.tbKick}>Project</div>
        <div className={s.stripProject}>{project.title}</div>
        <div className={s.tbLine}>{project.address ?? ""}</div>
      </div>
      <div className={s.stripSheet}>
        <div className={s.tbKick}>{sheet.name}</div>
        <div className={s.stripNo}>{sheet.no}</div>
        <div className={s.tbOf}>{index + 1} of {sheets.length} · {project.date}</div>
      </div>
    </div>
  );
}

function CrewCover(p: PlanSetProps & { sheets: PlanSheet[]; m: PlanModel | null; scene: DeckScene }) {
  const { structure: st, project, sheets, m, scene } = p;
  const f = st.frame;
  const big: Array<[string, string]> = [];
  if (f) {
    big.push(["Deck height", ftInFrac(f.surfaceIn, 8)]);
    big.push(["Joists", `${f.joistSize} @ ${f.spacingIn}"`]);
    big.push(["Footings", `${m?.posts.length ?? 0} · ${inFrac(st.design.frostIn)} deep`]);
    if (m?.attached) big.push(["Ledger lags", String(f.ledgers.reduce((a, l) => a + l.fasteners, 0))]);
    big.push(["Posts", `${m?.posts.length ?? 0} × ${st.design.framing.post}`]);
  }
  const flight = st.stairs.find((x) => x.kind === "flight");
  if (flight) big.push(["Stair", `${flight.risers}R @ ${inFrac(flight.riserIn)}`]);
  if (st.rails.on) big.push(["Guard", `${st.rails.heightIn}" · ${Math.round(st.rails.totalLf)} ft`]);
  return (
    <>
      <div>
        <div className={s.coverKick}>Construction set · {project.date}</div>
        <div className={s.crewTitle}>{project.title}</div>
        <div className={s.coverAddr}>{project.address ?? ""}</div>
      </div>
      <div className={s.crewPic}>
        <IsoPicture scene={scene} structure={st} yawDeg={-32} label="The deck, from the engine's 3D model" className={s.coverIso} />
      </div>
      <div className={s.bigGrid}>
        {big.map(([k, v]) => (
          <div key={k} className={s.bigCell}>
            <span>{k}</span>
            <b>{v}</b>
          </div>
        ))}
      </div>
      <div>
        <div className={s.h}>In this set<span>keep it on site with the permit</span></div>
        <table className={s.t}>
          <tbody>
            {sheets.map((x) => (
              <tr key={x.no}><td className={s.k}>{x.no}</td><td>{x.name}</td></tr>
            ))}
          </tbody>
        </table>
        <div className={s.small} style={{ marginTop: 4 }}>The building department&apos;s set (G-001 to S-601) governs; this set is the same design, drawn for building it. Verify every dimension on site before cutting.</div>
      </div>
    </>
  );
}

function CrewLayout({ m }: { m: PlanModel }) {
  const view = React.useMemo(() => fitView((sc) => foundationPlan(m, sc, {}), 7.5, 6.6), [m]);
  return (
    <>
      <ViewBox view={view} no={1} sheetNo="C-1" />
      <div>
        <div className={s.h}>Footing layout<span>to post centres, from the datum</span></div>
        <table className={s.t} data-plan-crew-layout>
          <thead>
            <tr><th>Point</th><th className={s.n}>Along the house</th><th className={s.n}>Out from it</th><th>Footing</th><th className={s.c}>✓</th></tr>
          </thead>
          <tbody>
            {m.layout.points.map((pt, i) => (
              <tr key={`${pt.name}-${i}`}><td className={s.k}>{pt.name}</td><td className={s.n}>{ftInFrac(pt.x, 16)}</td><td className={s.n}>{ftInFrac(pt.y, 16)}</td><td>{pt.what}</td><td className={s.c}>☐</td></tr>
            ))}
            {m.layout.diagonals.map((dg) => (
              <tr key={`${dg.from}-${dg.to}`} className={s.sub}><td colSpan={2}>Diagonal {dg.from} → {dg.to}</td><td className={s.n}>{ftInFrac(dg.lengthIn, 16)}</td><td>±1/4&quot; when square</td><td className={s.c}>☐</td></tr>
            ))}
          </tbody>
        </table>
        <ol className={s.notes} style={{ marginTop: 5 }}>
          <li>Datum: {m.layout.origin}. Set batter boards past each end; run a string along the beam line(s) parallel to the house.</li>
          <li>Measure each footing along the house, then out from it; drive a stake at each centre. Check the two diagonals — equal to the table when square.</li>
          <li>Check a right angle at the datum with 3-4-5 (or 6-8-10) before trusting the strings.</li>
        </ol>
      </div>
    </>
  );
}

function CrewFraming({ m }: { m: PlanModel }) {
  const view = React.useMemo(() => fitView((sc) => framingPlan(m, sc, {}), 7.5, 5.3), [m]);
  const cuts = React.useMemo(() => cutList(m), [m]);
  return (
    <>
      <ViewBox view={view} no={1} sheetNo="C-2" />
      <div>
        <div className={s.h}>Cut list<span>{cuts.reduce((n, c) => n + c.qty, 0)} pieces</span></div>
        <table className={s.t} data-plan-cuts>
          <thead>
            <tr><th>Tag</th><th>Piece</th><th>Size</th><th className={s.n}>Length</th><th className={s.n}>Qty</th><th>Cut</th></tr>
          </thead>
          <tbody>
            {cuts.map((c, i) => (
              <tr key={i}><td className={s.k}>{c.tag}</td><td>{c.member}</td><td>{c.size}</td><td className={s.n}>{ftInFrac(c.lengthIn, 8)}</td><td className={s.n}>{c.qty}</td><td>{c.cut}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CrewStairs({ m }: { m: PlanModel }) {
  const flights = m.s.stairs.filter((x) => x.level === "upper" && x.kind === "flight" && x.risers > 0);
  const st = flights[0];
  const L = React.useMemo(() => (st ? stringerLayout(st, m.f.decking.thickIn) : null), [st, m]);
  const view = React.useMemo(() => (L ? fitView((sc) => stringerView(L, sc), 7.5, 4.6, 1 / 12) : null), [L]);
  if (!st || !L || !view) return null;
  return (
    <>
      <ViewBox view={view} no={1} sheetNo="C-3" />
      <div>
        <div className={s.h}>Stringer layout<span>stair 1 of {flights.length}</span></div>
        <div className={s.bigGrid}>
          <div className={s.bigCell}><span>Square: tongue</span><b>{inFrac(L.rise, 16)}</b></div>
          <div className={s.bigCell}><span>Square: blade</span><b>{inFrac(L.run, 16)}</b></div>
          <div className={s.bigCell}><span>Risers · treads</span><b>{L.risers} · {L.treads}</b></div>
          <div className={s.bigCell}><span>Drop at the foot</span><b>{inFrac(L.drop, 16)}</b></div>
          <div className={s.bigCell}><span>Stringers</span><b>{L.count} @ {L.spacing}&quot;</b></div>
          <div className={s.bigCell}><span>Throat left</span><b className={L.throat >= 5 ? undefined : s.bad}>{inFrac(L.throat, 8)}</b></div>
        </div>
        <ol className={s.notes} style={{ marginTop: 5 }}>
          <li>Set stair gauges on a framing square at {inFrac(L.rise, 16)} (tongue) and {inFrac(L.run, 16)} (blade); step off {L.risers} risers on a straight, crown-up 2x12 at least {ftInFrac(L.lengthIn, 8)} long.</li>
          <li>Cut the first stringer, test it against the rim and the landing, then trace the other {Math.max(0, L.count - 1)} from it.</li>
          <li>Take {inFrac(L.drop, 16)} — the tread&apos;s thickness — off the bottom so the bottom riser matches the rest; the risers stay within 3/8&quot; of each other.</li>
          <li>Never cut past the layout lines into the throat; at least 5&quot; of solid wood stays under every notch (this one leaves {inFrac(L.throat, 8)}).</li>
        </ol>
      </div>
    </>
  );
}

function CrewMaterials({ list }: { list: MaterialList }) {
  const groups = list.groups.filter((g) => g.lines.some((l) => !l.byClient));
  return (
    <div style={{ minWidth: 0 }}>
      <div className={s.h}>Materials<span>{list.count} lines · tick as it arrives</span></div>
      <table className={s.t} data-plan-crew-materials>
        <thead>
          <tr><th>Part</th><th>Description</th><th className={s.n}>Qty</th><th className={s.c}>✓</th></tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.step}>
              <tr className={s.sub}><td colSpan={4}>{g.label}</td></tr>
              {g.lines.filter((l) => !l.byClient).map((l, i) => (
                <tr key={`${g.step}-${i}`}>
                  <td className={s.k}>{(PART_PREFIX[g.step] ?? g.step.slice(0, 2).toUpperCase())}-{String(i + 1).padStart(2, "0")}</td>
                  <td>{l.label}{l.note ? <span className={s.mutText}> — {l.note}</span> : null}</td>
                  <td className={s.n}>{fmtQty(l.qty)} {l.unit}</td>
                  <td className={s.c}>☐</td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CrewSequence({ m, list }: { m: PlanModel; list: MaterialList }) {
  const phases = React.useMemo(() => buildSequence(m, list), [m, list]);
  return (
    <div className={s.seq} data-plan-sequence>
      {phases.map((ph, i) => (
        <div key={ph.title} className={s.phase}>
          <div className={s.phaseHead}><b>{i + 1}</b> {ph.title}</div>
          <ul>
            {ph.steps.map((t, j) => (
              <li key={j}><span className={s.box}>☐</span>{t}</li>
            ))}
          </ul>
          {ph.hold ? <div className={s.hold}>HOLD · {ph.hold}</div> : null}
        </div>
      ))}
    </div>
  );
}

/** What each inspection will look at on this deck, with room for the inspector's date and initials. */
function InspectionRecord({ m }: { m: PlanModel }) {
  const f = m.f;
  const st = m.s;
  const rows: Array<[string, string]> = [
    ["Footings", `${m.footings.filter((x) => x.kind !== "stair-pad").map((x) => `${x.tag} ×${x.at.length} ${inFrac(x.padIn)} Ø × ${inFrac(x.thickIn)}`).join(", ")}; bottoms ${inFrac(st.design.frostIn)} below grade on undisturbed soil (S-101).`],
    [
      "Framing",
      [
        m.attached ? `Ledger: ${f.ledgers.reduce((a, l) => a + l.fasteners, 0)} lags @ ${f.ledgers[0]?.spacingIn ?? 16}" staggered, flashed` : "Free-standing, braced",
        `${f.hardware.hangers} hangers, ${f.hardware.ties} ties`,
        m.attached ? "LD-1, LD-2 hold-downs" : "",
        `${f.beams.map((b) => m.beamTag.get(b.id)).join(", ")} on post caps`,
        `joists ${f.joistSize} @ ${f.spacingIn}"`,
      ]
        .filter(Boolean)
        .join("; ") + " (S-102, S-501).",
    ],
    [
      "Final",
      [st.rails.on ? `Guards ${st.rails.heightIn}", no 4" opening` : "", ...st.stairs.filter((x) => x.kind === "flight").map((x, i) => `stair ${i + 1} ${x.risers}R @ ${inFrac(x.riserIn)}, handrail 34"–38"`), "decking fastened per its maker", "a light at the stairs"]
        .filter(Boolean)
        .join("; ") + ".",
    ],
  ];
  return (
    <div>
      <div className={s.h}>Inspection record<span>for the building department</span></div>
      <table className={s.t} data-plan-inspections>
        <thead>
          <tr><th>Inspection</th><th>Looks at</th><th className={s.c}>Date</th><th className={s.c}>By</th></tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}><td className={s.k}>{k}</td><td>{v}</td><td className={s.signCell} /><td className={s.signCell} /></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
