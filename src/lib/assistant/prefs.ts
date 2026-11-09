import "server-only";
// WHAT THE AI OPERATOR SENDS WITHOUT BEING ASKED (2026-11-05, batch 3): each
// person's own switches — the morning briefing and its time, the alert when a
// client opens a proposal, the alert when a new lead comes in. Off until they
// turn them on in Settings → AI Operator. Since 2026-11-06 also the language they
// speak to it in (English unless they pick another). Kept as JSON in SyncState under the
// person, like the PIN (lib/assistant/pin): no schema change, and it works for
// someone who never linked a phone (they get it in the app only).
import { db } from "@/lib/db";
import { DEFAULT_SPEECH_LANG, isSpeechLang, type SpeechLang } from "@/lib/assistant/shared";

export interface AssistantPrefs {
  /** projects: the Overview's projects paragraph in it (part 2, 2026-11-09) — on unless they turn it off. */
  briefing: { on: boolean; time: string; projects: boolean };
  alerts: { proposalOpened: boolean; newLead: boolean };
  /** The language they speak to the Operator in: the ears listen for it. */
  lang: SpeechLang;
}

export const DEFAULT_PREFS: AssistantPrefs = { briefing: { on: false, time: "06:30", projects: true }, alerts: { proposalOpened: false, newLead: false }, lang: DEFAULT_SPEECH_LANG };

const PREFIX = "assistant:prefs:";
const keyOf = (organizationId: string, userId: string) => `${PREFIX}${organizationId}:${userId}`;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Tolerant: anything missing or odd falls back to the default. */
export function parsePrefs(raw: string | null | undefined): AssistantPrefs {
  if (!raw) return DEFAULT_PREFS;
  try {
    const v = JSON.parse(raw) as Partial<{ briefing: Partial<AssistantPrefs["briefing"]>; alerts: Partial<AssistantPrefs["alerts"]>; lang: unknown }>;
    const time = typeof v.briefing?.time === "string" && TIME_RE.test(v.briefing.time) ? v.briefing.time : DEFAULT_PREFS.briefing.time;
    return {
      briefing: { on: v.briefing?.on === true, time, projects: v.briefing?.projects !== false },
      alerts: { proposalOpened: v.alerts?.proposalOpened === true, newLead: v.alerts?.newLead === true },
      lang: isSpeechLang(v.lang) ? v.lang : DEFAULT_SPEECH_LANG,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function readPrefs(organizationId: string, userId: string): Promise<AssistantPrefs> {
  const row = await db.syncState.findUnique({ where: { key: keyOf(organizationId, userId) }, select: { cursor: true } }).catch(() => null);
  return parsePrefs(row?.cursor);
}

export async function writePrefs(organizationId: string, userId: string, prefs: AssistantPrefs): Promise<void> {
  const key = keyOf(organizationId, userId);
  const cursor = JSON.stringify(parsePrefs(JSON.stringify(prefs)));
  await db.syncState.upsert({ where: { key }, create: { key, cursor }, update: { cursor } });
}

/** Everyone who set anything, with their switches — the minute job and the alert hooks read it. */
export async function allPrefs(organizationId?: string): Promise<{ organizationId: string; userId: string; prefs: AssistantPrefs }[]> {
  const rows = await db.syncState.findMany({ where: { key: { startsWith: organizationId ? `${PREFIX}${organizationId}:` : PREFIX } }, select: { key: true, cursor: true } });
  const out: { organizationId: string; userId: string; prefs: AssistantPrefs }[] = [];
  for (const r of rows) {
    const [org, user] = r.key.slice(PREFIX.length).split(":");
    if (org && user) out.push({ organizationId: org, userId: user, prefs: parsePrefs(r.cursor) });
  }
  return out;
}
