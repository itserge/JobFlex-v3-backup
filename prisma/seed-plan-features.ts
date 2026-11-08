// Brings a LOCAL dev.db's sellable plans' feature lines to production's (prisma/plan-features.ts). The main seed is
// create-only for plans (it never clobbers admin edits), so an old dev.db keeps whatever lines it was given; this
// rewrites only `features` on starter / professional / enterprise — names, prices, limits and Stripe ids stay.
// Refuses anything but a SQLite file database: it is never run against production.
//   npx --no-install tsx prisma/seed-plan-features.ts
import { PrismaClient } from "@prisma/client";
import { PLAN_FEATURES } from "./plan-features";

// The database the dev server opens: .env.local over .env, as Next loads them.
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    /* no such file */
  }
}
const url = process.env.DATABASE_URL ?? "";
if (!url.startsWith("file:")) {
  console.error(`seed-plan-features: refusing — DATABASE_URL is not a local SQLite file (${url.split(":")[0] || "unset"})`);
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  for (const [slug, features] of Object.entries(PLAN_FEATURES)) {
    const r = await prisma.pricingPlan.updateMany({ where: { slug }, data: { features: JSON.stringify(features) } });
    console.log(`${slug}: ${r.count ? `${features.length} lines` : "no such plan"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
