"use client";

// ADMIN · PRICING PLANS — the page.
// Route: /admin/plans. Renders ONLY the shell's `.content` children, as a
// fragment, so the reveal cascade walks `.content > *`.
//
// The plan catalog is the single source of truth for every plan surface
// (pricing page, subscription page, checkout, limits). Writes go through the
// existing upsertPricingPlan / deletePricingPlan (src/actions/admin.ts) and
// syncPlanToStripe (src/actions/plans.ts); the promo-code active flag through
// setPromoActive (src/actions/influencers.ts). Promo codes are created on the
// Influencers page — this card only lists and toggles them.

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, RefreshCw, ArrowUpRight } from "lucide-react";
import { toast } from "@/components/ui/Toast";
import { money } from "@/lib/format";
import { upsertPricingPlan, deletePricingPlan, setCustomPlanTrial } from "@/actions/admin";
import { syncPlanToStripe } from "@/actions/plans";
import { setPromoActive } from "@/actions/influencers";
import { LIMIT_DEFS, DEFAULT_FREE_LIMITS, PAID_CALL_KEYS, UNLIMITED, isUnlimited, type PlanLimits, type LimitKey } from "@/lib/planLimits";
import shared from "@/components/v3/admin-users/admin-shared.module.css";
import {
  makeCx,
  KIT_BTN_CLASS,
  useSheet,
  Sheet,
  SheetBody,
  SheetFoot,
  Field,
  Toggle,
  Note,
  errorMessage,
} from "@/components/v3/admin-users/admin-kit";
import { useAdminMotion } from "@/components/v3/admin-users/use-admin-motion";
import { StripeModeSwitch } from "@/components/v3/admin-integrations/integrations-content";
import s from "./admin-plans.module.css";

const cx = makeCx(s, shared);

export interface HydratedPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceCents: number;
  yearlyPriceCents: number | null;
  trialDays: number;
  interval: string;
  order: number;
  features: string[];
  /** Numeric caps keyed by LimitKey; a missing key means unlimited. */
  limits: PlanLimits;
  active: boolean;
  highlight: boolean;
}

/** The custom plan, which has no PricingPlan row: its price is computed from
 *  the pages a shop ticks (lib/customPlan), so only the trial is editable. */
export interface CustomPlanDTO {
  trialDays: number;
  baseCents: number;
  pageCents: number;
  /** Add-on page labels, for the card's "what can be bought" line. */
  pages: string[];
}

export interface SyncedInfo {
  monthly: boolean;
  yearly: boolean;
}

export interface PromoDTO {
  id: string;
  code: string;
  influencerName: string;
  customerPercentOff: number | null;
  /** describeCommission() output, e.g. "20% · 12 months". */
  commission: string;
  active: boolean;
  clicks: number;
}

const BLANK: HydratedPlan = {
  id: "",
  slug: "",
  name: "",
  description: "",
  priceCents: 0,
  yearlyPriceCents: null,
  trialDays: 0,
  interval: "month",
  order: 0,
  features: [],
  limits: {},
  active: true,
  highlight: false,
};

/** The limits grid, grouped the way the owner reads them. Every LimitKey appears once. */
const LIMIT_GROUPS: Array<{ title: string; keys: LimitKey[] }> = [
  { title: "Proposals", keys: ["proposalsCreated", "proposalsAccepted", "proposalsCompleted"] },
  { title: "Estimates", keys: ["estimatorUses", "hvacEstimates"] },
  { title: "Paid lookups", keys: ["roofMeasurements", "manualJReports"] },
  { title: "Clients", keys: ["clients"] },
  { title: "Leads", keys: ["leads"] },
  { title: "Projects & schedules", keys: ["projects", "calendarCards", "calendarEvents"] },
  { title: "Jobs & crew", keys: ["jobs", "workers", "teamSeats", "managers"] },
  { title: "Comms", keys: ["conversationsStarted", "messagesSent", "aiPhoneCalls", "reviewRequests"] },
  { title: "Assistant", keys: ["assistantCommands"] },
];
const DEF_BY_KEY = new Map(LIMIT_DEFS.map((d) => [d.key, d]));

/** Dollars (number) → integer cents, rounded to avoid float drift (29.99 → 2999). */
function dollarsToCents(dollars: number): number {
  return Math.round((Number.isFinite(dollars) ? dollars : 0) * 100);
}
function centsToText(cents: number | null): string {
  if (cents == null) return "";
  const d = cents / 100;
  return Number.isInteger(d) ? String(d) : d.toFixed(2);
}

/** Annual savings vs paying monthly, as a whole percent (0 when no yearly price). */
function yearlySavingsPct(monthlyCents: number, yearlyCents: number | null): number {
  if (!yearlyCents || monthlyCents <= 0) return 0;
  const full = monthlyCents * 12;
  if (yearlyCents >= full) return 0;
  return Math.round(((full - yearlyCents) / full) * 100);
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capCount(limits: PlanLimits): { caps: number; unlimited: number } {
  const caps = LIMIT_DEFS.filter((d) => !isUnlimited(limits[d.key])).length;
  return { caps, unlimited: LIMIT_DEFS.length - caps };
}

export function AdminPlansContent({
  plans,
  synced,
  stripeEnabled,
  promos,
  customPlan,
  stripeMode,
  stripeModes,
}: {
  plans: HydratedPlan[];
  synced: Record<string, SyncedInfo>;
  stripeEnabled: boolean;
  promos: PromoDTO[];
  /** The pay-per-page plan. Listed beside the catalog, edited on its own. */
  customPlan: CustomPlanDTO;
  /** The live/sandbox payments switch — same control /admin/integrations has. */
  stripeMode: "live" | "test";
  stripeModes: { live: boolean; test: boolean };
}) {
  useAdminMotion(KIT_BTN_CLASS);
  const router = useRouter();

  const [editing, setEditing] = useState<HydratedPlan | null>(null);
  const [deleting, setDeleting] = useState<HydratedPlan | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const editSheet = useSheet();
  const delSheet = useSheet();
  const customSheet = useSheet();
  const [customTrial, setCustomTrial] = useState(String(customPlan.trialDays));
  const [customBusy, setCustomBusy] = useState(false);
  const [customErr, setCustomErr] = useState<string | null>(null);

  const openEditor = useCallback(
    (p: HydratedPlan) => {
      setEditing(p);
      editSheet.open();
    },
    [editSheet],
  );
  const closeEditor = useCallback(() => editSheet.close(() => setEditing(null)), [editSheet]);

  const openDelete = useCallback(
    (p: HydratedPlan) => {
      setDeleting(p);
      setDeleteErr(null);
      delSheet.open();
    },
    [delSheet],
  );
  const closeDelete = useCallback(() => delSheet.close(() => setDeleting(null)), [delSheet]);

  function openCustom() {
    setCustomTrial(String(customPlan.trialDays));
    setCustomErr(null);
    customSheet.open();
  }

  async function saveCustom() {
    if (customBusy) return;
    setCustomBusy(true);
    setCustomErr(null);
    try {
      const res = await setCustomPlanTrial(Number(customTrial));
      toast.success(
        "Custom plan saved",
        res.trialDays > 0 ? `${res.trialDays}-day trial at checkout.` : "No trial — charged immediately.",
      );
      router.refresh();
      customSheet.close();
    } catch (e) {
      setCustomErr(errorMessage(e, "Couldn't save."));
    } finally {
      setCustomBusy(false);
    }
  }

  async function save(p: HydratedPlan) {
    const res = await upsertPricingPlan({
      id: p.id || undefined,
      slug: p.slug,
      name: p.name,
      description: p.description,
      priceCents: p.priceCents,
      yearlyPriceCents: p.yearlyPriceCents,
      trialDays: p.trialDays,
      interval: p.interval as "month" | "year",
      order: p.order,
      features: p.features,
      limits: p.limits,
      active: p.active,
      highlight: p.highlight,
    });
    if (res?.syncWarning) {
      setWarning(res.syncWarning);
      toast.error("Saved — Stripe not synced", res.syncWarning);
    } else {
      setWarning(null);
      toast.success("Saved", "Live on every plan surface.");
    }
    router.refresh();
    closeEditor();
  }

  async function confirmDelete() {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteErr(null);
    try {
      await deletePricingPlan(deleting.id);
      toast.success("Plan deleted", deleting.name);
      router.refresh();
      closeDelete();
    } catch (e) {
      // The action refuses when subscribers are on the plan — that message is
      // the point of this dialog, so it stays in the box.
      setDeleteErr(errorMessage(e, "Couldn't delete."));
    } finally {
      setDeleteBusy(false);
    }
  }

  async function sync(p: HydratedPlan) {
    setSyncingId(p.id);
    try {
      await syncPlanToStripe(p.id);
      setWarning(null);
      toast.success("Synced to Stripe", `${p.name}: products and prices are current.`);
      router.refresh();
    } catch (e) {
      toast.error("Sync failed", errorMessage(e));
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <>
      <div className={cx("page-head")}>
        <div>
          <div className={cx("kicker")}>Platform · Catalog</div>
          <h1 className={cx("page-title")}>Pricing plans</h1>
        </div>
        <div className={cx("page-actions")}>
          <button type="button" className={cx("btn", "btn-primary")} onClick={() => openEditor({ ...BLANK })}>
            <Plus className={cx("ic")} aria-hidden="true" />
            New plan
          </button>
        </div>
      </div>

      {/* WHERE THESE PLANS CHARGE — the same live/sandbox switch
          /admin/integrations owns, one SyncState row behind both. Mounted here
          too because "which account does checkout hit" is a question asked
          while editing plans (owner's call, 2026-08-31). */}
      <StripeModeSwitch mode={stripeMode} modes={stripeModes} />

      {warning ? <Note>{warning}</Note> : null}
      {!stripeEnabled ? (
        <Note>
          Stripe isn&rsquo;t configured — set <b>STRIPE_SECRET_KEY</b> to sync plans and take checkout. Saving still
          updates every plan surface.
        </Note>
      ) : null}

      {plans.length === 0 ? (
        <div className={cx("pl-empty")}>No plans in the catalog.</div>
      ) : (
        <div className={cx("pl-grid")}>
          {plans.map((p) => {
            const savings = yearlySavingsPct(p.priceCents, p.yearlyPriceCents);
            const sx = synced[p.slug];
            const isSynced = !!sx && sx.monthly && (p.yearlyPriceCents == null || p.yearlyPriceCents === 0 || sx.yearly);
            const { caps, unlimited } = capCount(p.limits);
            const capped = LIMIT_DEFS.filter((d) => !isUnlimited(p.limits[d.key]));
            return (
              <article key={p.id} className={cx("pl-card", !p.active && "pl-card--off")} aria-label={p.name}>
                <div className={cx("pl-head")}>
                  <div className={cx("pl-titles")}>
                    <div className={cx("pl-name")}>{p.name}</div>
                    <div className={cx("pl-slug")}>
                      {p.slug} · №{p.order}
                    </div>
                  </div>
                  <div className={cx("pl-plates")}>
                    {p.highlight ? <span className={cx("stamp", "stamp--bp")}>Most popular</span> : null}
                    {!p.active ? <span className={cx("st")}>Inactive</span> : null}
                    {p.priceCents > 0 || (p.yearlyPriceCents ?? 0) > 0 ? (
                      isSynced ? (
                        <span className={cx("st", "st--ok")}>Synced</span>
                      ) : (
                        <span className={cx("st", "st--warn")}>Not synced</span>
                      )
                    ) : (
                      <span className={cx("st")}>Free</span>
                    )}
                  </div>
                </div>

                <div className={cx("pl-strip")}>
                  <div className={cx("pl-price")}>
                    <span className={cx("pl-amt")}>{money(p.priceCents / 100)}</span>
                    <span className={cx("pl-per")}>/mo</span>
                  </div>
                  <div className={cx("pl-price", "pl-price--yr")}>
                    {p.yearlyPriceCents ? (
                      <>
                        <span className={cx("pl-amt")}>{money(p.yearlyPriceCents / 100)}</span>
                        <span className={cx("pl-per")}>/yr</span>
                        {savings > 0 ? <span className={cx("pl-save")}>save {savings}%</span> : null}
                      </>
                    ) : (
                      <span className={cx("pl-none")}>no yearly price</span>
                    )}
                  </div>
                  <div className={cx("pl-tags")}>
                    {p.trialDays > 0 ? <span className={cx("tag")}>{p.trialDays}-day trial</span> : null}
                    <span className={cx("tag")}>
                      {caps} caps · {unlimited} ∞
                    </span>
                  </div>
                </div>

                <div className={cx("pl-body")}>
                  {p.description ? <p className={cx("pl-desc")}>{p.description}</p> : null}
                  {p.features.length > 0 ? (
                    <ul className={cx("pl-feats")}>
                      {p.features.slice(0, 5).map((f, i) => (
                        <li key={`${i}-${f}`}>{f}</li>
                      ))}
                      {p.features.length > 5 ? (
                        <li className={cx("pl-more")}>+{p.features.length - 5} more</li>
                      ) : null}
                    </ul>
                  ) : null}
                  <dl className={cx("pl-ledger")}>
                    {capped.slice(0, 6).map((d) => (
                      <div key={d.key} className={cx("pl-led")}>
                        <dt>{d.label}</dt>
                        <span className={cx("pl-led-lead")} aria-hidden="true" />
                        <dd>
                          {p.limits[d.key]}
                          {d.scope === "monthly" ? " / cycle" : ""}
                        </dd>
                      </div>
                    ))}
                    {capped.length > 6 ? (
                      <div className={cx("pl-led-all")}>+{capped.length - 6} more caps</div>
                    ) : null}
                    <div className={cx("pl-led-all")}>
                      {capped.length === 0 ? "Every limit unlimited" : "Everything else · unlimited"}
                    </div>
                  </dl>
                </div>

                <div className={cx("pl-foot")}>
                  <button type="button" className={cx("btn", "btn-sm", "btn-ghost")} onClick={() => openEditor(p)}>
                    <Pencil className={cx("ic")} aria-hidden="true" />
                    Edit
                  </button>
                  <button
                    type="button"
                    className={cx("btn", "btn-sm", "btn-ghost")}
                    disabled={!stripeEnabled || syncingId === p.id}
                    title={stripeEnabled ? "Create or update the Stripe product and prices" : "Connect Stripe first"}
                    onClick={() => sync(p)}
                  >
                    <RefreshCw className={cx("ic")} aria-hidden="true" />
                    {syncingId === p.id ? "Syncing…" : isSynced ? "Re-sync" : "Sync to Stripe"}
                  </button>
                  <span className={cx("pl-foot-gap")} />
                  <button
                    type="button"
                    className={cx("btn", "btn-sm", "btn-quiet", "btn-danger", "pl-del")}
                    aria-label={`Delete ${p.name}`}
                    onClick={() => openDelete(p)}
                  >
                    <Trash2 className={cx("ic")} aria-hidden="true" />
                  </button>
                </div>
              </article>
            );
          })}

          {/* THE CUSTOM PLAN — sold on every plan surface but not a catalog
              row: the price is the base plus whatever pages the shop ticks,
              so there is no fixed priceCents to store. Listed here because
              "which plans do we sell, and on what trial" is asked in one
              place (owner, 2026-09-05). */}
          <article className={cx("pl-card")} aria-label="Custom plan">
            <div className={cx("pl-head")}>
              <div className={cx("pl-titles")}>
                <div className={cx("pl-name")}>Custom</div>
                <div className={cx("pl-slug")}>custom · pay per page</div>
              </div>
              <div className={cx("pl-plates")}>
                <span className={cx("st", "st--ok")}>Always on</span>
              </div>
            </div>

            <div className={cx("pl-strip")}>
              <div className={cx("pl-price")}>
                <span className={cx("pl-amt")}>{money(customPlan.baseCents / 100)}</span>
                <span className={cx("pl-per")}>/mo base</span>
              </div>
              <div className={cx("pl-price", "pl-price--yr")}>
                <span className={cx("pl-amt")}>{money(customPlan.pageCents / 100)}</span>
                <span className={cx("pl-per")}>per page</span>
              </div>
              <div className={cx("pl-tags")}>
                {customPlan.trialDays > 0 ? (
                  <span className={cx("tag")}>{customPlan.trialDays}-day trial</span>
                ) : (
                  <span className={cx("tag")}>No trial</span>
                )}
                <span className={cx("tag")}>{customPlan.pages.length} add-on pages</span>
              </div>
            </div>

            <div className={cx("pl-body")}>
              <p className={cx("pl-desc")}>
                The everyday workspace, plus only the pages a shop picks. Priced at checkout from the
                selection, so it carries no fixed price and no Stripe product of its own.
              </p>
              <ul className={cx("pl-feats")}>
                {customPlan.pages.slice(0, 5).map((label) => (
                  <li key={label}>{label}</li>
                ))}
                {customPlan.pages.length > 5 ? (
                  <li className={cx("pl-more")}>+{customPlan.pages.length - 5} more</li>
                ) : null}
              </ul>
              <dl className={cx("pl-ledger")}>
                <div className={cx("pl-led")}>
                  <dt>Range</dt>
                  <span className={cx("pl-led-lead")} aria-hidden="true" />
                  <dd>
                    {money(customPlan.baseCents / 100)} –{" "}
                    {money((customPlan.baseCents + customPlan.pages.length * customPlan.pageCents) / 100)} / mo
                  </dd>
                </div>
                <div className={cx("pl-led-all")}>Limits follow the pages bought · everything else unlimited</div>
              </dl>
            </div>

            <div className={cx("pl-foot")}>
              <button type="button" className={cx("btn", "btn-sm", "btn-ghost")} onClick={openCustom}>
                <Pencil className={cx("ic")} aria-hidden="true" />
                Edit trial
              </button>
              <span className={cx("pl-foot-gap")} />
            </div>
          </article>
        </div>
      )}

      <Sheet
        handle={customSheet}
        kicker="custom · pay per page"
        title="Custom plan"
        onClose={() => customSheet.close()}
      >
        <SheetBody>
          {customErr ? <Note tone="danger">{customErr}</Note> : null}
          <Note>
            Price is computed at checkout: {money(customPlan.baseCents / 100)} base plus{" "}
            {money(customPlan.pageCents / 100)} for each of the {customPlan.pages.length} add-on pages, with a
            year priced as ten months. Those amounts are fixed in the build, so the trial is the only thing
            editable here. The trial applies to signup and to switching to Custom from the subscription page.
          </Note>
          <div className={cx("sec")}>
            <div className={cx("sec-h")}>
              <span className={cx("sec-t")}>Trial</span>
              <span className={cx("sec-m")}>Applied by both checkout routes</span>
            </div>
            <div className={cx("row")}>
              <Field label="Trial days" htmlFor="cp-trial" hint="0 = charge immediately">
                <input
                  id="cp-trial"
                  className={cx("in", "in--mono", "in--num")}
                  type="number"
                  min={0}
                  max={365}
                  value={customTrial}
                  onChange={(e) => setCustomTrial(e.target.value)}
                />
              </Field>
            </div>
          </div>
        </SheetBody>
        <SheetFoot>
          <button type="button" className={cx("btn", "btn-ghost")} onClick={() => customSheet.close()}>
            Cancel
          </button>
          <button type="button" className={cx("btn", "btn-primary")} disabled={customBusy} onClick={saveCustom}>
            {customBusy ? "Saving…" : "Save"}
          </button>
        </SheetFoot>
      </Sheet>

      <PromoCodesCard promos={promos} />

      <Sheet
        handle={editSheet}
        kicker={editing?.id ? `${editing.slug} · edit` : "New plan"}
        title={editing?.id ? editing.name || "Plan" : "New plan"}
        wide
        onClose={closeEditor}
      >
        {editing ? (
          <PlanForm
            key={editing.id || "new"}
            plan={editing}
            synced={editing.id ? synced[editing.slug] : undefined}
            stripeEnabled={stripeEnabled}
            syncing={syncingId === editing.id}
            onSync={() => sync(editing)}
            onSave={save}
            onCancel={closeEditor}
          />
        ) : null}
      </Sheet>

      <Sheet handle={delSheet} kicker={deleting?.slug ?? "plan"} title="Delete plan" onClose={closeDelete}>
        <SheetBody>
          {deleteErr ? <Note tone="danger">{deleteErr}</Note> : null}
          <Note tone="danger">
            <b>{deleting?.name}</b> leaves every plan surface and its Stripe prices are archived. This can&rsquo;t be
            undone. A plan with subscribers on it is refused — deactivate it instead.
          </Note>
        </SheetBody>
        <SheetFoot>
          <button type="button" className={cx("btn", "btn-ghost")} onClick={closeDelete} disabled={deleteBusy}>
            Cancel
          </button>
          <button type="button" className={cx("btn", "btn-danger")} onClick={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete plan"}
          </button>
        </SheetFoot>
      </Sheet>
    </>
  );
}

// ── Promo codes — read-only list + active toggle ──────────────────

function PromoCodesCard({ promos }: { promos: PromoDTO[] }) {
  const router = useRouter();
  // Optimistic flips so the toggle answers the click; a failed write reverts.
  const [override, setOverride] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function flip(p: PromoDTO, next: boolean) {
    setBusyId(p.id);
    setOverride((o) => ({ ...o, [p.id]: next }));
    try {
      const res = await setPromoActive(p.id, next);
      if (!res.ok) throw new Error(res.error);
      toast.success(next ? "Code active" : "Code paused", p.code);
      router.refresh();
    } catch (e) {
      setOverride((o) => ({ ...o, [p.id]: !next }));
      toast.error("Couldn't update", errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={cx("card", "tbl-card")}>
      <div className={cx("pl-thead")}>
        <div className={cx("card-head")}>
          <div className={cx("card-titles")}>
            <div className={cx("card-title")}>Promo codes</div>
            <div className={cx("card-sub")}>
              <b>{promos.length}</b> code{promos.length === 1 ? "" : "s"}
            </div>
          </div>
          <Link className={cx("card-link")} href="/admin/influencers">
            Influencers
            <ArrowUpRight className={cx("ic")} aria-hidden="true" />
          </Link>
        </div>
      </div>
      {promos.length === 0 ? (
        <div className={cx("tbl-empty")}>No promo codes yet.</div>
      ) : (
        <div className={cx("tbl-wrap")}>
          <table className={cx("tbl", "tbl--stack")}>
            <colgroup>
              <col className={cx("pl-c-code")} />
              <col className={cx("pl-c-inf")} />
              <col className={cx("pl-c-off")} />
              <col className={cx("pl-c-comm")} />
              <col className={cx("pl-c-clicks")} />
              <col className={cx("pl-c-active")} />
            </colgroup>
            <thead>
              <tr>
                <th>Code</th>
                <th>Influencer</th>
                <th>Customer</th>
                <th>Commission</th>
                <th className={cx("num")}>Clicks</th>
                <th>Active</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => {
                const active = override[p.id] ?? p.active;
                return (
                  <tr key={p.id}>
                    <td>
                      <span className={cx("pl-code")}>{p.code}</span>
                    </td>
                    <td data-l="Influencer">
                      <div className={cx("t-clip")} title={p.influencerName}>
                        {p.influencerName}
                      </div>
                    </td>
                    <td data-l="Customer" className={cx("t-mono")}>
                      {p.customerPercentOff != null ? `${p.customerPercentOff}% off` : "—"}
                    </td>
                    <td data-l="Commission" className={cx("t-mono")}>
                      {p.commission}
                    </td>
                    <td data-l="Clicks" className={cx("num", "t-num")}>
                      {p.clicks}
                    </td>
                    <td data-l="Active">
                      <Toggle
                        cell
                        on={active}
                        disabled={busyId === p.id}
                        onChange={(next) => flip(p, next)}
                        label={active ? "Active" : "Paused"}
                        ariaLabel={`${p.code} active`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── The plan editor ────────────────────────────────────────────────
// Keyed on the plan id by the parent: every field initialises from props and
// no effect syncs state, so the sheet keeps the last plan's values through
// its exit animation.

function PlanForm({
  plan,
  synced,
  stripeEnabled,
  syncing,
  onSync,
  onSave,
  onCancel,
}: {
  plan: HydratedPlan;
  synced: SyncedInfo | undefined;
  stripeEnabled: boolean;
  syncing: boolean;
  onSync: () => void;
  onSave: (p: HydratedPlan) => Promise<void>;
  onCancel: () => void;
}) {
  const isNew = !plan.id;
  const [local, setLocal] = useState<HydratedPlan>(plan);
  const [slugTouched, setSlugTouched] = useState(!isNew);
  /* THE BENEFITS, as a list rather than a textarea (owner, 2026-09-02): one
     row per line with its own field, a remove, an up/down, and an "Add".
     What is saved is unchanged — `features: string[]` — and every customer
     surface still draws it the way it always did (tick per row). */
  const [features, setFeatures] = useState<string[]>(plan.features);
  const setFeature = (i: number, v: string) =>
    setFeatures((list) => list.map((f, j) => (j === i ? v : f)));
  const removeFeature = (i: number) => setFeatures((list) => list.filter((_, j) => j !== i));
  const moveFeature = (i: number, dir: -1 | 1) =>
    setFeatures((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const addFeature = () => setFeatures((list) => [...list, ""]);
  // Prices are edited as raw text (dollars) so partially-typed decimals like
  // "29." survive keystrokes; cents are derived into `local` on each change.
  const [priceText, setPriceText] = useState(centsToText(plan.priceCents || null));
  const [yearlyText, setYearlyText] = useState(centsToText(plan.yearlyPriceCents));
  const [discountText, setDiscountText] = useState("20");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The cap a key held before "Unlimited" was switched on, so switching it
  // back restores the number instead of a blank.
  const lastCaps = useRef<Partial<Record<LimitKey, number>>>({});

  const savings = yearlySavingsPct(local.priceCents, local.yearlyPriceCents);
  const fullYear = local.priceCents * 12;
  const discountPct = Math.min(100, Math.max(0, Number(discountText) || 0));

  function patch(p: Partial<HydratedPlan>) {
    setLocal((prev) => ({ ...prev, ...p }));
  }

  function setName(v: string) {
    patch({ name: v, ...(isNew && !slugTouched ? { slug: slugify(v) } : {}) });
  }

  function applyDiscount() {
    if (local.priceCents <= 0) return;
    const cents = Math.round(fullYear * (1 - discountPct / 100));
    setYearlyText(centsToText(cents));
    patch({ yearlyPriceCents: cents });
  }

  function setCap(key: LimitKey, raw: string) {
    const n = Math.max(0, Math.trunc(Number(raw)));
    setLocal((prev) => ({
      ...prev,
      limits: { ...prev.limits, [key]: Number.isFinite(n) ? n : 0 },
    }));
  }

  function setUnlimited(key: LimitKey, on: boolean) {
    setLocal((prev) => {
      const next: PlanLimits = { ...prev.limits };
      if (on) {
        if (!isUnlimited(next[key])) lastCaps.current[key] = next[key];
        // The paid lookups' absence is their tier default, so unlimited is said with -1 (lib/planLimits).
        if ((PAID_CALL_KEYS as readonly LimitKey[]).includes(key)) next[key] = UNLIMITED;
        else delete next[key];
      } else {
        next[key] = lastCaps.current[key] ?? DEFAULT_FREE_LIMITS[key] ?? 10;
      }
      return { ...prev, limits: next };
    });
  }

  const counts = useMemo(() => capCount(local.limits), [local.limits]);

  async function submit() {
    if (busy) return;
    setErr(null);
    if (!local.name.trim()) return setErr("Give the plan a name.");
    if (!local.slug.trim()) return setErr("Give the plan a slug.");
    setBusy(true);
    try {
      await onSave({
        ...local,
        name: local.name.trim(),
        slug: local.slug.trim().toLowerCase(),
        description: local.description?.trim() || null,
        features: features.map((f) => f.trim()).filter(Boolean),
      });
    } catch (e) {
      setErr(errorMessage(e, "Couldn't save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SheetBody>
        {err ? <Note tone="danger">{err}</Note> : null}

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Identity</span>
            <span className={cx("sec-m")}>{isNew ? "Slug locks on create" : "Slug is permanent"}</span>
          </div>
          <div className={cx("row")}>
            <Field label="Name" htmlFor="pl-name">
              <input id="pl-name" className={cx("in")} value={local.name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label="Slug"
              htmlFor="pl-slug"
              hint={isNew ? "Lowercase, e.g. starter — it keys Stripe and subscriptions." : "Stripe prices and subscriptions key off it."}
            >
              <input
                id="pl-slug"
                className={cx("in", "in--mono")}
                value={local.slug}
                disabled={!isNew}
                onChange={(e) => {
                  setSlugTouched(true);
                  patch({ slug: slugify(e.target.value) || e.target.value.toLowerCase() });
                }}
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="pl-desc">
            <textarea
              id="pl-desc"
              className={cx("in", "ta")}
              rows={2}
              value={local.description ?? ""}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </Field>
        </div>

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Pricing</span>
            <span className={cx("sec-m")}>USD · price changes sync to Stripe</span>
          </div>
          <div className={cx("row", "row--3")}>
            <Field label="Monthly" htmlFor="pl-month">
              <span className={cx("in-wrap")}>
                <span className={cx("in-pre")}>$</span>
                <input
                  id="pl-month"
                  className={cx("in", "in--mono", "in--pre")}
                  inputMode="decimal"
                  value={priceText}
                  onChange={(e) => {
                    setPriceText(e.target.value);
                    patch({ priceCents: dollarsToCents(Number(e.target.value || 0)) });
                  }}
                />
              </span>
            </Field>
            <Field
              label="Yearly"
              htmlFor="pl-year"
              hint={
                <span className={cx("pr-save", savings === 0 && "none")}>
                  {local.yearlyPriceCents && savings > 0
                    ? `Saves ${savings}% vs monthly (${money(fullYear / 100)})`
                    : local.yearlyPriceCents
                      ? "No saving vs monthly"
                      : "Optional — blank hides yearly checkout"}
                </span>
              }
            >
              <span className={cx("in-wrap")}>
                <span className={cx("in-pre")}>$</span>
                <input
                  id="pl-year"
                  className={cx("in", "in--mono", "in--pre")}
                  inputMode="decimal"
                  value={yearlyText}
                  onChange={(e) => {
                    const v = e.target.value;
                    setYearlyText(v);
                    patch({ yearlyPriceCents: v.trim() === "" ? null : dollarsToCents(Number(v)) });
                  }}
                />
              </span>
            </Field>
            <Field label="Trial days" htmlFor="pl-trial" hint="0 = no trial">
              <input
                id="pl-trial"
                className={cx("in", "in--mono", "in--num")}
                type="number"
                min={0}
                max={365}
                value={local.trialDays}
                onChange={(e) => patch({ trialDays: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
              />
            </Field>
          </div>
          <div className={cx("pr-helper")}>
            <Field label="Yearly discount" htmlFor="pl-disc" hint="Fills yearly from monthly × 12">
              <span className={cx("in-wrap")}>
                <input
                  id="pl-disc"
                  className={cx("in", "in--mono", "in--num", "in--suf")}
                  inputMode="numeric"
                  value={discountText}
                  onChange={(e) => setDiscountText(e.target.value)}
                />
                <span className={cx("in-suf")}>%</span>
              </span>
            </Field>
            <button
              type="button"
              className={cx("btn", "btn-ghost")}
              disabled={local.priceCents <= 0}
              onClick={applyDiscount}
            >
              Apply {discountPct}% yearly discount
            </button>
          </div>
        </div>

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Visibility</span>
          </div>
          <div className={cx("row")}>
            <Toggle
              on={local.active}
              onChange={(v) => patch({ active: v })}
              label="Active"
              sub="On the pricing and subscription pages, purchasable"
            />
            <Toggle
              on={local.highlight}
              onChange={(v) => patch({ highlight: v })}
              label="Most popular"
              sub="The highlight plate on plan cards"
            />
            <Field label="Order" htmlFor="pl-order" hint="Low sorts first">
              <input
                id="pl-order"
                className={cx("in", "in--mono", "in--num")}
                type="number"
                value={local.order}
                onChange={(e) => patch({ order: Math.trunc(Number(e.target.value) || 0) })}
              />
            </Field>
          </div>
        </div>

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Limits</span>
            <span className={cx("sec-m")}>
              {counts.caps} caps · {counts.unlimited} unlimited
            </span>
          </div>
          <div className={cx("lg")}>
            {LIMIT_GROUPS.map((g) => (
              <div key={g.title} className={cx("lg-group")}>
                <div className={cx("lg-title")}>{g.title}</div>
                {g.keys.map((key) => {
                  const def = DEF_BY_KEY.get(key);
                  if (!def) return null;
                  const cap = local.limits[key];
                  const unlimited = isUnlimited(cap);
                  const id = `pl-lim-${key}`;
                  return (
                    <div key={key} className={cx("lg-row")}>
                      <div className={cx("lg-lbl")}>
                        <label className={cx("lg-name")} htmlFor={id}>
                          {def.label}
                          <span className={cx("tag")}>{def.scope === "monthly" ? "per cycle" : "total"}</span>
                        </label>
                        <span className={cx("lg-hint")}>{def.hint}</span>
                      </div>
                      <input
                        id={id}
                        className={cx("in", "in--mono", "lg-in")}
                        type="number"
                        min={0}
                        step={1}
                        placeholder="∞"
                        disabled={unlimited}
                        value={unlimited ? "" : cap}
                        onChange={(e) => setCap(key, e.target.value)}
                      />
                      <Toggle
                        cell
                        on={unlimited}
                        onChange={(v) => setUnlimited(key, v)}
                        label="Unlimited"
                        ariaLabel={`${def.label} unlimited`}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Benefits</span>
            <span className={cx("sec-m")}>
              {features.length} row{features.length === 1 ? "" : "s"} · shown top to bottom
            </span>
          </div>
          <div className={cx("feat-list")} role="list" aria-label="Benefits">
            {features.map((f, i) => (
              <div key={i} className={cx("feat-row")} role="listitem">
                <span className={cx("feat-n")}>{i + 1}</span>
                <input
                  className={cx("in")}
                  value={f}
                  aria-label={`Benefit ${i + 1}`}
                  placeholder="e.g. Proposal management"
                  onChange={(e) => setFeature(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addFeature();
                    }
                  }}
                />
                <button
                  type="button"
                  className={cx("feat-btn")}
                  aria-label="Move up"
                  title="Move up"
                  disabled={i === 0}
                  onClick={() => moveFeature(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={cx("feat-btn")}
                  aria-label="Move down"
                  title="Move down"
                  disabled={i === features.length - 1}
                  onClick={() => moveFeature(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={cx("feat-btn", "feat-x")}
                  aria-label="Remove benefit"
                  title="Remove"
                  onClick={() => removeFeature(i)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className={cx("feat-add")} onClick={addFeature}>
              + Add benefit
            </button>
            <p className={cx("feat-hint")}>
              A row that starts with &ldquo;Everything in &lt;plan&gt;&rdquo; inherits that plan&rsquo;s
              rows on every customer page; write the extras after it.
            </p>
          </div>
        </div>

        <div className={cx("sec")}>
          <div className={cx("sec-h")}>
            <span className={cx("sec-t")}>Stripe</span>
          </div>
          <div className={cx("pl-stripe")}>
            <div className={cx("meta", "pl-stripe-meta")}>
              <span>
                Monthly <b>{synced?.monthly ? "synced" : "not synced"}</b>
              </span>
              <span>
                Yearly{" "}
                <b>{local.yearlyPriceCents ? (synced?.yearly ? "synced" : "not synced") : "no price"}</b>
              </span>
              {!stripeEnabled ? (
                <span>
                  Stripe <b>not configured</b>
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className={cx("btn", "btn-sm", "btn-ghost")}
              disabled={isNew || !stripeEnabled || syncing}
              title={isNew ? "Save the plan first" : undefined}
              onClick={onSync}
            >
              <RefreshCw className={cx("ic")} aria-hidden="true" />
              {syncing ? "Syncing…" : "Sync to Stripe"}
            </button>
          </div>
        </div>
      </SheetBody>
      <SheetFoot>
        <button type="button" className={cx("btn", "btn-ghost")} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className={cx("btn", "btn-primary")} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : isNew ? "Create plan" : "Save plan"}
        </button>
      </SheetFoot>
    </>
  );
}
