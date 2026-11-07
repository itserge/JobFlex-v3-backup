// A BUDGET FILE, READY TO READ — in the browser (2026-11-07, the Budget card's "Paste or upload"). A PDF's text layer
// comes out as lines, its columns tab-separated, the way a spreadsheet pastes (lib/projectBudgetImport reads tables
// that way); a PDF with no text (a scan) and a photo become JPEGs small enough to send — the model reads those
// (lib/projectBudgetRead). Excel and Word files go to the server as they are (lib/officeText).

import { drawPage } from "./plans/pdfDraw";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjs: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjs) {
    // The legacy build runs on older Safari; the worker is the plan reader's own module.
    pdfjs = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("./plans/pdf.worker.ts", import.meta.url), { type: "module" });
      return m;
    });
    pdfjs.catch(() => {
      pdfjs = null;
    });
  }
  return pdfjs;
}

/** A budget runs a few pages; past these it is not one. */
const MAX_TEXT_PAGES = 12;
const MAX_PICTURE_PAGES = 4;
/** The long side a page or a photo is sent at: a lender's small print stays legible. */
const PICTURE_PX = 2000;

type Item = { str: string; x: number; y: number; w: number; h: number };

/** One page's text items as lines: grouped by baseline, left to right, a wide gap read as a column break (a tab). */
function pageLines(items: Item[]): string[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Item[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    const tol = Math.max(2, (line?.[0]?.h ?? it.h) * 0.45);
    if (line && Math.abs(line[0].y - it.y) <= tol) line.push(it);
    else lines.push([it]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let out = "";
    let end = -Infinity;
    for (const it of line) {
      const gap = it.x - end;
      const em = Math.max(4, it.h || 10);
      if (out) out += gap > em * 1.6 ? "\t" : gap > em * 0.12 && !out.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
      out += it.str;
      end = it.x + it.w;
    }
    return out.replace(/[ ]+\t/g, "\t").replace(/\t[ ]+/g, "\t").trim();
  });
}

function canvasBlob(c: HTMLCanvasElement, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't make a picture of that page."))), "image/jpeg", quality));
}

/** A PDF's words (its columns tab-separated) — or, when it has none worth reading (a scan), its first pages as JPEGs. */
export async function pdfBudget(file: File): Promise<{ text: string; images: Blob[] }> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_TEXT_PAGES); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      const items: Item[] = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || it.height });
      }
      pages.push(pageLines(items).join("\n"));
    }
    const text = pages.join("\n\n").trim();
    // A page of real words has dozens of letters and a few numbers; a scan has none.
    if (text.replace(/[^a-zA-Z]/g, "").length >= 40 && /\d/.test(text)) return { text, images: [] };
    const images: Blob[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PICTURE_PAGES); i++) {
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: PICTURE_PX / Math.max(vp1.width, vp1.height) });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const g = c.getContext("2d")!;
      g.fillStyle = "#fff";
      g.fillRect(0, 0, c.width, c.height);
      await drawPage(page, g, vp);
      images.push(await canvasBlob(c));
      c.width = c.height = 0;
    }
    return { text: "", images };
  } finally {
    void doc.destroy();
  }
}

/** A photo or a screenshot as a JPEG at most PICTURE_PX on its long side. */
export async function photoJpeg(file: File): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(/heic|heif/i.test(file.type || file.name) ? "This browser can't open HEIC photos — take a screenshot of it, or save it as JPG." : "Couldn't open that picture.");
  }
  const k = Math.min(1, PICTURE_PX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * k));
  c.height = Math.max(1, Math.round(bmp.height * k));
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await canvasBlob(c);
  c.width = c.height = 0;
  return blob;
}

/** What a file is to the card: words it reads here, a file for the server, a PDF, a picture — or not a budget file. */
export function fileKind(file: File): "words" | "office" | "pdf" | "picture" | "other" {
  const name = file.name.toLowerCase();
  if (/\.(csv|tsv|txt|text|md)$/.test(name) || file.type.startsWith("text/")) return "words";
  if (/\.(xlsx|xlsm|docx|xls|doc|numbers|pages)$/.test(name)) return "office";
  if (/\.pdf$/.test(name) || file.type === "application/pdf") return "pdf";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif)$/.test(name)) return "picture";
  return "other";
}
