"use client";

// ADMIN · ROOF FACETS (TEST) — /admin/roof-lab, blueprint (2026-11-11).
//
// The roof facet engine's test bench. On the left the saved roof measurements (every company's, newest first, with a
// search); on the right the one picked: Google's aerial photograph of the roof — or its height map shaded as a
// relief — with the facets the engine drew over it (lettered, largest first), every edge coloured by what it is and
// carrying its length in feet — or the roof alone as a report draws it, a FACETS diagram and a LINES diagram — then the numbers: the drawing against EagleView's own figures, the feet of ridge, hip,
// valley, eave and rake, the facets one by one, and what the engine decided along the way. Nothing here is saved, and
// nothing is shown to a contractor.
//
// The drawing is an SVG laid over the picture in the picture's own frame (metres east and south of its top-left
// corner — lib/roofFacets/server's PictureWindow), so the lines sit on the roof without any lining up.
//
// Renders ONLY the shell's `.content` children, as a fragment, so the reveal cascade walks `.content > *`.

import { useMemo, useState, useTransition } from "react";
import { drawRoofLab, listRoofLab, type RoofLabRow } from "@/actions/adminRoofLab";
import { FACET_EDGE_TYPES, FACET_EDGE_USE, FACET_EDGE_WORDS, type FacetEdgeType, type FacetModel } from "@/lib/roofFacets/model";
import type { RoofLabDrawing } from "@/lib/roofFacets/server";
import { shortDay } from "@/components/v3/admin-overview/admin-ui";
import { useAdminMotion } from "@/components/v3/admin-overview/admin-motion";
import s from "@/components/v3/admin-overview/admin-shared.module.css";
import r from "./roof-lab.module.css";

type Drawn = { ok: true; drawing: RoofLabDrawing } | { ok: false; error: string };

/**
 * The drawing's own colours — a roof report's legend (owner, 2026-11-12, with a sample report: "may be show like
 * this"): eaves blue, rakes green, ridges red, hips gold, valleys purple, step flashing a black dashed line, wall
 * flashing a grey dotted one. The same on the photograph and on the two diagrams; they do not follow the page's theme.
 */
const EDGE_COLOR: Record<FacetEdgeType, string> = {
  EAVE: "#2f55a4",
  RAKE: "#3f7d44",
  RIDGE: "#b23a3a",
  HIP: "#b8872b",
  VALLEY: "#5b3a8c",
  STEP: "#111111",
  WALL: "#555555",
  BREAK: "#0f7f86",
};
const EDGE_DASH: Partial<Record<FacetEdgeType, string>> = { STEP: "7 5", WALL: "1.5 5" };
const FACET_FILL = "#7c3aed";
const INK = "#14121a";
const PAPER = "#f6f4ef";

/** True when the box (cx ± hw, cy ± hh) lies inside the facet — its outer ring, and out of its holes. */
function boxFits(rings: Array<Array<{ x: number; y: number }>>, cx: number, cy: number, hw: number, hh: number): boolean {
  const inside = (x: number, y: number) => {
    let odd = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) odd = !odd;
      }
    }
    return odd;
  };
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) if (!inside(cx + dx * hw, cy + dy * hh)) return false;
  return true;
}

/** A facet's wash on the facets diagram: the steeper, the darker the blue. */
function pitchFill(rise12: number): string {
  const t = Math.min(1, Math.max(0, rise12 / 12));
  const from = [240, 244, 252], to = [140, 170, 222];
  return `rgb(${from.map((v, k) => Math.round(v + (to[k] - v) * t)).join(",")})`;
}

const FACING_WORDS: Record<string, string> = { N: "North", NE: "North-east", E: "East", SE: "South-east", S: "South", SW: "South-west", W: "West", NW: "North-west" };

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

export type View = "photo" | "relief" | "facets" | "lines";

/** A roof report's north arrow and 20-foot scale bar, in the diagram's own unit (metres). */
function Furniture({ vb, u }: { vb: { x: number; y: number; w: number; h: number }; u: number }) {
  const nx = vb.x + vb.w - 2.4 * u, ny = vb.y + 1.4 * u;
  const TEN_FT = 3.048;
  const sx = vb.x + 1.6 * u, sy = vb.y + vb.h - 2.6 * u;
  return (
    <g pointerEvents="none">
      <path d={`M${nx} ${ny}l${-0.75 * u} ${2.3 * u}l${0.75 * u} ${-0.6 * u}l${0.75 * u} ${0.6 * u}z`} fill={INK} />
      <text x={nx} y={ny + 3.7 * u} fontSize={u * 0.95} fontWeight={800} textAnchor="middle" fill={INK} style={{ fontFamily: "var(--font-mono)" }}>
        N
      </text>
      <rect x={sx} y={sy} width={TEN_FT} height={u * 0.42} fill={INK} />
      <rect x={sx + TEN_FT} y={sy} width={TEN_FT} height={u * 0.42} fill="#ffffff" stroke={INK} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <text x={sx} y={sy + u * 1.6} fontSize={u * 0.8} fill="#555" style={{ fontFamily: "var(--font-mono)" }}>
        0
      </text>
      <text x={sx + 2 * TEN_FT} y={sy + u * 1.6} fontSize={u * 0.8} textAnchor="middle" fill="#555" style={{ fontFamily: "var(--font-mono)" }}>
        20 ft
      </text>
    </g>
  );
}

/**
 * The two report-style drawings: the roof alone on white, from above, north up — FACETS (each washed by its pitch,
 * with its letter, area and pitch inside) and LINES (every edge in its kind's colour with its true length).
 */
function Diagram({ model, pts, paths, mode, hot, setHot }: { model: FacetModel; pts: Array<{ x: number; y: number }>; paths: Array<{ d: string; at: { x: number; y: number }; rings: Array<Array<{ x: number; y: number }>> }>; mode: "facets" | "lines"; hot: number | null; setHot: (f: (h: number | null) => number | null) => void }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.14 + 2;
  const vb = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  const u = Math.max(vb.w, vb.h) / 50;
  const mono = { fontFamily: "var(--font-mono)" } as const;
  return (
    <div className={r.paper} style={{ aspectRatio: `${vb.w} / ${vb.h}` }} data-roof-lab-diagram={mode}>
      <svg className={r.sheet} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={mode === "facets" ? `Roof diagram: ${model.facets.length} facets, each with its area and pitch` : "Roof diagram: every line with its length"}>
        {model.facets.map((f, i) => (
          <path
            key={f.letter}
            d={paths[i].d}
            fillRule="evenodd"
            fill={mode === "facets" ? pitchFill(f.pitch12) : PAPER}
            stroke={mode === "facets" ? INK : "none"}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity={hot === null || hot === i ? 1 : 0.55}
            onMouseEnter={() => setHot(() => i)}
            onMouseLeave={() => setHot((h) => (h === i ? null : h))}
            data-roof-lab-facet={f.letter}
          />
        ))}
        {mode === "lines"
          ? model.edges.map((e, i) => (
              <line key={`e${i}`} x1={pts[e.a].x} y1={pts[e.a].y} x2={pts[e.b].x} y2={pts[e.b].y} stroke={EDGE_COLOR[e.type]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[e.type]} vectorEffect="non-scaling-stroke" pointerEvents="none" data-roof-lab-edge={e.type} />
            ))
          : null}
        {mode === "lines"
          ? model.edges.map((e, i) => {
              if (e.lengthFt < 4) return null;
              const text = `${Math.round(e.lengthFt)}'`;
              if (Math.hypot(pts[e.a].x - pts[e.b].x, pts[e.a].y - pts[e.b].y) < u * 0.62 * text.length * 1.2) return null;
              return (
                <text key={`l${i}`} x={(pts[e.a].x + pts[e.b].x) / 2} y={(pts[e.a].y + pts[e.b].y) / 2} fontSize={u * 0.98} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={EDGE_COLOR[e.type]} stroke="#ffffff" strokeWidth={u * 0.32} strokeLinejoin="round" paintOrder="stroke" pointerEvents="none" style={mono}>
                  {text}
                </text>
              );
            })
          : null}
        {mode === "facets"
          ? model.facets.map((f, i) => {
              // a facet with no room for three lines of type gets its letter alone (its figures are in the table)
              const small = !boxFits(paths[i].rings, paths[i].at.x, paths[i].at.y, u * 1.75, u * 1.85);
              const rad = u * (small ? 0.72 : 1);
              const x = paths[i].at.x, y = paths[i].at.y - (small ? 0 : u * 0.95);
              return (
                <g key={`n${f.letter}`} pointerEvents="none">
                  <circle cx={x} cy={y} r={rad} fill="#ffffff" stroke={INK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                  <text x={x} y={y} fontSize={rad * 1.1} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={INK} style={{ fontFamily: "var(--font)" }}>
                    {f.letter}
                  </text>
                  {small ? null : (
                    <>
                      <text x={x} y={y + rad + u * 0.85} fontSize={u * 0.86} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={INK} stroke="#ffffff" strokeWidth={u * 0.26} strokeLinejoin="round" paintOrder="stroke" style={mono}>
                        {whole(f.areaSqft)} sf
                      </text>
                      <text x={x} y={y + rad + u * 1.8} fontSize={u * 0.78} textAnchor="middle" dominantBaseline="central" fill="#555" stroke="#ffffff" strokeWidth={u * 0.24} strokeLinejoin="round" paintOrder="stroke" style={mono}>
                        {f.pitchLabel}
                      </text>
                    </>
                  )}
                </g>
              );
            })
          : null}
        <Furniture vb={vb} u={u} />
      </svg>
    </div>
  );
}

/**
 * One roof drawn: the four views, the legend, the two tables, the comparison and the confidence. The lab mounts it
 * for the roof picked from its list; the roof estimator mounts it under a measurement for platform admins
 * (./roof-diagram-preview), opening on the facets diagram.
 */
/** What the outline step left out, in words; nothing under 20 sq ft is worth a line. */
function leftOutParts(lo: RoofLabDrawing["model"]["leftOut"]): string[] {
  if (!lo) return [];
  const n = (v: number) => `${Math.round(v).toLocaleString("en-US")} sq ft`;
  const out: string[] = [];
  if (lo.deckSqft >= 20) out.push(`${n(lo.deckSqft)} of deck (flat, a storey under the eave)`);
  if (lo.lowSqft >= 20) out.push(`${n(lo.lowSqft)} lower than 5 ft above the ground (driveway, patio, low deck)`);
  if (lo.besideWallSqft >= 20) out.push(`${n(lo.besideWallSqft)} beside the walls (a wall or hedge seen from above)`);
  if (lo.pastEdgeSqft >= 40) out.push(`${n(lo.pastEdgeSqft)} past the roof's edge`);
  return out;
}

export function RoofLabStage({ id, drawing, startView }: { id: string; drawing: RoofLabDrawing; startView?: View }) {
  const { model, window: win } = drawing;
  const [view, setView] = useState<View>(startView ?? (drawing.photo ? "photo" : "relief"));
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
        return { d: rings.map((ring) => `M${ring.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join("L")}Z`).join(""), at: labelPoint(rings), rings };
      }),
    [model, pts],
  );
  // type sizes in the drawing's own unit (metres), so they scale with the picture
  const unit = Math.max(win.widthM, win.heightM) / 52;
  const shown: View = view === "photo" && photoFailed ? "relief" : view;
  const picture = shown === "photo" || shown === "relief";
  const kinds = FACET_EDGE_TYPES.filter((t) => model.totals.count[t] > 0);
  const pitches = [...new Map(model.facets.map((f) => [f.pitchLabel, f.pitch12])).entries()].sort((p, q) => p[1] - q[1]);

  return (
    <div>
      <div className={r.tools}>
        <div className={r.seg} role="group" aria-label="View">
          <button type="button" className={shown === "photo" ? r.segOn : ""} disabled={!drawing.photo || photoFailed} onClick={() => setView("photo")}>
            Aerial photo
          </button>
          <button type="button" className={shown === "relief" ? r.segOn : ""} onClick={() => setView("relief")}>
            Height map
          </button>
          <button type="button" className={shown === "facets" ? r.segOn : ""} onClick={() => setView("facets")}>
            Facets diagram
          </button>
          <button type="button" className={shown === "lines" ? r.segOn : ""} onClick={() => setView("lines")}>
            Lines diagram
          </button>
        </div>
        {picture ? (
          <>
            <label className={r.tick}>
              <input type="checkbox" checked={fill} onChange={(e) => setFill(e.target.checked)} /> Facets
            </label>
            <label className={r.tick}>
              <input type="checkbox" checked={letters} onChange={(e) => setLetters(e.target.checked)} /> Letters
            </label>
            <label className={r.tick}>
              <input type="checkbox" checked={lengths} onChange={(e) => setLengths(e.target.checked)} /> Lengths
            </label>
          </>
        ) : (
          <span className={r.caption}>{shown === "facets" ? "Top view · each facet with its area and pitch" : "True lengths along the slope, feet"}</span>
        )}
      </div>
      {photoFailed ? <p className={r.note}>Google did not return the aerial photo for this roof, so the height map is shown instead.</p> : null}
      {!drawing.photo ? <p className={r.note}>No aerial photo is on file for this roof (or no Google key is set), so the height map is shown.</p> : null}

      {picture ? (
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
                fillOpacity={hot === i ? 0.5 : fill ? 0.22 : 0}
                stroke="none"
                onMouseEnter={() => setHot(i)}
                onMouseLeave={() => setHot((h) => (h === i ? null : h))}
                data-roof-lab-facet={f.letter}
              />
            ))}
            {/* a white edge under every line, so the report's colours read on a dark roof */}
            {model.edges.map((e, i) => (
              <line key={`c${i}`} x1={pts[e.a].x} y1={pts[e.a].y} x2={pts[e.b].x} y2={pts[e.b].y} stroke="#ffffff" strokeOpacity={0.92} strokeWidth={6.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ))}
            {model.edges.map((e, i) => (
              <line key={`e${i}`} x1={pts[e.a].x} y1={pts[e.a].y} x2={pts[e.b].x} y2={pts[e.b].y} stroke={EDGE_COLOR[e.type]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[e.type]} vectorEffect="non-scaling-stroke" pointerEvents="none" data-roof-lab-edge={e.type} />
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
                      <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={h * 0.22} fill="#ffffff" fillOpacity={0.95} stroke={EDGE_COLOR[e.type]} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      <text x={x} y={y} fontSize={unit * 0.9} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={EDGE_COLOR[e.type]} style={{ fontFamily: "var(--font-mono)" }}>
                        {text}
                      </text>
                    </g>
                  );
                })
              : null}
            {letters
              ? model.facets.map((f, i) => {
                  const { x, y } = facets[i].at;
                  const rad = unit * 0.95;
                  return (
                    <g key={`n${f.letter}`} pointerEvents="none">
                      <circle cx={x} cy={y} r={rad} fill="#ffffff" stroke={INK} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                      <text x={x} y={y} fontSize={rad * (f.letter.length > 1 ? 0.9 : 1.15)} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill={INK} style={{ fontFamily: "var(--font)" }}>
                        {f.letter}
                      </text>
                    </g>
                  );
                })
              : null}
          </svg>
        </div>
      ) : (
        <Diagram model={model} pts={pts} paths={facets} mode={shown === "facets" ? "facets" : "lines"} hot={hot} setHot={setHot} />
      )}

      {shown === "facets" ? (
        <ul className={r.legend} aria-label="What the shades mean">
          {pitches.map(([label, rise]) => (
            <li key={label}>
              <span className={r.shade} style={{ background: pitchFill(rise) }} />
              {label}
            </li>
          ))}
          <li className={r.legendNote}>Darker blue = steeper</li>
        </ul>
      ) : (
        <ul className={r.legend} aria-label="What the line colours mean">
          {kinds.map((t) => (
            <li key={t}>
              <svg className={r.key} viewBox="0 0 30 6" aria-hidden="true">
                <line x1={1} y1={3} x2={29} y2={3} stroke={EDGE_COLOR[t]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[t]} />
              </svg>
              {FACET_EDGE_WORDS[t]}
            </li>
          ))}
        </ul>
      )}

      <div className={r.subHead}>Lines and lengths</div>
      <div className={r.scroll}>
        <table className={`${s.tbl} ${r.tbl}`} data-roof-lab-lines>
          <thead>
            <tr>
              <th>Line</th>
              <th>What it&apos;s for</th>
              <th className={r.num}>Count</th>
              <th className={r.num}>Length, ft</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map((t) => (
              <tr key={t}>
                <td>
                  <span className={r.kind}>
                    <svg className={r.key} viewBox="0 0 30 6" aria-hidden="true">
                      <line x1={1} y1={3} x2={29} y2={3} stroke={EDGE_COLOR[t]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[t]} />
                    </svg>
                    {FACET_EDGE_WORDS[t]}
                  </span>
                </td>
                <td>{FACET_EDGE_USE[t]}</td>
                <td className={r.num}>{model.totals.count[t]}</td>
                <td className={r.num}>{whole(model.totals.feet[t])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={r.subHead}>Facets</div>
      <div className={r.scroll}>
        <table className={`${s.tbl} ${r.tbl}`} data-roof-lab-facets>
          <thead>
            <tr>
              <th>Facet</th>
              <th>Part</th>
              <th>Faces</th>
              <th className={r.num}>Pitch</th>
              <th className={r.num}>Area, sq ft</th>
              <th className={r.num}>Squares</th>
            </tr>
          </thead>
          <tbody>
            {model.facets.map((f, i) => (
              <tr key={f.letter} className={hot === i ? r.hot : ""} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot((h) => (h === i ? null : h))}>
                <td>
                  <span className={r.letterBox}>{f.letter}</span>
                </td>
                <td className={r.keep}>{f.part}</td>
                <td className={r.keep}>{f.facing ? (FACING_WORDS[f.facing] ?? f.facing) : "—"}</td>
                <td className={r.num}>{f.pitchLabel}</td>
                <td className={r.num}>{whole(f.areaSqft)}</td>
                <td className={r.num}>{(f.areaSqft / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={r.totalRow}>
              <td colSpan={4}>All facets</td>
              <td className={r.num}>{whole(model.totals.areaSqft)}</td>
              <td className={r.num}>{(model.totals.areaSqft / 100).toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className={r.cols}>
        <div>
          <div className={r.subHead}>The drawing against {model.compare.reference === "Google" ? "Google\u2019s estimate" : model.compare.reference}</div>
          <table className={`${s.tbl} ${r.tbl}`}>
            <thead>
              <tr>
                <th></th>
                <th className={r.num}>Drawing</th>
                <th className={r.num}>{model.compare.reference}</th>
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
            {model.compare.areaDeltaPct != null ? `The drawing's area is ${Math.abs(model.compare.areaDeltaPct)}% ${model.compare.areaDeltaPct >= 0 ? "above" : "below"} ${model.compare.reference}'s. ` : ""}
            Google&apos;s own count for this roof is {model.compare.googleSegments} planes.
          </p>
        </div>
        <div>
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
            {model.outlineFrom === "google"
              ? model.leftOut
                ? "EagleView gave no outline for this roof, so the outline is read off Google's height map and squared to the building. "
                : "The outline is Google's own outline of the building (EagleView gave none for this roof). "
              : `EagleView's outline was moved ${Math.abs(model.shiftFt.east)} ft ${model.shiftFt.east >= 0 ? "east" : "west"} and ${Math.abs(model.shiftFt.north)} ft ${model.shiftFt.north >= 0 ? "north" : "south"} to sit on Google's height map. `}
            Imagery: {drawing.imagery.quality ?? "unknown quality"}
            {drawing.imagery.date ? `, flown ${drawing.imagery.date}` : ""}.
          </p>
        </div>
      </div>

      {leftOutParts(model.leftOut).length ? (
        <p className={r.note} data-roof-left-out>
          <b>Not drawn, because it is not roof:</b> {leftOutParts(model.leftOut).join(" · ")}. Google&apos;s own estimate still counts these.
        </p>
      ) : null}

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
          <p className={r.note} style={{ margin: "0 0 12px" }}>
            The facets are read off Google&apos;s height map. Where Google has none of a roof (a newer house, mostly), it cannot be drawn yet — those rows say so.
          </p>
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
                    {x.heightMap === "none" ? <span className={`${r.rowFlag} ${r.rowFlagBad}`}>Google has no height map of this roof</span> : null}
                    {x.heightMap === "partial" ? <span className={r.rowFlag}>Height map shows only part of this roof</span> : null}
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
          {picked && drawn?.ok ? <RoofLabStage key={picked} id={picked} drawing={drawn.drawing} /> : null}
        </div>
      </div>
    </>
  );
}
