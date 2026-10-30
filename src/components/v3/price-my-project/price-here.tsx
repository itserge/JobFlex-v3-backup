"use client";
// "WHAT ARE YOU PLANNING?" IN THE PORTAL (2026-10-28, lib/home/portalPrice: one home portal, "make it smart"; owner
// 2026-10-30: the row under the box read as a mystery — a plain choice ABOVE the box). Both wizards (desk and phone)
// draw it: PriceChoice over the describe box — the estimators the portal runs as large tiles, each straight into its
// page, the one the words point at ("my roof is 15 years old…") framed and tagged; PriceNudge under the words — one
// line on what that estimator does and the button into it. Whatever they wrote goes with them (lib/home/carry): the
// brief of "any project", the note to the pro on the others. Writing on and pressing Continue still sends the project
// as words, as before.
import type { CSSProperties } from "react";
import { putCarriedWords } from "@/lib/home/carry";
import { PRICE_NUDGE, priceTradeFor, type PortalTrade } from "@/lib/home/portalPrice";
import { TRAFFIC_EVENTS } from "@/lib/traffic-contract";
import { trackTraffic } from "@/lib/traffic-client";
import { priceCards, type PriceCardKey } from "./cards";
import { Pic } from "./price-row";
import s from "./price-here.module.css";

const NAME: Record<PriceCardKey, string> = { roof: "Roof", deck: "Deck", fence: "Fence", hvac: "Heating & cooling", any: "Kitchen, bath & more" };
const HINT: Record<PriceCardKey, string> = {
  roof: "Replace or repair",
  deck: "Design it in 3D",
  fence: "Draw it on your lot",
  hvac: "Furnace, AC, heat pump",
  any: "Any remodel",
};

function useLit(desc: string, house: boolean) {
  const cards = priceCards(house).filter((c) => c.live);
  const hit = priceTradeFor(desc, house);
  const lit = hit ? cards.find((c) => c.trade === hit) ?? null : null;
  const pick = (trade: PortalTrade, via: "nudge" | "tile") => {
    putCarriedWords(desc);
    trackTraffic(TRAFFIC_EVENTS.pricePick, { trade, via });
  };
  return { cards, lit, pick };
}

/** The choice over the describe box: heading, one line, a tile per estimator. */
export function PriceChoice({ desc, house }: { desc: string; house: boolean }) {
  const { cards, lit, pick } = useLit(desc, house);
  return (
    <section className={s.choice} aria-labelledby="price-choice-h" data-price-here={lit ? lit.trade : ""}>
      <h2 className={s.h} id="price-choice-h">What are you planning?</h2>
      <p className={s.sub}>Pick one and we’ll price it in about a minute, or just describe it below.</p>
      <div className={s.tiles} style={{ "--n": cards.length } as CSSProperties}>
        {cards.map((c) => {
          const on = lit?.key === c.key;
          return (
            <a key={c.key} className={`${s.tile}${on ? ` ${s.tileOn}` : ""}`} href={c.href} onClick={() => pick(c.trade, "tile")} data-price-tile={c.trade}>
              <span className={s.pic}>
                <Pic k={c.key} />
              </span>
              <span className={s.name}>{NAME[c.key]}</span>
              <span className={s.hint}>{HINT[c.key]}</span>
              {on ? <span className={s.tag}>Best match</span> : null}
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** Under the words, once they point at an estimator: what it does and the button into it. */
export function PriceNudge({ desc, house }: { desc: string; house: boolean }) {
  const { lit, pick } = useLit(desc, house);
  if (!lit) return null;
  return (
    <div className={s.box}>
      <a className={s.nudge} href={lit.href} onClick={() => pick(lit.trade, "nudge")} data-price-nudge={lit.trade}>
        <span className={s.nudgePic}>
          <Pic k={lit.key} />
        </span>
        <span className={s.nudgeT}>{PRICE_NUDGE[lit.trade].say}</span>
        <span className={s.nudgeGo}>{PRICE_NUDGE[lit.trade].go} →</span>
      </a>
    </div>
  );
}
