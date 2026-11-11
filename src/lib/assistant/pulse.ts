import "server-only";
// THE COMPANY PULSE, FOR THE OPERATOR (Smart CRM part 7, 2026-11-10): "how was last week", "how fast do we answer
// new leads", "who closes best" — read from the same pulse the CRM's Office tab draws (lib/pulse), so the Operator
// and the page can never give two answers.

import { z } from "zod";
import type { ReadTool } from "@/lib/assistant/tools";
import { money } from "@/lib/assistant/shared";
import { readPulse } from "@/lib/pulse/server";
import { PULSE_PERIODS, pulseLine, sourceWords, speedWords, waitWords, winWords, type PulsePeriod } from "@/lib/pulse/shared";

const companyPulse: ReadTool<{ period: PulsePeriod }> = {
  kind: "read",
  name: "company_pulse",
  // Money collected and each salesperson's win rate: the office's (the Office tab shows it to office roles only).
  need: "money.read",
  card: {
    label: "Company pulse",
    purpose: "How the company did over a week, 30 or 90 days: new leads, how fast they got a first reply and who is still waiting, proposals sent, jobs won, the win rate for each salesperson, money collected, and the lead sources that brought paid work — each compared with the same stretch before.",
    when: "'How was last week', 'how fast do we answer leads', 'who closes best', 'what's our win rate': company_pulse(period). Say the numbers as given; never guess a rate or a reply time.",
    objects: ["lead", "proposal", "money"],
    effect: "read",
    group: "lookups",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "how was last week?", args: { period: "last-week" } },
      { say: "how fast do we answer new leads?", args: { period: "30d" } },
    ],
  },
  description:
    "The company pulse for a period: one summary sentence, what changed against the same stretch before, speed to lead (the middle first-reply time, how many heard back within 5 minutes / an hour / a day / later, who is still waiting, and each person's reply time), the win rate for the company and for each salesperson, the best lead sources, and the things worth a look.",
  params: z.object({
    period: z.enum(PULSE_PERIODS as unknown as [PulsePeriod, ...PulsePeriod[]]).describe("'week' = this week so far (Monday to now), 'last-week' = the last full Monday–Sunday week, '30d' / '90d' = the last 30 / 90 days"),
  }),
  async run({ actor, now }, args) {
    const p = await readPulse(actor.organizationId, { period: args.period, now, tz: actor.timezone });
    const page = "/dashboard/crm?tab=office#pulse";
    if (p.quiet) return { period: p.label, dates: p.range, summary: pulseLine(p), page };
    return {
      period: p.label,
      dates: p.range,
      summary: pulseLine(p),
      comparedWith: p.prevLabel,
      // The tile shows the money short ("$23.9K"); said aloud it is the whole number.
      changes: p.stats.filter((s) => s.delta).map((s) => `${s.label}: ${s.key === "collected" ? money(p.collected) : s.value} (${s.delta!.words})`),
      speedToLead: {
        firstReply: p.speed.medianMin === null ? "no reply on record" : `${waitWords(p.speed.medianMin)} (the middle of ${p.speed.replied} replied)`,
        howFast: p.speed.buckets.filter((b) => b.count > 0).map((b) => `${b.label}: ${b.count}`),
        stillWaiting: [...p.speed.waiting.map((w) => `${w.name} — came in ${w.since}${w.owner ? `, ${w.owner}'s` : ", nobody's yet"}`), ...(p.speed.waitingMore ? [`and ${p.speed.waitingMore} more`] : [])],
        byPerson: p.speed.people.map(speedWords),
      },
      winRate: {
        company: winWords({ ...p.wins.total, name: "The company" }),
        bySalesperson: p.wins.rows.map(winWords),
      },
      bestSources: p.sources.map(sourceWords),
      worthALook: p.notes.map((n) => n.text),
      page,
    };
  },
};

export const PULSE_TOOLS = [companyPulse] as const;
