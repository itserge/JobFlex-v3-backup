"use client";
// WHAT TO BUILD, SHOWN (2026-10-11, owner: "the selection of what to do is
// very cheap looking — make it interactive samples of what kind of a deck
// project you do"). The first step's four words are now four pictures the
// engine built (lib/deck/samples → lib/deck/iso): a deck with its rails and
// stairs, a covered deck under its gable, an octagon gazebo, a pergola on
// the house. Touching a card stands its picture up layer by layer — the
// footings, the posts, the frame, the boards, the rails, the roof — and
// choosing one is choosing the kind. Under the chosen kind sit samples to
// start from; one tap lays the sample over the contractor's own address,
// site, house and lumber, and the 3D on the right follows.
//
// Made real (2026-10-13, owner: "more realistic, detailed, modern, a little
// glassy — and interactive"): the pictures are lit and drawn in their
// materials (lib/deck/iso), and they turn — a mouse drags one round, a
// hovered card turns slowly on its own once it has stood up, the ↻ beside
// it turns it a third of the way for a thumb or a keyboard, and every
// picture eases back to its own angle when it is left. While a picture is
// moving it is drawn quicker (fewer parts, no grain) and settles into full
// detail when it stops.
//
// No WebGL here: each picture is a few thousand SVG faces, computed once
// per page for its resting angle and on the fly while it turns.

import * as React from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { KINDS, KIND_WORDS, kindSample, sampleDesign, samplesFor, type DeckSample } from "@/lib/deck/samples";
import { isoDrawing, isoMarkup, type IsoDrawing, type IsoMaterials } from "@/lib/deck/iso";
import { buildStructure } from "@/lib/deck/structure";
import { deckScene, type DeckScene } from "@/lib/deck/scene";
import { deckingProduct } from "@/lib/deck/catalog";
import type { DeckDesign, Structure } from "@/lib/deck/design";
import p from "./deck-kind-picker.module.css";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/** The angle every picture rests at. */
const REST_YAW = 34;
const DETAIL = { card: { full: 2400, quick: 1100 }, thumb: { full: 900, quick: 500 } } as const;

/* A TURNING PICTURE IS PAINTED, NOT REBUILT (2026-10-19, perf). A frame of the turn used to replace the SVG's
   thousands of paths, and the browser's styling and painting of them cost 120–170ms a frame — 2.7s of every 3s of a
   hovered card, whatever the frame rate or the number of parts. The faces are now painted onto a canvas laid over
   the picture (a few milliseconds for the same frame); the resting SVG underneath is never touched, and shows again,
   crisp and with its build-up, as soon as the picture is back at its angle. */
/* A moving picture is drawn at no more than this many device pixels per CSS pixel (2026-10-19, perf): the
   rasterizing of a frame grows with its pixels, and a picture in motion does not show the difference; the
   resting image is as sharp as the screen. */
const MOVING_DPR = 1.5;

/** The picture's box in device pixels at `scale` a CSS pixel — measured on the canvas's parent, since the canvas itself
 *  may be hidden at the time (0 × 0 would have made the raster one stretched pixel). */
function pixelBox(canvas: HTMLCanvasElement, scale: number) {
  const box = (canvas.parentElement ?? canvas).getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, scale);
  return { cw: Math.max(1, Math.round(box.width * dpr)), ch: Math.max(1, Math.round(box.height * dpr)) };
}

/** The canvas sized to its box at `scale` device pixels a CSS pixel; `k` and the offsets place `viewBox` in it, "meet". */
function fitCanvas(canvas: HTMLCanvasElement, viewBox: string, scale: number) {
  const { cw, ch } = pixelBox(canvas, scale);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);
  const k = Math.min(cw / vw, ch / vh);
  return { cw, ch, k, ox: (cw - vw * k) / 2 - vx * k, oy: (ch - vh * k) / 2 - vy * k };
}

/** A picture's image rasterized onto `bm`, "meet" like a turn's frame (2026-10-19: drawn to the whole box it was
 *  stretched to the card's shape, wider at rest than the same picture on hover). */
function rasterMeet(bm: HTMLCanvasElement, img: HTMLImageElement, viewBox: string) {
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
  const k = Math.min(bm.width / vw, bm.height / vh);
  bm.getContext("2d")?.drawImage(img, (bm.width - vw * k) / 2, (bm.height - vh * k) / 2, vw * k, vh * k);
}

function paintFrame(canvas: HTMLCanvasElement, d: IsoDrawing) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { cw, ch, k, ox, oy } = fitCanvas(canvas, d.viewBox, MOVING_DPR);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.setTransform(k, 0, 0, k, ox, oy);
  // A gradient or pattern fill is painted as its first colour; a filter is dropped. A gradient that only fades one
  // colour out (the ground's edge, black to nothing) is a mask, not a surface: painted flat it was a dark wedge, so
  // a face filled with one is left out.
  const flat = new Map<string, [string, number] | null>();
  for (const def of d.defs) {
    if (def.kind === "linear" || def.kind === "radial") {
      const fade = def.stops.length > 1 && def.stops.every((s) => s[1] === def.stops[0][1]) && def.stops[def.stops.length - 1][2] === 0;
      flat.set(def.id, fade ? null : [def.stops[0]?.[1] ?? "#888", def.stops[0]?.[2] ?? 1]);
    } else if (def.kind === "grain") flat.set(def.id, [def.lines[0]?.[2] ?? "#888", 0.5]);
  }
  const colour = (fill: string): [string, number] | null => {
    const m = /^url\(#([^)]+)\)/.exec(fill);
    if (!m) return [fill, 1];
    return flat.has(m[1]) ? flat.get(m[1])! : ["#888", 1];
  };
  ctx.lineJoin = "round";
  for (const f of d.faces) {
    const ca = colour(f.fill.split("|")[0]);
    if (!ca) continue;
    const [c, a] = ca;
    const path = new Path2D(f.d);
    // "none": lines only (a long member's own edges over its strips) — a canvas would keep the last colour and fill.
    if (f.fill !== "none") {
      ctx.globalAlpha = (f.opacity ?? 1) * a * (f.layer === "shadow" ? 0.34 : 1);
      ctx.fillStyle = c;
      ctx.fill(path);
    }
    if (f.stroke) {
      ctx.globalAlpha = f.strokeOpacity ?? 1;
      ctx.strokeStyle = f.stroke;
      ctx.lineWidth = 0.45 / k;
      ctx.stroke(path);
    }
  }
  ctx.globalAlpha = 1;
}

/** The scene a sample makes, built once per page. */
const scenes = new Map<string, { scene: DeckScene; materials: IsoMaterials }>();
function sceneFor(sample: DeckSample): { scene: DeckScene; materials: IsoMaterials } {
  let s = scenes.get(sample.id);
  if (!s) {
    const design: DeckDesign = sampleDesign(sample);
    const family = deckingProduct(design.decking.product).family;
    const decking: IsoMaterials["decking"] = family === "treated" || family === "softwood" ? "wood" : family === "hardwood" || family === "modified" ? "hardwood" : family;
    s = { scene: deckScene(buildStructure(design)), materials: { decking, roofing: design.roof.roofing, rail: design.rail.type } };
    scenes.set(sample.id, s);
  }
  return s;
}

/* THE PICTURE IS AN IMAGE (2026-10-19, perf). A live picture is thousands of SVG nodes, and four of them on the
   page made every scroll frame re-style and re-layerize them all; as an image the browser rasterizes it once and
   scrolls the bitmap. An image sees none of the page's stylesheets, so it carries the one rule it needs: the thin
   edges (without it every face was outlined at a full unit — "the 3D parts sticking out everywhere"). */
const PICTURE_STYLE = "<style>path{stroke-width:.45;stroke-linejoin:round;vector-effect:non-scaling-stroke}</style>";
function svgImage(viewBox: string, inner: string): string {
  // A width and height (the viewBox's) give the image an intrinsic size, which a canvas needs before it will draw it.
  const [, , w, h] = viewBox.split(/\s+/);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${w}" height="${h}">${PICTURE_STYLE}${inner}</svg>`)}`;
}

/** The resting picture, drawn once per sample and size: the whole as one image, and one image a build step. */
interface Resting { key: string; viewBox: string; still: string; steps: string[]; faces: number }
const resting = new Map<string, Resting>();
function restingFor(sample: DeckSample, detail: "card" | "thumb"): Resting {
  const key = `${sample.id}:${detail}`;
  let r = resting.get(key);
  if (!r) {
    const { scene, materials } = sceneFor(sample);
    const d = isoDrawing(scene, { maxSolids: DETAIL[detail].full, materials, yawDeg: REST_YAW });
    const prefix = `iso-${sample.id}-${detail}`;
    const index = new Map(d.ranks.map((rank, i) => [rank, i] as const));
    const steps = d.ranks.map((_, i) => svgImage(d.viewBox, isoMarkup({ ...d, faces: d.faces.filter((f) => index.get(f.rank) === i) }, { prefix, layerClass: "step" })));
    r = { key, viewBox: d.viewBox, still: svgImage(d.viewBox, isoMarkup(d, { prefix, layerClass: "step" })), steps, faces: d.faces.length };
    resting.set(key, r);
  }
  return r;
}

/* THE BUILD-UP IS BLITTED (2026-10-19, perf). It used to be the live SVG with a CSS animation a step — the browser
   re-rasterized the whole picture every frame for a second and a half (276ms, 146ms, 121ms tasks on one hover).
   Now each step is its own image, rasterized once onto a small bitmap the first frame it is due, and a frame of the
   build-up is a dozen bitmap blits with an alpha and a rise. The step images are decoded ahead, in idle time. */
const STEP_MS = 70;
const RISE_MS = 420;
const stepImages = new Map<string, HTMLImageElement[]>();
function stepImagesFor(rest: Resting): HTMLImageElement[] {
  let imgs = stepImages.get(rest.key);
  if (!imgs) {
    imgs = rest.steps.map((src) => {
      // (createElement, not `new Image()`: `Image` here is next/image's component.)
      const im = document.createElement("img");
      im.decoding = "async";
      im.src = src;
      return im;
    });
    stepImages.set(rest.key, imgs);
  }
  return imgs;
}
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/* A turning picture is redrawn at most this often (2026-10-19, perf): a frame is a few thousand paths computed and
   parsed, and at 60 a second four turning cards took the page under 20fps. 25 a second reads as smooth for a slow
   turn. And not while the page scrolls under the mouse: the picture holds its angle until the scroll settles. */
const DRAW_EVERY_MS = 40;
const SCROLL_QUIET_MS = 200;
let pageScrolledAt = 0;
let scrollWatched = false;
function watchPageScroll() {
  if (scrollWatched || typeof document === "undefined") return;
  scrollWatched = true;
  document.addEventListener("scroll", () => { pageScrolledAt = performance.now(); }, { capture: true, passive: true });
}
if (typeof document !== "undefined") watchPageScroll();
const pageStill = (now: number) => now - pageScrolledAt > SCROLL_QUIET_MS;

export type Turn = { turn: () => void };

/**
 * One picture. `play` > 0 stands it up step by step; a new value plays it
 * again. It turns: a mouse drag on it, `turnRef` (the ↻ beside it), and a
 * slow turn of its own while `spin` (the mouse resting on its card) — then
 * it eases back to its angle.
 *
 * WHAT IS IN THE DOM (2026-10-19, perf): one image, and a canvas over it. The image is the picture's source and its
 * first showing; once it has loaded it is rasterized once, in idle time, onto the canvas, and the canvas is what the
 * page scrolls — a bitmap. (An SVG image is replayed, all its thousands of paths, for every tile the scroll
 * uncovers; four of them made the scroll drag while the cards were in view.) A turn is painted on the same canvas
 * (paintFrame); the build-up is blitted on it from the step images (stepImagesFor). No live SVG, ever: the page's
 * style and layout never see the picture's parts.
 */
export function IsoFigure({ sample, detail, play = 0, spin = false, label, className, turnRef, staticPreview = false }: { sample: DeckSample; detail: "card" | "thumb"; play?: number; spin?: boolean; label: string; className?: string; turnRef?: React.MutableRefObject<Turn | null>; staticPreview?: boolean }) {
  const rest = restingFor(sample, detail);
  const stillRef = React.useRef<HTMLSpanElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const yaw = React.useRef(REST_YAW);
  const anim = React.useRef<number>(0);
  const settle = React.useRef<number>(0);
  const build = React.useRef<number>(0);
  const drag = React.useRef<{ x: number; yaw: number; moved: boolean } | null>(null);
  const buildEnds = React.useRef(0);
  // The resting picture rasterized, at the screen's own density; null until the image has loaded and idle time came.
  const stillBitmap = React.useRef<HTMLCanvasElement | null>(null);
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  /** What the canvas shows: nothing (the image shows), the resting raster, or a moving picture. */
  const onCanvas = React.useRef<"none" | "still" | "moving">("none");

  /** The picture at its angle: the raster on the canvas once there is one, the image itself until then. */
  const showStill = React.useCallback(() => {
    const canvas = canvasRef.current;
    const still = stillRef.current;
    if (!canvas) return;
    const img = still?.querySelector("img");
    let bm = stillBitmap.current;
    if (bm && img) {
      const { cw, ch } = fitCanvas(canvas, rest.viewBox, 2);
      if (bm.width !== cw || bm.height !== ch) {
        // The card has changed size (the window did): rasterized again at the new one.
        bm.width = cw;
        bm.height = ch;
        try {
          rasterMeet(bm, img, rest.viewBox);
        } catch {
          bm = null;
        }
      }
    }
    if (bm) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(bm, 0, 0);
        canvas.style.display = "block";
        onCanvas.current = "still";
        if (still) still.style.visibility = "hidden";
        return;
      }
    }
    canvas.style.display = "none";
    onCanvas.current = "none";
    if (still) still.style.visibility = "";
  }, [rest.viewBox]);
  // The raster, once the image has loaded and the box has a size, in idle time; the page is not held for it. Again
  // whenever the box changes size (the window; a folded section opening).
  React.useEffect(() => {
    const img = stillRef.current?.querySelector("img");
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!img || !canvas || !wrap) return;
    let idle = 0;
    const schedule = () => {
      (window.cancelIdleCallback ?? window.clearTimeout)(idle);
      idle = (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200)))(() => {
        if (!img.complete || !img.naturalWidth) return;
        const { cw, ch } = pixelBox(canvas, 2);
        if (cw < 2 || ch < 2) return; // not laid out yet: the observer calls again when it is
        const bm = stillBitmap.current ?? document.createElement("canvas");
        if (bm.width === cw && bm.height === ch && stillBitmap.current) return;
        bm.width = cw;
        bm.height = ch;
        try {
          rasterMeet(bm, img, rest.viewBox);
        } catch {
          return;
        }
        stillBitmap.current = bm;
        // Shown now unless something else is moving on the canvas.
        if (onCanvas.current !== "moving") showStill();
      });
    };
    if (img.complete && img.naturalWidth) schedule();
    else img.addEventListener("load", schedule, { once: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(wrap);
    return () => {
      img.removeEventListener("load", schedule);
      ro.disconnect();
      (window.cancelIdleCallback ?? window.clearTimeout)(idle);
      stillBitmap.current = null;
    };
  }, [rest, showStill]);

  /** The picture at `yawDeg`: at its angle the resting picture; turned, a painted frame. */
  const draw = React.useCallback(
    (yawDeg: number, quality: "full" | "quick") => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const atRest = Math.abs(yawDeg - REST_YAW) < 0.01 && quality === "full";
      if (atRest) {
        showStill();
        return;
      }
      const { scene, materials } = sceneFor(sample);
      const d = isoDrawing(scene, { maxSolids: DETAIL[detail][quality], materials, yawDeg, detail: quality });
      canvas.style.display = "block";
      onCanvas.current = "moving";
      paintFrame(canvas, d);
      if (stillRef.current) stillRef.current.style.visibility = "hidden";
    },
    [sample, detail, showStill],
  );
  const stopAll = React.useCallback(() => {
    cancelAnimationFrame(anim.current);
    cancelAnimationFrame(settle.current);
    cancelAnimationFrame(build.current);
  }, []);
  /** The picture turned to `to` over `ms`, then drawn in full. */
  const turnTo = React.useCallback(
    (to: number, ms: number) => {
      stopAll();
      const from = yaw.current;
      if (reducedMotion() || ms <= 0) {
        yaw.current = to;
        draw(to, "full");
        return;
      }
      const t0 = performance.now();
      let drawn = 0;
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        yaw.current = from + (to - from) * easeInOut(t);
        if (t < 1) {
          if (now - drawn >= DRAW_EVERY_MS) {
            drawn = now;
            draw(yaw.current, "quick");
          }
          settle.current = requestAnimationFrame(step);
        } else {
          yaw.current = to;
          draw(to, "full");
        }
      };
      settle.current = requestAnimationFrame(step);
    },
    [draw, stopAll],
  );
  // The step images decoded ahead, in idle time, so the first hover has them.
  React.useEffect(() => {
    if (staticPreview) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 300));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const h = idle(() => {
      for (const im of stepImagesFor(rest)) im.decode?.().catch(() => {});
    });
    return () => cancel(h);
  }, [rest, staticPreview]);
  // The build-up: the steps blitted onto the canvas one after the other, each fading in as it settles; then the
  // image again. Replayed whenever `play` changes.
  React.useEffect(() => {
    if (!play || staticPreview) return;
    stopAll();
    yaw.current = REST_YAW;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || reducedMotion()) {
      draw(REST_YAW, "full");
      return;
    }
    const imgs = stepImagesFor(rest);
    const bitmaps: (HTMLCanvasElement | null)[] = imgs.map(() => null);
    const t0 = performance.now();
    const total = (imgs.length - 1) * STEP_MS + RISE_MS;
    buildEnds.current = t0 + total;
    const frame = (now: number) => {
      const t = now - t0;
      const { cw, ch } = fitCanvas(canvas, rest.viewBox, MOVING_DPR);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      for (let i = 0; i < imgs.length; i++) {
        const since = t - i * STEP_MS;
        if (since < 0) break;
        let bm = bitmaps[i];
        if (!bm || bm.width !== cw || bm.height !== ch) {
          // Its first frame: the step rasterized once, onto its own bitmap (an image not yet decoded joins later).
          if (!imgs[i].complete) continue;
          bm = document.createElement("canvas");
          bm.width = cw;
          bm.height = ch;
          try {
            rasterMeet(bm, imgs[i], rest.viewBox);
          } catch {
            continue;
          }
          bitmaps[i] = bm;
        }
        const k = easeOut(Math.min(1, since / RISE_MS));
        ctx.globalAlpha = k;
        ctx.drawImage(bm, 0, -(1 - k) * 0.025 * ch);
      }
      ctx.globalAlpha = 1;
      canvas.style.display = "block";
      onCanvas.current = "moving";
      if (stillRef.current) stillRef.current.style.visibility = "hidden";
      if (t < total) build.current = requestAnimationFrame(frame);
      else draw(REST_YAW, "full");
    };
    build.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(build.current);
  }, [play, rest, staticPreview, draw, stopAll]);
  // The ↻: a third of a turn.
  React.useEffect(() => {
    if (!turnRef) return;
    turnRef.current = { turn: () => turnTo(yaw.current + 120, 650) };
    return () => {
      turnRef.current = null;
    };
  }, [turnRef, turnTo]);
  // The mouse rests on the card: once the picture has stood up it turns slowly; off the card it eases back.
  React.useEffect(() => {
    if (!spin || reducedMotion()) return;
    cancelAnimationFrame(anim.current);
    cancelAnimationFrame(settle.current);
    watchPageScroll();
    // Only once the build-up has stood every step up.
    const start = Math.max(performance.now() + 350, buildEnds.current);
    let last = start;
    const step = (now: number) => {
      if (now >= start && !drag.current) {
        if (!pageStill(now)) {
          // Paused for the scroll: the time does not pile up into a jump when it resumes.
          last = now;
        } else if (now - last >= DRAW_EVERY_MS) {
          yaw.current += ((now - Math.max(last, start)) / 1000) * 9;
          last = now;
          draw(yaw.current, "quick");
        }
      } else last = now;
      anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(anim.current);
      if (Math.abs(yaw.current - REST_YAW) > 0.01) turnTo(REST_YAW, 600);
    };
  }, [spin, play, draw, turnTo]);
  React.useEffect(() => stopAll, [stopAll]);

  /* ── a mouse drag turns it by hand (a touch scrolls the page, as it should) ── */
  const dragDrawn = React.useRef(0);
  const onDown = (e: React.PointerEvent<Element>) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    stopAll();
    drag.current = { x: e.clientX, yaw: yaw.current, moved: false };
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent<Element>) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    yaw.current = drag.current.yaw + dx * 0.6;
    // A mouse reports faster than the picture can be drawn: one frame per DRAW_EVERY_MS, the last angle wins on release.
    const now = performance.now();
    if (now - dragDrawn.current < DRAW_EVERY_MS) return;
    dragDrawn.current = now;
    draw(yaw.current, "quick");
  };
  const onUp = (e: React.PointerEvent<Element>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    (e.currentTarget as Element & { releasePointerCapture?: (id: number) => void }).releasePointerCapture?.(e.pointerId);
    draw(yaw.current, "full");
    // A drag is not a click on the card.
    if (d.moved) {
      const el = e.currentTarget;
      const swallow = (ev: Event) => { ev.stopPropagation(); ev.preventDefault(); };
      el.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => el.removeEventListener("click", swallow, { capture: true }), 0);
    }
  };
  const handlers = staticPreview ? {} : { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp };
  return (
    // The pointer's events on the wrapper: whichever of the two is showing, the drag is the same.
    <span ref={wrapRef} className={cx(p.svg, className)} data-iso-faces={rest.faces} {...handlers}>
      {/* The picture's image: its source, and its first showing until the raster is on the canvas. */}
      <span ref={stillRef} className={p.svg}>
        <Image src={rest.still} alt="" width={480} height={320} unoptimized loading="lazy" className={p.svg} draggable={false} />
      </span>
      {/* The picture as the page sees it: the raster at rest, the build-up and the turns as they play. */}
      <canvas ref={canvasRef} className={p.turnCanvas} role="img" aria-label={label} />
    </span>
  );
}

/** The ↻ beside a picture: a third of a turn, for a thumb or a keyboard. Outside the card's button, so it is its own. */
function TurnButton({ turnRef, small, what }: { turnRef: React.MutableRefObject<Turn | null>; small?: boolean; what: string }) {
  return (
    <button type="button" className={cx(p.turn, small && p.turnSmall)} aria-label={`Turn the picture of ${what}`} title="Turn it" onClick={(e) => { e.stopPropagation(); turnRef.current?.turn(); }} data-iso-turn>
      ↻
    </button>
  );
}

function KindCard({ structure: st, label, on, onPick, staticPreview }: { structure: Structure; label: string; on: boolean; onPick: () => void; staticPreview: boolean }) {
  const hero = kindSample(st);
  const turn = React.useRef<Turn | null>(null);
  const [play, setPlay] = React.useState(0);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.kindWrap} onPointerEnter={(e) => { if (!staticPreview && e.pointerType === "mouse" && pageStill(performance.now())) { setPlay((n) => n || 1); setSpin(true); } }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" role="radio" aria-checked={on} className={cx(p.kind, on && p.kindOn)} onClick={() => { onPick(); if (!staticPreview) setPlay((n) => n + 1); }} data-structure={st}>
        <span className={p.fig}>
          <IsoFigure sample={hero} detail="card" play={play} spin={spin} label={`${label}: ${hero.name}`} turnRef={turn} staticPreview={staticPreview} />
          {on ? <span className={p.tick} aria-hidden="true">✓</span> : null}
        </span>
        <span className={p.kindName}>{label}</span>
        <span className={p.kindBlurb}>{KIND_WORDS[st].blurb}</span>
        <span className={p.kindInc}>{KIND_WORDS[st].includes}</span>
      </button>
      {!staticPreview ? <TurnButton turnRef={turn} what={label} /> : null}
    </div>
  );
}

function SampleCard({ sample, inUse, onPick, staticPreview }: { sample: DeckSample; inUse: boolean; onPick: () => void; staticPreview: boolean }) {
  const turn = React.useRef<Turn | null>(null);
  const [spin, setSpin] = React.useState(false);
  return (
    <div className={p.sampleWrap} onPointerEnter={(e) => { if (!staticPreview && e.pointerType === "mouse" && pageStill(performance.now())) setSpin(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setSpin(false); }}>
      <button type="button" className={cx(p.sample, inUse && p.sampleOn)} aria-pressed={inUse} onClick={onPick} data-deck-sample={sample.id}>
        <span className={cx(p.fig, p.figSmall)}>
          <IsoFigure sample={sample} detail="thumb" spin={spin} label={sample.name} turnRef={turn} staticPreview={staticPreview} />
        </span>
        <span className={p.sampleName}>{sample.name}</span>
        <span className={p.sampleFacts}>{sample.facts}</span>
        <span className={p.sampleTag}>{inUse ? "In use ✓" : "Start from this →"}</span>
      </button>
      {!staticPreview ? <TurnButton turnRef={turn} small what={sample.name} /> : null}
    </div>
  );
}

export function DeckKindPicker({ structure, onPickKind, onPickSample, appliedSampleId, hint, staticPreview = false, foldSamples = false }: { structure: Structure; onPickKind: (s: Structure) => void; onPickSample: (s: DeckSample) => void; appliedSampleId: string | null; /** The line beside "Start from a sample" (the client's page says it its own way). */ hint?: string; staticPreview?: boolean; foldSamples?: boolean }) {
  const samples = samplesFor(structure);
  const [samplesOpen, setSamplesOpen] = React.useState(false);
  const choices = <div className={p.sampleRow}>{samples.map((sm) => <SampleCard key={sm.id} sample={sm} inUse={sm.id === appliedSampleId} onPick={() => onPickSample(sm)} staticPreview={staticPreview} />)}</div>;
  return (
    <div className={p.picker} data-deck-kinds>
      <div className={p.kinds} role="radiogroup" aria-label="What to build">
        {KINDS.map(({ structure: st, label }) => (
          <KindCard key={st} structure={st} label={label} on={st === structure} onPick={() => onPickKind(st)} staticPreview={staticPreview} />
        ))}
      </div>
      {foldSamples ? <details className={p.samples} data-deck-samples={structure} onToggle={(event) => setSamplesOpen(event.currentTarget.open)}><summary className={p.samplesLbl}>Starting layouts<ChevronDown size={16} aria-hidden="true" /></summary>{samplesOpen ? choices : null}</details> : <div className={p.samples} data-deck-samples={structure}>
        <div className={p.samplesHead}>
          <span className={p.samplesLbl}>Start from a sample</span>
          <span className={p.samplesHint}>{hint ?? "Your address, state, house and lumber stay as set — the sample brings the shape, height, rails, stairs and roof."}</span>
        </div>
        {choices}
      </div>}
    </div>
  );
}
