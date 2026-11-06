"use client";
// THE DIAL (2026-11-05, batch 4, Rev 2): the one round thing on the sheet — a ring of bars around the talk button.
// Red and lively while it is held, mint and lively while it listens live (2026-11-06), a white sweep while it
// works, a yellow pulse when it needs the person's yes, green once it is done, a faint breath at rest. Drawn on a canvas every frame (none under reduced motion).
// It is decoration for the state, not a level meter: the browser's recogniser gives no sound level.

import { useEffect, useRef } from "react";

export type DialMode = "idle" | "listen" | "live" | "work" | "need" | "done";

const COL: Record<DialMode, string> = { idle: "#ffffff", listen: "#ff6257", live: "#80e4a9", work: "#ffffff", need: "#ffd44f", done: "#80e4a9" };

export function Dial({ mode, size = 112 }: { mode: DialMode; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size * dpr;
    cv.height = size * dpr;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const N = 56;
    const c = size / 2;
    const R0 = size * 0.357;
    let raf = 0;
    const draw = (t: number) => {
      const m = modeRef.current;
      cx.clearRect(0, 0, size, size);
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        let len: number;
        let alpha: number;
        if (m === "listen" || m === "live") {
          const n = still ? Math.abs(Math.sin(i * 1.3)) : Math.abs(Math.sin(i * 2.1 + t * 0.011)) * Math.abs(Math.cos(i * 0.7 - t * 0.007));
          len = 4 + 13 * n;
          alpha = 0.95;
        } else if (m === "work") {
          let d = a + Math.PI / 2 - (still ? 0 : (t * 0.0028) % (Math.PI * 2));
          d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          const k = Math.max(0, 1 - d / 1.7);
          len = 4 + 11 * k;
          alpha = 0.22 + 0.75 * k;
        } else if (m === "need") {
          const p = still ? 1 : 0.5 + 0.5 * Math.sin(t * 0.004);
          len = 5 + 7 * p;
          alpha = 0.55 + 0.45 * p;
        } else if (m === "done") {
          len = 9;
          alpha = 0.9;
        } else {
          const p = still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 0.0016 + i * 0.05);
          len = 3 + 3 * p;
          alpha = 0.28 + 0.25 * p;
        }
        cx.strokeStyle = COL[m];
        cx.globalAlpha = alpha;
        cx.lineWidth = 2;
        cx.lineCap = "round";
        cx.beginPath();
        cx.moveTo(c + Math.cos(a) * R0, c + Math.sin(a) * R0);
        cx.lineTo(c + Math.cos(a) * (R0 + len), c + Math.sin(a) * (R0 + len));
        cx.stroke();
      }
      cx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // Under reduced motion there is no loop: the ring is drawn once per mode, so the mode is a dependency on purpose.
  }, [size, mode]);

  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />;
}
