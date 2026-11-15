"use client";
// THE FRAMING PLAN (2026-10-04; the roof 2026-10-10; levels, stairs, rails and
// fixtures M3 2026-10-10) — the structure seen from above, drawn the way a
// framer sketches it: the outline in heavy ink (a bow or clipped corners as
// drawn), the house wall hatched, the ledger along it, every joist, the beams
// (dashed where they sit under the joists, solid where they are flush), posts
// on their footings, the blocking, the dimensions a crew lays out by; the
// lower level the same a step down; the stairs with their treads; the rail
// with its posts; the fixtures as amber marks. With a roof: its posts, the
// headers between them, the rafters, hips and ridge in blueprint blue, and
// the eave line dashed outside the posts.
//
// Owner: "stairs placed by pointing." In placing mode a click near an open
// edge tells the studio which edge, how far along, and which level.
import * as React from "react";
import type { DeckGrip } from "@/lib/deck/byHand";
import type { DeckFrame } from "@/lib/deck/frame";
import type { DeckStructure } from "@/lib/deck/structure";
import { structureLevels } from "@/lib/deck/structure";
import type { DeckSurface } from "@/lib/deck/surface";
import { ftIn } from "@/lib/deck/codeTables";
import { shapeOutline, type StairSide } from "@/lib/deck/design";
import s from "./deck-studio.module.css";

export interface PlanEdgeHit {
  level: "upper" | "lower";
  side: StairSide;
  atFt: number;
}

/**
 * The nearest open edge of a level to a point in the plan (inches, the main deck's coordinates), and where along it —
 * the front and the open ends of each level. `maxIn` caps the distance (the plan's click: 3 ft; the 3D's: any, so a
 * click anywhere on the deck takes its nearest edge — owner, 2026-10-11).
 */
export function nearestStairEdge(structure: DeckStructure, xIn: number, yIn: number, maxIn = 36): PlanEdgeHit | null {
  let best: { d: number; hit: PlanEdgeHit } | null = null;
  for (const l of structureLevels(structure)) {
    const W = Math.max(...l.frame.zones.map((z) => z.zone.x1));
    const D = Math.max(...l.frame.zones.map((z) => z.zone.y1));
    const ox = l.offsetXIn;
    const oy = l.offsetYIn;
    const clampX = Math.min(Math.max(xIn, ox), ox + W);
    const clampY = Math.min(Math.max(yIn, oy), oy + D);
    const edges: Array<{ side: StairSide; d: number; at: number; open: boolean }> = [
      { side: "front", d: Math.hypot(yIn - (oy + D), xIn - clampX), at: clampX - ox, open: true },
      { side: "left", d: Math.hypot(xIn - ox, yIn - clampY), at: clampY - oy, open: l.frame.edges.some((ed) => ed.side === "left" && !ed.house) },
      { side: "right", d: Math.hypot(xIn - (ox + W), yIn - clampY), at: clampY - oy, open: l.frame.edges.some((ed) => ed.side === "right" && !ed.house) },
    ];
    for (const ed of edges) {
      if (!ed.open || ed.d > maxIn) continue;
      if (!best || ed.d < best.d) best = { d: ed.d, hit: { level: l.id, side: ed.side, atFt: Math.round((ed.at / 12) * 2) / 2 } };
    }
  }
  return best?.hit ?? null;
}

const FIXTURE_MARK: Record<string, string> = { "led-strip": "L", "post-cap": "c", "step-light": "s", "string-light": "S", sconce: "W", "ceiling-light": "L", chandelier: "C", fan: "F", outlet: "O", heater: "H", flood: "F" };

/**
 * `show`: "all" (the studio), "floor" (the permit set's floor framing plan: no roof over it, the posts and footings
 * named) or "roof" (the roof framing plan alone, the deck as a faint outline under it).
 */
export function DeckPlan({
  structure,
  placing = null,
  onPlaceStair,
  show = "all",
  marks = [],
  grips,
  onMoveGrip,
  onPickGrip,
  level = "upper",
}: {
  structure: DeckStructure;
  placing?: "stair" | null;
  onPlaceStair?: (hit: PlanEdgeHit) => void;
  show?: "all" | "floor" | "roof";
  /** Points to call out on the plan, deck inches (the permit set's lateral devices, 2026-10-20). */
  marks?: ReadonlyArray<{ x: number; y: number; label: string }>;
  /**
   * MOVED BY HAND (2026-11-13; lib/deck/byHand): the posts and beams that can be taken hold of. With `onMoveGrip` each
   * is dragged on the plan — a post along its beam or its side, a beam along the joists — an inch at a time; a click
   * without a pull is `onPickGrip` (the studio opens the part's card, to type its place).
   */
  grips?: readonly DeckGrip[];
  onMoveGrip?: (grip: DeckGrip, at: number, done: boolean) => void;
  onPickGrip?: (grip: DeckGrip) => void;
  /** A double deck whose lower floor is shaped on its own (2026-11-14; lib/deck/doubleDeck): which deck's frame is drawn. */
  level?: "upper" | "lower";
}) {
  const { frame: frameIn, roof: roofIn } = structure;
  const frame = show === "roof" ? null : frameIn;
  // (The lower deck's own plan has no roof over it: the roof is the upper deck's.)
  const lowerPlan = level === "lower" && structure.lower?.place === "under" && !!structure.design.lower.shape;
  const roof = show === "floor" || lowerPlan ? null : roofIn;
  const outlineOnly = show === "roof" ? frameIn : null;
  // A DOUBLE DECK (2026-11-13): the lower deck is framed on the upper deck's own lines, so one plan is both — drawn
  // once, with a word saying so (two frames laid on one another were unreadable).
  const under = structure.lower?.place === "under" ? structure.lower : null;
  // …unless it was shaped on its own (2026-11-14): then each deck has a plan of its own, picked by `level`.
  const ownLower = !!under && !!structure.design.lower.shape;
  const lowerOnly = ownLower && level === "lower";
  const levels = structureLevels(structure).filter((l) => (lowerOnly ? l.id === "lower" : !(under && l.id === "lower")));
  const underNote = !under || lowerOnly ? "" : ownLower ? `double deck · lower deck shaped on its own: its own plan` : `double deck · the lower deck ${ftIn(under.frame.surfaceIn)} high, framed on the same lines: ${under.frame.joistSize} @ ${under.frame.spacingIn}", ${[...new Set(under.frame.beams.map((b) => b.spec.size))].join(" and ")} ${under.frame.beams.length === 1 ? "beam" : "beams"} let into the posts`;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const eave = roof?.eaveRing ?? [];
  // The roof's framing plan draws no stairs (2026-11-13): their footprints made its frame larger and the roof smaller.
  const drawnStairs = show === "roof" ? [] : lowerPlan ? structure.stairs.filter((st) => st.level === "lower") : structure.stairs;
  const xs = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.x0 + l.offsetXIn, z.zone.x1 + l.offsetXIn])), ...eave.map((p) => p.x), ...(roof ? [0] : []), ...drawnStairs.flatMap((st) => st.footprint.map((p) => p.x))];
  const ys = [...levels.flatMap((l) => l.frame.zones.flatMap((z) => [z.zone.y0 + l.offsetYIn, z.zone.y1 + l.offsetYIn])), ...eave.map((p) => p.y), ...(roof ? [0] : []), ...drawnStairs.flatMap((st) => st.footprint.map((p) => p.y))];
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 48);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys, 48);
  const size = Math.max(maxX - minX, maxY - minY);
  const font = Math.max(9, size / 34);
  const pad = font * (show === "floor" ? 9 : show === "roof" ? 3.6 : 5.5);
  const onHouse = frame ? frame.design.placement !== "detached" : roof?.attach === "wall";
  const houseBand = font * 2.2;
  const lw = Math.max(0.8, size / 260);
  const dimY = maxY + font * 2.6;
  const dimX = maxX + font * 2.6;
  const joistNote = frame ? `${frame.joistSize} joists @ ${frame.spacingIn}" o.c.` : "";
  const roofNote = roof ? (roof.trusses ? `trusses @ ${roof.trusses.spacingIn}" o.c. · ${ftIn(roof.trusses.spanIn)} span` : `${roof.rafters.size} rafters @ ${roof.rafters.spacingIn}" o.c.`) : "";
  const vb = `${minX - pad} ${minY - pad - (onHouse ? houseBand : 0)} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2 + (onHouse ? houseBand : 0)}`;
  const roofMembers = (roles: string[]) => (roof ? roof.members.filter((m) => roles.includes(m.role)) : []);

  // A PULL ON THE PLAN. The pointer's travel along the part's own line, read in the plan's inches; the listeners
  // are the window's, so the pull goes on while the plan re-draws under it (every inch re-frames the deck).
  const moveRef = React.useRef(onMoveGrip);
  const pickGripRef = React.useRef(onPickGrip);
  React.useEffect(() => {
    moveRef.current = onMoveGrip;
    pickGripRef.current = onPickGrip;
  });
  const pull = React.useRef<{ grip: DeckGrip; x: number; y: number; last: number; moved: boolean } | null>(null);
  const [held, setHeld] = React.useState<{ kind: DeckGrip["kind"]; id: string } | null>(null);
  const toPlan = (clientX: number, clientY: number) => {
    const ctm = svgRef.current?.getScreenCTM();
    return ctm ? new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse()) : null;
  };
  const gripDown = (e: React.PointerEvent<SVGRectElement>, grip: DeckGrip) => {
    if (placing || e.button > 0) return;
    const at = toPlan(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    e.stopPropagation();
    pull.current = { grip, x: at.x, y: at.y, last: grip.at, moved: false };
    setHeld({ kind: grip.kind, id: grip.id });
    const move = (ev: PointerEvent) => {
      const d = pull.current;
      const now = toPlan(ev.clientX, ev.clientY);
      if (!d || !now) return;
      const next = Math.round(d.grip.at + (d.grip.axis === "x" ? now.x - d.x : now.y - d.y));
      if (next === d.last) return;
      d.last = next;
      d.moved = true;
      moveRef.current?.(d.grip, next, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const d = pull.current;
      pull.current = null;
      setHeld(null);
      if (!d) return;
      if (d.moved) moveRef.current?.(d.grip, d.last, true);
      else pickGripRef.current?.(d.grip);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  const liveGrips = onMoveGrip && grips && show === "all" && !lowerPlan ? grips.filter((g) => !g.fixed) : [];
  const heldGrip = held ? liveGrips.find((g) => g.kind === held.kind && g.id === held.id) : undefined;

  /** A click in placing mode: the nearest open edge of a level, and where along it. */
  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!placing || !onPlaceStair || !svgRef.current) return;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const hit = nearestStairEdge(structure, pt.x, pt.y);
    if (hit) onPlaceStair(hit);
  };

  const levelDrawing = (f: DeckFrame, ox: number, oy: number, lower: boolean, surface: DeckSurface | null) => {
    // THE PICTURE-FRAME BORDER, SEEN FROM ABOVE (2026-11-13 — a deck builder: "the border option changes nothing in the
    // overhead view"). This plan drew the frame only. The border's boards are now laid on it as they lie — a toned band
    // along every open edge, each board outlined — with a word saying how wide.
    const borderPieces = surface && surface.border > 0 && show !== "roof" ? surface.pieces.filter((pc) => pc.border) : [];
    const borderRings = surface && surface.border > 0 && show !== "roof" ? surface.shaped.slice(surface.shapedBorderFrom) : [];
    // Where its label hangs: under the border's front-most piece — a plain board, or a mitred one (its cut ring's box).
    const ringBoxes = borderRings.map((ring) => {
      const xs = ring.filter((_, k) => k % 2 === 0);
      const ys = ring.filter((_, k) => k % 2 === 1);
      return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, sx: Math.max(...xs) - Math.min(...xs), sy: Math.max(...ys) - Math.min(...ys) };
    });
    const labelled = [...borderPieces.map((pc) => ({ cx: pc.cx, cy: pc.cy, sx: pc.sx, sy: pc.sy })), ...ringBoxes];
    const borderAt = labelled.length ? labelled.reduce((a, b) => (b.cy + b.sy / 2 > a.cy + a.sy / 2 + 0.5 || (Math.abs(b.cy + b.sy / 2 - (a.cy + a.sy / 2)) <= 0.5 && b.sx > a.sx) ? b : a)) : null;
    const zones = f.zones.map((z) => z.zone);
    const W = Math.max(...zones.map((z) => z.x1));
    const D = Math.max(...zones.map((z) => z.y1));
    const outline = shapeOutline(f.design.shape).map((p) => `${p.x + ox},${p.y + oy}`).join(" ");
    const sticks = (role: string) => f.sticks.filter((st) => st.role === role);
    const rect = (st: (typeof f.sticks)[number], key: string, fill: string, stroke?: string, sw = lw * 0.6) =>
      st.yaw ? (
        <rect key={key} x={st.cx + ox - st.sx / 2} y={st.cy + oy - st.sy / 2} width={st.sx} height={st.sy} fill={fill} stroke={stroke} strokeWidth={sw} transform={`rotate(${(st.yaw * 180) / Math.PI} ${st.cx + ox} ${st.cy + oy})`} />
      ) : (
        <rect key={key} x={st.cx + ox - st.sx / 2} y={st.cy + oy - st.sy / 2} width={st.sx} height={st.sy} fill={fill} stroke={stroke} strokeWidth={sw} />
      );
    return (
      <g key={lower ? "lower" : "upper"} opacity={lower ? 0.92 : 1}>
        {f.posts.map((p) => (
          <circle key={`f${p.id}`} cx={p.x + ox} cy={p.y + oy} r={p.footing.padIn / 2} fill="none" stroke="var(--muted)" strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2}`} />
        ))}
        {f.beams.map((b) => (
          <rect key={b.id} x={b.x0 + ox} y={b.y + oy - b.spec.thickIn / 2} width={b.x1 - b.x0} height={b.spec.thickIn} fill={b.style === "flush" ? "var(--paper-deep)" : "none"} stroke="var(--blueprint)" strokeWidth={lw * 1.6} strokeDasharray={b.style === "dropped" ? `${lw * 6} ${lw * 3}` : undefined} />
        ))}
        {/* The angled beams under corners cut at 45° (2026-11-14): the same dashed line as the beams they meet. */}
        {f.cornerBeams.map((c) => {
          const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0) || 1;
          const nx = (-(c.y1 - c.y0) / len) * (c.spec.thickIn / 2);
          const ny = ((c.x1 - c.x0) / len) * (c.spec.thickIn / 2);
          return (
            <polygon
              key={c.id}
              points={`${c.x0 + nx + ox},${c.y0 + ny + oy} ${c.x1 + nx + ox},${c.y1 + ny + oy} ${c.x1 - nx + ox},${c.y1 - ny + oy} ${c.x0 - nx + ox},${c.y0 - ny + oy}`}
              fill="none"
              stroke="var(--blueprint)"
              strokeWidth={lw * 1.6}
              strokeDasharray={`${lw * 6} ${lw * 3}`}
              data-deck-plan-corner-beam={c.id}
            />
          );
        })}
        {sticks("joist").map((j, i) => rect(j, `j${i}`, "var(--paper-deep)", "var(--ink-soft)"))}
        {sticks("rim").map((r, i) => rect(r, `r${i}`, r.curved ? "var(--blueprint)" : "var(--paper-deep)", "var(--ink-soft)"))}
        {sticks("blocking").map((b, i) => rect(b, `k${i}`, "var(--muted-light)"))}
        {sticks("ledger").map((l, i) => rect(l, `l${i}`, "var(--ink)"))}
        {f.posts.filter((p) => !p.roof).map((p) => {
          const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
          const d = p.size === "4x6" ? 5.5 : w;
          // A post set by hand wears a ring (2026-11-13), like the roof's.
          return (
            <g key={p.id}>
              <rect x={p.x + ox - w / 2} y={p.y + oy - d / 2} width={w} height={d} fill="var(--ink)" />
              {p.by ? <circle cx={p.x + ox} cy={p.y + oy} r={w * 0.95} fill="none" stroke="var(--blueprint)" strokeWidth={lw * 1.1} data-deck-plan-post-by="pin" /> : null}
            </g>
          );
        })}
        {show === "floor"
          ? f.posts.filter((p) => !p.roof).map((p) => (
              <text key={`pn${p.id}`} x={p.x + ox + (p.size === "8x8" ? 3.75 : p.size === "6x6" ? 2.75 : 1.75) + font * 0.25} y={p.y + oy + font * 1.15} fontSize={font * 0.7} className={s.planNote}>
                {p.id}
              </text>
            ))
          : null}
        {borderPieces.length || borderRings.length ? (
          <g data-deck-plan-border={surface?.border} pointerEvents="none">
            {borderPieces.map((pc, i) => (
              <rect key={`bd${i}`} x={pc.cx + ox - pc.sx / 2} y={pc.cy + oy - pc.sy / 2} width={pc.sx} height={pc.sy} fill="var(--blueprint)" fillOpacity={0.2} stroke="var(--blueprint)" strokeWidth={lw * 0.9} />
            ))}
            {borderRings.map((ring, i) => (
              <polygon key={`br${i}`} points={ring.map((v, k) => v + (k % 2 === 0 ? ox : oy)).join(" ")} fill="var(--blueprint)" fillOpacity={0.2} stroke="var(--blueprint)" strokeWidth={lw * 0.9} />
            ))}
            {borderAt ? (
              <text x={borderAt.cx + ox} y={borderAt.cy + oy + borderAt.sy / 2 + font * 0.95} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
                {`picture-frame border · ${surface!.border === 2 ? "2 boards" : "1 board"}${surface!.product.border ? ` · ${surface!.product.border.name}` : ""}`}
              </text>
            ) : null}
          </g>
        ) : null}
        <polygon points={outline} fill="none" stroke="var(--ink)" strokeWidth={lw * 2.2} />
        {f.beams.map((b) => (
          <text key={`bt${b.id}`} x={b.x0 + ox + font * 0.6} y={b.y + oy - b.spec.thickIn / 2 - font * 0.45} fontSize={font * 0.9} className={s.planNote}>
            {`${b.spec.size} ${b.style === "flush" ? "flush " : ""}beam · posts ${ftIn(b.spanIn)} o.c.`}
          </text>
        ))}
        {!roof || lower ? (
          <text x={W / 2 + ox} y={(f.zones[0].zone.y0 + (f.beams[0]?.y ?? D)) / 2 + oy} fontSize={font * 0.95} textAnchor="middle" className={s.planNote}>
            {lower ? `lower level · ${f.joistSize} @ ${f.spacingIn}" · ${ftIn(f.surfaceIn)} high` : joistNote}
          </text>
        ) : null}
        {!lower && underNote && show !== "roof" ? (
          <text x={W / 2 + ox} y={(f.zones[0].zone.y0 + (f.beams[0]?.y ?? D)) / 2 + oy + font * 1.25} fontSize={font * 0.7} textAnchor="middle" className={s.planNote} data-deck-plan-double>
            {underNote}
          </text>
        ) : null}
      </g>
    );
  };

  return (
    <svg ref={svgRef} className={`${s.planSvg}${placing ? ` ${s.planPlacing}` : ""}`} viewBox={vb} role="img" aria-label={`Framing plan: ${ftIn(maxX - minX)} by ${ftIn(maxY - minY)}${joistNote ? `, ${joistNote}` : ""}${roofNote ? `, ${roofNote}` : ""}`} onClick={onClick} data-deck-plan={placing ? "placing" : "plan"}>
      <defs>
        <pattern id="deckHatch" width={font} height={font} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2={font} stroke="var(--muted-light)" strokeWidth={lw} />
        </pattern>
      </defs>
      {/* The house, where the deck meets it. */}
      {frame
        ? frame.edges.filter((e) => e.house).map((e, i) => {
            const horizontal = e.y0 === e.y1;
            const x = Math.min(e.x0, e.x1);
            const y = Math.min(e.y0, e.y1);
            return horizontal ? (
              <rect key={`h${i}`} x={x} y={y - houseBand} width={Math.abs(e.x1 - e.x0)} height={houseBand} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
            ) : (
              <rect key={`h${i}`} x={x - (e.side === "left" ? 0 : houseBand)} y={y} width={houseBand} height={Math.abs(e.y1 - e.y0)} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
            );
          })
        : onHouse
          ? <rect x={minX} y={-houseBand} width={maxX - minX} height={houseBand} fill="url(#deckHatch)" stroke="var(--ink)" strokeWidth={lw} />
          : null}
      {onHouse ? (
        <text x={(minX + maxX) / 2} y={-houseBand / 2 + font * 0.35} fontSize={font} textAnchor="middle" className={s.planLabel}>
          HOUSE
        </text>
      ) : null}
      {/* The deck's levels — or, on the roof plan, just its outline. */}
      {outlineOnly ? <polygon points={shapeOutline(outlineOnly.design.shape).map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--muted-light)" strokeWidth={lw * 1.4} strokeDasharray={`${lw * 6} ${lw * 4}`} /> : null}
      {frame ? levels.map((l) => levelDrawing(l.frame, l.offsetXIn, l.offsetYIn, l.id === "lower", l.surface)) : null}
      {/* The stairs: the footprint and every tread line. */}
      {drawnStairs.map((st) => {
        const pts = st.footprint.map((p) => `${p.x},${p.y}`).join(" ");
        const treads = st.members.filter((m) => m.role === "tread" || m.role === "box-tread" || m.role === "landing-tread");
        return (
          <g key={`st${st.design.id}`} className={s.planStair}>
            <polygon points={pts} fill="var(--paper)" stroke="var(--ink)" strokeWidth={lw * 1.4} />
            {treads.map((m, i) => (
              <rect key={i} x={m.cx - m.sx / 2} y={m.cy - m.sy / 2} width={m.sx} height={m.sy} fill="none" stroke="var(--ink-soft)" strokeWidth={lw * 0.6} transform={m.yaw ? `rotate(${(m.yaw * 180) / Math.PI} ${m.cx} ${m.cy})` : undefined} />
            ))}
            {/* The way down (2026-11-14): one arrow along the stair's own line, through every landing and turn. */}
            {st.kind === "flight" && st.path.length > 1 ? (
              <polyline points={st.path.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke="var(--blueprint)" strokeWidth={lw} markerEnd="url(#arrow)" data-deck-plan-stair-path={st.landings.length} />
            ) : null}
            {st.landings.map((l) => (
              <text key={`ld${l.id}`} x={l.x} y={l.y + font * 0.3} fontSize={font * 0.62} textAnchor="middle" className={s.planNote} stroke="var(--paper)" strokeWidth={font * 0.22} paintOrder="stroke" data-deck-plan-landing={l.id}>
                {`landing ${ftIn(Math.round(l.heightIn))} up`}
              </text>
            ))}
            <text x={st.landings.length ? (st.path[0].x + st.path[1].x) / 2 : st.footprint.reduce((a, p) => a + p.x, 0) / st.footprint.length} y={(st.landings.length ? (st.path[0].y + st.path[1].y) / 2 : st.footprint.reduce((a, p) => a + p.y, 0) / st.footprint.length) + font * 0.35} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
              {st.kind === "box" ? `box steps · ${st.risers} risers` : `${st.widthIn / 12} ft stair · ${st.risers} risers${st.landings.length ? ` · ${st.landings.length} ${st.landings.length === 1 ? "landing" : "landings"}` : ""}`}
            </text>
          </g>
        );
      })}
      {/* The rail: a line just inside the edge, a square at every post. */}
      {structure.rails.on && show !== "roof" ? (
        <g className={s.planRail}>
          {structure.rails.segments.map((sg, i) => (
            <line key={i} x1={sg.x0} y1={sg.y0} x2={sg.x1} y2={sg.y1} stroke="var(--ink)" strokeWidth={lw * 2.6} strokeLinecap="butt" opacity={0.75} />
          ))}
          {structure.rails.members.filter((m) => m.role === "rail-post").map((m, i) => (
            <rect key={i} x={m.cx - 2} y={m.cy - 2} width={4} height={4} fill="#fff" stroke="var(--ink)" strokeWidth={lw} />
          ))}
        </g>
      ) : null}
      {/* The roof: eave line dashed, rafters, hips and ridge in blue, headers heavy, posts solid. */}
      {roof ? (
        <g className={s.planRoof}>
          {roof.slab ? <rect x={Math.min(...roof.ring.map((p) => p.x)) - 12} y={Math.min(...roof.ring.map((p) => p.y)) - 12} width={Math.max(...roof.ring.map((p) => p.x)) - Math.min(...roof.ring.map((p) => p.x)) + 24} height={Math.max(...roof.ring.map((p) => p.y)) - Math.min(...roof.ring.map((p) => p.y)) + 24} fill="var(--paper)" stroke="var(--muted)" strokeWidth={lw} /> : null}
          <polygon points={roof.eaveRing.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--blueprint)" strokeWidth={lw * 1.2} strokeDasharray={`${lw * 5} ${lw * 3}`} />
          {roofMembers(["truss"]).filter((m) => m.of === "truss-tc").map((m, i) => (
            <line key={`tr${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} stroke="var(--blueprint)" strokeWidth={lw * 0.9} opacity={0.9} />
          ))}
          {roofMembers(["rafter", "jack", "fly", "purlin", "slat", "tie"]).map((m, i) => (
            <line key={`rf${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} stroke="var(--blueprint)" strokeWidth={m.role === "slat" ? lw * 0.4 : lw * 0.7} opacity={m.role === "slat" || m.role === "purlin" ? 0.5 : 0.85} />
          ))}
          {roofMembers(["hip", "ridge", "ring"]).map((m, i) => (
            <line key={`hr${i}`} x1={m.x0} y1={m.y0} x2={m.x1} y2={m.y1} stroke="var(--blueprint-dark)" strokeWidth={lw * 1.8} />
          ))}
          {roof.headers.map((h) => (
            <line key={h.id} x1={h.x0} y1={h.y0} x2={h.x1} y2={h.y1} stroke="var(--ink)" strokeWidth={lw * 2.4} />
          ))}
          {roof.walls?.segments.map((w, i) => (
            <line key={`w${i}`} x1={w.x0} y1={w.y0} x2={w.x1} y2={w.y1} stroke="var(--blueprint-dark)" strokeWidth={lw * 3.5} opacity={0.5} />
          ))}
          {roof.ledger ? <rect x={Math.min(...roof.members.filter((m) => m.role === "roof-ledger").map((m) => m.x0))} y={0} width={roof.ledger.lengthIn} height={1.5} fill="var(--ink)" /> : null}
          {/* OPENINGS FRAMED BY HAND (2026-11-13): the gap between its two posts, its clear width, its door's swing. */}
          {roof.openings.map((o) => {
            const L = Math.hypot(o.x1 - o.x0, o.y1 - o.y0) || 1;
            const ux = (o.x1 - o.x0) / L;
            const uy = (o.y1 - o.y0) / L;
            const mx = (o.x0 + o.x1) / 2;
            const my = (o.y0 + o.y1) / 2;
            // Out of the roof: away from its middle.
            const out = (mx - roof.centreX) * -uy + (my - roof.centreY) * ux >= 0 ? 1 : -1;
            const nx = -uy * out;
            const ny = ux * out;
            const leaf = o.leaves ? L / o.leaves : 0;
            const tick = font * 0.7;
            return (
              <g key={`op${o.id}`} data-deck-plan-opening={o.id}>
                <line x1={o.x0} y1={o.y0} x2={o.x1} y2={o.y1} stroke="#fff" strokeWidth={lw * 4.2} />
                <line x1={o.x0} y1={o.y0} x2={o.x1} y2={o.y1} stroke="var(--ink)" strokeWidth={lw * 0.9} strokeDasharray={`${lw * 3} ${lw * 2.5}`} />
                {[[o.x0, o.y0], [o.x1, o.y1]].map(([x, y], i) => (
                  <line key={i} x1={x - nx * tick} y1={y - ny * tick} x2={x + nx * tick} y2={y + ny * tick} stroke="var(--blueprint-dark)" strokeWidth={lw * 1.2} />
                ))}
                {Array.from({ length: o.leaves }, (_, i) => {
                  // Each leaf hung on its own jamb: the first on the opening's start, the second on its end; drawn half open,
                  // swung out 45° (a full quarter swing ran out through the plan's dimensions).
                  const hx = i === 0 ? o.x0 : o.x1;
                  const hy = i === 0 ? o.y0 : o.y1;
                  const dir = i === 0 ? 1 : -1;
                  const ex = hx + ux * leaf * dir;
                  const ey = hy + uy * leaf * dir;
                  const sx = hx + (ux * dir + nx) * leaf * Math.SQRT1_2;
                  const sy = hy + (uy * dir + ny) * leaf * Math.SQRT1_2;
                  return <path key={`lf${i}`} d={`M${hx},${hy} L${sx},${sy} A${leaf},${leaf} 0 0 ${(ux * ny - uy * nx) * dir > 0 ? 0 : 1} ${ex},${ey}`} fill="none" stroke="var(--blueprint-dark)" strokeWidth={lw * 0.8} />;
                })}
                <text x={mx - nx * font * 1.5} y={my - ny * font * 1.5 + font * 0.3} fontSize={font * 0.72} textAnchor="middle" className={s.planNote}>
                  {`${ftIn(Math.round(o.widthIn))} opening${o.leaves === 2 ? " · pair of doors" : o.leaves === 1 ? " · door" : ""}`}
                </text>
              </g>
            );
          })}
          {roof.posts.map((p) => {
            const w = p.size === "8x8" ? 7.5 : p.size === "6x6" ? 5.5 : 3.5;
            // A post set by hand wears a ring, so the builder's own posts read apart from the ones the spans set.
            return (
              <g key={p.id}>
                <rect x={p.x - w / 2} y={p.y - w / 2} width={w} height={w} fill="var(--blueprint-dark)" stroke="#fff" strokeWidth={lw * 0.6} />
                {p.by ? <circle cx={p.x} cy={p.y} r={w * 0.95} fill="none" stroke="var(--blueprint)" strokeWidth={lw * 1.1} data-deck-plan-post-by={p.by.kind} /> : null}
              </g>
            );
          })}
          {roof.posts.filter((p) => p.footing).map((p) => (
            <circle key={`rf${p.id}`} cx={p.x} cy={p.y} r={(p.footing?.padIn ?? 12) / 2} fill="none" stroke="var(--muted)" strokeWidth={lw} strokeDasharray={`${lw * 3} ${lw * 2}`} />
          ))}
          <text x={roof.centreX} y={roof.centreY + font * (show === "roof" ? -0.6 : 0.35)} fontSize={font * (show === "roof" ? 0.8 : 0.95)} textAnchor="middle" className={s.planNote}>
            {roofNote}
          </text>
          {show === "roof" ? (
            <text x={roof.centreX} y={roof.centreY + font * 0.5} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
              {`${roof.kind} ${roof.roof.pitch}:12 · ${ftIn(roof.roof.overhangIn)} overhang`}
            </text>
          ) : null}
          {show === "roof" && roof.trusses ? (
            <text x={roof.centreX} y={roof.centreY + font * 1.6} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
              {`${roof.trusses.count} trusses · ${roof.trusses.chord} chords · no ridge beam`}
            </text>
          ) : null}
          {show === "roof" && roof.ridge ? (
            <text x={roof.centreX} y={roof.centreY + font * 1.6} fontSize={font * 0.8} textAnchor="middle" className={s.planNote}>
              {`${roof.ridge.kind === "beam" ? `${roof.ridge.spec?.size ?? roof.ridge.nominal} ridge beam` : `${roof.ridge.nominal} ridge board`} · ${ftIn(roof.ridge.lengthIn)}`}
            </text>
          ) : null}
          {roof.headers[0] ? (
            // Below everything drawn, above the width's dimension line — clear of the eave's dashed line it used to sit on.
            <text x={Math.min(...roof.eaveRing.map((p) => p.x)) + font * 0.2} y={maxY + font * 1.3} fontSize={font * 0.85} className={s.planNote}>
              {`${[...new Set(roof.headers.map((h) => h.spec.size))].join("/")} headers · ${roof.posts.length} posts`}
            </text>
          ) : null}
        </g>
      ) : null}
      {/* Fixtures: amber marks with a letter. */}
      {structure.electrical.on && show !== "roof" ? (
        <g className={s.planFixtures}>
          {structure.electrical.fixtures.map((fx) =>
            fx.kind === "led-strip" || fx.kind === "string-light" ? (
              <line key={fx.id} x1={fx.x - (Math.cos(fx.yaw) * fx.sx) / 2} y1={fx.y - (Math.sin(fx.yaw) * fx.sx) / 2} x2={fx.x + (Math.cos(fx.yaw) * fx.sx) / 2} y2={fx.y + (Math.sin(fx.yaw) * fx.sx) / 2} stroke="#d9a21b" strokeWidth={lw * 1.6} strokeDasharray={fx.kind === "string-light" ? `${lw * 2} ${lw * 2}` : undefined} />
            ) : (
              <g key={fx.id}>
                <circle cx={fx.x} cy={fx.y} r={font * 0.55} fill={fx.supply === "client" ? "#fff" : "#f1c45a"} stroke="#9a6d0a" strokeWidth={lw} strokeDasharray={fx.supply === "client" ? `${lw * 2} ${lw * 1.5}` : undefined} />
                <text x={fx.x} y={fx.y + font * 0.3} fontSize={font * 0.7} textAnchor="middle" fill="#5b4000" fontWeight={700}>
                  {FIXTURE_MARK[fx.kind] ?? "•"}
                </text>
              </g>
            ),
          )}
        </g>
      ) : null}
      {/* Dimensions. */}
      <g className={s.planDim}>
        <line x1={minX} y1={dimY} x2={maxX} y2={dimY} strokeWidth={lw} />
        <line x1={minX} y1={dimY - font * 0.6} x2={minX} y2={dimY + font * 0.6} strokeWidth={lw} />
        <line x1={maxX} y1={dimY - font * 0.6} x2={maxX} y2={dimY + font * 0.6} strokeWidth={lw} />
        <text x={(minX + maxX) / 2} y={dimY + font * 1.5} fontSize={font} textAnchor="middle">{ftIn(maxX - minX)}</text>
        <line x1={dimX} y1={minY} x2={dimX} y2={maxY} strokeWidth={lw} />
        <line x1={dimX - font * 0.6} y1={minY} x2={dimX + font * 0.6} y2={minY} strokeWidth={lw} />
        <line x1={dimX - font * 0.6} y1={maxY} x2={dimX + font * 0.6} y2={maxY} strokeWidth={lw} />
        <text x={dimX + font * 0.9} y={(minY + maxY) / 2} fontSize={font} transform={`rotate(90 ${dimX + font * 0.9} ${(minY + maxY) / 2})`} textAnchor="middle">{ftIn(maxY - minY)}</text>
      </g>
      {/* The floor plan's key: every post mark with its size and footing, grouped. */}
      {show === "floor" && frame
        ? (() => {
            const groups = new Map<string, string[]>();
            for (const l of levels) for (const p of l.frame.posts.filter((pp) => !pp.roof)) {
              const key = `${p.size} posts on ${p.footing.type === "poured" ? `${p.footing.padIn}-in. poured footings, ${p.footing.depthIn} in. deep` : `${p.footing.padIn}-in. pier blocks`}`;
              groups.set(key, [...(groups.get(key) ?? []), p.id]);
            }
            return [...groups.entries()].map(([key, ids], i) => (
              <text key={key} x={minX} y={maxY + font * (6 + i * 1.1)} fontSize={font * 0.75} className={s.planNote}>
                {`${ids.join(", ")}: ${key}`}
              </text>
            ));
          })()
        : null}
      {marks.map((m, i) => (
        <g key={`mark${i}`} data-plan-mark={m.label}>
          <circle cx={m.x} cy={m.y + font * 0.9} r={font * 0.42} fill="var(--blueprint)" stroke="var(--ink)" strokeWidth={lw} />
          <text x={m.x} y={m.y + font * 2.35} fontSize={font * 0.72} textAnchor="middle" className={s.planNote} fill="var(--blueprint)">{m.label}</text>
        </g>
      ))}
      {placing ? (
        <text x={(minX + maxX) / 2} y={minY - pad * 0.45 - (onHouse ? houseBand : 0)} fontSize={font * 1.1} textAnchor="middle" className={s.planNote}>
          Click an open edge to put the stairs there
        </text>
      ) : null}
      {liveGrips.length && !placing ? (
        <g data-deck-plan-grips={liveGrips.length}>
          <style>{`.dk-plan-grip{fill:var(--blueprint);fill-opacity:0;stroke:var(--blueprint);stroke-opacity:0;touch-action:none}.dk-plan-grip:hover,.dk-plan-grip[data-held]{fill-opacity:.16;stroke-opacity:.95}`}</style>
          {/* The beams first, the posts over them: where a post stands on its beam, the post is what the pointer takes. */}
          {[...liveGrips.filter((g) => g.kind === "beam"), ...liveGrips.filter((g) => g.kind !== "beam")].map((g, i) => {
            const beam = g.kind === "beam" ? frameIn?.beams.find((b) => b.id === g.part) : undefined;
            if (g.kind === "beam" && !beam) return null;
            const r = Math.max(5.5, font * 0.62);
            const box = beam ? { x: beam.x0, y: g.y - Math.max(3.2, font * 0.36), w: beam.x1 - beam.x0, h: 2 * Math.max(3.2, font * 0.36) } : { x: g.x - r, y: g.y - r, w: 2 * r, h: 2 * r };
            const on = held?.kind === g.kind && held.id === g.id;
            return (
              <rect key={`${g.kind}:${g.id}:${i}`} className="dk-plan-grip" x={box.x} y={box.y} width={box.w} height={box.h} rx={lw * 2} strokeWidth={lw * 1.4} style={{ cursor: g.axis === "x" ? "ew-resize" : "ns-resize" }} onPointerDown={(e) => gripDown(e, g)} onClick={(e) => e.stopPropagation()} data-deck-plan-grip={g.kind} data-deck-plan-grip-id={g.id} data-held={on ? "" : undefined}>
                <title>{`${g.label} — drag it, or click it to type its place`}</title>
              </rect>
            );
          })}
          {heldGrip ? (
            <text x={heldGrip.x} y={heldGrip.y - font * 1.1} fontSize={font * 0.95} textAnchor="middle" className={s.planNote} stroke="var(--paper)" strokeWidth={font * 0.3} paintOrder="stroke" pointerEvents="none" data-deck-plan-grip-read>
              {`${ftIn(Math.max(0, heldGrip.sign * (heldGrip.at - heldGrip.origin)))} ${heldGrip.from}`}
            </text>
          ) : null}
        </g>
      ) : null}
    </svg>
  );
}
