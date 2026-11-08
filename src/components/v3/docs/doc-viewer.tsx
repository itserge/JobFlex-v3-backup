"use client";
// THE DOCUMENT VIEWER (2026-11-08, the subcontractors plan, part 1): one overlay for every document in the app — a
// PDF drawn page by page by pdf.js (the legacy build, the same worker the plan reader uses, so an iPhone shows every
// page and nothing runs in the browser's PDF plugin), or a picture as it is. Page n of N, zoom, fit, full screen,
// Download (the signed link as an attachment), Print (the file in a new tab, the browser's own print), Original (the
// file itself), and an optional side panel the caller fills (part 2 puts "What the AI read" there). The panel is
// keyed by the document, so a new document starts with fresh state.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import s from "./doc-viewer.module.css";

export type ViewerDoc = {
  id: string;
  name: string;
  /** Same-origin URL that streams the bytes inline (the office's /api/subs/doc/<id>, the sub's /api/q/<token>/file/<id>). */
  href: string;
  contentType: string | null;
  /** The bytes as an attachment; null = no download button. */
  downloadHref: string | null;
  /** The words under the name: "V2 · Nov 8 · 2.4 MB". */
  meta?: string | null;
};

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("../../../lib/plans/pdf.worker.ts", import.meta.url), { type: "module" });
      return m;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

const isPdf = (d: ViewerDoc) => (d.contentType ?? "").toLowerCase() === "application/pdf" || /\.pdf$/i.test(d.name);

// false on the server and while hydrating, true once the client is up — createPortal needs a document, and no
// document is open before a click anyway (the pattern BlueprintSheet uses).
const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

export function DocViewer({ doc, onClose, side }: { doc: ViewerDoc | null; onClose: () => void; side?: ReactNode }) {
  const mounted = useSyncExternalStore(subscribeNever, onClient, onServer);
  if (!mounted || !doc) return null;
  // A <body> portal, like BlueprintSheet: drawn inside the shell's `.content` (z-index 1) and `.main` (isolation) a
  // fixed overlay is painted under the sticky topbar and the sidebar (both 30) whatever its own z-index — the Close
  // button could not be clicked. The shell's overlay layer (120) is not enough either: the directory opens a sub's
  // paper from inside a profile sheet (130), so the viewer stands one tier above the sheets (135, the stylesheet).
  // The tokens resolve from :root (globals.css), so nothing is lost at the body.
  return createPortal(<DocViewerPanel key={doc.id} doc={doc} onClose={onClose} side={side} />, document.body);
}

function DocViewerPanel({ doc, onClose, side }: { doc: ViewerDoc; onClose: () => void; side?: ReactNode }) {
  const pdf = isPdf(doc);
  const [zoom, setZoom] = useState(1);
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [state, setState] = useState<"loading" | "ready" | "error">(pdf ? "loading" : "ready");
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentProxy | null>(null);

  // Escape closes; the body scroll is locked while the viewer is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Caught in the capture phase and stopped there: a sheet under the viewer (the directory's profile) listens
      // for Escape too and would close along with it.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Draw every page at the current zoom.
  const render = useCallback(async () => {
    const pdfDoc = pdfRef.current;
    const host = pagesRef.current;
    const body = bodyRef.current;
    if (!pdfDoc || !host || !body) return;
    host.replaceChildren();
    const width = Math.max(240, body.clientWidth - 32) * zoom;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const p = await pdfDoc.getPage(n);
      const base = p.getViewport({ scale: 1 });
      const scale = width / base.width;
      const vp = p.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.className = s.page;
      canvas.width = Math.floor(vp.width * ratio);
      canvas.height = Math.floor(vp.height * ratio);
      canvas.style.width = `${Math.floor(vp.width)}px`;
      canvas.style.height = `${Math.floor(vp.height)}px`;
      canvas.setAttribute("data-doc-page", String(n));
      host.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.scale(ratio, ratio);
      await p.render({ canvasContext: ctx, viewport: vp }).promise;
    }
  }, [zoom]);

  // Load the PDF once; the state moves only from the fetch's own callbacks.
  useEffect(() => {
    if (!pdf) return;
    let dead = false;
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const res = await fetch(doc.href, { credentials: "same-origin" });
        if (!res.ok) throw new Error(res.status === 404 ? "The file was not found." : "The file could not be read.");
        const data = new Uint8Array(await res.arrayBuffer());
        const loaded = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        if (dead) return;
        pdfRef.current = loaded;
        setPages(loaded.numPages);
        setState("ready");
      } catch (err) {
        if (dead) return;
        setError(err instanceof Error ? err.message : "The file could not be read.");
        setState("error");
      }
    })();
    return () => {
      dead = true;
    };
  }, [doc.href, pdf]);

  useEffect(() => {
    if (pdf && state === "ready" && pdfRef.current) void render();
  }, [pdf, state, render]);

  // Which page is in view.
  function onScroll() {
    const body = bodyRef.current;
    const host = pagesRef.current;
    if (!body || !host) return;
    const top = body.scrollTop + body.clientHeight / 3;
    let current = 1;
    for (const el of Array.from(host.children) as HTMLElement[]) {
      if (el.offsetTop <= top) current = Number(el.getAttribute("data-doc-page") ?? current);
    }
    setPage(current);
  }

  function fullScreen() {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => null);
  }

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={doc.name} data-doc-viewer onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={s.frame} ref={frameRef}>
        <div className={s.bar}>
          <span className={s.name} title={doc.name} data-doc-viewer-name>
            {doc.name}
          </span>
          {doc.meta ? <span className={s.meta}>{doc.meta}</span> : null}
          {pdf && pages ? (
            <span className={s.meta} data-doc-viewer-pages>
              page {page} of {pages}
            </span>
          ) : null}
          <div className={s.acts}>
            <button type="button" className={s.btn} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} aria-label="Smaller" data-doc-zoom-out>
              −
            </button>
            <button type="button" className={s.btn} onClick={() => setZoom(1)} aria-label="Fit the width" data-doc-zoom-fit>
              Fit
            </button>
            <button type="button" className={s.btn} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} aria-label="Larger" data-doc-zoom-in>
              +
            </button>
            <button type="button" className={s.btn} onClick={fullScreen} data-doc-full>
              Full screen
            </button>
            {doc.downloadHref ? (
              <a className={s.btn} href={doc.downloadHref} data-doc-download>
                Download
              </a>
            ) : null}
            <a className={s.btn} href={doc.href} target="_blank" rel="noreferrer" data-doc-print>
              Print
            </a>
            <a className={s.btn} href={doc.href} target="_blank" rel="noreferrer" data-doc-original>
              Original
            </a>
            <button type="button" className={`${s.btn} ${s.btnDark}`} onClick={onClose} data-doc-close>
              Close
            </button>
          </div>
        </div>
        <div className={side ? s.split : undefined} style={{ minHeight: 0 }}>
          <div className={s.body} ref={bodyRef} onScroll={onScroll}>
            {state === "loading" ? <p className={s.state}>Opening {doc.name}…</p> : null}
            {state === "error" ? <p className={s.state}>{error}</p> : null}
            {pdf ? <div className={s.pages} ref={pagesRef} /> : null}
            {!pdf ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={s.picture} src={doc.href} alt={doc.name} style={{ width: `${Math.round(zoom * 100)}%` }} data-doc-picture />
            ) : null}
          </div>
          {side ? <div className={s.side}>{side}</div> : null}
        </div>
      </div>
    </div>
  );
}
