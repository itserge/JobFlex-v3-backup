// THE TUTORIALS' LINKS (2026-11-11) — server only. The films live in the PRIVATE Blob store (lib/media/privateStore,
// the store the crew's files use), so the page hands each signed-in viewer a signed link per file: it opens that one
// file (a read, nothing else) for 3 to 8 hours. A link that runs out under a long-open tab is replaced by the page
// (components/v3/tutorials: a refresh, then the film carries on where it was).
//
// The signing material is asked of the store once per file per 5 hours on a server, and reused; one tutorial's
// material can open no other file. A test copy without the store sets TUTORIALS_LOCAL_BASE to a folder serving the
// same files under the same names.

import "server-only";
import { privateToken } from "@/lib/media/privateStore";
import { TUTORIALS, tutorialFile, type TutorialLinks } from "./catalog";

const HOUR = 3_600_000;
type Delegation = { token: { delegationToken: string; clientSigningToken: string }; validUntil: number };
const issued = new Map<string, Delegation>();

async function delegationFor(token: string, pathname: string, now: number): Promise<Delegation> {
  const kept = issued.get(pathname);
  if (kept && kept.validUntil - now > 3 * HOUR) return kept;
  const { issueSignedToken } = await import("@vercel/blob");
  const t = await issueSignedToken({ token, pathname, operations: ["get", "head"], validUntil: now + 8 * HOUR });
  const d = { token: { delegationToken: t.delegationToken, clientSigningToken: t.clientSigningToken }, validUntil: t.validUntil };
  issued.set(pathname, d);
  return d;
}

/** Every tutorial's film and title frame, or null when this server has no way to hand them out. */
export async function tutorialLinks(): Promise<TutorialLinks | null> {
  const local = process.env.TUTORIALS_LOCAL_BASE?.replace(/\/+$/, "");
  if (local) return Object.fromEntries(TUTORIALS.map((t) => [t.slug, { video: `${local}/${tutorialFile(t, "mp4")}`, poster: `${local}/${tutorialFile(t, "jpg")}` }]));
  const token = privateToken();
  if (!token) return null;
  const now = Date.now();
  const { presignUrl } = await import("@vercel/blob");
  const sign = async (pathname: string) => {
    const d = await delegationFor(token, pathname, now);
    return (await presignUrl(d.token, { operation: "get", pathname, access: "private", validUntil: d.validUntil })).presignedUrl;
  };
  const rows = await Promise.all(TUTORIALS.map(async (t) => [t.slug, { video: await sign(tutorialFile(t, "mp4")), poster: await sign(tutorialFile(t, "jpg")) }] as const));
  return Object.fromEntries(rows);
}
