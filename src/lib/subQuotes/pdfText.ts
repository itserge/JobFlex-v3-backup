import "server-only";
// A PDF'S WORDS, ON THE SERVER (2026-11-08, the subcontractors plan, part 2): the text layer of an estimate, read in
// Node with pdf.js's legacy build (no worker, no canvas — words only; next.config lists pdfjs-dist as a server-external
// package so it loads from node_modules at run time). A scanned PDF has no words: the reader then sends the file
// itself to the vision model.

import { readIsSparse } from "./shared";

export type PdfText = { pages: number; text: string; sparse: boolean };

/** The words of up to `maxPages` pages, tidied; `sparse` when a page carries almost no letters (a scan). Throws on a
 *  file that is not a PDF. */
export async function pdfTextOf(bytes: Uint8Array, maxPages = 20): Promise<PdfText> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  try {
    let text = "";
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    const clean = text.replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
    return { pages: doc.numPages, text: clean, sparse: readIsSparse(clean, n) };
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
