// The All-list card (2026-10-30, owner's pick of six) — "Two-panel dossier".
//
// One proposal = one framed card in ONE table row (a single <tr class="prow">, so the page's in-place patch and its
// row exit move the whole card at once). Inside it, two proportioned zones side by side (golden ratio):
//   LEFT  — the job: kind tag, the title (the largest type on the card), client · city, the client's design line, then
//           a ruled label/value ledger (status, views, updated, owner, change orders, project).
//   RIGHT — the money plate on its own tinted ground: Quote/Contract, the amount, a paid-vs-contract track with stage
//           ticks, then the stages as a compact ledger; the stage being chased is framed, with its facts and Mark paid /
//           Send invoice / Remind under it. Plan, paid-in-full, declined and no-plan states each read in one line.
//   FOOT  — one ruled action bar: Open (the blue cell), Send/Resend, Client view, Change order, Zillow, Copy client
//           link — Delete apart at the far end.
// Every button keeps its classic `data-act`, and every operator string goes through kit.esc.

import type { CardKit, CardRenderer } from "./card-kit";
import {
  nextStage,
  paidTier,
  payState,
  sendState,
  stageFacts,
  statusPlate,
  type Installment,
  type PayState,
  type ProposalRow,
} from "../proposals-data";
import { whoHtml } from "@/lib/team/who";

const SIGNED = new Set(["ACCEPTED", "COMPLETED", "PAID"]);

function ic(name: string): string {
  return '<svg class="ic" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}

/* ── LEFT: the job ─────────────────────────────────────────────────────────────────────────────────────────────── */

function statusStamp(p: ProposalRow, k: CardKit): string {
  const st = statusPlate(p.status);
  const fresh =
    !!p.fresh && k.bloomOnce(p.id, p.fresh.accepted ? "accepted" : "declined", p.fresh.accepted ?? p.fresh.declined);
  const title =
    p.fresh && p.fresh.accepted ? ' title="Accepted ' + k.esc(p.accepted ?? "") + '"' : p.fresh && p.fresh.declined ? ' title="Declined"' : "";
  return (
    '<span class="pstatus ' + st.cls + (fresh ? " pstatus--fresh" : "") + '"' + title + ">" +
    k.esc(st.label) +
    (p.accepted && SIGNED.has(p.status) ? '<em class="pstatus-d">' + k.esc(p.accepted) + "</em>" : "") +
    "</span>"
  );
}

function fact(label: string, value: string, mod = ""): string {
  return '<div class="cc-f' + mod + '"><dt>' + label + "</dt><dd>" + value + "</dd></div>";
}

function jobHtml(p: ProposalRow, chain: string, k: CardKit): string {
  const facts: string[] = [fact("Status", statusStamp(p, k)), fact("Views", k.viewsCellHtml(p)), fact("Updated", k.esc(p.updated))];
  // The member's mark only on someone else's proposal (owner, 2026-09-25).
  if (!p.mine) facts.push(fact("Owner", p.ownerWho ? whoHtml(p.ownerWho) : k.esc(p.owner)));
  if (p.co && p.co.count) {
    facts.push(
      fact(
        "Change orders",
        '<span class="cc-co' + (p.co.pending ? " cc-co--wait" : "") + '">' + p.co.count +
          (p.co.pending ? " · " + p.co.pending + " awaiting approval" : "") + "</span>",
      ),
    );
  }
  // A chained proposal has its project's header above it; one alone in view names its project here.
  if (p.projectId && !chain) {
    facts.push(
      fact(
        "Project",
        '<a class="pt-proj" href="/dashboard/projects/' + encodeURIComponent(p.projectId) + '">' + k.esc(p.projectName ?? "Project") + "</a>",
      ),
    );
  }
  const sub = k.subLine(p);
  return (
    '<div class="cc-job">' +
    k.kindHtml(p) +
    '<a class="cc-title" href="' + k.esc(k.proposalHref(p.id)) + '" title="' + k.esc(p.title) + '">' + k.esc(p.title) + "</a>" +
    (sub ? '<div class="cc-sub">' + k.esc(sub) + "</div>" : "") +
    k.clientDesignHtml(p) +
    '<dl class="cc-facts">' + facts.join("") + "</dl>" +
    "</div>"
  );
}

/* ── RIGHT: the money plate ────────────────────────────────────────────────────────────────────────────────────── */

function paidPct(p: ProposalRow): number {
  const contract = p.contract ?? p.total;
  if (contract > 0 && p.owed <= 0) return 100;
  return contract > 0 ? Math.max(0, Math.min(100, Math.round(((p.paidAmt ?? 0) / contract) * 100))) : 0;
}

/** Stage boundaries as % of the contract — skipped within a point of either end. */
function ticks(p: ProposalRow, k: CardKit): number[] {
  const contract = p.contract ?? p.total;
  const insts = p.inst ?? [];
  if (contract <= 0 || insts.length < 2) return [];
  const out: number[] = [];
  let acc = 0;
  for (let i = 0; i < insts.length - 1; i++) {
    acc += k.instDollars(p, insts[i]);
    const at = Math.round((acc / contract) * 10000) / 100;
    if (at > 1 && at < 99) out.push(at);
  }
  return out;
}

function barHtml(p: ProposalRow, state: PayState, k: CardKit): string {
  const contract = p.contract ?? p.total;
  const pct = state === "plan" ? 0 : paidPct(p);
  const paid = p.paidAmt ?? 0;
  return (
    '<div class="cc-bar cc-bar--' + (state === "plan" ? "plan" : paidTier(p)) + '" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct +
    '" aria-valuetext="' + k.esc(state === "plan" ? "Not billed yet" : k.fmtMoney(paid) + " paid of " + k.fmtMoney(contract)) + '">' +
    '<span style="width:' + pct + '%"></span>' +
    ticks(p, k).map((t) => '<i class="cc-tick" style="left:' + t + '%"></i>').join("") +
    "</div>"
  );
}

function stageHtml(p: ProposalRow, it: Installment, i: number, state: PayState, next: Installment | null, k: CardKit): string {
  const share = it.pct ? "<em>" + Math.round(it.amount) + "%</em>" : "";
  const amount = k.fmtMoney(k.instDollars(p, it));
  let tone = "later";
  let mark = '<i class="cc-dot" aria-hidden="true"></i>';
  let tail = "";
  if (it.status === "PAID") {
    tone = "paid";
    mark = ic("check");
    tail = it.paidOn ? "Paid " + it.paidOn : "Paid";
  } else if (it.status === "WAIVED") {
    tone = "closed";
    tail = "Closed";
  } else if (state === "plan") {
    // Not signed yet: only the first stage is billed on signing; the rest follow it.
    tail = it.due ? "Due " + it.due : i === 0 ? "After signing" : "Later";
  } else if (next && it.id === next.id) {
    // The stage being chased: framed, its facts on their own line, the office's actions under it.
    const facts = stageFacts(it).join(" · ") || "Next to collect";
    return (
      '<li class="cc-st cc-st--next' + (it.overdue ? " is-late" : "") + '" data-stage="' + k.esc(it.id) + '">' +
      '<span class="cc-st-k">' + k.esc(it.label) + share + "</span>" +
      '<span class="cc-st-v">' + amount + "</span>" +
      '<span class="cc-st-facts">' + k.esc(facts) + "</span>" +
      (p.canBill === false ? "" : k.payActsHtml(p, next)) +
      "</li>"
    );
  } else {
    tail = it.due ? "Due " + it.due : "Later";
  }
  return (
    '<li class="cc-st cc-st--' + tone + '" data-stage="' + k.esc(it.id) + '">' +
    '<span class="cc-st-m">' + mark + "</span>" +
    '<span class="cc-st-k">' + k.esc(it.label) + share + "</span>" +
    '<span class="cc-st-s">' + k.esc(tail) + "</span>" +
    '<span class="cc-st-v">' + amount + "</span>" +
    "</li>"
  );
}

function moneyHtml(p: ProposalRow, k: CardKit): string {
  const state = payState(p);
  const contract = p.contract ?? p.total;
  const signed = SIGNED.has(p.status);
  const head =
    '<div class="cc-mk">' + (signed ? "Contract" : "Quote") + "</div>" +
    '<div class="cc-amt">' + k.fmtMoney(contract) + "</div>";

  // Nothing to collect: a declined quote, an archived one, or no payment plan yet — a calm plate.
  if (!state) {
    const calm =
      p.status === "DECLINED" ? "Declined — nothing to collect" : p.status === "ARCHIVED" ? "Archived" : "No payment plan yet";
    return '<div class="cc-money cc-money--calm' + (p.status === "DECLINED" ? " cc-money--declined" : "") + '">' + head + '<p class="cc-calm">' + calm + "</p></div>";
  }

  const insts = p.inst ?? [];
  const next = state === "collect" ? nextStage(p) : null;
  let line = "";
  if (state === "plan") {
    const who = p.clientId && p.client ? p.client.split(/\s+/)[0] : "the client";
    line =
      '<div class="cc-line"><span>' + (insts.length || 1) + (insts.length === 1 ? " payment" : " payments") + "</span>" +
      '<span class="cc-line-r">' + k.esc("Billed after " + who + " accepts") + "</span></div>";
  } else if (state === "paid") {
    line = '<div class="cc-line cc-line--ok"><span>' + ic("check") + "Paid in full</span></div>";
  } else {
    line =
      '<div class="cc-line"><span><b>' + k.fmtMoney(p.paidAmt ?? 0) + "</b> paid</span>" +
      '<span class="cc-line-r cc-due"><b>' + k.fmtMoney(p.owed) + "</b> due</span></div>";
  }

  let stages = insts.map((it, i) => stageHtml(p, it, i, state, next, k)).join("");
  // Signed with no schedule: the balance is the one thing to collect.
  if (!stages && state === "collect") {
    stages =
      '<li class="cc-st cc-st--next"><span class="cc-st-k">Balance</span><span class="cc-st-v">' + k.fmtMoney(p.owed) + "</span>" +
      '<span class="cc-st-facts">Next to collect</span>' + (p.canBill === false ? "" : k.payActsHtml(p, null)) + "</li>";
  }
  // A sales rep or an estimator reads what is left instead of the billing buttons.
  const left = state === "collect" && p.canBill === false ? '<p class="cc-left"><b>' + k.fmtMoney(p.owed) + "</b> left to collect</p>" : "";

  return (
    '<div class="cc-money cc-money--' + state + '">' +
    '<div class="cc-sum">' + head + barHtml(p, state, k) + line + "</div>" +
    (stages ? '<ol class="cc-stages">' + stages + "</ol>" : "") +
    left +
    k.finHtml(p) +
    "</div>"
  );
}

/* ── FOOT: one ruled action bar ────────────────────────────────────────────────────────────────────────────────── */

function footHtml(p: ProposalRow, k: CardKit): string {
  const send =
    sendState(p) === "none"
      ? '<button class="cc-c" type="button" data-act="send" title="' + k.esc(p.clientEmail ? "Send to " + p.clientEmail : "Send to the client") + '">' + ic("send") + "Send to client</button>"
      : k.sendCellHtml(p);
  return (
    '<div class="cc-foot">' +
    '<a class="cc-c cc-c--open" href="' + k.esc(k.proposalHref(p.id)) + '" title="Open the proposal">' + ic("pen") + "Open</a>" +
    send +
    '<a class="cc-c" href="/portal/q/' + encodeURIComponent(p.publicId) + '" target="_blank" rel="noopener noreferrer" title="Client view — the page the client gets, in a new tab">' + ic("eye") + "Client view</a>" +
    '<button class="cc-c" type="button" data-act="change-order" title="Price extras, send for signature">' + ic("plus") +
    (p.co && p.co.count ? "Change orders · " + p.co.count : "Change order") + "</button>" +
    (p.zillow
      ? '<a class="cc-c" href="' + k.esc(p.zillow) + '" target="_blank" rel="noopener noreferrer" title="Open the listing">' + ic("building") + "Zillow</a>"
      : "") +
    '<button class="cc-c" type="button" data-act="copylink" title="Copy the client\'s link to paste into a text">' + ic("link") + "Copy client link</button>" +
    '<button class="cc-c cc-c--del" type="button" data-act="del" title="Delete this proposal — permanent">' + ic("trash") + "Delete</button>" +
    "</div>"
  );
}

export const renderCardC: CardRenderer = (p, chain, kit) => {
  const hasPay = !!payState(p);
  return (
    '<tr class="prow cc-row' + chain + (hasPay ? " has-pay" : " no-pay") + '" data-id="' + kit.esc(p.id) + '"' +
    (chain && p.projectId ? ' data-grp="' + kit.esc(p.projectId) + '"' : "") +
    '><td class="cc-td" colspan="6"><div class="cc-wrap"><article class="cc">' +
    jobHtml(p, chain, kit) +
    moneyHtml(p, kit) +
    footHtml(p, kit) +
    "</article></div></td></tr>"
  );
};
