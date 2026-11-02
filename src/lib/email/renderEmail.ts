// The blueprint transactional email shell. Every JobFlex email renders through
// this one function from a typed EmailDoc — see doc.ts. Design tokens are
// inlined as literals because email clients don't resolve CSS custom
// properties; keep them in sync with globals.css by hand.
import { type BoxRow, type EmailDoc, type Lockup, TONE_COLOR } from "./doc";
import { fitAnchor, fitHeadline, fitOrgName } from "./fit";

const C = {
  canvas: "#ebe8e1",
  paper: "#f2f0eb",
  card: "#ffffff",
  hair: "#e2e2e2",
  ink: "#0a0a0a",
  inkSoft: "#2a2a2a",
  inkMuted: "#555555",
  inkFaint: "#888888",
  accent: "#1854a0",
} as const;

const SANS =
  "Inter,ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono','SF Mono',ui-monospace,Consolas,monospace";

const CARD_W = 560;
const PAD_D = 24;
const PAD_M = 16;

/**
 * Separator weight between two adjacent box rows (principle 10's three-rung
 * ladder). Inferred, never authored — this is what makes the ladder
 * mechanically true instead of something an author has to remember.
 *   hairline = peers · 1px ink = same sort, different group · 2px ink = kind change
 */
type Sep = "none" | "hair" | "ink1" | "ink2";

export function separatorFor(prev: BoxRow["type"] | null, next: BoxRow["type"]): Sep {
  if (prev === null) return "none";
  if (next === "cond") return "ink2"; // anything → condition
  if (next === "anchor") return "ink2"; // components → the anchor
  if (prev === "item" && next === "rate") return "ink1"; // items → tax
  return "hair"; // peers
}

function sepHtml(sep: Sep): string {
  if (sep === "none") return "";
  const h = sep === "ink2" ? 2 : 1;
  const bg = sep === "hair" ? C.hair : C.ink;
  return `<tr><td style="height:${h}px;line-height:${h}px;font-size:0;background:${bg};">&nbsp;</td></tr>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Only http(s), mailto and tel schemes render as live links; everything else
 * — javascript:, data:, vbscript:, and scheme spoofs hidden behind leading
 * whitespace, control characters, or mixed case — collapses to a dead "#".
 * Relative URLs (no scheme at all, e.g. /portal/q/abc) pass through
 * untouched. Deliberately avoids `new URL()`: it throws on relative input.
 */
function safeHref(url: string): string {
  // Browsers drop ASCII control characters (codes 0-31 and 127) from
  // anywhere in a URL before parsing its scheme, so a stray control
  // character hidden inside the word "javascript:" still reads as
  // "javascript:" to a mail client's renderer even though the raw string
  // never spells it that way. Stripped by char code below rather than a
  // regex escape range, so no literal control byte has to live in this
  // source file.
  let stripped = "";
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code > 31 && code !== 127) stripped += url[i];
  }
  const clean = stripped.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(clean)?.[1]?.toLowerCase();
  if (!scheme) return url; // no scheme → relative URL, leave as authored
  return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel"
    ? url
    : "#";
}

/**
 * The two-cell row every money and field line uses. Flexbox is unavailable in
 * Outlook desktop (Word engine), so: the label cell absorbs all variance and
 * wraps freely; the amount cell is width:1% + nowrap, which collapses it to
 * exactly its content and hands the remainder to the label. valign=top keeps
 * the amount level with the FIRST line of a wrapped name, which is what
 * preserves the scan down the right edge (principle 15).
 *
 * `valign` is "top" for every text-vs-text row. The condition row overrides it
 * to "middle": its right cell is a bordered chip roughly twice the label's
 * height, so top-alignment leaves the label visibly floating above the chip's
 * optical centre instead of sitting on the same line as it.
 */
function twoCol(
  left: string,
  right: string,
  padM: number,
  valign: "top" | "middle" = "top",
): string {
  return `<tr><td class="rowpad" style="padding:${padM}px ${PAD_M}px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="left" valign="${valign}">${left}</td>
    <td align="right" valign="${valign}" style="width:1%;white-space:nowrap;padding-left:16px;">${right}</td>
  </tr></table>
</td></tr>`;
}

function chip(text: string, tone: string): string {
  const filled = tone !== C.ink;
  return `<span style="display:inline-block;border:2px solid ${C.ink};border-radius:2px;background:${
    filled ? tone : "#ffffff"
  };color:${filled ? "#ffffff" : C.ink};font-family:${MONO};font-size:11.5px;letter-spacing:.10em;text-transform:uppercase;font-weight:700;padding:5px 8px;white-space:nowrap;">${esc(
    text,
  )}</span>`;
}

function rowHtml(row: BoxRow): string {
  switch (row.type) {
    case "item":
      return twoCol(
        `<div class="item" style="font-size:15.5px;font-weight:600;line-height:1.4;color:${C.ink};font-family:${SANS};">${esc(row.name)}</div>`,
        `<div class="item" style="font-size:15.5px;font-weight:700;font-variant-numeric:tabular-nums;color:${C.ink};font-family:${SANS};">${esc(row.amount)}</div>`,
        14,
      );
    case "field":
      return twoCol(
        `<div style="font-family:${MONO};font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:${C.inkMuted};font-weight:700;padding-top:2px;">${esc(row.label)}</div>`,
        `<div class="item" style="font-size:15.5px;font-weight:700;color:${C.ink};font-family:${SANS};">${esc(row.value)}</div>`,
        13,
      );
    case "rate":
      // The rate sits at LABEL size, not annotation size — "Tax 5%" is one
      // label in two faces, not a label with a footnote (principle 08).
      return twoCol(
        `<div class="item" style="font-size:15.5px;font-weight:500;color:${C.inkSoft};font-family:${SANS};">${esc(row.label)} <span style="font-family:${MONO};letter-spacing:.06em;font-weight:700;color:${C.ink};">${esc(row.rate)}</span></div>`,
        `<div class="item" style="font-size:15.5px;font-weight:600;font-variant-numeric:tabular-nums;color:${C.inkSoft};font-family:${SANS};">${esc(row.amount)}</div>`,
        14,
      );
    case "anchor": {
      const s = fitAnchor(row.value);
      return `<tr><td style="padding:16px ${PAD_M}px;background:${C.paper};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td align="left" valign="middle"><div class="anchorlbl" style="font-family:${MONO};font-size:14px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;color:${C.ink};">${esc(row.label)}</div></td>
    <td align="right" valign="middle" style="width:1%;white-space:nowrap;padding-left:16px;"><div class="anchorval" style="font-family:${SANS};font-size:${s.m}px;line-height:.88;font-weight:900;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:${C.ink};">${esc(row.value)}</div></td>
  </tr></table>
</td></tr>`;
    }
    case "choice": {
      const href = esc(safeHref(row.href));
      return twoCol(
        `<a href="${href}" class="item" style="font-size:15.5px;font-weight:800;line-height:1.4;color:${C.ink};font-family:${SANS};text-decoration:none;">${esc(row.label)}</a>`,
        `<a href="${href}" style="font-size:14px;font-weight:800;color:${C.accent};font-family:${SANS};text-decoration:underline;text-underline-offset:3px;">${esc(row.action)} &rarr;</a>`,
        14,
        "middle",
      );
    }
    case "cond":
      // The condition is the row the 2px rule points at, so its label reads at
      // the chip's own size rather than annotation size — sized just above the
      // chip's 11.5px so the pair balances, and centred against it.
      return twoCol(
        `<div class="condlbl" style="font-family:${MONO};font-size:12.5px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;color:${C.inkSoft};line-height:1.35;">${esc(row.label)}</div>`,
        chip(row.chip, TONE_COLOR[row.tone ?? "neutral"]),
        12,
        "middle",
      );
  }
}

function boxHtml(rows: BoxRow[]): string {
  const parts: string[] = [];
  let prev: BoxRow["type"] | null = null;
  for (const row of rows) {
    parts.push(sepHtml(separatorFor(prev, row.type)));
    parts.push(rowHtml(row));
    prev = row.type;
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${C.ink};border-radius:2px;border-collapse:separate;">${parts.join(
    "",
  )}</table>`;
}

function lockupHtml(lockup: Lockup): string {
  const name = lockup.kind === "org" ? lockup.name : "JobFlex";
  const s = fitOrgName(name);
  const logo = lockup.kind === "org" ? lockup.logoUrl : null;
  const markBg = lockup.kind === "platform" ? C.accent : C.ink;
  const mark = logo
    ? `<img src="${esc(logo)}" width="38" height="38" alt="" style="display:block;width:38px;height:38px;border-radius:2px;object-fit:cover;">`
    : `<div class="mark" style="width:38px;height:38px;border-radius:2px;background:${markBg};color:${C.paper};font-family:${SANS};font-size:19px;font-weight:800;text-align:center;line-height:38px;">${esc(
        (name.trim()[0] ?? "J").toUpperCase(),
      )}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td valign="middle" style="width:1%;">${mark}</td>
  <td valign="middle" class="orgname" style="padding-left:11px;font-family:${SANS};font-size:${s.m}px;font-weight:800;letter-spacing:-.015em;color:${C.ink};line-height:1.2;">${esc(name)}</td>
</tr></table>`;
}

/**
 * Turn a bare http(s) URL inside already-escaped text into a live link.
 * Must run AFTER esc() (so `&` inside the URL reads as the safe `&amp;`
 * entity, which browsers resolve fine in an href) and BEFORE the `\n` → `<br>`
 * pass (so the injected `<a>` tags survive instead of getting escaped).
 * Routes the href through safeHref() so a scheme other than http/https/
 * mailto/tel can never become a live link even if it somehow matches.
 */
function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, (url) => {
    const href = safeHref(url);
    if (href === "#") return url; // neutralised scheme — render as dead text, not a link
    return `<a href="${href}" style="color:${C.accent};text-decoration:underline;text-underline-offset:2px;">${url}</a>`;
  });
}

function paras(list: string[] | undefined): string {
  if (!list?.length) return "";
  return list
    .map((p) => {
      const text = linkify(esc(p)).replace(/\n/g, "<br>");
      return `<p class="body" style="margin:0 0 12px;font-family:${SANS};font-size:16px;line-height:1.6;color:${C.inkSoft};">${text}</p>`;
    })
    .join("");
}

function ctaHtml(cta: { label: string; href: string }): string {
  // bgcolor on the td covers clients that drop CSS backgrounds. 18px padding
  // keeps the target above 44px (principle 14).
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 0;">
  <tr><td align="center" bgcolor="${C.accent}" style="border:2px solid ${C.ink};border-radius:2px;box-shadow:3px 3px 0 ${C.ink};">
    <a href="${esc(safeHref(cta.href))}" target="_blank" style="display:block;padding:18px 16px;font-family:${SANS};font-size:15px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${esc(
      cta.label,
    )}</a>
  </td></tr>
</table>`;
}

/** Inbox-preview text: prose minus URLs, so a portal link never leaks into the snippet. */
function preheader(doc: EmailDoc): string {
  return (doc.prose ?? [])
    .join(" ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function plainText(doc: EmailDoc): string {
  const lines: string[] = [doc.headline, ""];
  for (const p of doc.prose ?? []) lines.push(p, "");
  for (const r of doc.box ?? []) {
    if (r.type === "item") lines.push(`${r.name}  ${r.amount}`);
    else if (r.type === "field") lines.push(`${r.label}: ${r.value}`);
    else if (r.type === "rate") lines.push(`${r.label} ${r.rate}  ${r.amount}`);
    else if (r.type === "anchor") lines.push(`${r.label.toUpperCase()}  ${r.value}`);
    else if (r.type === "choice") lines.push(`${r.label} — ${r.action}: ${r.href}`);
    else lines.push(`${r.label}: ${r.chip}`);
  }
  if (doc.box?.length) lines.push("");
  if (doc.cta) lines.push(`${doc.cta.label}: ${doc.cta.href}`, "");
  if (doc.link) lines.push(`${doc.link.label}: ${doc.link.href}`, "");
  for (const p of doc.after ?? []) lines.push(p, "");
  if (doc.fine) lines.push(doc.fine, "");
  lines.push(`— ${doc.footer.name}`);
  if (doc.footer.contact) lines.push(doc.footer.contact);
  return lines.join("\n");
}

export function renderEmail(doc: EmailDoc): { subject: string; html: string; text: string } {
  const h = fitHeadline(doc.headline);
  const kickerColor = doc.kicker?.tone ? TONE_COLOR[doc.kicker.tone] : C.accent;
  const anchorRow = doc.box?.find(
    (r): r is Extract<BoxRow, { type: "anchor" }> => r.type === "anchor",
  );
  const a = anchorRow ? fitAnchor(anchorRow.value) : null;
  const o = fitOrgName(doc.lockup.kind === "org" ? doc.lockup.name : "JobFlex");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(doc.subject)}</title>
<style>
/* Mobile-safe sizes are inlined; this only ever scales UP, so a client that
   strips the block falls back to the size guaranteed to fit (principle 18 of
   the fitting model). */
@media screen and (min-width:600px) {
  .h1 { font-size:${h.d}px !important; }
  .body { font-size:16px !important; }
  .item { font-size:17px !important; }
  .anchorlbl { font-size:16px !important; }
  .condlbl { font-size:13px !important; }
  ${a ? `.anchorval { font-size:${a.d}px !important; }` : ""}
  .orgname { font-size:${o.d}px !important; }
  .rowpad { padding-left:${PAD_D}px !important; padding-right:${PAD_D}px !important; }
  .pad { padding-left:${PAD_D}px !important; padding-right:${PAD_D}px !important; }
  .mark { width:46px !important; height:46px !important; line-height:46px !important; font-size:23px !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${C.canvas};font-family:${SANS};-webkit-font-smoothing: auto;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(
    preheader(doc),
  )}&#8203;&#847;&#847;&#847;&#847;&#847;&#847;&#847;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.canvas};">
<tr><td align="center" style="padding:28px 12px;">

<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.ink}" style="padding:0 4px 4px 0;"><![endif]-->
<table role="presentation" width="${CARD_W}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${CARD_W}px;background:${C.card};border:2px solid ${C.ink};border-radius:2px;box-shadow:4px 4px 0 rgba(10,10,10,.18);">

  <!-- header band: 26px graph-paper grid, flat paper fallback in Outlook -->
  <tr><td class="pad" style="padding:18px ${PAD_M}px;background-color:${C.paper};background-image:linear-gradient(rgba(10,10,10,.12) 1px,transparent 1px),linear-gradient(90deg,rgba(10,10,10,.12) 1px,transparent 1px);background-size:26px 26px;border-bottom:2px solid ${C.ink};">
    ${lockupHtml(doc.lockup)}
  </td></tr>

  <tr><td class="pad" style="padding:22px ${PAD_M}px 0;">
    ${
      doc.kicker
        ? `<div style="font-family:${MONO};font-size:11px;letter-spacing:.11em;text-transform:uppercase;font-weight:700;color:${kickerColor};">${esc(
            doc.kicker.text,
          )}</div>`
        : ""
    }
    <h1 class="h1" style="margin:${doc.kicker ? "9px" : "0"} 0 0;font-family:${SANS};font-size:${h.m}px;font-weight:900;line-height:1.02;letter-spacing:-.03em;text-transform:uppercase;color:${C.ink};">${esc(
      doc.headline,
    )}</h1>
    ${doc.prose?.length ? `<div style="margin-top:13px;">${paras(doc.prose)}</div>` : ""}
  </td></tr>

  ${doc.box?.length ? `<tr><td class="pad" style="padding:8px ${PAD_M}px 0;">${boxHtml(doc.box)}</td></tr>` : ""}

  ${doc.cta ? `<tr><td class="pad" style="padding:20px ${PAD_M}px 0;">${ctaHtml(doc.cta)}</td></tr>` : ""}
  ${
    doc.link
      ? `<tr><td class="pad" style="padding:16px ${PAD_M}px 0;"><a href="${esc(safeHref(doc.link.href))}" style="font-family:${SANS};font-size:16px;font-weight:700;color:${C.accent};text-decoration:none;">${esc(
          doc.link.label,
        )} &rarr;</a></td></tr>`
      : ""
  }

  ${doc.after?.length ? `<tr><td class="pad" style="padding:20px ${PAD_M}px 0;">${paras(doc.after)}</td></tr>` : ""}

  ${
    doc.fine
      ? `<tr><td class="pad" style="padding:18px ${PAD_M}px 0;"><div style="height:1px;background:${C.hair};"></div><div style="margin-top:11px;font-family:${MONO};font-size:11px;line-height:1.6;letter-spacing:.06em;color:${C.inkFaint};">${esc(
          doc.fine,
        )}</div></td></tr>`
      : ""
  }

  <tr><td class="pad" style="padding:22px ${PAD_M}px 0;"></td></tr>
  <tr><td class="pad" style="padding:15px ${PAD_M}px;background:${C.paper};border-top:2px solid ${C.ink};">
    <div style="font-family:${MONO};font-size:11px;letter-spacing:.10em;text-transform:uppercase;font-weight:700;color:${C.ink};">${esc(
      doc.footer.name,
    )}</div>
    ${
      doc.footer.contact || doc.footer.ref
        ? `<div style="margin-top:5px;font-family:${MONO};font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:${C.inkMuted};">${esc(
            [doc.footer.contact, doc.footer.ref].filter(Boolean).join(" · "),
          )}</div>`
        : ""
    }
    <div style="margin-top:9px;font-family:${MONO};font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:${C.inkFaint};">Sent with JobFlex</div>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->

</td></tr>
</table>
</body>
</html>`;

  return { subject: doc.subject, html, text: plainText(doc) };
}
