// THE PORTAL'S ESTIMATOR PAGES (2026-10-28, lib/home/portalPrice: "one home portal"). Every estimator a homeowner
// runs — /homeowner/price/<trade> — sits under one bar: JobFlex · Homeowner Portal, the way back to the portal, and
// the switch between the five estimators (./cards) with "Describe it instead" for everything else. The picture
// marks (Pic) are the cards' and the portal box's. Server-safe: plain anchors, no state.
import Link from "next/link";
import { ProductMark } from "@/components/brand/ProductMark";
import { PORTAL_PATH, type PortalTrade } from "@/lib/home/portalPrice";
import { priceCards, type PriceCardKey } from "./cards";
import s from "./price.module.css";

export type { PriceCardKey } from "./cards";

export function Pic({ k }: { k: PriceCardKey }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (k) {
    case "roof":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M4 17 16 6l12 11" />
          <path d="M8 15v11h16V15" />
          <path d="M13 26v-7h6v7" />
        </svg>
      );
    case "deck":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M4 14h24" />
          <path d="M4 20h24" />
          <path d="M8 14v12M16 14v12M24 14v12" />
          <path d="M6 14V8h20v6" />
          <path d="M11 8V5M21 8V5" />
        </svg>
      );
    case "fence":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <path d="M6 10l3-4 3 4v16H6zM14 10l3-4 3 4v16h-6zM22 10l3-4 3 4v16h-6z" />
          <path d="M4 15h24M4 22h24" />
        </svg>
      );
    case "hvac":
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <rect x="5" y="9" width="22" height="14" rx="2" />
          <path d="M9 13h14M9 17h14M12 23v4M20 23v4" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 32 32" {...common}>
          <rect x="5" y="7" width="22" height="18" rx="2" />
          <path d="m5 21 7-7 5 5 4-4 6 6" />
          <circle cx="21" cy="12" r="2" />
        </svg>
      );
  }
}

/** The portal's bar over an estimator (Blueprint, owner 2026-10-30): the mark and its tag, the way back as a plain ink
 *  link, the estimators as tabs under an ink rule; `at` marks the estimator on screen. Every estimator page — the roof
 *  and the four house estimators — sits in the same content column under it. */
export function PriceChrome({ at, house, children }: { at: PortalTrade; house: boolean; children: React.ReactNode }) {
  const cards = priceCards(house).filter((c) => c.live);
  return (
    <div className={s.page} data-portal-price={at}>
      <header className={s.top}>
        <div className={s.topIn}>
          <Link className={s.brand} href={PORTAL_PATH} prefetch={false} aria-label="JobFlex Homeowner portal">
            <ProductMark />
            JobFlex
            <span className={s.portalTag}>Homeowner portal</span>
          </Link>
          <Link className={s.topLink} href={PORTAL_PATH} prefetch={false} data-portal-back>
            Back to the portal
          </Link>
        </div>
        <nav className={s.switch} aria-label="Price another project">
          <div className={s.switchIn}>
            {cards.map((c) => (
              <a key={c.key} className={`${s.sw}${c.trade === at ? ` ${s.swOn}` : ""}`} href={c.href} aria-current={c.trade === at ? "page" : undefined} data-portal-switch={c.trade}>
                <span className={s.swPic}>
                  <Pic k={c.key} />
                </span>
                {c.title}
              </a>
            ))}
            <a className={`${s.sw} ${s.swQuiet}`} href={PORTAL_PATH} data-portal-switch="describe">
              Something else? Describe it
            </a>
          </div>
        </nav>
      </header>
      <main className={s.main}>{children}</main>
    </div>
  );
}

/** The page head every estimator page opens with: the blue kicker, the display H1, one line of lead. */
export function PriceHead({ kicker, title, lede }: { kicker: string; title: string; lede: string }) {
  return (
    <div className={s.head}>
      <p className={s.kicker}>{kicker}</p>
      <h1 className={s.h1}>{title}</h1>
      <p className={s.lede}>{lede}</p>
    </div>
  );
}

/** The step rail: numbered squares with labels — done ink, the step on screen blue. */
export function PriceRail({ steps, at }: { steps: ReadonlyArray<string>; at: number }) {
  return (
    <ol className={s.rail} aria-label="Progress">
      {steps.map((label, i) => (
        <li key={label} className={`${s.railStep}${i < at ? ` ${s.railDone}` : i === at ? ` ${s.railOn}` : ""}`} aria-current={i === at ? "step" : undefined}>
          <span className={s.railSq} aria-hidden="true">{i + 1}</span>
          <span className={s.railLbl}>{label}</span>
          {i < steps.length - 1 ? <span className={s.railLine} aria-hidden="true" /> : null}
        </li>
      ))}
    </ol>
  );
}
