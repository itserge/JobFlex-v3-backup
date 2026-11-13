"use client";

// THE NEW PLANS ON SCREEN (Base + Tools, part 3b — owner, 2026-11-10). Two pieces, one view (lib/toolPlans/shared
// toolsSubscriptionModel, read on the server by lib/toolPlans/view):
//   · ToolsSubscriptionSection — the Subscription page's section (desk and phone, id="tools", where the menu's
//     "Upgrade your plan" lands): Your plan, Your tools, the main tool switch in the free days, and Upgrade your plan
//     (the tools, works-well-with first; people; a bigger plan, and the smaller ones in a quieter row);
//   · ToolsWelcome — /dashboard/welcome, the first day: the plan, the switch, three tools that work well with the
//     main tool and every other one, each with Try free.
//
// NO LOCKS (owner): what is tried or added shows in the menu at once — every success calls router.refresh(), which
// re-renders the layout's menu and this page's own view. The answer is said inline, beside the button. Remove and a
// plan change ask first, inline (a window.confirm doesn't exist in some in-app browsers); Try free needs no ask: the
// button carries its date and the line under it the price and that it can be removed any time before.
//
// Styles: ./tools-plan.module.css (every rule under `.tp`, controls at 0,3,0 — see its header).

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  addToolAction,
  changePlanAction,
  removeToolAction,
  setPeopleAction,
  switchMainToolAction,
  tryToolAction,
  type ToolActionResult,
} from "@/actions/toolPlans";
import { money, type ToolId, type ToolsModelOffer, type ToolsModelPlan, type ToolsModelTool, type ToolsSubscriptionModel } from "@/lib/toolPlans/shared";
import s from "./tools-plan.module.css";

export type ToolsView = ToolsSubscriptionModel & { lapsed: boolean };

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const per = (cents: number) => `${money(cents)}/mo`;
const listAnd = (items: readonly string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

// ── one place for every button's call, its answer and its ask ────────────────

type Msg = { key: string; ok: boolean; text: string };

function useAct() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<Msg | null>(null);
  const [confirm, setConfirm] = React.useState<string | null>(null);
  const run = React.useCallback(
    async (key: string, fn: () => Promise<ToolActionResult>, okKey?: string) => {
      setBusy(key);
      setMsg(null);
      let res: ToolActionResult;
      try {
        res = await fn();
      } catch {
        res = { ok: false, message: "Couldn't reach JobFlex. Check the connection and try again." };
      }
      setBusy(null);
      setConfirm(null);
      setMsg({ key: res.ok && okKey ? okKey : key, ok: res.ok, text: res.message });
      if (res.ok) router.refresh();
    },
    [router],
  );
  const ask = React.useCallback((key: string | null) => {
    setConfirm(key);
    setMsg(null);
  }, []);
  return { busy, msg, confirm, ask, run };
}
type Act = ReturnType<typeof useAct>;

function Note({ act, k }: { act: Act; k: string }) {
  if (!act.msg || act.msg.key !== k) return null;
  return (
    <p className={cx(s.msg, !act.msg.ok && s.msgBad)} role={act.msg.ok ? "status" : "alert"} data-tools-msg="">
      {act.msg.text}
    </p>
  );
}

function Confirm({ act, words, yes, onYes, busyWords }: { act: Act; words: string; yes: string; onYes: () => void; busyWords: string }) {
  const busy = act.busy !== null;
  return (
    <div className={s.confirm} data-tools-confirm="">
      <span>{words}</span>
      <div className={s.acts}>
        <button type="button" className={cx(s.btn, s.btnPrimary)} onClick={onYes} disabled={busy}>
          {busy ? busyWords : yes}
        </button>
        <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.ask(null)} disabled={busy}>
          Not now
        </button>
      </div>
    </div>
  );
}

// ── your plan ────────────────────────────────────────────────────────────────

function PlanBlock({ model, act }: { model: ToolsView; act: Act }) {
  const p = model.plan;
  return (
    <div className={s.block} data-tools-plan="">
      <div className={s.kicker}>Your plan</div>
      <p className={s.planName}>{p.label}</p>
      {/* The owner's words for the free days: "Free until Nov 17, then $154/mo." */}
      {model.inTrial && model.trialDay && !model.lapsed ? (
        <p className={s.planBill} data-tools-free="">{`Free until ${model.trialDay}, then ${per(p.monthlyCents)}.`}</p>
      ) : null}
      <dl className={s.facts}>
        {model.inTrial ? null : (
          <div className={s.fact}>
            <dt className={s.factK}>Each month</dt>
            <dd className={s.factV}>{per(p.monthlyCents)}</dd>
          </div>
        )}
        <div className={s.fact}>
          <dt className={s.factK}>People</dt>
          <dd className={s.factV}>{p.seatCents === null ? "Just you" : `${p.people} of ${p.paidPeople}`}</dd>
        </div>
      </dl>
      {model.lapsed ? <p className={s.note}>Your plan has ended, so nothing can be added. Write to us from Help to start it again.</p> : null}
      <Note act={act} k="plan" />
    </div>
  );
}

// ── the free days, said plainly ──────────────────────────────────────────────

/** WHAT THE FREE DAYS ALLOW (owner, 2026-11-12: "during the trial they can switch or test something else, and it
 *  should clearly say it"): on the welcome page and on Subscription while the sign-up's trial runs. */
function FreeDaysNote({ model }: { model: ToolsView }) {
  if (!model.inTrial || !model.trialDay || model.lapsed) return null;
  return (
    <div className={s.freeNote} data-tools-free-note="">
      <p className={s.freeNoteH}>{`Your free days run until ${model.trialDay}`}</p>
      <ul className={s.freeNoteList}>
        <li>Everything on your plan is free until then, the tools you picked too.</li>
        <li>Don’t need a tool? Remove it before then and you never pay for it.</li>
        <li>Want to test something else? Try any other tool free, or change your plan.</li>
        <li>{`On ${model.trialDay} you pay only for what’s still on your plan.`}</li>
      </ul>
    </div>
  );
}

// ── your tools ───────────────────────────────────────────────────────────────

function ToolRow({ t, model, act }: { t: ToolsModelTool; model: ToolsView; act: Act }) {
  const k = `tool:${t.id}`;
  const asking = act.confirm === k;
  const live = !model.lapsed;
  let tag: React.ReactNode;
  let state: string;
  let button: React.ReactNode = null;
  switch (t.state) {
    case "main":
      tag = <span className={cx(s.tag, s.tagMain)}>Main tool</span>;
      state = t.inPlan ? `Included in ${model.plan.name}` : model.inTrial && t.day ? `Free until ${t.day}, then ${per(t.cents)} on your bill.` : `${per(t.cents)}, on your plan`;
      if (live && t.removable) button = <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.ask(k)} data-tools-remove={t.id}>Remove</button>;
      break;
    case "included":
      tag = <span className={cx(s.tag, s.tagOn)}>Included</span>;
      state = `In ${model.plan.name}`;
      break;
    case "on-bill":
      tag = <span className={cx(s.tag, s.tagOn)}>On your bill</span>;
      state = per(t.cents);
      if (live) button = <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.ask(k)} data-tools-remove={t.id}>Remove</button>;
      break;
    case "trying":
      if (t.removed) {
        tag = <span className={cx(s.tag, s.tagQuiet)}>Removed</span>;
        state = `Open until ${t.day}. It won't be billed.`;
        if (live) button = <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.run(k, () => addToolAction(t.id))} disabled={act.busy !== null} data-tools-addback={t.id}>Add back</button>;
      } else {
        tag = <span className={cx(s.tag, s.tagTry)}>Free try</span>;
        state = `Free until ${t.day}, then ${per(t.cents)} on your bill.`;
        if (live) button = <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.ask(k)} data-tools-remove={t.id}>Remove</button>;
      }
      break;
    case "closing":
      tag = <span className={cx(s.tag, s.tagQuiet)}>Closing</span>;
      state = `Open until ${t.day}.`;
      if (live) button = <button type="button" className={cx(s.btn, s.btnQuiet)} onClick={() => act.run(k, () => addToolAction(t.id))} disabled={act.busy !== null} data-tools-addback={t.id}>Add back</button>;
      break;
  }
  const removeWords =
    t.state === "trying"
      ? `Remove the ${t.label} try? It stays open until ${t.day} and won't be billed.`
      : t.state === "main" && model.inTrial
        ? `Remove ${t.label}? It stays open until ${t.day ?? "your free days end"} and won't be billed. You can add it back any time.`
        : `Remove ${t.label}? It stays open until the end of the month you paid for. No refund.`;
  return (
    <li className={s.row} data-tool-row={t.id} data-tool-state={t.removed ? "removed" : t.state}>
      <div className={s.rowMain}>
        <p className={s.rowName}>
          {tag}
          {t.label}
        </p>
        <p className={s.rowState}>{state}</p>
      </div>
      {button && !asking ? <div className={s.acts}>{button}</div> : null}
      {asking ? <Confirm act={act} words={removeWords} yes="Remove it" busyWords="Removing…" onYes={() => act.run(k, () => removeToolAction(t.id))} /> : null}
      <Note act={act} k={k} />
    </li>
  );
}

function ToolsBlock({ model, act }: { model: ToolsView; act: Act }) {
  return (
    <div className={s.block} data-tools-mine="">
      <h2 className={s.h2}>Your tools</h2>
      {model.tools.length ? (
        <ul className={s.rows}>
          {model.tools.map((t) => (
            <ToolRow key={t.id} t={t} model={model} act={act} />
          ))}
        </ul>
      ) : (
        <p className={s.note}>No tools yet. Try one free below.</p>
      )}
    </div>
  );
}

// ── the main tool, in the free days ──────────────────────────────────────────

function SwitchBox({ model, act }: { model: ToolsView; act: Act }) {
  const [pick, setPick] = React.useState<ToolId | "">("");
  const busy = act.busy === "switch";
  return (
    <div className={s.switch} data-tools-switch="">
      <h2 className={s.h2}>Not the tool you wanted? Switch your main tool</h2>
      <p className={s.note}>
        {`While your free days last (until ${model.trialDay}) you can switch as often as you like. Your free days keep counting.`}
      </p>
      <div className={s.switchRow}>
        <select className={s.select} value={pick} onChange={(e) => setPick(e.target.value as ToolId | "")} aria-label="Your new main tool" data-tools-switch-pick="">
          <option value="">{model.plan.mainLabel ? `Instead of ${model.plan.mainLabel}…` : "Pick your main tool…"}</option>
          {model.switchTo.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={cx(s.btn, s.btnPrimary)}
          disabled={!pick || act.busy !== null}
          onClick={() => pick && void act.run("switch", () => switchMainToolAction(pick))}
          data-tools-switch-go=""
        >
          {busy ? "Switching…" : "Switch"}
        </button>
      </div>
      <Note act={act} k="switch" />
    </div>
  );
}

// ── the tools to add ─────────────────────────────────────────────────────────

function OfferCard({ o, model, act }: { o: ToolsModelOffer; model: ToolsView; act: Act }) {
  const k = `tool:${o.id}`;
  const busy = act.busy === k;
  const asking = act.confirm === k;
  const addWords = !model.hasCard
    ? "Adding a tool needs a card on file."
    : model.inTrial
      ? `${o.label} goes on your bill with your plan on ${model.trialDay}: ${per(o.cents)}.`
      : `Today you pay for the days left this month, then ${per(o.cents)}.`;
  return (
    <li className={cx(s.card, o.pair && s.cardPair)} data-tool-card={o.id}>
      <div className={s.cardTop}>
        <h4 className={s.cardName}>{o.label}</h4>
        <span className={s.cardPrice}>{per(o.cents)}</span>
      </div>
      <p className={s.cardNote}>{o.note}</p>
      {model.lapsed ? null : o.canTry ? (
        <>
          <div className={s.acts}>
            <button type="button" className={cx(s.btn, s.btnPrimary)} disabled={act.busy !== null} onClick={() => void act.run(k, () => tryToolAction(o.id))} data-tools-try={o.id}>
              {busy ? "Starting…" : `Try free until ${o.tryDay}`}
            </button>
          </div>
          <p className={s.cardFine}>{`Then ${per(o.cents)} on your bill. Remove it any time before.`}</p>
        </>
      ) : asking ? (
        <Confirm act={act} words={addWords} yes={`Add · ${per(o.cents)}`} busyWords="Adding…" onYes={() => void act.run(k, () => addToolAction(o.id))} />
      ) : (
        <>
          <div className={s.acts}>
            <button type="button" className={s.btn} disabled={act.busy !== null} onClick={() => act.ask(k)} data-tools-add={o.id}>
              {`Add · ${per(o.cents)}`}
            </button>
          </div>
          <p className={s.cardFine}>{"You've had its free try."}</p>
        </>
      )}
      <Note act={act} k={k} />
    </li>
  );
}

function OfferGrid({ items, model, act }: { items: readonly ToolsModelOffer[]; model: ToolsView; act: Act }) {
  return (
    <ul className={s.grid}>
      {items.map((o) => (
        <OfferCard key={o.id} o={o} model={model} act={act} />
      ))}
    </ul>
  );
}

// ── people ───────────────────────────────────────────────────────────────────

function People({ model, act }: { model: ToolsView; act: Act }) {
  const p = model.plan;
  const pro = model.plans.find((x) => x.id === "professional");
  // Its own key: the Professional card further down asks the same, and only one of the two should open.
  const k = "people:professional";
  if (p.seatCents === null) {
    return (
      <div className={s.stepper} data-tools-people="basic">
        <p className={s.note}>Basic is just you. Move to Professional to add people.</p>
        {pro && pro.canMove ? (
          act.confirm === k ? (
            <PlanConfirm plan={pro} model={model} act={act} k={k} />
          ) : (
            <div className={s.acts}>
              <button type="button" className={s.btn} disabled={act.busy !== null} onClick={() => act.ask(k)} data-tools-move="professional">
                {`Move to Professional · ${per(pro.cents)}`}
              </button>
            </div>
          )
        ) : null}
        <Note act={act} k={k} />
      </div>
    );
  }
  return <PeopleStepper key={p.paidPeople} model={model} act={act} />;
}

function PeopleStepper({ model, act }: { model: ToolsView; act: Act }) {
  const p = model.plan;
  const seat = p.seatCents ?? 0;
  const min = Math.max(p.seats, p.people);
  const [n, setN] = React.useState(Math.max(p.paidPeople, min));
  const changed = n !== p.paidPeople;
  const extra = Math.max(0, n - p.seats);
  const busy = act.busy === "people";
  return (
    <div className={s.peopleBox} data-tools-people="stepper">
      <p className={s.note}>{`${p.seats} people come with ${p.name}, you counted. Each person after that is ${per(seat)}. ${p.people} on your team now.`}</p>
      <div className={s.stepper}>
        <button type="button" className={cx(s.btn, s.btnSq)} aria-label="One person fewer" disabled={n <= min || act.busy !== null} onClick={() => setN((v) => Math.max(min, v - 1))}>
          −
        </button>
        <span className={s.count} aria-live="polite" data-tools-people-count="">
          {n}
        </span>
        <button type="button" className={cx(s.btn, s.btnSq)} aria-label="One person more" disabled={n >= 500 || act.busy !== null} onClick={() => setN((v) => Math.min(500, v + 1))}>
          +
        </button>
        <span className={s.note}>{extra ? `${extra} extra · ${per(extra * seat)}` : "No extra people"}</span>
        {changed ? (
          <div className={s.acts}>
            <button type="button" className={cx(s.btn, s.btnPrimary)} disabled={act.busy !== null} onClick={() => void act.run("people", () => setPeopleAction(n))} data-tools-people-save="">
              {busy ? "Saving…" : `Save ${n} people`}
            </button>
          </div>
        ) : null}
      </div>
      {changed ? (
        <p className={s.cardFine}>
          {model.inTrial ? `Billed with your plan on ${model.trialDay}.` : n > p.paidPeople ? "Today you pay for the days left this month." : "Fewer people: no refund for this month."}
        </p>
      ) : null}
      <Note act={act} k="people" />
    </div>
  );
}

// ── other sizes ──────────────────────────────────────────────────────────────

function planWords(plan: ToolsModelPlan, model: ToolsView): string {
  const price = per(plan.cents);
  const gets = plan.includes.length ? ` ${listAnd(plan.includes)} ${plan.includes.length === 1 ? "comes" : "come"} included.` : "";
  const loses = plan.loses.length ? ` ${listAnd(plan.loses)} ${plan.loses.length === 1 ? "closes" : "close"}${model.inTrial ? "." : " at the end of this month."}` : "";
  if (model.inTrial) return `Move to ${plan.name}? Free until ${model.trialDay}, then ${price}.${gets}${loses}`;
  if (plan.bigger) return `Move to ${plan.name}? Today you pay the difference for the rest of this month, then ${price}.${gets}`;
  return `Switch to ${plan.name}? ${price} from your next bill, no refund for this month.${loses}`;
}

function PlanConfirm({ plan, model, act, k = `plan:${plan.id}` }: { plan: ToolsModelPlan; model: ToolsView; act: Act; k?: string }) {
  return (
    <Confirm
      act={act}
      words={planWords(plan, model)}
      yes={plan.bigger ? `Move to ${plan.name}` : `Switch to ${plan.name}`}
      busyWords="Changing…"
      onYes={() => void act.run(k, () => changePlanAction(plan.id), "plan")}
    />
  );
}

function BiggerPlans({ plans, model, act }: { plans: readonly ToolsModelPlan[]; model: ToolsView; act: Act }) {
  return (
    <ul className={s.plans}>
      {plans.map((p) => {
        const k = `plan:${p.id}`;
        return (
          <li key={p.id} className={s.planCard} data-tools-plan-card={p.id}>
            <h4 className={s.cardName}>{p.name}</h4>
            <p className={s.planCardPrice}>
              {money(p.cents)}
              <small> /mo with your tools</small>
            </p>
            {p.includes.length ? <p className={s.cardFine}>{`${listAnd(p.includes)} ${p.includes.length === 1 ? "comes" : "come"} included.`}</p> : null}
            <ul className={s.planLines}>
              {p.lines.slice(0, 4).map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {!p.canMove ? (
              <p className={s.note}>{p.why}</p>
            ) : act.confirm === k ? (
              <PlanConfirm plan={p} model={model} act={act} />
            ) : (
              <div className={s.acts}>
                <button type="button" className={cx(s.btn, s.btnPrimary)} disabled={act.busy !== null} onClick={() => act.ask(k)} data-tools-move={p.id}>
                  {`Move to ${p.name}`}
                </button>
              </div>
            )}
            <Note act={act} k={k} />
          </li>
        );
      })}
    </ul>
  );
}

function SmallerPlans({ plans, model, act }: { plans: readonly ToolsModelPlan[]; model: ToolsView; act: Act }) {
  const asking = plans.find((p) => act.confirm === `plan:${p.id}`);
  return (
    <div className={s.smaller} data-tools-smaller="">
      <span>Smaller plans:</span>
      {plans.map((p) =>
        p.canMove ? (
          <button key={p.id} type="button" className={cx(s.btn, s.btnQuiet)} disabled={act.busy !== null} onClick={() => act.ask(`plan:${p.id}`)} data-tools-move={p.id}>
            {`Switch to ${p.name} · ${per(p.cents)}`}
          </button>
        ) : (
          <span key={p.id}>{`${p.name}: ${p.why}`}</span>
        ),
      )}
      {asking ? <PlanConfirm plan={asking} model={model} act={act} /> : null}
      {plans.map((p) => (
        <Note key={p.id} act={act} k={`plan:${p.id}`} />
      ))}
    </div>
  );
}

function UpgradeBlock({ model, act }: { model: ToolsView; act: Act }) {
  const pairs = model.offer.filter((o) => o.pair);
  const more = model.offer.filter((o) => !o.pair);
  const bigger = model.plans.filter((p) => p.bigger);
  const smaller = model.plans.filter((p) => !p.bigger);
  return (
    <div className={s.block} data-tools-upgrade="">
      <h2 className={s.h2}>Upgrade your plan</h2>
      {model.offer.length ? <p className={s.note}>Try any tool free. It shows in your menu right away.</p> : null}
      {pairs.length ? (
        <>
          <h3 className={s.h3}>{`Works well with ${model.plan.mainLabel}`}</h3>
          <OfferGrid items={pairs} model={model} act={act} />
        </>
      ) : null}
      {more.length ? (
        <>
          <h3 className={s.h3}>{pairs.length ? "More tools" : "Tools"}</h3>
          <OfferGrid items={more} model={model} act={act} />
        </>
      ) : null}
      {!model.offer.length ? <p className={s.note}>Every tool is on your plan.</p> : null}
      <h3 className={s.h3}>People</h3>
      <People model={model} act={act} />
      {bigger.length ? (
        <>
          <h3 className={s.h3}>A bigger plan</h3>
          <BiggerPlans plans={bigger} model={model} act={act} />
        </>
      ) : null}
      {smaller.length ? <SmallerPlans plans={smaller} model={model} act={act} /> : null}
    </div>
  );
}

// ── the two pieces ───────────────────────────────────────────────────────────

/** The Subscription page's section for a shop on the new plans (desk and phone). */
export function ToolsSubscriptionSection({ model, className }: { model: ToolsView; className?: string }) {
  const act = useAct();
  return (
    <section id="tools" className={cx(s.tp, className)} aria-label="Your plan and tools" data-tools-section="">
      <PlanBlock model={model} act={act} />
      <FreeDaysNote model={model} />
      <ToolsBlock model={model} act={act} />
      {model.inTrial && model.switchTo.length && !model.lapsed ? <SwitchBox model={model} act={act} /> : null}
      {model.lapsed ? null : <UpgradeBlock model={model} act={act} />}
    </section>
  );
}

/** The welcome page's body: the plan, the switch, three tools that work well with the main tool, and the rest. */
export function ToolsWelcome({ model }: { model: ToolsView }) {
  const act = useAct();
  const pairs = model.offer.filter((o) => o.pair).slice(0, 3);
  const rest = model.offer.filter((o) => !pairs.includes(o));
  const day = model.offer.find((o) => o.tryDay)?.tryDay ?? null;
  return (
    <div className={cx(s.tp, s.welcome)} data-tools-welcome="">
      <div className="page-head">
        <div>
          <div className="kicker">Welcome to JobFlex</div>
          <h1 className="page-title">Your shop is ready</h1>
        </div>
      </div>
      <p className={s.lead}>
        {`Try any tool below free${day ? ` until ${day}` : ""}. It shows in your menu right away, and goes on your bill after that unless you remove it.`}
      </p>
      <PlanBlock model={model} act={act} />
      <FreeDaysNote model={model} />
      {/* The tools the shop built its plan with (owner, 2026-11-12): each with its Remove, here on day one. */}
      {model.tools.length ? <ToolsBlock model={model} act={act} /> : null}
      {model.inTrial && model.switchTo.length ? <SwitchBox model={model} act={act} /> : null}
      {pairs.length ? (
        <div className={s.block} data-tools-pairs="">
          <h2 className={s.h2}>{`Works well with ${model.plan.mainLabel}`}</h2>
          <OfferGrid items={pairs} model={model} act={act} />
        </div>
      ) : null}
      {rest.length ? (
        <div className={s.block} data-tools-rest="">
          <h2 className={s.h2}>{pairs.length ? "Every other tool" : "Tools you can add"}</h2>
          <OfferGrid items={rest} model={model} act={act} />
        </div>
      ) : null}
      <div className={s.foot}>
        <Link className={cx(s.btn, s.btnPrimary)} href={"/dashboard" as Route}>
          Go to your dashboard
        </Link>
        <Link className={s.btn} href={"/dashboard/subscription#tools" as Route}>
          Your plan and tools
        </Link>
      </div>
    </div>
  );
}
