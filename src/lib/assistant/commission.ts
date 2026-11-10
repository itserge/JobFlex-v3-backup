import "server-only";
// SALES COMMISSION FOR THE OPERATOR (2026-11-10, the ProSmart gaps plan, part 4): "how much commission does Nelly
// have", "what do I owe the reps". The same figures the Workers page shows (lib/proposalRow/server repCommissions):
// each rep's percent, and what they have earned of the whole on their sold deals — earned as the client pays,
// before tax. Money: the office's.

import { z } from "zod";
import { db } from "@/lib/db";
import type { ReadTool } from "@/lib/assistant/tools";
import { repCommissions } from "@/lib/proposalRow/server";

type Args = { who: string | null };

const salesCommission: ReadTool<Args> = {
  kind: "read",
  name: "sales_commission",
  need: "money.read",
  card: {
    label: "Sales commission",
    purpose: "Each rep's commission percent and what they have earned on their sold deals — earned as the client pays.",
    when: "'How much commission does Nelly have', 'what do I owe the reps', 'what's Mike's percent': sales_commission(who) for one person, null for everyone with a percent.",
    objects: ["worker", "money", "proposal"],
    effect: "read",
    group: "money",
    version: 1,
    since: "2026-11-10",
    samples: [
      { say: "how much commission does Nelly have?", args: { who: "Nelly" } },
      { say: "what do I owe the sales reps?", args: { who: null } },
    ],
  },
  description:
    "Sales commission: each rep's percent and, on their sold deals, what they have earned (their percent of what the client has paid, before tax) out of the whole commission on those deals. who = a person's name, or null for everyone with a percent or a deal.",
  params: z.object({ who: z.string().max(80).nullable() }),
  async run({ actor }, args) {
    const org = actor.organizationId;
    const [stats, members] = await Promise.all([
      repCommissions(org),
      db.membership.findMany({ where: { organizationId: org }, select: { userId: true, role: true, user: { select: { name: true, email: true } } } }),
    ]);
    let rows = members.map((m) => ({ who: m.user.name || m.user.email || "Someone", role: m.role.toLowerCase(), ...(stats.get(m.userId) ?? { pct: null, earned: 0, full: 0, deals: 0 }) }));
    if (args.who) {
      const q = args.who.trim().toLowerCase();
      rows = rows.filter((r) => r.who.toLowerCase().includes(q));
      if (!rows.length) return { say: `No one called ${args.who} on the team.` };
    } else rows = rows.filter((r) => r.pct || r.deals);
    if (!rows.length) return { say: "Nobody has a sales commission yet — set a percent on the Workers page." };
    return {
      reps: rows.map((r) => ({ who: r.who, role: r.role, percent: r.pct, earned: r.earned, ofTotal: r.full, deals: r.deals })),
      rule: "Earned as the client pays, before sales tax; a deal keeps the percent it was sold at.",
      page: "/dashboard/workers",
    };
  },
};

export const COMMISSION_TOOLS = [salesCommission] as const;
