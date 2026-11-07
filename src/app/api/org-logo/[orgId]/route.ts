import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logoVersion } from "@/lib/orgLogo";
import { decodeLogo } from "@/lib/orgLogoServer";

export const runtime = "nodejs";

// The shop's logo as an EMAIL shows it (2026-11-05, lib/orgLogo emailLogoSrc). Mails used to carry the stored data
// URL itself — up to 1 MB — and Gmail clips any mail over 102 KB, so a new-lead mail opened as an empty grid and
// "[Message clipped]", and Gmail draws no data-URL picture anyway. Now the mail links here: a small PNG (mail
// clients draw PNG; many draw no SVG or WebP), 144 px at most, for the 38–46 px mark. The logo is the one the shop's
// clients already see on every proposal, so the company id is enough to ask for it.
const SIDE = 144;

export async function GET(req: Request, ctx: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await ctx.params;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { logoUrl: true, deletedAt: true } }).catch(() => null);
  if (!org || org.deletedAt || !org.logoUrl) return new NextResponse(null, { status: 404 });

  const logo = decodeLogo(org.logoUrl);
  if (!logo) return new NextResponse(null, { status: 404 });
  if (logo.kind === "remote") return NextResponse.redirect(logo.url, 302);

  let png: Buffer | null = null;
  try {
    const { default: sharp } = await import("sharp");
    png = await sharp(logo.bytes, { density: 192 }).resize({ width: SIDE, height: SIDE, fit: "inside", withoutEnlargement: logo.mime !== "image/svg+xml" }).png().toBuffer();
  } catch {
    png = null;
  }
  // A picture sharp can't read: the stored PNG or JPEG as it is; anything else is no logo (the mail has its name).
  const body = png ?? (logo.mime === "image/png" || logo.mime === "image/jpeg" || logo.mime === "image/jpg" ? logo.bytes : null);
  if (!body) return new NextResponse(null, { status: 404 });

  // While ?v= matches the stored logo the bytes can't change; a new logo is a new fingerprint and a new URL.
  const asked = new URL(req.url).searchParams.get("v");
  const current = asked !== null && asked === logoVersion(org.logoUrl.trim());
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": png ? "image/png" : logo.mime === "image/jpg" ? "image/jpeg" : logo.mime,
      "Content-Length": String(body.length),
      "Cache-Control": current ? "public, max-age=31536000, immutable" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
