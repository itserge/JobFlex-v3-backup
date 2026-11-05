// THE "JOBFLEX ASSISTANT" CONTACT CARD (2026-11-04) — the link in the "you're
// linked" text and in Settings → Assistant. A phone opens it as a contact to add:
// the name, the Assistant's number (texts and calls), the JobFlex logo and the
// page that explains it. Public: it holds nothing but JobFlex's own number.
import { NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/appUrl";
import { assistantNumber } from "@/lib/assistant/phone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let photo: string | null | undefined;

/** The app icon (180 px, app/apple-icon.png), as the card's photo; none when it can't be read. */
async function logo(base: string): Promise<string | null> {
  if (photo !== undefined) return photo;
  try {
    const res = await fetch(`${base}/apple-icon.png`, { cache: "force-cache" });
    photo = res.ok ? Buffer.from(await res.arrayBuffer()).toString("base64") : null;
  } catch {
    photo = null;
  }
  return photo;
}

/** vCard lines are folded at 75 characters (RFC 2425); a long photo line goes on, each piece starting with a space. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(` ${line.slice(i, i + 74)}`);
  return parts.join("\r\n");
}

export async function GET() {
  const number = await assistantNumber();
  if (!number) return NextResponse.json({ error: "The JobFlex AI Operator's number isn't set up yet." }, { status: 404 });
  const base = await appBaseUrl();
  const pic = await logo(base);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "N:AI Operator;JobFlex;;;",
    "FN:JobFlex AI Operator",
    "ORG:JobFlex",
    `TEL;TYPE=CELL,VOICE,TEXT:${number}`,
    `URL:${base}/assistant`,
    "NOTE:Text or call to run your JobFlex business. Every change is read back before it happens.",
    ...(pic ? [fold(`PHOTO;ENCODING=b;TYPE=PNG:${pic}`)] : []),
    "END:VCARD",
  ];
  return new NextResponse(lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": 'inline; filename="JobFlex AI Operator.vcf"',
      "Cache-Control": "public, max-age=3600",
    },
  });
}
