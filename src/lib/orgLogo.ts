// The company logo on the pages a CLIENT opens (the proposal, its phone build).
//
// Organization.logoUrl is a data URL written by the Company page (lib/logoClient:
// PNG, JPG, WebP or SVG, held under 1 MB). Printing that string straight into
// an <img> would carry it inside the page several times over — the desktop
// tree, the handheld view model that rides to the client, the RSC payload — so
// a client page links to it instead: /api/public-quote/<publicId>/logo serves
// the bytes, and `?v=` is a fingerprint of the stored value, so a new logo is a
// new URL and an unchanged one stays in the browser's cache.
//
// Pure: no Node imports, safe to call from any server module (the decoding and
// the PDF conversion live in lib/orgLogoServer).

/** A stored value that can be drawn: a data:image URL or an http(s) URL. */
export function hasDrawableLogo(logoUrl: string | null | undefined): logoUrl is string {
  if (!logoUrl) return false;
  const v = logoUrl.trim();
  return /^data:image\/[a-z0-9.+-]+[;,]/i.test(v) || /^https?:\/\//i.test(v);
}

/** FNV-1a over the whole value, as 8 hex digits — changes whenever the logo does. */
export function logoVersion(logoUrl: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < logoUrl.length; i++) {
    h ^= logoUrl.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Where a client page loads the shop's logo for this proposal, or null when there is none. */
export function proposalLogoHref(publicId: string, logoUrl: string | null | undefined): string | null {
  if (!hasDrawableLogo(logoUrl)) return null;
  return `/api/public-quote/${encodeURIComponent(publicId)}/logo?v=${logoVersion(logoUrl.trim())}`;
}

/** The logo as an email may show it (2026-11-05): a link to /api/org-logo/<orgId> (a small PNG every mail client
 *  draws) for a stored data URL, an https value as it is, or null — never the data URL itself, which made Gmail
 *  clip every mail that carried it. `base` is the site the link points at (lib/siteUrl). */
export function emailLogoSrc(logoUrl: string | null | undefined, orgId: string | null | undefined, base: string): string | null {
  if (!hasDrawableLogo(logoUrl)) return null;
  const v = logoUrl.trim();
  if (/^https:\/\//i.test(v)) return v;
  if (!orgId || !/^data:/i.test(v)) return null;
  return `${base}/api/org-logo/${encodeURIComponent(orgId)}?v=${logoVersion(v)}`;
}
