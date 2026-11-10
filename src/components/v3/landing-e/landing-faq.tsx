"use client";

import { useTrialOffer } from "@/components/providers/trial-offer";
import { useState } from "react";
import type { LandingVariantKey } from "./landing-variants";
import { Reveal } from "./reveal";
import "./pricing-faq.css";

/* Six questions (CRO stage 2, 2026-09-09). The fourth is the trade's: the
   roofing and fencing heroes promise a measurement, so they get "where do
   the figures come from" (aerial data, never a provider's name); every other
   trade gets how a description is priced.
   FAQ CARDS (owner, 2026-09-26): Blueprint cards — white, 2px ink frame, hard
   ink offset — that show only the question. Hover (or keyboard focus) turns
   the card to ink with the answer in white; with no hover (a phone) a tap
   toggles it. The question layer and the answer layer share ONE grid cell,
   so the card is always as tall as its answer and nothing moves when it
   opens (pricing-faq.css, .lp-faq-*). The wipe is a calm 0.4s (2026-09-26).
   On a phone (≤768px) the six cards are a two-row swipe carousel, three
   columns of two, with the next column showing at the right edge. */
type Faq = { q: string; a: string };

const DATA_Q: Record<"roofing" | "fencing" | "hvac" | "other", Faq> = {
  roofing: {
    q: "Where do the roof figures come from?",
    a: "From aerial data for the address: area, pitch and each structure are measured from above, and the report says which figures were measured and which were reported.",
  },
  fencing: {
    q: "Where do the fence figures come from?",
    a: "The lot lines come from the parcel record and the grade from terrain data; the run is the line you draw on the map, and the takeoff follows it.",
  },
  // HVAC (2026-10-01): the hero promises a load and a rebate list.
  hvac: {
    q: "Where do the HVAC figures come from?",
    a: "The design day comes from the county, the load from the house's size, era and ducts, and the heat pump is sized to the Manual S window. Incentives are listed with the dates they open and close, so a proposal never quotes a rebate that is not live.",
  },
  other: {
    q: "How is an estimate priced from a description?",
    a: "You type the job the way you would say it to a foreman; the estimator turns it into line items with your trade's units and current material and labor prices, and you adjust anything before it goes out.",
  },
};

/* The card question, by signupTrialMode (lib/trialPolicyServer). */
const cardQuestions = (days: number): Record<"card" | "cardless", Faq> => ({
  card: {
    q: "Do I need a credit card to start?",
    a: `Yes. A card is required to start your ${days}-day free trial. Your selected plan renews automatically at the disclosed price when the trial ends unless you cancel from the Subscription page first.`,
  },
  cardless: {
    q: "Do I need a credit card to start?",
    a: `No. Confirm your email to start your ${days}-day free trial. Add a card before it ends to keep your plan; without one your account moves to the free plan, your work stays and nothing is charged.`,
  },
});

function questions(variant: LandingVariantKey | undefined, requiresCard: boolean, days: number): Faq[] {
  const CARD_Q = cardQuestions(days);
  const data = variant === "roofing" || variant === "fencing" || variant === "hvac" ? DATA_Q[variant] : DATA_Q.other;
  return [
    requiresCard ? CARD_Q.card : CARD_Q.cardless,
    {
      q: "How long does it take to learn?",
      a: "Most shops send their first proposal the same day. Type the job, the estimate writes itself, and the calendar and invoices follow from it.",
    },
    {
      q: "My trade isn't in the list.",
      a: "Pick the closest one and name yours under Other. Templates, units and lead matching follow the trade you type.",
    },
    data,
    {
      q: `What happens after ${days} days?`,
      a: requiresCard ? "Your selected plan renews automatically at the price and billing interval shown in checkout unless you cancel before the trial ends. Cancel anytime from the Subscription page: you keep the plan to the end of the period you've paid for, then your account moves to the free plan — no more charges, and your work stays." : "With a card added, your selected plan starts billing at the disclosed price when the trial ends. Without a card, nothing is charged: your account moves to the free plan and your work stays.",
    },
    {
      q: "Does it work from my phone?",
      a: "Yes. The whole app runs in the phone's browser, crews included; there is nothing to install.",
    },
  ];
}

export function LandingFaq({ variant, registerHref = "/auth/register", cta = "Start my free trial", requiresCard = true }: { variant?: LandingVariantKey; registerHref?: string; cta?: string; requiresCard?: boolean }) {
  const { days } = useTrialOffer();
  const items = questions(variant, requiresCard, days);
  /* Opened by a click, a tap, Enter or Space; each card on its own. Hover and
     keyboard focus only SHOW the answer (CSS); this set is what aria-expanded
     reports and what keeps an answer up on a touch screen. */
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  return (
    <section id="faq" className="relative overflow-hidden bg-lp-paper px-5 py-[8vmin] sm:px-6">
      <div className="mx-auto lp-wrap">
        <Reveal>
          <h2 className="lp-sec-title">FAQ</h2>
          <p className="lp-sec-lede">The six things every shop asks first.</p>
        </Reveal>
        {/* lp-faq-rail: on a phone the grid is a two-row swipe carousel
            that runs edge to edge (pricing-faq.css). */}
        <Reveal delay={120} className="lp-faq-rail mt-9 sm:mt-11">
          <div className="lp-faq-grid">
            {items.map((item, i) => {
              const isOpen = open.has(i);
              return (
                <div key={item.q} className={"lp-faq-card" + (isOpen ? " is-open" : "")}>
                  <button
                    type="button"
                    id={`faq-q-${i}`}
                    className="lp-faq-q"
                    aria-expanded={isOpen}
                    aria-controls={`faq-a-${i}`}
                    onClick={() => toggle(i)}
                  >
                    <span className="lp-faq-q-text">{item.q}</span>
                    <span className="lp-faq-hint" aria-hidden>
                      <span className="lp-faq-mark">
                        <svg viewBox="0 0 24 24">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </span>
                      <span className="lp-faq-hint-hover">Hover for the answer</span>
                      <span className="lp-faq-hint-tap">Tap for the answer</span>
                    </span>
                  </button>
                  <div id={`faq-a-${i}`} className="lp-faq-a" aria-hidden={!isOpen}>
                    <p className="lp-faq-a-q" aria-hidden>
                      {item.q}
                    </p>
                    <p className="lp-faq-a-text">{item.a}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
        {/* The section's CTA (pass B). */}
        <Reveal delay={160} className="mt-10 sm:mt-12">
          <a href={registerHref} className="lp-btn-lime w-full sm:w-auto" data-cta="faq">
            {cta}
            <span aria-hidden>→</span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}
