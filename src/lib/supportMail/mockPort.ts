import "server-only";
// SUPPORT MAIL · A BOX ON DISK, FOR LOCAL TESTS (2026-10-18). No IMAP server
// runs on a laptop here (no Docker for GreenMail), so a local check points the
// cron at a folder instead: every *.eml in SUPPORT_MAIL_MOCK_DIR is a letter in
// the inbox (its file order = its uid), and state.json beside them keeps what
// the cron did — which letters are read, which labels they carry. The same
// InboxPort as the Gmail one (lib/supportMail/imap); the decisions are
// lib/supportMail/core's either way. Never used on Vercel production.
import { promises as fs } from "node:fs";
import path from "node:path";
import PostalMime from "postal-mime";
import type { InboxLetter, InboxPort } from "./core";
import { PROCESSED_LABEL, UNMATCHED_LABEL, UNSUBSCRIBED_LABEL } from "./imap";

type State = { seen: Record<string, boolean>; labels: Record<string, string[]> };

async function readState(dir: string): Promise<State> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8")) as State;
  } catch {
    return { seen: {}, labels: {} };
  }
}

export function mockInboxDir(env: Record<string, string | undefined> = process.env): string | null {
  const dir = env.SUPPORT_MAIL_MOCK_DIR?.trim();
  return dir && env.VERCEL_ENV !== "production" ? dir : null;
}

export async function withMockInbox<T>(dir: string, run: (port: InboxPort) => Promise<T>): Promise<T> {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".eml")).sort();
  const state = await readState(dir);
  const save = () => fs.writeFile(path.join(dir, "state.json"), JSON.stringify(state, null, 1), "utf8");
  const raw = async (uid: number) => fs.readFile(path.join(dir, files[uid - 1]));
  const label = (uid: number, l: string) => {
    const k = String(uid);
    state.labels[k] = [...new Set([...(state.labels[k] ?? []), l])];
  };
  const port: InboxPort = {
    async unseen(limit) {
      const out: InboxLetter[] = [];
      for (let i = 0; i < files.length; i++) {
        const uid = i + 1;
        if (state.seen[String(uid)]) continue;
        const p = await PostalMime.parse(await raw(uid));
        const h: Record<string, string> = {};
        for (const x of p.headers ?? []) h[x.key.toLowerCase()] = h[x.key.toLowerCase()] ? `${h[x.key.toLowerCase()]}, ${x.value}` : x.value;
        const list = (a?: Array<{ address?: string }>) => (a ?? []).map((x) => x.address ?? "").filter(Boolean);
        out.push({
          uid,
          from: p.from?.address ? (p.from.name ? `${p.from.name} <${p.from.address}>` : p.from.address) : null,
          to: list(p.to),
          cc: list(p.cc),
          deliveredTo: [h["delivered-to"], h["x-original-to"]].filter((x): x is string => Boolean(x)),
          subject: p.subject ?? "",
          messageId: p.messageId ?? null,
          inReplyTo: p.inReplyTo ?? null,
          references: (p.references ?? "").split(/\s+/).filter(Boolean),
          headers: h,
          unmatchedBefore: (state.labels[String(uid)] ?? []).includes(UNMATCHED_LABEL),
        });
      }
      return out.slice(-limit);
    },
    async source(uid) {
      return raw(uid);
    },
    async done(uid) {
      state.seen[String(uid)] = true;
      label(uid, PROCESSED_LABEL);
      await save();
    },
    async unmatched(uid) {
      label(uid, UNMATCHED_LABEL);
      await save();
    },
    async stopped(uid) {
      state.seen[String(uid)] = true;
      label(uid, UNSUBSCRIBED_LABEL);
      await save();
    },
  };
  return run(port);
}
