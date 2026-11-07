import { PrismaClient } from "@prisma/client";
import { Role, LeadStatus, ProposalStatus, MeasurementType } from "../src/lib/prismaEnums";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { PLAN_FEATURES } from "./plan-features";

const prisma = new PrismaClient();

async function main() {
  console.log("▸ Seeding JobFlex demo data");

  const org = await prisma.organization.upsert({
    where: { slug: "acme-contracting" },
    update: {},
    create: {
      slug: "acme-contracting",
      name: "Acme Contracting",
      billingEmail: "owner@acme.test",
      phone: "(555) 010-0100",
      address: "220 Market St, Philadelphia, PA",
      defaultTaxRate: 0.06,
      primaryColor: "#4F46E5",
    },
  });

  const password = await bcrypt.hash("password123", 10);

  const owner = await prisma.user.upsert({
    where: { email: "owner@acme.test" },
    update: { hashedPassword: password, activeOrgId: org.id, name: "Jamie Rivera" },
    create: {
      email: "owner@acme.test",
      name: "Jamie Rivera",
      hashedPassword: password,
      activeOrgId: org.id,
    },
  });

  const sales = await prisma.user.upsert({
    where: { email: "sales@acme.test" },
    update: { hashedPassword: password, activeOrgId: org.id, name: "Morgan Lane" },
    create: {
      email: "sales@acme.test",
      name: "Morgan Lane",
      hashedPassword: password,
      activeOrgId: org.id,
    },
  });

  // The automation account (2026-09-20): every script and Playwright run signs
  // in as this one, so the owner's own login is never spent on the sign-in
  // brake (8 attempts per address per 15 minutes) by a test.
  //
  // In its OWN organisation, "QA Co" (same day, later): limits here are per
  // organisation — 30 property lookups an hour, for one — and a screenshot
  // matrix run inside Acme spent the owner's allowance and left his phone
  // without house outlines for an hour. Nothing a test does may be charged to
  // the organisation a person works in.
  const qaOrg = await prisma.organization.upsert({
    where: { slug: "qa-co" },
    update: {},
    create: {
      slug: "qa-co",
      name: "QA Co",
      billingEmail: "qa@acme.test",
      phone: "(555) 010-0199",
      address: "12618 NE 100th St, Kirkland, WA",
      defaultTaxRate: 0.06,
      primaryColor: "#111113",
    },
  });
  const qaPassword = await bcrypt.hash("qa-pass-2026", 10);
  const qa = await prisma.user.upsert({
    where: { email: "qa@acme.test" },
    update: { hashedPassword: qaPassword, activeOrgId: qaOrg.id, name: "QA Robot" },
    create: {
      email: "qa@acme.test",
      name: "QA Robot",
      hashedPassword: qaPassword,
      activeOrgId: qaOrg.id,
    },
  });

  const installer = await prisma.user.upsert({
    where: { email: "installer@acme.test" },
    update: { hashedPassword: password, activeOrgId: org.id, name: "Casey Stone" },
    create: {
      email: "installer@acme.test",
      name: "Casey Stone",
      hashedPassword: password,
      activeOrgId: org.id,
    },
  });

  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    update: { role: Role.OWNER },
    create: { userId: owner.id, organizationId: org.id, role: Role.OWNER },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: qa.id, organizationId: qaOrg.id } },
    update: { role: Role.OWNER },
    create: { userId: qa.id, organizationId: qaOrg.id, role: Role.OWNER },
  });
  // It used to be an OWNER of Acme; that seat is given up.
  await prisma.membership.deleteMany({ where: { userId: qa.id, organizationId: org.id } });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: sales.id, organizationId: org.id } },
    update: { role: Role.SALES },
    create: { userId: sales.id, organizationId: org.id, role: Role.SALES },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: installer.id, organizationId: org.id } },
    update: { role: Role.INSTALLER },
    create: { userId: installer.id, organizationId: org.id, role: Role.INSTALLER },
  });

  const tagVIP = await prisma.tag.upsert({
    where: { organizationId_label: { organizationId: org.id, label: "VIP" } },
    update: {},
    create: { organizationId: org.id, label: "VIP", color: "#C89450" },
  });

  const clients = await Promise.all(
    [
      { name: "Rohan Patel", email: "rohan@patel.test", phone: "(555) 221-0044", address: "118 Cedar Ave" },
      { name: "Elena Diaz", email: "elena@diaz.test", phone: "(555) 221-0055", address: "221 Oak St" },
      { name: "Marcus Reilly", email: "marcus@reilly.test", phone: "(555) 221-0066", address: "910 Fir Ln" },
    ].map((c) =>
      prisma.client.create({
        data: {
          organizationId: org.id,
          ...c,
          city: "Philadelphia",
          state: "PA",
          zip: "19103",
        },
      }),
    ),
  );

  await prisma.clientTag.create({
    data: { clientId: clients[0].id, tagId: tagVIP.id },
  });

  await Promise.all(
    [
      {
        name: "Sarah Wu",
        email: "sarah@wu.test",
        phone: "(555) 410-2020",
        projectType: "Roof replacement",
        description: "20-year architectural shingles, 2,400 sqft roof, minor decking repair expected.",
        status: LeadStatus.NEW,
        aiCategory: "Roofing",
        aiConfidence: 0.88,
      },
      {
        name: "Ben Okafor",
        email: "ben@okafor.test",
        phone: "(555) 410-2021",
        projectType: "Kitchen remodel",
        description: "Full gut, island, quartz counters, shaker cabs, mid-tier appliances.",
        status: LeadStatus.CONTACTED,
        aiCategory: "Kitchen",
        aiConfidence: 0.92,
        assignedToId: sales.id,
        contactedAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      },
      {
        name: "Priya Shah",
        email: "priya@shah.test",
        phone: "(555) 410-2022",
        projectType: "Fence install",
        description: "180 linear ft cedar privacy fence, one gate, sloped yard.",
        status: LeadStatus.QUOTED,
        aiCategory: "Fencing",
        aiConfidence: 0.95,
        assignedToId: sales.id,
      },
      {
        name: "Luis Romero",
        email: "luis@romero.test",
        projectType: "Deck",
        description: "16x20 composite deck, railings, staircase.",
        status: LeadStatus.NEW,
        aiCategory: "Decking",
        aiConfidence: 0.9,
      },
    ].map((l) =>
      prisma.lead.create({
        data: {
          organizationId: org.id,
          ...l,
          city: "Philadelphia",
          state: "PA",
          zip: "19103",
        },
      }),
    ),
  );

  const publicId1 = randomUUID();
  const proposal1 = await prisma.proposal.create({
    data: {
      publicId: publicId1,
      organizationId: org.id,
      ownerId: sales.id,
      clientId: clients[0].id,
      title: "Patel Residence — Roof Replacement",
      description: "Full tear-off, architectural shingle upgrade, new ridge vents, drip edge, and ice/water shield.",
      scopeOfWork:
        "Remove existing 3-tab shingles to decking. Replace ice & water shield, install synthetic underlayment, 30-year architectural shingles (Owens Corning Duration), new drip edge, new ridge vents, pipe collars. Full cleanup and magnetic sweep.",
      notes: "Material upgrade available: lifetime shingle — +$1,250.",
      status: ProposalStatus.SENT,
      subtotal: 17400,
      taxRate: 0.06,
      taxTotal: 1044,
      total: 18444,
      sentAt: new Date(Date.now() - 1000 * 60 * 60 * 20),
      viewCount: 2,
      viewedAt: new Date(Date.now() - 1000 * 60 * 60 * 6),
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14),
      lineItems: {
        create: [
          {
            name: "Tear-off & disposal",
            description: "Remove existing shingles, dispose of debris, dumpster included.",
            measurementType: MeasurementType.SQFT,
            quantity: 2400,
            unitPrice: 1.2,
            materialCost: 0.4,
            laborCost: 0.8,
            total: 2880,
            position: 0,
          },
          {
            name: "Architectural shingles (30-yr)",
            description: "Owens Corning Duration, full roof.",
            measurementType: MeasurementType.SQFT,
            quantity: 2400,
            unitPrice: 4.6,
            materialCost: 2.8,
            laborCost: 1.8,
            total: 11040,
            position: 1,
          },
          {
            name: "Ridge vent system",
            measurementType: MeasurementType.LINEAR_FT,
            quantity: 60,
            unitPrice: 14,
            materialCost: 6,
            laborCost: 8,
            total: 840,
            position: 2,
          },
          {
            name: "Ice & water shield — valleys and eaves",
            measurementType: MeasurementType.SQFT,
            quantity: 400,
            unitPrice: 3.6,
            materialCost: 1.8,
            laborCost: 1.8,
            total: 1440,
            position: 3,
          },
          {
            name: "Project setup + cleanup",
            measurementType: MeasurementType.LUMP_SUM,
            quantity: 1,
            unitPrice: 1200,
            materialCost: 100,
            laborCost: 1100,
            total: 1200,
            position: 4,
          },
        ],
      },
      installments: {
        create: [
          { label: "Deposit on signing", amount: 30, isPercent: true, position: 0 },
          { label: "Materials delivered", amount: 40, isPercent: true, position: 1 },
          { label: "Completion", amount: 30, isPercent: true, position: 2 },
        ],
      },
    },
  });

  const publicId2 = randomUUID();
  await prisma.proposal.create({
    data: {
      publicId: publicId2,
      organizationId: org.id,
      ownerId: sales.id,
      clientId: clients[1].id,
      title: "Diaz — Kitchen Remodel Quote",
      description: "Full kitchen remodel — cabinetry, counters, appliances, lighting.",
      status: ProposalStatus.DRAFT,
      subtotal: 42800,
      taxRate: 0.06,
      taxTotal: 2568,
      total: 45368,
      validUntil: new Date(Date.now() + 1000 * 60 * 60 * 24 * 21),
      lineItems: {
        create: [
          {
            name: "Shaker cabinetry — painted",
            measurementType: MeasurementType.LINEAR_FT,
            quantity: 28,
            unitPrice: 550,
            materialCost: 380,
            laborCost: 170,
            total: 15400,
            position: 0,
          },
          {
            name: "Quartz counters — 3cm",
            measurementType: MeasurementType.SQFT,
            quantity: 52,
            unitPrice: 85,
            materialCost: 60,
            laborCost: 25,
            total: 4420,
            position: 1,
          },
          {
            name: "Island — seating for 4",
            measurementType: MeasurementType.LUMP_SUM,
            quantity: 1,
            unitPrice: 6800,
            materialCost: 4200,
            laborCost: 2600,
            total: 6800,
            position: 2,
          },
          {
            name: "Appliance package (mid-tier)",
            measurementType: MeasurementType.LUMP_SUM,
            quantity: 1,
            unitPrice: 8800,
            materialCost: 8800,
            laborCost: 0,
            total: 8800,
            position: 3,
          },
          {
            name: "Lighting + electrical",
            measurementType: MeasurementType.LUMP_SUM,
            quantity: 1,
            unitPrice: 3400,
            materialCost: 1200,
            laborCost: 2200,
            total: 3400,
            position: 4,
          },
          {
            name: "Plumbing rough + finish",
            measurementType: MeasurementType.LUMP_SUM,
            quantity: 1,
            unitPrice: 3980,
            materialCost: 1400,
            laborCost: 2580,
            total: 3980,
            position: 5,
          },
        ],
      },
    },
  });

  await prisma.activityEvent.createMany({
    data: [
      {
        organizationId: org.id,
        actorId: sales.id,
        clientId: clients[0].id,
        proposalId: proposal1.id,
        kind: "SENT",
        summary: `Proposal "${proposal1.title}" sent to Rohan Patel`,
      },
      {
        organizationId: org.id,
        actorId: sales.id,
        clientId: clients[0].id,
        proposalId: proposal1.id,
        kind: "VIEWED",
        summary: `Rohan Patel opened the proposal`,
      },
    ],
  });

  await prisma.payment.create({
    data: {
      organizationId: org.id,
      clientId: clients[2].id,
      amount: 4200,
      provider: "STRIPE",
      status: "PAID",
      paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
      method: "card",
    },
  });

  await prisma.subscription.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      plan: "PROFESSIONAL",
      status: "ACTIVE",
      provider: "STRIPE",
      currentPeriodEnd: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    },
  });

  // ── Projects ──────────────────────────────────────────
  const today = new Date();
  const inDays = (n: number) => new Date(today.getTime() + n * 86_400_000);

  const project1 = await prisma.project.create({
    data: {
      organizationId: org.id,
      name: "Lakeside Heights — Phase 1",
      description: "Six-house subdivision on Lakeside, full envelope + finish work.",
      status: "ACTIVE",
      startsAt: inDays(-14),
      endsAt: inDays(120),
      budget: 850_000,
    },
  });

  const project2 = await prisma.project.create({
    data: {
      organizationId: org.id,
      name: "Patel Residence Renovation",
      description: "Roof, kitchen, deck — coordinated across three crews.",
      status: "ACTIVE",
      startsAt: inDays(-3),
      endsAt: inDays(45),
      budget: 92_000,
    },
  });

  const projectJobs = await Promise.all(
    [
      { project: project1, title: "Foundation pour — Lot A1", start: -14, end: -3, status: "COMPLETED", clientId: clients[0].id },
      { project: project1, title: "Framing — Lot A1", start: -2, end: 18, status: "IN_PROGRESS", clientId: clients[0].id },
      { project: project1, title: "Roofing — Lot A1", start: 21, end: 35, status: "SCHEDULED", clientId: clients[0].id },
      { project: project1, title: "Foundation pour — Lot A2", start: 7, end: 24, status: "SCHEDULED", clientId: clients[1].id },
      { project: project2, title: "Patel — Roof tear-off", start: -3, end: 4, status: "IN_PROGRESS", clientId: clients[0].id },
      { project: project2, title: "Patel — Kitchen demo", start: 5, end: 12, status: "SCHEDULED", clientId: clients[0].id },
      { project: project2, title: "Patel — Cabinet install", start: 14, end: 28, status: "SCHEDULED", clientId: clients[0].id },
    ].map((j) =>
      prisma.job.create({
        data: {
          organizationId: org.id,
          projectId: j.project.id,
          clientId: j.clientId,
          title: j.title,
          status: j.status,
          startsAt: inDays(j.start),
          endsAt: inDays(j.end),
        },
      }),
    ),
  );

  // ── Job expenses (across past 6 months for rich charts) ──
  const expenseSeed = [
    { jobIdx: 0, category: "Materials", amount: 18_400, daysAgo: 90, note: "Concrete & rebar" },
    { jobIdx: 0, category: "Labor",     amount: 9_800,  daysAgo: 88, note: "Concrete crew" },
    { jobIdx: 1, category: "Materials", amount: 22_300, daysAgo: 60, note: "Lumber package" },
    { jobIdx: 1, category: "Equipment", amount: 1_400,  daysAgo: 55, note: "Lift rental" },
    { jobIdx: 4, category: "Materials", amount: 4_600,  daysAgo: 30, note: "Shingles & underlayment" },
    { jobIdx: 4, category: "Permits",   amount: 240,    daysAgo: 28 },
    { jobIdx: 4, category: "Fuel",      amount: 180,    daysAgo: 14 },
    { jobIdx: 4, category: "Materials", amount: 850,    daysAgo: 7,  note: "Drip edge + flashing" },
  ];
  await Promise.all(
    expenseSeed.map((e) =>
      prisma.jobExpense.create({
        data: {
          jobId: projectJobs[e.jobIdx].id,
          category: e.category,
          amount: e.amount,
          note: e.note ?? null,
          createdAt: inDays(-e.daysAgo),
        },
      }),
    ),
  );

  // ── Backdated payments for revenue trend ──
  await prisma.payment.createMany({
    data: [
      { organizationId: org.id, clientId: clients[0].id, amount: 12_500, provider: "STRIPE", status: "PAID", paidAt: inDays(-95), method: "ach" },
      { organizationId: org.id, clientId: clients[0].id, amount: 24_000, provider: "STRIPE", status: "PAID", paidAt: inDays(-65), method: "ach" },
      { organizationId: org.id, clientId: clients[1].id, amount: 8_400,  provider: "STRIPE", status: "PAID", paidAt: inDays(-40), method: "card" },
      { organizationId: org.id, clientId: clients[1].id, amount: 6_200,  provider: "SQUARE", status: "PAID", paidAt: inDays(-20), method: "card" },
      { organizationId: org.id, clientId: clients[2].id, amount: 18_900, provider: "STRIPE", status: "PAID", paidAt: inDays(-9),  method: "ach" },
    ],
  });

  // ── Invoices ──
  await prisma.invoice.createMany({
    data: [
      {
        organizationId: org.id,
        proposalId: proposal1.id,
        clientId: clients[0].id,
        number: "INV-1041",
        amount: 18_444,
        status: "PENDING",
        provider: "STRIPE",
        dueDate: inDays(7),
      },
      {
        organizationId: org.id,
        clientId: clients[1].id,
        number: "INV-1042",
        amount: 6_200,
        status: "PAID",
        provider: "SQUARE",
        dueDate: inDays(-25),
        paidAt: inDays(-20),
      },
      {
        organizationId: org.id,
        clientId: clients[2].id,
        number: "INV-1043",
        amount: 4_980,
        status: "PENDING",
        provider: "STRIPE",
        dueDate: inDays(-3), // overdue
      },
      {
        organizationId: org.id,
        clientId: clients[2].id,
        number: "INV-1040",
        amount: 18_900,
        status: "PAID",
        provider: "STRIPE",
        dueDate: inDays(-16),
        paidAt: inDays(-9),
      },
    ],
  });

  // ── Change orders ──
  await prisma.changeOrder.createMany({
    data: [
      {
        organizationId: org.id,
        jobId: projectJobs[4].id,
        title: "Decking replacement (rotted area)",
        description: "Discovered rot above the kitchen wall. Adds 6 sheets of OSB + labor.",
        amount: 1_240,
        status: "SENT",
        publicToken: randomUUID(),
        sentAt: inDays(-2),
      },
      {
        organizationId: org.id,
        jobId: projectJobs[1].id,
        title: "Upgrade to Hardie siding",
        description: "Client wants Hardie instead of vinyl on front elevation.",
        amount: 4_800,
        status: "DRAFT",
        publicToken: randomUUID(),
      },
      {
        organizationId: org.id,
        jobId: projectJobs[0].id,
        title: "Trim window count down to 8",
        description: "Final plans dropped two windows.",
        amount: -1_200,
        status: "APPROVED",
        publicToken: randomUUID(),
        sentAt: inDays(-30),
        approvedAt: inDays(-28),
      },
    ],
  });

  // ── Applicants ──
  await prisma.applicant.createMany({
    data: [
      { organizationId: org.id, fullName: "Marcus Reyes", email: "marcus.reyes@example.com", phone: "(555) 552-2103", role: "Roofer", source: "Indeed", status: "APPLIED", notes: "10 years residential roofing." },
      { organizationId: org.id, fullName: "Aisha Brown", email: "aisha.brown@example.com", phone: "(555) 552-2104", role: "Estimator", source: "Referral", status: "APPLIED", notes: "Strong with takeoff software." },
      { organizationId: org.id, fullName: "Diego Salinas", email: "diego.s@example.com", phone: "(555) 552-2105", role: "Foreman", source: "Walk-in", status: "INTERVIEWING", notes: "2026-04-22 09:00 — Phone screen went well, schedule on-site next." },
      { organizationId: org.id, fullName: "Hannah Kim", email: "hannah.k@example.com", phone: "(555) 552-2106", role: "Carpenter", source: "Indeed", status: "INTERVIEWING" },
      { organizationId: org.id, fullName: "Robert Cole", email: "robert.cole@example.com", role: "Roofer", source: "LinkedIn", status: "HIRED", notes: "Onboarded 2026-04-25." },
      { organizationId: org.id, fullName: "Sam Liu", email: "sam.liu@example.com", role: "Apprentice", source: "Job fair", status: "REJECTED", notes: "Not enough experience for the open role." },
    ],
  });

  // ── Influencer affiliate stats (last 3 months) ──
  const periodFor = (offset: number) => {
    const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  await prisma.influencerStatement.createMany({
    data: [
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", clicks: 1830, conversions: 41, earnings: 2050, period: periodFor(0) },
      { organizationId: org.id, influencerName: "ContractorBros (YT)",  clicks: 920,  conversions: 18, earnings: 900,  period: periodFor(0) },
      { organizationId: org.id, influencerName: "Local-Reno-Mom (IG)",  clicks: 410,  conversions: 9,  earnings: 450,  period: periodFor(0) },
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", clicks: 1620, conversions: 38, earnings: 1900, period: periodFor(-1) },
      { organizationId: org.id, influencerName: "ContractorBros (YT)",  clicks: 880,  conversions: 14, earnings: 700,  period: periodFor(-1) },
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", clicks: 1410, conversions: 32, earnings: 1600, period: periodFor(-2) },
    ],
  });
  await prisma.influencerPayout.createMany({
    data: [
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", amount: 1900, period: periodFor(-1), status: "PAID", paidAt: inDays(-15) },
      { organizationId: org.id, influencerName: "ContractorBros (YT)",  amount: 700,  period: periodFor(-1), status: "PAID", paidAt: inDays(-15) },
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", amount: 1600, period: periodFor(-2), status: "PAID", paidAt: inDays(-45) },
      { organizationId: org.id, influencerName: "Jenna Vargas (TikTok)", amount: 2050, period: periodFor(0),  status: "PENDING" },
      { organizationId: org.id, influencerName: "ContractorBros (YT)",  amount: 900,  period: periodFor(0),  status: "PENDING" },
    ],
  });

  // ── Org landing builder defaults ─────────────────────
  await prisma.organization.update({
    where: { id: org.id },
    data: {
      publicProfileEnabled: true,
      landingHeroTitle: "A premium roof in 7 days, guaranteed.",
      landingHeroSubtitle:
        "Family-owned. Licensed in 4 states. Free same-week quotes — every season.",
      heroImageUrl: null,
      servicesJson: JSON.stringify(["Roofing", "Kitchen", "Fencing", "Decking"]),
    },
  });

  // ── Follow-up rules + scheduled follow-ups for the CRM module ──
  const rule1 = await prisma.followUpRule.upsert({
    where: { id: "seed-rule-day2" },
    update: {},
    create: {
      id: "seed-rule-day2",
      organizationId: org.id,
      name: "Day-2 nudge",
      triggerStatus: "SENT",
      delayMinutes: 60 * 24 * 2,
      enabled: true,
      template: null,
    },
  });
  const rule2 = await prisma.followUpRule.upsert({
    where: { id: "seed-rule-won" },
    update: {},
    create: {
      id: "seed-rule-won",
      organizationId: org.id,
      name: "Won welcome",
      triggerStatus: "ACCEPTED",
      delayMinutes: 30,
      enabled: true,
      template: null,
    },
  });

  // 4 scheduled follow-ups: 1 already overdue, 3 upcoming
  await prisma.followUp.createMany({
    data: [
      {
        organizationId: org.id,
        proposalId: proposal1.id,
        runAt: inDays(-1), // overdue
        note: "Day-2 nudge · SENT + 2d",
      },
      {
        organizationId: org.id,
        proposalId: proposal1.id,
        runAt: inDays(2),
        note: "Day-2 nudge · second pass",
      },
      {
        organizationId: org.id,
        proposalId: proposal1.id,
        runAt: inDays(7),
        note: "Week-1 check-in",
      },
      {
        organizationId: org.id,
        proposalId: proposal1.id,
        runAt: inDays(14),
        note: "Two-week final-call",
      },
    ],
  });

  // ── Platform-scope announcement (visible to every tenant) ──
  await prisma.announcement.create({
    data: {
      organizationId: org.id,
      title: "JobFlex 2.5 — CRM hub, Health, and Landing builder",
      body: "Three new hubs are live: a unified CRM at /dashboard/crm, a platform health dashboard at /admin/health, and a public-form Landing builder under /dashboard/company.",
      scope: "PLATFORM",
      priority: 1,
      expiresAt: inDays(21),
    },
  });

  // ── Pricing plans (create-only: never clobbers admin edits on re-seed) ──
  // Lowercase slugs on purpose — the limits engine matches Subscription.plan to
  // PricingPlan.slug case-insensitively in JS, but everything else assumes
  // lowercase (mixed case previously caused a fail-open limits bug).
  // Checkout still requires an admin to run "Sync to Stripe" on /admin/plans.
  //
  // trialDays is UNUSED (2026-10-26, audit §4): every trial's length is the
  // trial offer's (lib/trialOffer signupTrialOffer). Kept at 7 so the column
  // and /admin/plans agree with what is given.
  //
  // The "free" row is seeded INACTIVE (the Free tier was removed from the
  // product, 2026-08-17): it never appears on a sales surface, but the row
  // must exist because limitsEngine reads limits from ALL rows regardless of
  // `active` — lapsed and no-subscription orgs are enforced at THIS row's caps.
  const plans = [
    {
      slug: "free",
      name: "Free",
      description: "Internal cap floor — not sold. Lapsed/no-subscription orgs enforce these limits.",
      priceCents: 0,
      yearlyPriceCents: null as number | null,
      trialDays: 0,
      order: 0,
      highlight: false,
      active: false,
      features: [
        "5 proposals / month",
        "3 AI estimates / month",
        "Client portal",
        "Online payments",
      ],
      // The enforced caps. Lapsed paid subscriptions also drop to THIS row's
      // limits (limitsEngine isLapsed), so every metered resource needs a cap
      // here.
      limits: {
        proposalsCreated: 5,
        estimatorUses: 3,
        jobs: 10,
        calendarEvents: 20,
        calendarCards: 20,
        projects: 3,
        workers: 1,
        teamSeats: 1,
        conversationsStarted: 5,
        messagesSent: 100,
        leads: 15,
        aiPhoneCalls: 5,
        reviewRequests: 5,
        roofMeasurements: 3,
        manualJReports: 1,
      } as Record<string, number> | null,
    },
    {
      slug: "starter",
      name: "Starter",
      description: "Solo contractors \u2014 proposals, clients, free leads and the day-to-day books.",
      priceCents: 2900,
      yearlyPriceCents: 29000,
      trialDays: 7,
      order: 1,
      highlight: false,
      active: true,
      // Production's lines (prisma/plan-features.ts; an old dev.db: prisma/seed-plan-features.ts).
      features: PLAN_FEATURES.starter,
      limits: { workers: 1, roofMeasurements: 15, manualJReports: 10 },
    },
    {
      slug: "professional",
      name: "Professional",
      description: "Growing teams \u2014 everything in Starter plus Smart Proposal and the estimators.",
      priceCents: 7900,
      yearlyPriceCents: 79000,
      trialDays: 7,
      order: 2,
      highlight: true,
      active: true,
      features: PLAN_FEATURES.professional,
      limits: { workers: 3, roofMeasurements: 40, manualJReports: 25 },
    },
    {
      slug: "enterprise",
      name: "Enterprise",
      description: "Large businesses \u2014 every estimator, AI phone answering, custom branding, unlimited seats.",
      priceCents: 19900,
      yearlyPriceCents: 199000,
      trialDays: 7,
      order: 3,
      highlight: false,
      active: true,
      features: PLAN_FEATURES.enterprise,
      // Absent limits = unlimited, except the paid lookups (lib/planLimits PAID_CALL_DEFAULTS).
      limits: { roofMeasurements: 100, manualJReports: 60 } as Record<string, number> | null,
    },
  ];
  for (const p of plans) {
    await prisma.pricingPlan.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        slug: p.slug,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        yearlyPriceCents: p.yearlyPriceCents,
        interval: "month",
        trialDays: p.trialDays,
        order: p.order,
        highlight: p.highlight,
        active: p.active,
        features: JSON.stringify(p.features),
        limitsJson: p.limits ? JSON.stringify(p.limits) : null,
      },
    });
  }
  console.log("   seeded pricing plans: starter $29 / professional $79 / enterprise $199 (7-day trial, lib/trialOffer) + inactive cap-floor row");

  console.log("   seeded follow-up rules:", rule1.id, rule2.id);
  console.log("✓ Seed complete");
  console.log("   owner@acme.test / password123");
  console.log("   sales@acme.test / password123");
  console.log("   installer@acme.test / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
