"use client";
// LINKS FOR YOUR ADS (2026-09-29, AVACO's TrackingLinks brought over): the
// link to put in each ad or post, so the platform cards, the live map and
// the reports can tell every platform, campaign and ad apart. Meta and
// TikTok fill in the platform, campaign and ad names themselves when their
// "URL parameters" field gets these placeholders; Google's ValueTrack fills
// the campaign and creative ids; X does not fill anything in. The link can
// open the landing on a trade's own hero (`?industry=`), which the signup
// remembers as landingIndustry. A trade with ad hooks (roofing, 2026-10-04 —
// landing-variants LANDING_HOOKS) can also open on the ad's own opening line
// as the headline (`&hook=`), so the page continues the ad's sentence.
import { useState } from "react";
import { VARIANT_KEYS, VARIANT_TRADE, hooksOf, resolveLandingVariant, type LandingVariantKey } from "@/components/v3/landing-e/landing-variants";
import { SPOTLIGHT, SPOTLIGHT_TOOLS, TOOLS_AD, TOOLS_AD_KEYS, spotlightFromTrade, type ToolsAdKey } from "@/lib/planSpotlight";
import s from "./traffic.module.css";

type Kind = "meta" | "tiktok" | "google" | "x" | "organic";
const PRESETS: Record<Kind, { label: string; params: (campaign: string, platform: string) => string; note: string; fills: boolean }> = {
  meta: {
    label: "Facebook & Instagram ads (Meta)",
    params: () => "utm_source={{site_source_name}}&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}}",
    note: "In Ads Manager, paste the parameters into the ad's \"URL parameters\" field and use the plain address as the website. Meta fills in fb or ig, so Facebook and Instagram are counted apart, with each campaign and ad by name.",
    fills: true,
  },
  tiktok: {
    label: "TikTok ads",
    params: () => "utm_source=tiktok&utm_medium=paid&utm_campaign=__CAMPAIGN_NAME__&utm_content=__CID_NAME__",
    note: "In TikTok Ads Manager, paste the parameters into \"URL parameters\" (or add them to the destination URL). TikTok fills in the campaign and ad names.",
    fills: true,
  },
  google: {
    label: "Google Ads",
    params: (campaign) => `utm_source=google&utm_medium=cpc&utm_campaign=${campaign || "{campaignid}"}&utm_content={creative}&utm_term={keyword}`,
    note: "In Google Ads, paste the parameters into the campaign's \"Final URL suffix\" (Settings → Additional settings → Campaign URL options) and keep auto-tagging on. Google fills in the creative and keyword; type the campaign's name above or let {campaignid} stand in.",
    fills: true,
  },
  x: {
    label: "X (Twitter) ads",
    params: (campaign) => `utm_source=x&utm_medium=paid&utm_campaign=${campaign || "campaign-name"}`,
    note: "X doesn't fill names in: type the campaign's name above, and use this full link as the ad's website URL.",
    fills: false,
  },
  organic: {
    label: "Posts, stories and bio links (not paid)",
    params: (campaign, platform) => `utm_source=${platform}&utm_medium=social&utm_campaign=${campaign || "post-name"}`,
    note: "For your own posts and profile links: these count as organic, apart from the ads.",
    fills: false,
  },
};
const slug = (v: string) => v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const PAGES: Array<[string, string]> = [["/", "Landing page"], ["/auth/register", "Straight to sign-up"], ["/pricing", "Pricing"], ["/homeowner", "Homeowner page"]];
/** The trade's own name ("HVAC", "Kitchen & Bath"), not its slug title-cased ("Hvac"). */
const heroName = (key: string) => VARIANT_TRADE[key as LandingVariantKey] ?? key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function AdLinks({ origin = "https://www.jobflex.app" }: { origin?: string }) {
  const [kind, setKind] = useState<Kind>("meta");
  const [campaign, setCampaign] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [page, setPage] = useState("/");
  const [industry, setIndustry] = useState("");
  const [hook, setHook] = useState("");
  // THE TOOL THE AD SELLS (lib/planSpotlight, 2026-10-14): `&tool=` on the link,
  // and the plan cards pin and mark that tool for everyone who clicks it. A
  // trade hero already means its own estimator; the picker is for the ads
  // for Smart Proposal, blueprints, the AI desk and Deck Studio.
  const [tool, setTool] = useState("");
  // THE NEW PLANS' KEYS (Base + Tools, part 5): video, texting, crm, operator, home-builder, remodeler. They price the
  // plan cards with their tool only while the Plans switch is on (Admin → Trial watch); a Classic card reads them as
  // no tool (lib/planSpotlight parseAdTool).
  const newKey = (TOOLS_AD_KEYS as readonly string[]).includes(tool) ? (tool as ToolsAdKey) : null;
  const toolLabel = newKey ? TOOLS_AD[newKey].label : tool && tool in SPOTLIGHT ? SPOTLIGHT[tool as keyof typeof SPOTLIGHT].label : null;
  const [copied, setCopied] = useState<string | null>(null);
  const preset = PRESETS[kind];
  const params = preset.params(slug(campaign), platform);
  // The opening lines this trade's landing knows; a hook picked for one trade
  // does not follow the link to another.
  const hooks = page === "/" ? hooksOf(resolveLandingVariant(industry)) : [];
  const hookOn = hooks.find((x) => x.key === hook) ?? null;
  const toolQ = tool ? `tool=${tool}` : "";
  const heroQ = industry && page === "/" ? `industry=${industry}${hookOn ? `&hook=${hookOn.key}` : ""}` : "";
  const base = `${origin.replace(/\/$/, "")}${page}${heroQ || toolQ ? `?${[heroQ, toolQ].filter(Boolean).join("&")}` : ""}`;
  const full = `${base}${base.includes("?") ? "&" : "?"}${params}`;
  const copy = async (text: string, which: string) => { try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1600); } catch { /* select and copy by hand */ } };

  return (
    <section className={s.card} aria-label="Links for your ads">
      <div className={s.cardHead}><div><h2>Links for your ads</h2><span className={s.micro}>Use one in every ad and post, so the platform cards above and every campaign and ad are told apart</span></div><span className={s.stamp}>Copy and paste</span></div>
      <div className={s.exploreBody}>
        <div className={s.dimensionTabs} role="group" aria-label="Where the link goes">
          {(Object.keys(PRESETS) as Kind[]).map((k) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{PRESETS[k].label}</button>)}
        </div>
        <div className={s.linksForm}>
          <label className={s.filterLabel}><span>Page it opens</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" value={page} onChange={(e) => setPage(e.target.value)}>{PAGES.map(([p, name]) => <option key={p} value={p}>{name}</option>)}</select></div></label>
          {page === "/" && <label className={s.filterLabel}><span>Trade hero on the landing</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="">Default (every trade)</option>{VARIANT_KEYS.map((k) => <option key={k} value={k}>{heroName(k)}</option>)}</select></div></label>}
          <label className={s.filterLabel}><span>The tool the ad sells</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" data-testid="ad-tool" value={tool} onChange={(e) => setTool(e.target.value)}><option value="">{industry && spotlightFromTrade(industry) ? `— the ${SPOTLIGHT[spotlightFromTrade(industry)!].label} (the trade hero's own) —` : "— none —"}</option><optgroup label="Today's plans and the new plans">{SPOTLIGHT_TOOLS.map((k) => <option key={k} value={k}>{SPOTLIGHT[k].label}</option>)}</optgroup><optgroup label="New plans only (Base + Tools)">{TOOLS_AD_KEYS.map((k) => <option key={k} value={k}>{TOOLS_AD[k].label}</option>)}</optgroup></select></div></label>
          {hooks.length > 0 && <label className={s.filterLabel}><span>Headline: the ad&apos;s opening line</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" data-testid="ad-link-hook" value={hookOn?.key ?? ""} onChange={(e) => setHook(e.target.value)}><option value="">The trade&apos;s own headline</option>{hooks.map((x) => <option key={x.key} value={x.key}>{x.h1.join(" ")} — {x.ad}</option>)}</select></div></label>}
          {(kind === "x" || kind === "google" || kind === "organic") && <label className={s.filterLabel}><span>Campaign name</span><input className={s.linksInput} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="october-roofers"/></label>}
          {kind === "organic" && <label className={s.filterLabel}><span>Platform</span><div className={`bp-sel ${s.selectWrap}`}><select className="bp-sel-in" value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="instagram">Instagram</option><option value="facebook">Facebook</option><option value="tiktok">TikTok</option><option value="x">X (Twitter)</option><option value="youtube">YouTube</option><option value="linkedin">LinkedIn</option><option value="nextdoor">Nextdoor</option></select></div></label>}
        </div>
        {preset.fills && <>
          <div className={s.linksRow}><span>Website address</span><code data-testid="ad-link-base">{base}</code><button type="button" className={s.button} onClick={() => copy(base, "base")}>{copied === "base" ? "Copied" : "Copy"}</button></div>
          <div className={s.linksRow}><span>URL parameters</span><code data-testid="ad-link-params">{params}</code><button type="button" className={s.primary} onClick={() => copy(params, "params")}>{copied === "params" ? "Copied" : "Copy"}</button></div>
        </>}
        <div className={s.linksRow}><span>{preset.fills ? "Or the full link in one" : "Link"}</span><code data-testid="ad-link-full">{full}</code><button type="button" className={preset.fills ? s.button : s.primary} onClick={() => copy(full, "full")}>{copied === "full" ? "Copied" : "Copy"}</button></div>
        <p className={s.footnote}>{preset.note}{industry && page === "/" ? ` The link opens the landing on the ${heroName(industry)} hero; the signup remembers it as its landing trade.` : ""}{newKey ? ` With the Plans switch on, this link opens the new plans priced with the ${toolLabel} as the main tool, and the sign-up starts on Professional + ${toolLabel}. With it off, the plan cards show as they are, with no tool marked.` : toolLabel ? ` Every plan card marks the ${toolLabel} for whoever clicks this link — on the landing, at sign-up and on the Subscription page.` : ""}{hookOn ? ` Its headline is the ad's own opening line — “${hookOn.h1.join(" ")}” — with the ad's next line under it; pick the line the ad really opens on.` : hooks.length ? " Pick the ad's opening line and the page's headline continues it." : ""}</p>
      </div>
    </section>
  );
}
