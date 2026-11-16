"use client";

// ROOF TRACE · THE HAND-TRACING TOOL (2026-11-16) — the "Traced lines" view of the roof diagram card (the roof
// estimator's admin card and /admin/roof-lab). Owner, 2026-11-16: "imagine that you're an artist … you just draw the
// lines … the hips, valleys, edges", then "make this auto draw tool … for admin only". Part 1: an admin draws (or
// corrects) the roof's lines on the aerial photo and saves them; the roof report then draws these lines instead of
// the facet engine's. Part 2 will fill the drawing in automatically; it is corrected here the same way.
//
// Draw: click, click, click — each click adds a line from the last point, in the kind picked below the tools; a click
// near a point joins it, a click near a line splits that line there (a hip meeting a ridge). Double-click, Esc or a
// right-click ends the run. Move & select: drag a point (every line meeting there follows; dropped on another point
// it joins it), click a line to pick it (then a kind button retypes it, Delete removes it), drag the photo to pan.
// The wheel zooms in both. Undo steps back. Nothing is kept until Save.
//
// The SVG is in the photo's own metres (lib/roofFacets/server PictureWindow); the saved drawing is UTM metres
// (lib/roofTrace/trace), so it stays on the roof whatever window the photo is cut to.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { clearRoofTraceAction, getRoofTrace, saveRoofTraceAction } from "@/actions/adminRoofTrace";
import type { FacetEdgeType } from "@/lib/roofFacets/model";
import type { RoofLabDrawing } from "@/lib/roofFacets/server";
import { EMPTY_EDIT, addPoint, connect, deleteLine, editFromTrace, looseEnds, mergePoints, movePoint, nearestLine, nearestPoint, setType, splitLine, traceFromEdit, type EditPoint, type EditState } from "@/lib/roofTrace/edit";
import { TRACE_TYPES, traceFromEngine, type RoofTrace } from "@/lib/roofTrace/trace";
import { EDGE_COLOR, EDGE_DASH } from "./edge-style";
import r from "./roof-lab.module.css";

const ONE: Record<FacetEdgeType, string> = { EAVE: "Eave", RAKE: "Rake", RIDGE: "Ridge", HIP: "Hip", VALLEY: "Valley", STEP: "Step flashing", WALL: "Wall flashing", BREAK: "Pitch change" };
/** How near (screen pixels) a click must be to a point or a line to land on it. */
const SNAP_PX = 10;
const HISTORY = 100;

type Tool = "draw" | "move";
interface Box { x: number; y: number; w: number; h: number }
type Drag = { kind: "point"; i: number; moved: boolean } | { kind: "pan"; sx: number; sy: number; from: Box; moved: boolean };

const savedWords = (t: RoofTrace) => {
  const d = new Date(t.savedAt);
  const when = Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `Saved ${when}${t.savedBy ? ` by ${t.savedBy}` : ""}`;
};

export function RoofTraceEditor({ id, drawing }: { id: string; drawing: RoofLabDrawing }) {
  const win = drawing.window;
  const full: Box = useMemo(() => ({ x: 0, y: 0, w: win.widthM, h: win.heightM }), [win.widthM, win.heightM]);
  const [box, setBox] = useState<Box>(full);
  const [st, setSt] = useState<EditState>(EMPTY_EDIT);
  const [histLen, setHistLen] = useState(0);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [saved, setSaved] = useState<RoofTrace | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>("draw");
  const [kind, setKind] = useState<FacetEdgeType>("EAVE");
  const [sel, setSel] = useState<number | null>(null);
  const [chain, setChain] = useState<number | null>(null);
  const [hover, setHover] = useState<EditPoint | null>(null);
  const [busy, setBusy] = useState<null | "save" | "clear">(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<null | "engine" | "clear">(null);
  const [pxW, setPxW] = useState(800);

  const svgRef = useRef<SVGSVGElement>(null);
  // the drawing and the view as the handlers must read them (a handler can run before the next render)
  const stRef = useRef(st);
  const boxRef = useRef(box);
  useLayoutEffect(() => { stRef.current = st; }, [st]);
  useLayoutEffect(() => { boxRef.current = box; }, [box]);
  const hist = useRef<EditState[]>([]);
  const drag = useRef<Drag | null>(null);

  const photoUrl = drawing.photo ? `/api/admin/roof-lab/picture?id=${encodeURIComponent(id)}&kind=photo${drawing.photoFrom ? `&from=${drawing.photoFrom}` : ""}` : `/api/admin/roof-lab/picture?id=${encodeURIComponent(id)}&kind=relief`;

  useEffect(() => {
    let on = true;
    getRoofTrace(id)
      .then((res) => {
        if (!on) return;
        if (!res.ok) { setPhase("error"); setMsg({ ok: false, text: res.error }); return; }
        if (res.trace) { setSt(editFromTrace(res.trace, win)); setSaved(res.trace); }
        setPhase("ready");
      })
      .catch(() => { if (on) { setPhase("error"); setMsg({ ok: false, text: "The saved drawing could not be read just now. Open the roof again to retry." }); } });
    return () => { on = false; };
  }, [id, win]);

  // the SVG's width on screen, for turning "10 pixels" into metres at the present zoom
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPxW(el.clientWidth || 800));
    ro.observe(el);
    setPxW(el.clientWidth || 800);
    return () => ro.disconnect();
  }, [phase]);
  const mPerPx = box.w / Math.max(1, pxW);

  /** A change that Undo can take back. */
  const commit = useCallback((next: EditState) => {
    const cur = stRef.current;
    if (next === cur) return;
    hist.current = [...hist.current.slice(-(HISTORY - 1)), cur];
    setHistLen(hist.current.length);
    setSt(next);
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const prev = hist.current.pop();
    setHistLen(hist.current.length);
    if (!prev) return;
    setSt(prev);
    setDirty(true);
    setSel(null);
    setChain(null);
  }, []);

  const toM = (clientX: number, clientY: number): EditPoint | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const clampBox = useCallback((b: Box): Box => {
    const x = Math.min(Math.max(b.x, -b.w * 0.5), full.w - b.w * 0.5);
    const y = Math.min(Math.max(b.y, -b.h * 0.5), full.h - b.h * 0.5);
    return { ...b, x, y };
  }, [full]);

  const zoomAt = useCallback((p: EditPoint, f: number) => {
    setBox((v) => {
      const w = Math.min(full.w, Math.max(full.w / 14, v.w * f));
      const h = (w * full.h) / full.w;
      if (w >= full.w) return full;
      return clampBox({ x: p.x - (p.x - v.x) * (w / v.w), y: p.y - (p.y - v.y) * (h / v.h), w, h });
    });
  }, [full, clampBox]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toM(e.clientX, e.clientY);
      if (p) zoomAt(p, Math.exp(e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [phase, zoomAt]);

  const pickKind = (t: FacetEdgeType) => {
    setKind(t);
    if (sel !== null && stRef.current.lines[sel]) commit(setType(stRef.current, sel, t));
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (phase !== "ready") return;
    // the keys (1–8, Esc, Delete, Undo) work right after a click on the photo
    (e.currentTarget.closest("[data-roof-trace]") as HTMLElement | null)?.focus({ preventScroll: true });
    if (e.button === 2) { setChain(null); return; }
    const p = toM(e.clientX, e.clientY);
    if (!p) return;
    const rad = SNAP_PX * mPerPx;
    const cur = stRef.current;
    if (e.button === 1 || (tool === "draw" && e.shiftKey)) {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, from: boxRef.current, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "draw") {
      let next = cur;
      let k = nearestPoint(cur, p.x, p.y, rad);
      if (k < 0 && chain !== null && cur.pts[chain] && Math.hypot(cur.pts[chain].x - p.x, cur.pts[chain].y - p.y) <= rad) k = chain;
      if (k < 0) {
        const hit = nearestLine(cur, p.x, p.y, rad);
        [next, k] = hit ? splitLine(cur, hit.i, hit.at) : addPoint(cur, p);
      }
      if (chain !== null && chain !== k) next = connect(next, chain, k, kind);
      if (next !== cur) commit(next);
      setChain(k);
      setSel(null);
      return;
    }
    const k = nearestPoint(cur, p.x, p.y, rad);
    if (k >= 0) {
      hist.current = [...hist.current.slice(-(HISTORY - 1)), cur];
      setHistLen(hist.current.length);
      drag.current = { kind: "point", i: k, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const hit = nearestLine(cur, p.x, p.y, rad);
    if (hit) { setSel(hit.i); setKind(cur.lines[hit.i].type); return; }
    setSel(null);
    drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, from: boxRef.current, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toM(e.clientX, e.clientY);
    setHover(p);
    const d = drag.current;
    if (!d || !p) return;
    if (d.kind === "point") {
      d.moved = true;
      setSt((s) => movePoint(s, d.i, p));
      setDirty(true);
    } else {
      const scale = d.from.w / Math.max(1, pxW);
      const dx = (e.clientX - d.sx) * scale, dy = (e.clientY - d.sy) * scale;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) d.moved = true;
      setBox(clampBox({ ...d.from, x: d.from.x - dx, y: d.from.y - dy }));
    }
  };

  const onUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || d.kind !== "point") return;
    if (!d.moved) {
      hist.current.pop();
      setHistLen(hist.current.length);
      return;
    }
    // the last move's position, from the pointer itself (the state may be a frame behind)
    const p = toM(e.clientX, e.clientY);
    const cur = p ? movePoint(stRef.current, d.i, p) : stRef.current;
    const at = cur.pts[d.i];
    const onto = at ? nearestPoint(cur, at.x, at.y, SNAP_PX * mPerPx, d.i) : -1;
    setSt(onto >= 0 ? mergePoints(cur, d.i, onto) : cur);
  };

  const removeSelected = useCallback(() => {
    if (sel === null) return;
    commit(deleteLine(stRef.current, sel));
    setSel(null);
  }, [sel, commit]);

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (e.key === "Escape") { setChain(null); setSel(null); setConfirm(null); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && sel !== null) { e.preventDefault(); removeSelected(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= TRACE_TYPES.length && !e.metaKey && !e.ctrlKey && !e.altKey) pickKind(TRACE_TYPES[n - 1]);
  };

  const startFromEngine = () => {
    commit(editFromTrace(traceFromEngine(drawing.model), win));
    setConfirm(null);
    setSel(null);
    setChain(null);
    setMsg({ ok: true, text: "The automatic lines are in. Fix what is off, then Save." });
  };

  const save = async () => {
    setBusy("save");
    setMsg(null);
    const body = traceFromEdit(stRef.current, win, "hand");
    const res = await saveRoofTraceAction(id, body).catch(() => ({ ok: false as const, error: "The drawing could not be saved just now. Your lines are still here — try Save again." }));
    setBusy(null);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    setSaved(res.trace);
    setSt(editFromTrace(res.trace, win));
    hist.current = [];
    setHistLen(0);
    setDirty(false);
    setSel(null);
    setChain(null);
    setMsg({ ok: true, text: "Saved. The roof report draws these lines now." });
  };

  const removeSaved = async () => {
    setBusy("clear");
    setMsg(null);
    const res = await clearRoofTraceAction(id).catch(() => ({ ok: false as const, error: "The saved drawing could not be removed just now. Try again." }));
    setBusy(null);
    setConfirm(null);
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return; }
    setSaved(null);
    setDirty(stRef.current.lines.length > 0);
    setMsg({ ok: true, text: "Removed. The roof report draws the automatic lines again." });
  };

  const loose = looseEnds(st);
  const hp = SNAP_PX * mPerPx;
  const snapPoint = hover && phase === "ready" ? nearestPoint(st, hover.x, hover.y, hp) : -1;
  const snapLine = hover && phase === "ready" && snapPoint < 0 && tool === "draw" ? nearestLine(st, hover.x, hover.y, hp) : null;
  const usedPts = useMemo(() => {
    const u = new Set<number>();
    for (const l of st.lines) { u.add(l.a); u.add(l.b); }
    return [...u];
  }, [st]);
  const from = chain !== null ? st.pts[chain] : null;
  const to = hover ? (snapPoint >= 0 ? st.pts[snapPoint] : snapLine ? snapLine.at : hover) : null;

  const hint =
    tool === "draw"
      ? chain === null
        ? `Click where a ${ONE[kind].toLowerCase()} starts. Each next click draws a line to it; a click near a point joins it, near a line splits it. Double-click, Esc or right-click ends the run. Shift-drag or the wheel moves around.`
        : `Drawing ${ONE[kind].toLowerCase()} lines — click the next corner. Double-click, Esc or right-click to stop.`
      : sel !== null
        ? "Line picked: press a kind below to change it, or Delete to remove it. Drag any point to move it — dropped on another point, the two join."
        : "Drag a point to move it (every line meeting there follows; drop it on another point to join them). Click a line to pick it. Drag the photo to move around.";

  return (
    <div className={r.trace} tabIndex={0} onKeyDown={onKey} data-roof-trace aria-label="Hand-traced roof lines">
      <div className={r.tools}>
        <div className={r.seg} role="group" aria-label="Tool">
          <button type="button" className={tool === "draw" ? r.segOn : ""} aria-pressed={tool === "draw"} onClick={() => { setTool("draw"); setSel(null); }} data-roof-trace-tool="draw">
            Draw
          </button>
          <button type="button" className={tool === "move" ? r.segOn : ""} aria-pressed={tool === "move"} onClick={() => { setTool("move"); setChain(null); }} data-roof-trace-tool="move">
            Move &amp; select
          </button>
        </div>
        <div className={r.seg} role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoomAt({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, 1 / 1.6)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomAt({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, 1.6)} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => setBox(full)}>Fit</button>
        </div>
        <button type="button" className="btn btn-ghost btn--sm" onClick={undo} disabled={!histLen} data-roof-trace-undo>
          Undo
        </button>
        {/* always drawn (greyed until a line is picked), so nothing above the photo changes size and moves it under the pointer */}
        <button type="button" className="btn btn-ghost btn--sm" onClick={removeSelected} disabled={sel === null} data-roof-trace-delete>
          Delete line
        </button>
      </div>

      <div className={r.typeRow} role="group" aria-label={sel !== null ? "Kind of the picked line" : "Kind of line to draw"}>
        {TRACE_TYPES.map((t, i) => (
          <button key={t} type="button" className={`${r.typeBtn} ${kind === t ? r.typeOn : ""}`} aria-pressed={kind === t} onClick={() => pickKind(t)} data-roof-trace-kind={t}>
            <svg className={r.key} viewBox="0 0 30 6" aria-hidden="true">
              <line x1={1} y1={3} x2={29} y2={3} stroke={EDGE_COLOR[t]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[t]} />
            </svg>
            {ONE[t]}
            <span className={r.typeKey} aria-hidden="true">{i + 1}</span>
          </button>
        ))}
      </div>
      <div className={r.traceStage} style={{ aspectRatio: `${win.widthM} / ${win.heightM}` }} data-roof-trace-tool-on={tool}>
        <svg
          ref={svgRef}
          className={r.traceSvg}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={() => setChain(null)}
          onContextMenu={(e) => { e.preventDefault(); setChain(null); }}
          role="img"
          aria-label={`Aerial photo with ${st.lines.length} traced roof lines`}
        >
          <image href={photoUrl} x={0} y={0} width={win.widthM} height={win.heightM} preserveAspectRatio="none" />
          {st.lines.map((l, i) => {
            const a = st.pts[l.a], b = st.pts[l.b];
            return <line key={`u${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={sel === i ? "#ffd60a" : "#ffffff"} strokeOpacity={0.92} strokeWidth={sel === i ? 9 : 6} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" />;
          })}
          {st.lines.map((l, i) => {
            const a = st.pts[l.a], b = st.pts[l.b];
            return <line key={`l${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR[l.type]} strokeWidth={3.2} strokeLinecap="round" strokeDasharray={EDGE_DASH[l.type]} vectorEffect="non-scaling-stroke" pointerEvents="none" data-roof-trace-line={l.type} />;
          })}
          {from && to && tool === "draw" ? (
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={EDGE_COLOR[kind]} strokeWidth={2.4} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ) : null}
          {usedPts.map((k) => (
            <circle key={`p${k}`} cx={st.pts[k].x} cy={st.pts[k].y} r={(tool === "move" ? 4.5 : 3) * mPerPx} fill="#ffffff" stroke="#14121a" strokeWidth={1.2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}
          {from ? <circle cx={from.x} cy={from.y} r={5 * mPerPx} fill={EDGE_COLOR[kind]} stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
          {snapPoint >= 0 ? <circle cx={st.pts[snapPoint].x} cy={st.pts[snapPoint].y} r={7 * mPerPx} fill="none" stroke="#ffd60a" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
          {snapLine ? <circle cx={snapLine.at.x} cy={snapLine.at.y} r={5.5 * mPerPx} fill="none" stroke="#ffd60a" strokeWidth={2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
        </svg>
        {phase === "loading" ? <p className={r.traceOver} role="status">Opening the saved drawing…</p> : null}
      </div>

      {/* under the photo: as it changes length the photo stays put */}
      <p className={r.traceHint} data-roof-trace-hint>{hint}</p>

      <div className={r.traceFoot}>
        <span className={r.traceStatus} data-roof-trace-status>
          {st.lines.length} {st.lines.length === 1 ? "line" : "lines"}
          {loose ? ` · ${loose} loose ${loose === 1 ? "end" : "ends"}` : ""} · {dirty ? "Not saved yet" : saved ? savedWords(saved) : "Nothing saved — the report draws the automatic lines"}
        </span>
        <div className={r.traceActions}>
          {confirm === "engine" ? (
            <>
              <span className={r.caption}>Replace your lines with the automatic ones?</span>
              <button type="button" className="btn btn-ghost btn--sm" onClick={startFromEngine} data-roof-trace-engine-yes>Replace</button>
              <button type="button" className="btn btn-ghost btn--sm" onClick={() => setConfirm(null)}>Keep mine</button>
            </>
          ) : (
            <button type="button" className="btn btn-ghost btn--sm" onClick={() => (st.lines.length ? setConfirm("engine") : startFromEngine())} disabled={phase !== "ready" || !drawing.model.edges.length} data-roof-trace-engine>
              Start from the automatic lines
            </button>
          )}
          {saved ? (
            confirm === "clear" ? (
              <>
                <span className={r.caption}>Remove the saved drawing from the report?</span>
                <button type="button" className="btn btn-ghost btn--sm" onClick={removeSaved} disabled={busy !== null} data-roof-trace-clear-yes>{busy === "clear" ? "Removing…" : "Remove"}</button>
                <button type="button" className="btn btn-ghost btn--sm" onClick={() => setConfirm(null)}>Keep it</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn--sm" onClick={() => setConfirm("clear")} disabled={busy !== null} data-roof-trace-clear>
                Remove the saved drawing
              </button>
            )
          ) : null}
          <button type="button" className="btn btn-primary btn--sm" onClick={save} disabled={busy !== null || phase !== "ready" || !dirty || !st.lines.length} data-roof-trace-save>
            {busy === "save" ? "Saving…" : "Save lines"}
          </button>
        </div>
      </div>
      {msg ? (
        <p className={msg.ok ? r.traceOk : r.fail} role={msg.ok ? "status" : "alert"} data-roof-trace-msg>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
