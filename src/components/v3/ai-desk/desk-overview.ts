// THE AI DESK AT A GLANCE (owner, 2026-10-14: "organize the AI desk and make a better design — it's everything in one
// colour, black, so basic; get me something better, modern"). Pure: from what the settings page already loaded, the
// overview's status line, the setup progress, each tab's state and the tab to open on. desk-steps.tsx draws it.
import { minutesLeftWords } from "@/lib/aiDesk/shared";
import type { DeskSettingsData } from "@/components/v3/settings-blueprint/settings-data";

export type DeskTab = "numbers" | "business" | "booking" | "voice" | "minutes";
export const SETUP_TABS = ["numbers", "business", "booking", "voice"] as const;

export type TabState = { tone: "done" | "check" | "todo" | "warn" | "info"; words: string };
export type Overview = {
  /** The overview's status: live (answering), warn (something to do), off (not answering at all). */
  status: { tone: "live" | "warn" | "off"; words: string };
  done: Record<(typeof SETUP_TABS)[number], boolean>;
  count: number;
  /** The first setup tab not done, or null when all four are. */
  next: (typeof SETUP_TABS)[number] | null;
  forwardingPending: boolean;
  tabs: Record<DeskTab, TabState>;
  minutesWords: string;
};

export function deskOverview(d: DeskSettingsData, number: string | null, toCheck: number, written: boolean): Overview {
  const forwardingPending = !!number && d.forwarding !== "none" && d.forwardCheck?.status !== "works";
  const done = {
    numbers: !!number && !forwardingPending,
    business: written && toCheck === 0,
    booking: d.steps.booking,
    voice: d.steps.tested,
  };
  const count = SETUP_TABS.filter((k) => done[k]).length;
  const next = SETUP_TABS.find((k) => !done[k]) ?? null;
  const b = d.minutes.balance;
  const status: Overview["status"] = !d.assistantOnPlan
    ? { tone: "off", words: "Not on your plan — calls ring your phone" }
    : !number
      ? { tone: "warn", words: "No number yet — get one in Phone & forwarding" }
      : d.paused
        ? { tone: "off", words: `Paused — calls ${pausedTo(d)} until you turn the desk back on` }
      : b.out
        ? { tone: "warn", words: "Out of minutes — calls ring your phone or take a message" }
        : forwardingPending
          ? { tone: "warn", words: "Answering its number — your forwarding isn't confirmed yet" }
          : !written
            ? { tone: "warn", words: "Answering — with your company details only, until you describe your business" }
            : { tone: "live", words: d.mode === "FORWARD" || d.forwarding === "missed" ? "Live — taking the calls you miss" : "Live — answering every call" };
  const minutesWords = minutesLeftWords(b);
  const tabs: Record<DeskTab, TabState> = {
    numbers: !number ? { tone: "todo", words: "To do" } : forwardingPending ? { tone: "check", words: "Forwarding to check" } : { tone: "done", words: "Done" },
    business: toCheck > 0 ? { tone: "check", words: `${toCheck} to check` } : written ? { tone: "done", words: "Done" } : { tone: "todo", words: "To do" },
    booking: done.booking ? { tone: "done", words: "Booking on" } : { tone: "todo", words: "Messages only" },
    voice: done.voice ? { tone: "done", words: "Tested" } : { tone: "todo", words: "Not tested" },
    minutes: b.out ? { tone: "warn", words: "Out" } : b.low ? { tone: "check", words: minutesWords.replace(/ — running low$/, "") } : { tone: "info", words: minutesWords },
  };
  return { status, done, count, next, forwardingPending, tabs, minutesWords };
}

/** Where a call goes while the desk is paused (lib/aiDesk/calls): the company phone, unless it forwards every call to
 *  the desk (that would loop) — else a message. */
export function pausedTo(d: Pick<DeskSettingsData, "businessPhone" | "forwarding">): string {
  return d.businessPhone && d.forwarding !== "all" ? `ring ${d.businessPhone}` : "take a message";
}

const ALL_TABS: readonly DeskTab[] = ["numbers", "business", "booking", "voice", "minutes"];

/**
 * The tab to open on: the one in the address (`step=`, kept as tabs are picked — a reload, or the page rebuilding
 * itself when a tablet turns, opens the same tab); back from a minutes purchase → minutes; else the first thing not
 * done; else the business.
 */
export function firstTab(o: Overview, search: string): DeskTab {
  const step = /[?&]step=([a-z]+)/.exec(search)?.[1];
  if (step && (ALL_TABS as readonly string[]).includes(step)) return step as DeskTab;
  if (/[?&]pack_paid=/.test(search)) return "minutes";
  return o.next ?? "business";
}
