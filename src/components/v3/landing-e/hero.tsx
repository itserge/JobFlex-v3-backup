import { preload } from "react-dom";
import { PhoneOverview } from "./blueprint-phone";
import { REGISTER } from "./routes";
import { DashboardMock } from "./dashboard-mock";
import { HeroVisual } from "./hero-visual";
import { DEFAULT_LANDING, type LandingVariant, type LandingVariantKey } from "./landing-variants";
import { Reveal } from "./reveal";
import { HeroEntrance } from "./hero-entrance";
import { HeroExperiment } from "./hero-experiment";
import { HomeownerDoor } from "./homeowner-door";
import { HeroProof } from "./hero-proof";
import "./hero-fit.css";

/* THE ENTRANCE IS ARMED BY THE PAGE, NOT ASSUMED BY THE STYLESHEET
   (2026-10-04). The copy used to be server-rendered invisible and shown by
   hero-entrance once the JavaScript and gsap were in: on a phone on Google's
   mobile profile that was a black first screen for 7–8 s, and three ad
   clicks in four left without a second page. Now the headline, the line and
   the buttons are on screen from the first paint. Only a desk about to play
   the entrance holds them back: this runs as the HTML streams in, ahead of
   the copy, and sets html[data-lp-entrance] when the window is a desk's
   (1024px, a hovering fine pointer) with no reduced-motion preference —
   the one state landing-e.css hides `.lp-enter` under (the headline and
   the button; the film between them is never held). hero-entrance lifts
   it as its motion starts; if that has not happened 1.8 s on, the timer
   here lifts it and the copy simply appears. No JavaScript, a phone, a
   touch screen: never armed, never hidden. */
const ENTRANCE_PRELUDE = `(function(){try{var d=document.documentElement,w=window;if(!w.matchMedia||!w.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)").matches||w.matchMedia("(prefers-reduced-motion: reduce)").matches)return;d.setAttribute("data-lp-entrance","pending");w.__jfEntranceTimer=setTimeout(function(){if(d.getAttribute("data-lp-entrance")==="pending"){d.removeAttribute("data-lp-entrance");if(w.__jfHeroShownAt===undefined)w.__jfHeroShownAt=Math.round(performance.now());}},1800);}catch(e){}})();`;

/* THE FIRST SCREEN ENDS ON THE BUTTON (2026-10-19). Runs as the HTML
   streams in, right after the fold: the headline, the picture and the one
   button, the button a small margin above the screen's foot. What the
   picture may take is the screen less what stands above it and the
   button's row under it:
   - --lp-fit-top: where the picture starts, in page px, with the gap above
     it at its minimum (the gaps grow into whatever height is left over, so
     they must not feed back into the picture's size);
   - --lp-fold-rest: the gap under the picture at its minimum, the button
     and the foot margin.
   hero-fit.css sizes the film's frame from both. A product shot with no
   film (data-fit="shot") is scaled with `zoom` instead (html's
   --lp-fit-zoom — never the element's own style, which React hydrates),
   in one step from its natural height (offsetHeight, which no zoom
   changes): a zoom set from script reaches getBoundingClientRect only on
   the next frame, in Chrome and WebKit alike, so measuring the box after
   setting it read the old size (2026-10-22: the shot shrank to half in
   Chrome and stayed unscaled in WebKit). Then the height still left — on a
   phone where the picture took the column's whole width — goes to the two
   gaps, half each, up to the cap (--lp-fold-gap-max), as html's
   --lp-fold-gap-extra; past the cap it stays under the button, where the
   line under it may show. Again on a resize, at load, and once the fonts
   are in (fonts.ready after load and each loadingdone, re-checked two
   frames on); while fonts are still loading a scale already set is kept.
   Without JavaScript the stylesheet's fallbacks apply. */
const FIT_SCRIPT = `(function(){try{var d=document.documentElement,w=window,q=0,f=document.fonts;function px(v){return parseFloat(v)||0;}function vis(sel){var a=document.querySelectorAll(sel);for(var i=0;i<a.length;i++){if(a[i].getClientRects().length)return a[i];}return null;}function fit(){q=0;var scr=document.querySelector("#hero .lp-fold-screen"),el=vis("#hero [data-fit]"),btn=document.querySelector("#hero [data-cta='hero']");if(!scr||!el||!btn)return;var gaps=scr.querySelectorAll(".lp-fold-gap"),g0=gaps[0],g1=gaps[1],cs=getComputedStyle(scr),min0=g0?px(getComputedStyle(g0).minHeight):0;function extra(){return g0?Math.max(0,g0.getBoundingClientRect().height-min0):0;}var rest=(g1?px(getComputedStyle(g1).minHeight):0)+btn.getBoundingClientRect().height+px(cs.getPropertyValue("--lp-fold-foot"));d.style.setProperty("--lp-fold-rest",Math.round(rest)+"px");var bottom;if(el.getAttribute("data-fit")==="shot"){var r=el.getBoundingClientRect(),nat=el.offsetHeight,room=w.innerHeight-(r.top+w.scrollY-extra())-rest,z=nat>room+0.5?Math.max(0.5,Math.floor(room/nat*1000)/1000):1,had=d.style.getPropertyValue("--lp-fit-zoom");if(z<1)d.style.setProperty("--lp-fit-zoom",String(z));else if(!(had&&f&&f.status!=="loaded"))d.style.removeProperty("--lp-fit-zoom");bottom=r.top+nat*(z<1?z:had&&f&&f.status!=="loaded"?parseFloat(had):1);}else{d.style.setProperty("--lp-fit-top",Math.round(el.getBoundingClientRect().top+w.scrollY-extra())+"px");bottom=el.getBoundingClientRect().bottom;}var slack=w.innerHeight-(bottom+w.scrollY-extra())-rest,cap=Math.max(0,px(cs.getPropertyValue("--lp-fold-gap-max"))-min0),per=Math.max(0,Math.min(cap,Math.floor(slack/2)));d.style.setProperty("--lp-fold-gap-extra",per+"px");}function later(){if(!q)q=requestAnimationFrame(fit);}function settle(){later();requestAnimationFrame(function(){requestAnimationFrame(later);});}function fonts(){if(f&&f.ready)f.ready.then(settle);}fit();w.addEventListener("resize",later);w.addEventListener("load",function(){later();fonts();});fonts();if(f&&f.addEventListener)f.addEventListener("loadingdone",settle);}catch(e){}})();`;

/* The first screen, and the one screen a trade variant may replace.
   THE ORDER (2026-10-19, desk and phone alike): the one-thought headline
   (the variant's `title`; a `?hook=` puts the ad's two lines there), the
   demo film — or, with no film, the product shot — and the one button, the
   three filling the first screen and nothing under them in it; below the
   fold the line under the button. Under the hero: the description with its
   figures, then the reviews (hero-proof.tsx). No Google button here — it
   stays on the register page. */
export function Hero({
  variant = DEFAULT_LANDING,
  variantKey,
  registerHref = REGISTER,
  cta,
  trialCta,
  priceLine = null,
  hook,
}: {
  /** The ad hook the headline shows (`?hook=`), for the demo film's events. */
  hook?: string;
  /** The button's words: the trial — "Start my 7-day FREE TRIAL" on every
   *  landing (owner, 2026-10-16). A trade's own heroCta stays in
   *  landing-variants.ts, unused here, to bring back. */
  trialCta?: string;
  /** The line under the button ("Build your free estimates"); null renders
   *  nothing. The trial's terms are Stripe's page's, never this line's. */
  priceLine?: string | null;
  variant?: LandingVariant;
  /** The variant's key, for the film's events and the homeowner's door. */
  variantKey?: LandingVariantKey;
  registerHref?: string;
  /** landing-e: the first-person CTA replaces the variant's own words. */
  cta?: string;
}) {
  const shot = variant.visual !== "dashboard";
  // An ad landing (landing-variants.ts, 2026-10-04): the homeowner's door under the button.
  const adScreen = shot && !!variant.shotCta;
  const words = trialCta ?? cta ?? variant.primaryCta;
  // The hero plate is the LCP element: preload the one this viewport's CSS
  // will ask for (landing-e.css switches at 860 px). One <link rel="preload">
  // per breakpoint in <head>, with imagesrcset/imagesizes and a media query.
  preload("/landing-d/bg-hero-ridge-800.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-800.webp 800w", imageSizes: "100vw", media: "(max-width: 860px)" });
  preload("/landing-d/bg-hero-ridge-1600.webp", { as: "image", imageSrcSet: "/landing-d/bg-hero-ridge-1600.webp 1600w", imageSizes: "100vw", media: "(min-width: 861px)" });
  return (
    <>
    <section id="hero" className="lp-hero">
      <div className="lp-bg lp-bg--ridge" aria-hidden />
      <div className="lp-fold relative z-[1] mx-auto max-w-[86rem] px-5 text-center sm:px-6">
        {/* The entrance (pass C): H1 lines out of a mask, the button +250 ms
            — hero-entrance.tsx, on a desk the prelude has armed. `.lp-enter`
            marks the two blocks; they are hidden only under
            html[data-lp-entrance] (ENTRANCE_PRELUDE above). */}
        <script dangerouslySetInnerHTML={{ __html: ENTRANCE_PRELUDE }} />
        <HeroEntrance>
        {/* The first screen: the headline, the picture, the button — and the
            two gaps between them share out the height left over, so the
            button stands a small margin above the screen's foot. */}
        <div className="lp-fold-screen">
          {/* A/B landing_hero_v1 (scaffold, not running): the headline block
              is the experiment's slot, on the default hero only — a trade
              variant is its own page and is never bucketed. */}
          <HeroExperiment enabled={!variantKey}>
          <h1 className={`lp-enter lp-fold-h1${variant.title ? "" : " lp-h1--lines"}`} data-entrance="h1">
            {variant.title ?? (
              <>
                {variant.h1[0]}
                <br />
                {variant.h1[1]}
              </>
            )}
          </h1>
          </HeroExperiment>
          <div className="lp-fold-gap" aria-hidden />
          {/* Two builds of the same screen, not one build clipped: the desktop
              plate's 208px sidebar and four-across KPI row cannot survive a
              phone column (owner, 2026-08-25). An estimator shot or a film is
              one build for both, each copy switched by the same 640 px. */}
          <div className="lp-fold-vis">
            <Reveal shown className="sm:hidden">
              {variant.film ? (
                <HeroVisual variant={variant} slot="phone" hook={hook} landing={variantKey} />
              ) : (
                <div data-fit="shot">{shot ? <HeroVisual variant={variant} slot="phone" hook={hook} landing={variantKey} /> : <PhoneOverview />}</div>
              )}
            </Reveal>
            <div className="mx-auto hidden lp-wrap sm:block">
              <Reveal shown>
                {variant.film ? (
                  <HeroVisual variant={variant} slot="desk" hook={hook} landing={variantKey} />
                ) : (
                  <div data-fit="shot">{shot ? <HeroVisual variant={variant} slot="desk" hook={hook} landing={variantKey} /> : <DashboardMock />}</div>
                )}
              </Reveal>
            </div>
          </div>
          <div className="lp-fold-gap" aria-hidden />
          {/* The one button, a thumb wide on a phone. */}
          <div className="lp-enter lp-fold-cta" data-entrance="cta">
            <a href={registerHref} className={`lp-btn-dark lp-cta lp-cta--solid lp-trial-cta${words.length > 30 ? " lp-cta--long" : ""}`} data-cta="hero">
              {words}
            </a>
          </div>
          {/* The page's line (landing-e-page.tsx) and the homeowner who
              clicked a contractor ad, sent where they belong. */}
          <div className="lp-fold-after">
            {priceLine ? <p className="lp-hero-price">{priceLine}</p> : null}
            {adScreen ? <HomeownerDoor trade={variantKey} /> : null}
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: FIT_SCRIPT }} />
        </HeroEntrance>
      </div>
    </section>
    <HeroProof variant={variant} />
    </>
  );
}
