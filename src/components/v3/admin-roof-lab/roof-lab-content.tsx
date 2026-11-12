"use client";

// ADMIN · ROOF FACETS (TEST) — /admin/roof-lab, blueprint (2026-11-11).
//
// The roof facet engine's test bench. On the left the saved roof measurements (every company's, newest first, with a
// search); on the right the one picked: Google's aerial photograph of the roof — or its height map shaded as a
// relief — with the facets the engine drew over it (lettered, largest first), every edge coloured by what it is and
// carrying its length in feet, then the numbers: the drawing against EagleView's own figures, the feet of ridge, hip,
// valley, eave and rake, the facets one by one, and what the engine decided along the way. Nothing here is saved, and
// nothing is shown to a contractor.
//
// The drawing is an SVG laid over the picture in the picture's own frame (metres east and south of its top-left
// corner — lib/roofFacets/server's PictureWindow), so the lines sit on the roof without any lining up.
//
// Renders ONLY the shell's `.content` children, as a fragment, so the reveal cascade walks `.content > *`.

import { useMemo, useState, useTransition } from "react";
import { drawRoofLab, listRoofLab, type RoofLabRow } from "@/actions/adminRoofLab";
import { FACET_EDGE_TYPES, FACET_EDGE_WORDS, type FacetEdgeType, type FacetModel } from "@/lib/roofFacets/model";
import type { RoofLabDrawing } from "@/lib/roofFacets/server";
import { shortDay } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import r from "./roof-lab.module.css";

type Drawn = { ok: true; drawing: RoofLabDrawing } | { ok: false; error: string };

/** The drawing's own colours: they sit on a photograph, so they do not follow the page's theme. */
const EDGE_COLOR: Record<FacetEdgeType, string> = {
  RIDGE: "#ff3b30",
  HIP: "#c77dff",
  VALLEY: "#3d9bff",
  EAVE: "#34d167",
  RAKE: "#ffab2e",
  STEP: "#ffffff",
  BREAK: "#ffe45c",
};
const FACET_FILL = "#7c3aed";

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** A point well inside a facet for its letter: the centroid when it lies inside, else the middle of the widest span on the centroid's row. */
function labelPoint(rings: Array<Array<{ x: number; y: number }>>): { x: number; y: number } {
  const outer = rings[0];
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i], q = outer[(i + 1) % outer.length];
    const k = p.x * q.y - q.x * p.y;
    a += k; cx += (p.x + q.x) * k; cy += (p.y + q.y) * k;
  }
  const c = Math.abs(a) < 1e-9 ? outer[0] : { x: cx / (3 * a), y: cy / (3 * a) };
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      if ((p.y <= c.y && q.y > c.y) || (q.y <= c.y && p.y > c.y)) xs.push(p.x + ((c.y - p.y) / (q.y - p.y)) * (q.x - p.x));
    }
  }
  xs.sort((p, q) => p - q);
  let best: [number, number] | null = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (c.x >= xs[k] && c.x <= xs[k + 1]) return c;
    if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  }
  return best ? { x: (best[0] + best[1]) / 2, y: c.y } : c;
}

function ConfidenceChip({ level }: { level: FacetModel["confidence"]["level"] }) {
  if (level === "high") return <span className="chip ok">High confidence</span>;
  if (level === "medium") return <span className="chip wait">Medium confidence</span>;
  return <span className={`chip ${s.chipDanger}`}>Low confidence</span>;
}

function Stage({ id, drawing }: { id: string; drawing: RoofLabDrawing }) {
  const { model, window: win } = drawing;
  const [kind, setKind] = useState<"photo" | "relief">(drawing.photo ? "photo" : "relief");
  const [photoFailed, setPhotoFailed] = useState(false);
  const [lengths, setLengths] = useState(true);
  const [letters, setLetters] = useState(true);
  const [fill, setFill] = useState(true);
  const [hot, setHot] = useState<number | null>(null);

  const pts = useMemo(() => model.vertices.map((v) => ({ x: v.e - win.e0, y: win.n0 - v.n })), [model, win]);
  const facets = useMemo(
    () =>
      model.facets.map((f) => {
        const rings = [f.outer, ...f.holes].map((ring) => ring.map((v) => pts[v]));
        return { d: rings.map((ring) => `M${ring.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L")}Z`).join(""), at: labelPoint(rings) };
      }),
    [model, pts],
  );
  // type sizes in the drawing's own unit (metres), so they scale with the picture
  const unit = Math.max(win.widthM, win.heightM) / 52;
  const shown = kind === "photo" && !photoFailed ? "photo" : "relief";

  return (
    <div>
      <div className={r.tools}>
        <div className={r.seg} role="group" aria-label="Picture">
          <button type="button" className={shown === "photo" ? r.segOn : ""} disabled={!drawing.photo || photoFailed} onClick={() => setKind("photo")}>
            Aerial photo
          </button>
          <button type="button" className={shown === "relief" ? r.segOn : ""} onClick={() => setKind("relief")}>
            Height map
          </button>
        </div>
        <label className={r.tick}>
          <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Facets
        </label>
        <label className={r.tick}>
          <input type="checkbox" checked={letters} onChange={(e) => setLetters(e.target.checked)} /> Letters
        </label>
        <label className={r.tick}>
          <input type="checkbox" checked={lengths} onChange={(e) => setLengths(e.target.checked)} /> Lengths
        </label>
      </div>
      {photoFailed ? <p className={r.note}>Google did not return the aerial photo for this roof, so the height map is shown instead.</p> : null}
      {!drawing.photo ? <p className={r.note}>No aerial photo is on file for this roof (or no Google key is set), so the height map is shown.</p> : null}

      <div className={r.stage} style={{ aspectRatio: `${win.widthM} / ${win.heightM}` }} data-roof-lab-stage data-roof-lab-picture={shown}>
        {/* eslint-disable-next-line @next/next/no-img-element -- an admin-only picture cut on the server for this roof */}
        <img
          key={`${id}-${shown}`}
          className={r.pic}
          src={`/api/admin/roof-lab/picture?id=${encodeURIComponent(id)}&kind=${shown}`}
          alt={shown === "photo" ? "Aerial photo of the roof" : "Height map of the roof, shaded"}
          onError={() => { if (shown === "photo") setPhotoFailed(true); }}
        />
        <svg className={r.draw} viewBox={`0 0 ${win.widthM} ${win.heightM}`} preserveAspectRatio="none" role="img" aria-label={`${model.facets.length} roof facets`}>
          {model.facets.map((f, i) => (
            <path
              key={f.letter}
              d={facets[i].d}
              fillRule="evenodd"
              fill={FACET_FILL}
              fillOpacity={hot === i ? 0.5 : fill ? 0.24 : 0}
              stroke="none"
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot((h) => (h === i ? null : h))}
              data-roof-lab-facet={f.letter}
            />
          ))}
          {model.edges.map((e, i) => (
            <line key={`c${i}`} x1={pts[e.a].x} y1={pts[e.a].y} x2={pts[e.b].x} y2={pts[e.b].y} stroke="#14121a" strokeOpacity={0.85} strokeWidth={5} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}
          {model.edges.map((e, i) => (
            <line
              key={`e${i}`}
              x1={pts[e.a].x}
              y1={pts[e.a].y}
              x2={pts[e.b].x}
              y2={pts[e.b].y}
              stroke={EDGE_COLOR[e.type]}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={e.type === "STEP" ? "6 5" : undefined}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
              data-roof-lab-edge={e.type}
            />
          ))}
          {lengths
            ? model.edges.map((e, i) => {
                if (e.lengthFt < 5) return null;
                const text = `${Math.round(e.lengthFt)}'`;
                const x = (pts[e.a].x + pts[e.b].x) / 2, y = (pts[e.a].y + pts[e.b].y) / 2;
                const w = unit * (0.62 * text.length + 0.7), h = unit * 1.3;
                // an edge shorter than its own label would only be hidden by it
                if (Math.hypot(pts[e.a].x - pts[e.b].x, pts[e.a].y - pts[e.b].y) < w * 1.15) return null;
                return (
                  <g key={`l${i}`} pointerEvents="none">
                    <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h * 0.22} fill="#ffffff" fillOpacity={0.94} stroke={EDGE_COLOR[e.type]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                    <text x={x} y={y} fontSize={unit * 0.9} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#14121a" style={{ fontFamily: "var(--font-mono)" }}>
                      {text}
                    </text>
                  </g>
                );
              })
            : null}
          {letters
            ? model.facets.map((f, i) => {
                const { x, y } = facets[i].at;
                const w = unit * (0.75 * f.letter.length + 0.9), h = unit * 1.6;
                return (
                  <g key={`n${f.letter}`} pointerEvents="none">
                    <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h * 0.22} fill="#14121a" fillOpacity={0.88} />
                    <text x={x} y={y} fontSize={unit * 1.1} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill="#ffffff" style={{ fontFamily: "var(--font-mono)" }}>
                      {f.letter}
                    </text>
                  </g>
                );
              })
            : null}
        </svg>
      </div>

      <ul className={r.legend} aria-label="What the line colours mean">
        {FACET_EDGE_TYPES.filter((t) => model.totals.feet[t] > 0).map((t) => (
          <li key={t}>
            <span className={r.swatch} style={{ background: EDGE_COLOR[t] }} />
            {FACET_EDGE_WORDS[t]} · {whole(model.totals.feet[t])} ft
          </li>
        ))}
      </ul>

      <div className={r.cols}>
        <div>
          <div className={r.subHead}>The drawing against EagleView</div>
          <table className={`${s.tbl} ${r.tbl}`}>
            <thead>
              <tr>
                <th></th>
                <th className={r.num}>Drawing</th>
                <th className={r.num}>EagleView</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Roof area</td>
                <td className={r.num}>{whole(model.totals.areaSqft)} sq ft</td>
                <td className={r.num}>{model.compare.eagleViewSqft != null ? `${whole(model.compare.eagleViewSqft)} sq ft` : "none given"}</td>
              </tr>
              <tr>
                <td>Facets</td>
                <td className={r.num}>{model.totals.facets}</td>
                <td className={r.num}>{model.compare.eagleViewFacets ?? "none given"}</td>
              </tr>
              <tr>
                <td>Main pitch</td>
                <td className={r.num}>{model.totals.predominantPitch ?? "none"}</td>
                <td className={r.num}>{model.compare.eagleViewPitch ?? "none given"}</td>
              </tr>
            </tbody>
          </table>
          <p className={r.note}>
            {model.compare.areaDeltaPct != null ? `The drawing's area is ${Math.abs(model.compare.areaDeltaPct)}% ${model.compare.areaDeltaPct >= 0 ? "above" : "below"} EagleView's. ` : ""}
            Google&apos;s own count for this roof is {model.compare.googleSegments} planes.
          </p>

          <div className={r.subHead}>How sure</div>
          <p className={r.sure}>
            <ConfidenceChip level={model.confidence.level} /> <span className={r.score}>{model.confidence.score} of 100</span>
          </p>
          <ul className={r.reasons}>
            {model.confidence.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <p className={r.note}>
            EagleView&apos;s outline was moved {Math.abs(model.shiftFt.east)} ft {model.shiftFt.east >= 0 ? "east" : "west"} and {Math.abs(model.shiftFt.north)} ft {model.shiftFt.north >= 0 ? "north" : "south"} to sit on Google&apos;s height
            map. Imagery: {drawing.imagery.quality ?? "unknown quality"}
            {drawing.imagery.date ? `, flown ${drawing.imagery.date}` : ""}.
          </p>
        </div>

        <div>
          <div className={r.subHead}>Facets</div>
          <table className={`${s.tbl} ${r.tbl}`} data-roof-lab-facets>
            <thead>
              <tr>
                <th>Facet</th>
                <th className={r.num}>Area</th>
                <th className={r.num}>Pitch</th>
                <th>Faces</th>
              </tr>
            </thead>
            <tbody>
              {model.facets.map((f, i) => (
                <tr key={f.letter} className={hot === i ? r.hot : ""} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot((h) => (h === i ? null : h))}>
                  <td>
                    <b>{f.letter}</b>
                  </td>
                  <td className={r.num}>{whole(f.areaSqft)} sq ft</td>
                  <td className={r.num}>{f.pitchLabel}</td>
                  <td>{f.facing ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {model.notes.length ? (
        <details className={r.notes}>
          <summary>What the engine decided, step by step</summary>
          <ol>
            {model.notes.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

export function AdminRoofLabContent({ rows: initialRows, openId, first }: { rows: RoofLabRow[]; openId: string | null; first: Drawn | null }) {
  useAdminMotion();
  const [rows, setRows] = useState(initialRows);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(openId);
  const [drawn, setDrawn] = useState<Drawn | null>(first);
  const [searching, startSearch] = useTransition();
  const [drawing, startDraw] = useTransition();

  const search = () => startSearch(async () => setRows(await listRoofLab(query)));
  const open = (id: string) => {
    setPicked(id);
    setDrawn(null);
    startDraw(async () => setDrawn(await drawRoofLab(id).catch(() => ({ ok: false as const, error: "That did not go through. Try again." }))));
  };
  const row = rows.find((x) => x.id === picked) ?? null;

  return (
    <>
      <div className="page-head">
        <div>
          <div className="kicker">Platform · admins only</div>
          <h1 className="page-title">Roof facets (test)</h1>
        </div>
      </div>

      <div className="card">
        <p className={r.lead}>
          Pick a roof that was already measured. The engine reads the facets off Google&apos;s height map inside EagleView&apos;s outline and draws them on the aerial photo: ridges, hips, valleys, eaves and rakes, each with its
          length. Nothing is ordered, nothing is saved, and contractors do not see this page.
        </p>
      </div>

      <div className={r.layout}>
        <div className="card" data-roof-lab-list>
          <div className="card-head">
            <div className="card-title">Measured roofs</div>
          </div>
          <form className={r.searchRow} onSubmit={(e) => { e.preventDefault(); search(); }}>
            <input className={s.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Street or city" aria-label="Search by street or city" />
            <button type="submit" className="btn btn-ghost" disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>
          {rows.length ? (
            <ul className={r.list}>
              {rows.map((x) => (
                <li key={x.id}>
                  <button type="button" className={`${r.rowBtn} ${picked === x.id ? r.rowOn : ""}`} onClick={() => open(x.id)} data-roof-lab-row={x.id}>
                    <span className={r.rowTitle}>{x.address}</span>
                    <span className={r.rowSub}>
                      {[x.place, x.company].filter(Boolean).join(" · ")}
                    </span>
                    <span className={r.rowMeta}>
                      {shortDay(x.measuredAt)}
                      {x.areaSqft != null ? ` · ${whole(x.areaSqft)} sq ft` : ""}
                      {x.facetCount != null ? ` · ${x.facetCount} facets` : ""}
                      {x.pitch ? ` · ${x.pitch}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No measured roofs match.</p>
          )}
        </div>

        <div className="card" data-roof-lab-view>
          <div className="card-head">
            <div className="card-title">{row ? row.address : picked ? "The roof you opened" : "Pick a roof"}</div>
          </div>
          {!picked ? <p className="empty">Pick a roof on the left to see its facets.</p> : null}
          {picked && drawing && !drawn ? <p className={r.busy} role="status">Drawing the facets…</p> : null}
          {picked && drawn && !drawn.ok ? (
            <p className={r.fail} role="alert" data-roof-lab-error>
              {drawn.error}
            </p>
          ) : null}
          {picked && drawn?.ok ? <Stage key={picked} id={picked} drawing={drawn.drawing} /> : null}
        </div>
      </div>
    </>
  );
}
