// /homeowner/price/<trade> — the homeowner portal's estimators (2026-10-28, lib/home/portalPrice: "one home portal").
// The roof prices itself from the address (the range engine, lib/publicEstimate/roof — was /price/roof); deck,
// fence, heating & cooling and any project ("smart") run JobFlex's own estimators in house mode (the website
// estimators with JobFlex as the shop, lib/webEstimator houseShop — was /estimate/jobflex/<trade>). One bar over all
// of them (PriceChrome): the way back to the portal and the switch between estimators. No account.
//
// The roof: ?address=&city=&state=&zip= prefill the field (a cost guide knows its city); ?lat=&lng= too, for a stand
// with no Maps key; ?home=<key>&plan=<id> picks up a range saved from "Email me this range".
// Outside the (marketing) group on purpose: its smooth wheel would fight the 3D views' own wheel.
import type { Metadata, Route } from "next";
import { notFound, redirect } from "next/navigation";
import { PriceChrome, PriceHead } from "@/components/v3/price-my-project/price-row";
import { RoofFlow, type Resume } from "@/components/v3/price-my-project/roof-flow";
import type { Site } from "@/components/v3/price-my-project/place-field";
import { WebDeck } from "@/components/v3/web-estimate/web-deck";
import { WebHvac } from "@/components/v3/web-estimate/web-hvac";
import { WebSmart } from "@/components/v3/web-estimate/web-smart";
import { WebFence } from "@/components/v3/web-estimate/web-fence";
import { webPageModel } from "@/actions/webEstimator";
import { db } from "@/lib/db";
import { findHomeByKey } from "@/lib/home/portal";
import { homeownerDoorFor } from "@/lib/home/homeownerDoor";
import { isPortalTrade, type PortalTrade } from "@/lib/home/portalPrice";
import { houseOrgId } from "@/lib/publicEstimate/store";
import { HOUSE_SLUG } from "@/lib/webEstimator";
import { parsePlanEstimate, parsePlanSite } from "@/lib/leadCenter/estimate";
import { PRO_IS } from "@/lib/home/jobflexPro";
import s from "@/components/v3/price-my-project/price.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<{ trade: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const TITLES: Record<PortalTrade, { title: string; description: string }> = {
  roof: { title: "Price my roof", description: "Your roof, read from the sky: type your address, answer three questions, and see a price range for your house. Not a quote — a local JobFlex pro confirms on site." },
  deck: { title: "Design and price my deck", description: "Design your deck in 3D on your lot and see the price as you build it. A local JobFlex pro confirms on site." },
  fence: { title: "Price my fence", description: "Draw your fence on your lot from the air and see a price range in about a minute. A local JobFlex pro confirms on site." },
  hvac: { title: "Price my heating & cooling", description: "Your house looked up, the system sized to it, a price range in about a minute. A local JobFlex pro confirms on site." },
  smart: { title: "Price my project", description: "Kitchens, baths and other projects priced from your words and photos — a range in about a minute. A local JobFlex pro confirms on site." },
};

/** Each estimator page's head (PriceHead): the kicker, the H1, the one-line lead — true of the estimator as it runs. */
const HEADS: Record<PortalTrade, { kicker: string; title: string; lede: string }> = {
  roof: { kicker: "Price my roof", title: "Your roof, read from the sky.", lede: "Type your address, answer three questions, see a range for your house. An estimate, not a quote — a local JobFlex pro confirms on site." },
  deck: { kicker: "Price my deck", title: "Design your deck in 3D.", lede: "Type your address, design the deck on your lot and see the price as you build it. A local JobFlex pro confirms on site." },
  fence: { kicker: "Price my fence", title: "Draw your fence on your lot.", lede: "Draw it on your lot from the air and see a price range in about a minute. A local JobFlex pro confirms on site." },
  hvac: { kicker: "Price my heating & cooling", title: "A system sized to your house.", lede: "We look up your house, size the system to it and show a price range in about a minute. A local JobFlex pro confirms on site." },
  smart: { kicker: "Price my project", title: "Priced from your words.", lede: "Kitchens, baths and other projects priced from your description and photos — a range in about a minute. A local JobFlex pro confirms on site." },
};

/** Where a trade's describe-and-match intake starts when the house estimators are off. */
const DESCRIBE: Record<Exclude<PortalTrade, "roof">, string | null> = { deck: "decking", fence: "fencing", hvac: "hvac", smart: null };

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { trade } = await params;
  if (!isPortalTrade(trade)) return { title: "JobFlex Homeowner Portal" };
  return { title: `${TITLES[trade].title} — JobFlex Homeowner Portal`, description: TITLES[trade].description, alternates: { canonical: `/homeowner/price/${trade}` } };
}

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 200) : "");
const num = (v: string | string[] | undefined) => (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** ?home=<key>&plan=<id> — a range saved from "Email me this range", picked up at the form (the dashboard's and the
 *  email's "Get quotes"). Only this home's own planned plan; anything else is the plain flow. */
async function resumeFrom(key: string, planId: string): Promise<Resume | null> {
  try {
    const home = await findHomeByKey(key);
    if (!home) return null;
    const plan = await db.homePlan.findFirst({ where: { id: planId, homeId: home.id, status: "PLANNED" }, select: { notes: true } });
    const e = parsePlanEstimate(plan?.notes);
    const site = parsePlanSite(plan?.notes);
    if (!e || e.trade !== "roof" || !site) return null;
    const homeSqft = e.basis === "size" && e.hidden.facts.footprintSqft ? Math.round(e.hidden.facts.footprintSqft * e.storeys) : null;
    return {
      site,
      plan: { homeKey: key, planId },
      priced: {
        answers: e.answers,
        budgetCents: e.budgetCents,
        homeSqft,
        // The form needs the number and the choices only; the hidden lines stay on the server.
        range: { low: e.range.low, mid: e.range.mid, high: e.range.high, squares: e.squares, pitchLabel: e.pitchLabel, basis: e.basis, scope: [], cityFactor: e.cityFactor, cityWords: null, hidden: { facts: e.hidden.facts, spec: e.hidden.spec, materials: [], labor: [], assumptions: [], scopeText: "" } },
      },
    };
  } catch {
    return null;
  }
}

export default async function PortalPricePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { trade } = await params;
  if (!isPortalTrade(trade)) notFound();
  const sp = await searchParams;
  const house = !!(await houseOrgId());

  if (trade === "roof") {
    const resume = typeof sp.home === "string" && typeof sp.plan === "string" ? await resumeFrom(sp.home, sp.plan) : null;
    const address = str(sp.address);
    const lat = num(sp.lat);
    const lng = num(sp.lng);
    const prefill: Site | null =
      address && lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { address, city: str(sp.city), state: str(sp.state).toUpperCase(), zip: str(sp.zip), lat, lng }
        : null;
    return (
      <PriceChrome at="roof" house={house}>
        <PriceHead kicker={HEADS.roof.kicker} title={HEADS.roof.title} lede={HEADS.roof.lede} />
        <RoofFlow prefill={prefill} resume={resume} />
        <p className={s.note}>{PRO_IS}</p>
      </PriceChrome>
    );
  }

  // The house estimators: closed (no house org, or the Lead Center turned them off) → the portal's own intake, the
  // project started in the homeowner's words.
  const m = house ? await webPageModel(HOUSE_SLUG, trade, null).catch(() => null) : null;
  if (!m) {
    const door = DESCRIBE[trade] ? homeownerDoorFor(DESCRIBE[trade]) : null;
    redirect((door?.href ?? "/homeowner") as Route);
  }
  return (
    <PriceChrome at={trade} house={house}>
      <PriceHead kicker={HEADS[trade].kicker} title={HEADS[trade].title} lede={HEADS[trade].lede} />
      {/* The website estimator as it is; the Blueprint reaches it only through this wrapper (price.module.css .house). */}
      <div className={s.house} data-house>
        {m.trade === "deck" ? (
          <WebDeck shop={m.shop} title={m.title} embed={false} />
        ) : m.trade === "fence" ? (
          <WebFence shop={m.shop} title={m.title} basis={m.basis} askEmail={m.askEmail} choices={m.choices} embed={false} />
        ) : m.trade === "hvac" ? (
          <WebHvac shop={m.shop} title={m.title} basis={m.basis} askEmail={m.askEmail} embed={false} />
        ) : (
          <WebSmart shop={m.shop} title={m.title} basis={m.basis} askEmail={m.askEmail} embed={false} />
        )}
      </div>
    </PriceChrome>
  );
}
