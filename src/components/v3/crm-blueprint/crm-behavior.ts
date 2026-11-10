// CRM blueprint — runtime behaviors, ported verbatim from the donor file's
// <script> (jobflex-crm-blueprint_1.html). Every duration, easing, stagger,
// page size, formula and markup string is the donor's exact value.
//
// Adaptations are mechanical only:
// - queries are scoped to the mounted `.content` root;
// - document/window listeners, timers and observers are tracked for unmount
//   cleanup;
// - the donor blocks that belong to the persistent chrome are NOT ported here:
//   the mobile nav drawer, FLUID SCALE (+ the `eff-*` breakpoint classes), the
//   sidebar entry cascade, the sliding sidebar indicator and the graph-paper
//   parallax all live in components/v3/blueprint-shell/shell-behavior.ts;
// - `pressify` keeps the donor's selector minus the shell-owned controls
//   (.icon-btn, .sb-foot-ic, .sb-foot-acc), which the shell already presses.
//
// Like the donor, list markup is built with innerHTML — but no longer from the
// demo data. The page (src/app/dashboard/crm/page.tsx) reads the real rows out
// of Prisma and hands them in through `options.data`; the fixture in
// crm-data.ts survives only as the fallback for a render with no session.
// Because the strings are now user-authored records rather than the donor's own
// literals, everything interpolated into markup goes through `escapeAttr`.
//
// WRITES: the workflow rules and the follow-up queue call the live server
// actions in src/actions/followUps.ts — the same ones the classic CRM pages
// used (upsert / setEnabled / delete for rules, runNow / markDone for the
// queue). They are org-scoped and role-gated on the server and they revalidate
// the classic routes, so the two editions stay in step. Local state is patched
// from the result, so the sheet repaints immediately instead of waiting on a
// round trip; a reload reads the same rows back.

import {
  deleteFollowUpRule,
  markFollowUpDone,
  runFollowUpNow,
  setFollowUpRuleEnabled,
  turnOnDefaultFollowUps,
  upsertFollowUpRule,
} from "@/actions/followUps";
import { leaveRow, staggerIn } from "@/components/v3/blueprint-shell/list-motion";
import { whoHtml } from "@/lib/team/who";
import { renderEmail } from "@/lib/email/renderEmail";
import {
  FOLLOW_UP_CHANNELS,
  MAX_DELAY_DAYS,
  TEXT_NEEDS_TWILIO,
  channelLabel,
  delayLabel,
  followUpsStatus,
  readDelayDays,
  followUpEmailDoc,
  followUpSmsText,
  previewContext,
  triggerMoment,
  type FollowUpChannel,
} from "@/lib/followUps/copy";
import { FOLLOW_UP_MODES, FOLLOW_UP_WORDS, modeLabel, parseMode, parseWords, type FollowUpMode, type FollowUpWords } from "@/lib/followUps/agent";
import {
  STATUS_ORDER,
  STATUS_CLS,
  TRIGGERS,
  Q_PAGE,
  type ActivityItem,
  type CrmContentData,
  type CrmLead,
  type CrmStats,
  type Customer,
  type FollowUpRule,
  type QueueItem,
} from "./crm-data";

export type CrmContentOptions = {
  /** The org's real CRM rows, read server-side. REQUIRED — there is no fixture
   *  fallback any more, so the sheet cannot paint demo records. */
  data: CrmContentData;
  /** Client-side navigation, supplied by the React wrapper (this module has no
   *  router of its own). Omit and the overview's cross-links stay inert. */
  navigate?: (href: string) => void;
};

/** Server actions reject with an Error whose message is written for the user
 *  ("Not found", the role guard's refusal). Surface that text; fall back to a
 *  generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  // A Next.js server-action transport failure has no useful message.
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** Every value interpolated into an innerHTML string is now a database record,
 *  not a donor literal. */
function escapeAttr(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function initCrmContent(content: HTMLElement, options: CrmContentOptions): () => void {
  // Scoped to `.content`, which the shared shell owns and re-fills on every
  // navigation. `.main` lives in the shell, above this element.
  const root = content;
  const main = content.closest<HTMLElement>(".main");

  const disposers: Array<() => void> = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const on = (
    target: EventTarget,
    ev: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // Module isolation: a failure in one block must not disable the rest.
  function safe(name: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.error("[JobFlex] module failed: " + name, err);
    }
  }

  // Dismiss Lead Center banners (smooth height + gap collapse) — inert on this
  // page (no banner in the markup), kept for donor parity with shared shells.
  $$(".banner-close").forEach((btn) => {
    btn.addEventListener("click", () => {
      const b = btn.closest<HTMLElement>(".banner");
      if (!b || b.classList.contains("closing")) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        b.classList.add("hidden");
        return;
      }
      b.style.height = b.offsetHeight + "px";
      b.style.transitionDelay = "0ms";
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          b.classList.add("closing");
          b.style.height = "0px";
        }),
      );
      b.addEventListener("transitionend", function te(e) {
        if (e.propertyName !== "height") return;
        b.classList.add("hidden");
        b.removeEventListener("transitionend", te);
      });
    });
  });

  /** `leaveRow` wants `(ms, fn)`; the donor's helper is `(fn, ms)`. */
  const after = (ms: number, fn: () => void) => {
    later(fn, ms);
  };

  // ================= CRM: STATE =================
  // The org's real rows, read in the page's server component. They are CLONED,
  // because rule create/edit/toggle/delete and queue done/send mutate them in
  // place: the server actions are the source of truth, and these arrays mirror
  // them so the sheet repaints the moment one returns instead of waiting on a
  // round trip through the router.
  const live = options.data;
  const stats: CrmStats = { ...live.stats };
  const freshData: CrmLead[] = live.fresh.map((l) => ({ ...l }));
  const activityData: ActivityItem[] = live.activity.map((a) => ({ ...a }));
  const customersData: Customer[] = live.customers.map((c) => ({ ...c }));
  let rulesData: FollowUpRule[] = live.rules.map((r) => ({ ...r }));
  let queueData: QueueItem[] = live.queue.map((q) => ({ ...q }));
  const orgBrand = { ...live.org };
  const smsEnabled = live.smsEnabled;
  /** The server's clock at render — "next send in 5 h" hydrates as rendered. */
  const renderedAt = live.renderedAt;

  /** True while any write is in flight, so a double click cannot fire twice. */
  const crm = {
    // Today is the first tab now (lib/crm/brief); the overview panel starts hidden.
    tab: "today",
    cbFilter: [] as string[],
    qTab: "ALL",
    qPage: 1,
    editing: null as string | null,
    creating: false,
    savingRule: false,
    busyRule: null as string | null,
    busyQueue: null as string | null,
    /** What the preview card is showing. Seeded from the first rule, then
     *  driven by whichever rule form is open — change the trigger in the form
     *  and the card beside it re-renders. */
    prevTrigger: rulesData[0]?.triggerStatus ?? "SENT",
    prevChannel: (rulesData[0]?.channel ?? "EMAIL") as FollowUpChannel,
    prevDelay: rulesData[0]?.delayMinutes ?? 60 * 24 * 2,
  };

  function showErr(sel: string, msg: string | null) {
    const box = $(sel);
    if (!box) return;
    box.textContent = msg || "";
    box.classList.toggle("is-hidden", !msg);
  }

  function money(n: number) {
    // Whole dollars. A bare toLocaleString keeps up to three decimals, so a
    // float sum of proposal totals printed as "$61,970.446" (owner, 2026-09-18).
    return "$" + Math.round(n).toLocaleString("en-US");
  }
  function titleCase(s: string) {
    return s.charAt(0) + s.slice(1).toLowerCase();
  }
  function humanDelay(min: number) {
    if (min < 60) return min + "m";
    if (min < 60 * 24) return Math.round(min / 60) + "h";
    return Math.round(min / 60 / 24) + "d";
  }
  function dueNow() {
    return queueData.filter(function (q) {
      return q.overdue;
    });
  }
  function scheduled() {
    return queueData.filter(function (q) {
      return !q.overdue;
    });
  }

  // ================= OVERVIEW =================
  function renderStats() {
    const won = stats.won;
    const lost = stats.lost;
    const active = stats.active;
    const rate = won + lost > 0 ? (won / (won + lost)) * 100 : 0;
    const due = dueNow().length;
    const cards: Array<{
      lbl: string;
      val: string;
      delta?: { txt: string; dir: string } | null;
    }> = [
      {
        lbl: "Conversion rate",
        val: rate.toFixed(1) + "%",
        delta:
          won + lost > 0
            ? { txt: won + " won · " + lost + " lost", dir: rate >= 50 ? "up" : "down" }
            : null,
      },
      { lbl: "Active leads", val: String(active) },
      { lbl: "Follow-ups due", val: String(due) },
      { lbl: "Shared inbox", val: String(stats.conversations) },
    ];
    const grid = $("#statGrid");
    if (!grid) return;
    grid.innerHTML = cards
      .map(function (c) {
        return (
          '<div class="stat"><div class="kpi-lbl">' +
          c.lbl +
          "</div>" +
          '<div class="stat-val">' +
          c.val +
          "</div>" +
          (c.delta
            ? '<div class="stat-delta ' +
              c.delta.dir +
              '">' +
              (c.delta.dir === "up" ? "▲" : "▼") +
              " " +
              c.delta.txt +
              "</div>"
            : "") +
          "</div>"
        );
      })
      .join("");
  }

  function renderFresh() {
    // The page already queried the five newest NEW/ROUTED/CLAIMED leads, in
    // that order — the classic overview's query. Slice defensively only.
    const rows = freshData.slice(0, 5);
    const list = $("#freshList");
    if (!list) return;
    list.innerHTML =
      rows
        .map(function (l) {
          return (
            '<li><div style="min-width:0"><div class="fresh-name">' +
            escapeAttr(l.name) +
            "</div>" +
            '<div class="fresh-sub">' +
            escapeAttr(l.project) +
            (l.assignee ? " · " + escapeAttr(l.assignee) : "") +
            "</div></div>" +
            '<div class="fresh-right"><span class="pstatus pstatus--sent">' +
            escapeAttr(l.status.toLowerCase()) +
            "</span>" +
            '<span class="fresh-age">' +
            escapeAttr(l.age) +
            "</span></div></li>"
          );
        })
        .join("") || '<li><span class="fresh-sub">No new leads.</span></li>';
  }

  function renderActions() {
    const due = dueNow().length;
    const active = stats.active;
    // `go` switches a tab on this sheet; `nav` leaves for another page. The two
    // middle rows used to carry `data-flash="Opened"` — a 1600ms label swap
    // that opened nothing. They are the classic overview's links now.
    const rows: Array<{
      show: boolean;
      tone: string;
      ic: string;
      t: string;
      h: string;
      go: string | null;
      nav?: string;
    }> = [
      {
        show: due > 0,
        tone: "danger",
        ic: "i-cal",
        t: due + " follow-up" + (due === 1 ? "" : "s") + " overdue",
        h: "Run or mark done in the queue",
        go: "queue",
      },
      {
        show: active > 0,
        tone: "accent",
        ic: "i-target",
        t: active + " lead" + (active === 1 ? "" : "s") + " still in motion",
        h: "Push them forward in the kanban",
        go: null,
        nav: "/dashboard/leads",
      },
      {
        show: stats.conversations > 0,
        tone: "",
        ic: "i-msg",
        t: stats.conversations + " conversation" + (stats.conversations === 1 ? "" : "s"),
        h: "Open the shared inbox",
        go: null,
        nav: "/dashboard/messages",
      },
      {
        show: true,
        tone: "",
        ic: "i-chart",
        t: "Quote → close optimization",
        h: "Tighten your follow-up workflow rules",
        go: "workflows",
      },
    ];
    const list = $("#actionList");
    if (!list) return;
    list.innerHTML = rows
      .filter(function (r) {
        return r.show;
      })
      .map(function (r) {
        return (
          '<li><button class="arow' +
          (r.tone ? " arow--" + r.tone : "") +
          '" type="button"' +
          (r.go ? ' data-goto="' + r.go + '"' : "") +
          (r.nav ? ' data-nav="' + r.nav + '"' : "") +
          ">" +
          '<span class="arow-ic"><svg class="ic"><use href="#' +
          r.ic +
          '"/></svg></span>' +
          '<span class="arow-txt"><span class="arow-t" style="display:block">' +
          r.t +
          "</span>" +
          '<span class="arow-h" style="display:block">' +
          r.h +
          "</span></span>" +
          '<svg class="ic arow-go"><use href="#i-arrow"/></svg></button></li>'
        );
      })
      .join("");
  }

  function renderRecent() {
    const list = $("#recentList");
    if (!list) return;
    list.innerHTML =
      activityData
        .slice(0, 5)
        .map(function (a) {
          return (
            "<li><span>" +
            escapeAttr(a.summary) +
            '</span><span class="recent-age">' +
            escapeAttr(a.age) +
            // Who did it, on its own line under the sentence (owner, 2026-09-24).
            '</span><span class="recent-who">' +
            whoHtml(a.who, { compact: true }) +
            "</span></li>"
          );
        })
        .join("") || '<li><span class="recent-age">Nothing recorded yet.</span></li>';
  }

  // ================= CUSTOMER BOOK =================
  function renderCbTiles() {
    const totalLtv = customersData.reduce(function (a, c) {
      return a + c.ltv;
    }, 0);
    const totalQuotes = customersData.reduce(function (a, c) {
      return a + c.quotes;
    }, 0);
    const tiles = $("#cbTiles");
    if (!tiles) return;
    tiles.innerHTML =
      '<div class="cb-tile"><div class="kpi-lbl">Customers</div><div class="cb-val">' +
      customersData.length +
      '</div><div class="cb-hint">with ≥1 proposal</div></div>' +
      '<div class="cb-tile"><div class="kpi-lbl">Lifetime value</div><div class="cb-val">' +
      money(totalLtv) +
      '</div><div class="cb-hint">paid to date</div></div>' +
      '<div class="cb-tile"><div class="kpi-lbl">Total proposals</div><div class="cb-val">' +
      totalQuotes +
      '</div><div class="cb-hint">all statuses</div></div>';
  }

  function cbFiltered() {
    return crm.cbFilter.length === 0
      ? customersData
      : customersData.filter(function (c) {
          return crm.cbFilter.indexOf(c.top) !== -1;
        });
  }

  function renderCbChips() {
    const counts: Record<string, number> = {};
    customersData.forEach(function (c) {
      counts[c.top] = (counts[c.top] || 0) + 1;
    });
    const present = STATUS_ORDER.filter(function (s) {
      return counts[s] > 0;
    });
    let html =
      '<button class="cb-chip' +
      (crm.cbFilter.length === 0 ? " on" : "") +
      '" type="button" data-cb="ALL">All <span class="cb-n">' +
      customersData.length +
      "</span></button>";
    present.forEach(function (s) {
      // No status dot: the chip itself carries the status color once active
      // (`cb-chip--<status>` + `.on` in the CSS module).
      html +=
        '<button class="cb-chip cb-chip--' +
        s.toLowerCase() +
        (crm.cbFilter.indexOf(s) !== -1 ? " on" : "") +
        '" type="button" data-cb="' +
        s +
        '">' +
        titleCase(s) +
        ' <span class="cb-n">' +
        counts[s] +
        "</span></button>";
    });
    const chips = $("#cbChips");
    if (chips) chips.innerHTML = html;
    const shown = cbFiltered().length;
    const caption = $("#cbCaption");
    if (caption) {
      caption.textContent =
        crm.cbFilter.length === 0
          ? customersData.length + " customer" + (customersData.length === 1 ? "" : "s")
          : shown + " of " + customersData.length + " shown";
    }
  }

  function renderCbTable() {
    const rows = cbFiltered();
    const body = $("#cbBody");
    if (!body) return;
    body.innerHTML = rows.length
      ? rows
          .map(function (c) {
            return (
              '<tr class="prow">' +
              '<td><div class="cb-name">' +
              escapeAttr(c.name) +
              '</div><div class="cb-mail">' +
              (c.email ? escapeAttr(c.email) : "—") +
              "</div></td>" +
              // A status outside the donor's eight has no class; the bare
              // `.pstatus` (draft treatment) is the right neutral fallback,
              // where `undefined` would have printed into the class list.
              '<td><span class="pstatus ' +
              (STATUS_CLS[c.top] || "") +
              '">' +
              titleCase(c.top) +
              "</span></td>" +
              '<td class="num"><span class="pt-mono">' +
              c.quotes +
              "</span></td>" +
              '<td class="num"><span class="pt-money">' +
              money(c.quoted) +
              "</span></td>" +
              '<td class="num">' +
              (c.ltv > 0
                ? '<span class="pt-money cb-ltv">' + money(c.ltv) + "</span>"
                : '<span class="cb-none">—</span>') +
              "</td>" +
              '<td><span class="pt-mono">' +
              c.last +
              "</span></td>" +
              "</tr>"
            );
          })
          .join("")
      : '<tr><td colspan="6" style="text-align:center;padding:38px 16px;color:var(--muted)">No customers match this filter.</td></tr>';
  }

  // ================= WORKFLOWS =================
  /** The one line over the rules: on/off, how many, when the next one goes. */
  function renderFuStatus() {
    const box = $("#fuStatus");
    if (!box) return;
    const next = queueData.reduce<number | null>((m, q) => (m === null || q.runAt < m ? q.runAt : m), null);
    const st = followUpsStatus(rulesData.filter((r) => r.enabled).length, next, renderedAt);
    box.classList.toggle("is-off", !st.on);
    const txt = $("#fuStatusTxt");
    if (txt) txt.innerHTML = "<b>" + escapeAttr(st.lead) + "</b>" + (st.rest ? " " + escapeAttr(st.rest) : "");
    const btn = $("#fuDefaultsBtn");
    if (btn) btn.classList.toggle("is-hidden", st.on);
  }

  function renderRules() {
    renderFuStatus();
    const empty = $("#rulesEmpty");
    if (empty) empty.classList.toggle("is-hidden", rulesData.length !== 0 || crm.creating);
    const list = $("#rulesList");
    if (list) {
      list.innerHTML = rulesData
        .map(function (r) {
          if (crm.editing === r.id) return "<li>" + ruleFormHtml(r) + "</li>";
          const trig =
            (
              TRIGGERS.find(function (t) {
                return t.value === r.triggerStatus;
              }) || ({} as { label?: string })
            ).label || r.triggerStatus;
          const busy = crm.busyRule === r.id ? " disabled" : "";
          return (
            '<li data-rule="' +
            escapeAttr(r.id) +
            '">' +
            '<div style="min-width:0;flex:1">' +
            '<div class="rule-name">' +
            escapeAttr(r.name) +
            (r.isDefault ? '<span class="rule-def">Default</span>' : "") +
            '<span class="pstatus ' +
            (r.enabled ? "rst--on" : "rst--off") +
            '">' +
            ruleBadge(r) +
            "</span></div>" +
            '<div class="rule-meta">Trigger: <b>' +
            escapeAttr(trig) +
            "</b> · Delay: <b>" +
            humanDelay(r.delayMinutes) +
            "</b> · Sends: <b>" +
            channelLabel(r.channel) +
            "</b> · <b data-rule-mode=\"" +
            parseMode(r.mode) +
            "\">" +
            modeLabel(parseMode(r.mode)) +
            "</b>" +
            (parseWords(r.words) === "AI" ? " · <b data-rule-words=\"AI\">Written for each client</b>" : "") +
            "</div>" +
            '<div class="rule-tpl">' +
            escapeAttr(triggerMoment(r.triggerStatus)) +
            "</div>" +
            "</div>" +
            '<div class="rule-act">' +
            '<button class="tgl' +
            (r.enabled ? " on" : "") +
            '" type="button" data-act="toggle" aria-pressed="' +
            (r.enabled ? "true" : "false") +
            '" aria-label="Toggle rule"' +
            busy +
            "></button>" +
            '<button class="btn btn-ghost btn--sm" type="button" data-act="preview" aria-label="Preview ' +
            escapeAttr(r.name) +
            '">Preview</button>' +
            '<button class="btn btn-ghost btn--sm" type="button" data-act="edit"' + busy + ">Edit</button>" +
            // A turned-off starter rule has nothing left to delete; the switch turns it back on.
            // The empty cell keeps its switch and Edit in line with the rows around it.
            (r.isDefault && !r.enabled
              ? '<span class="rule-del" aria-hidden="true" style="visibility:hidden"></span>'
              : '<button class="rule-del" type="button" data-act="del-rule" aria-label="' +
                (r.isDefault ? "Turn off rule" : "Delete rule") +
                '"' +
                busy +
                '><svg class="ic"><use href="#i-trash"/></svg></button>') +
            "</div></li>"
          );
        })
        .join("");
    }
    const form = $("#ruleForm");
    if (!form) return;
    form.classList.toggle("is-hidden", !crm.creating);
    if (crm.creating) form.innerHTML = ruleFormHtml(null);
  }

  /** One plain sentence under the form: what the two choices mean together. */
  function agentNote(mode: FollowUpMode, words: FollowUpWords): string {
    const m = FOLLOW_UP_MODES.find((x) => x.value === mode);
    const w = FOLLOW_UP_WORDS.find((x) => x.value === words);
    return (m ? m.hint : "") + (mode === "SUGGEST" ? "" : " " + (w ? w.hint : ""));
  }

  function ruleFormHtml(r: FollowUpRule | null) {
    const days = r ? Math.max(1, Math.round(r.delayMinutes / 60 / 24)) : 2;
    return (
      '<div class="rf-body" data-form="' +
      (r ? r.id : "new") +
      '">' +
      '<div class="rf-grid">' +
      '<label><span class="rf-lbl">Rule name</span><input class="rf-in" data-f="name" maxlength="120" value="' +
      (r ? escapeAttr(r.name) : "") +
      '" placeholder="Nudge after send"></label>' +
      // Both selects use the shared blueprint treatment published in
      // blueprint-global.css: the WRAPPER `.bp-sel` draws the chevron (a
      // <select> can carry no pseudo-element), `.bp-sel-in` kills the OS
      // appearance. No `rf-sel` class any more — it out-specified the shared
      // rule and dragged the native font/border back.
      '<label><span class="rf-lbl">Trigger</span><span class="bp-sel"><select class="bp-sel-in" data-f="trigger">' +
      TRIGGERS.map(function (t) {
        return (
          '<option value="' +
          t.value +
          '"' +
          (r && r.triggerStatus === t.value ? " selected" : "") +
          ">" +
          t.label +
          "</option>"
        );
      }).join("") +
      "</select></span></label>" +
      '<label><span class="rf-lbl">Delay (days)</span><input class="rf-in" type="number" min="1" max="' + MAX_DELAY_DAYS + '" step="1" inputmode="numeric" data-f="days" value="' +
      days +
      '"></label>' +
      // The rule has no template any more — the wording is derived from the
      // trigger. The one remaining choice is HOW it reaches the client, and
      // TEXT is only offered when this deployment has a Twilio number (the
      // server refuses it either way).
      '<label><span class="rf-lbl">Send by</span><span class="bp-sel"><select class="bp-sel-in" data-f="channel">' +
      FOLLOW_UP_CHANNELS.map(function (c) {
        return (
          '<option value="' +
          c.value +
          '"' +
          (c.value === "TEXT" && !smsEnabled ? " disabled" : "") +
          ((r ? r.channel : "EMAIL") === c.value ? " selected" : "") +
          ">" +
          c.label +
          "</option>"
        );
      }).join("") +
      "</select></span></label>" +
      // WHO SENDS IT and WHOSE WORDS (Smart CRM part 4, lib/followUps/agent). Whatever is picked, a follow-up stops
      // by itself when the client replies, signs or pays.
      '<label><span class="rf-lbl">Who sends it</span><span class="bp-sel"><select class="bp-sel-in" data-f="mode">' +
      FOLLOW_UP_MODES.map(function (m) {
        return '<option value="' + m.value + '"' + (parseMode(r?.mode) === m.value ? " selected" : "") + ">" + m.label + "</option>";
      }).join("") +
      "</select></span></label>" +
      '<label><span class="rf-lbl">Words</span><span class="bp-sel"><select class="bp-sel-in" data-f="words">' +
      FOLLOW_UP_WORDS.map(function (w) {
        return '<option value="' + w.value + '"' + (parseWords(r?.words) === w.value ? " selected" : "") + ">" + w.label + "</option>";
      }).join("") +
      "</select></span></label>" +
      "</div>" +
      '<div class="rf-note" data-rf-agent>' +
      escapeAttr(agentNote(parseMode(r?.mode), parseWords(r?.words))) +
      "</div>" +
      '<div class="rf-note">' +
      (smsEnabled
        ? "The card on the right is the message this rule sends."
        : TEXT_NEEDS_TWILIO + " Email works now — see the card on the right.") +
      "</div>" +
      '<div class="mf-err is-hidden" data-rf-err role="alert"></div>' +
      '<div class="rf-act">' +
      '<button class="btn btn-primary btn--sm" type="button" data-act="save-rule"><svg class="ic"><use href="#i-check"/></svg><span data-save-lbl>Save rule</span></button>' +
      '<button class="btn btn-ghost btn--sm" type="button" data-act="cancel-rule">Cancel</button>' +
      "</div></div>"
    );
  }

  // ================= PREVIEW =================
  // The card to the right of the rules. It renders the REAL message: the doc
  // comes from src/lib/followUps/copy.ts and the HTML from
  // lib/email/renderEmail — the same two calls dispatchOne() makes. Change the
  // trigger (here or in an open rule form) and this repaints.
  //
  // The email goes in an iframe because it is a whole document with its own
  // <style> block and its own 560px measure; inlining it would let the app's
  // stylesheet leak in and stop the preview from being truthful. Scripts are
  // sandboxed off; `allow-same-origin` is kept only so the frame's own height
  // can be measured after it paints.
  let prevFrame: HTMLIFrameElement | null = null;
  let prevDocHeight = 900;

  function previewCtx() {
    const ctx = previewContext(orgBrand.name, crm.prevDelay);
    ctx.orgPhone = orgBrand.phone;
    ctx.orgLogoUrl = orgBrand.logoUrl;
    return ctx;
  }

  /** The email frame is authored at its natural 600px and scaled down to the
   *  column, so the layout stays the one the client will actually see.
   *
   *  The document is re-measured on every fit, not just on load: the first
   *  render happens while the Workflows panel is still `display: none`, where
   *  the frame has no layout and reports nothing — so the height has to be
   *  taken again the moment the panel is shown. `body.scrollHeight` is the
   *  body's own content height here (the email is shorter than the frame), not
   *  the frame's viewport. +12 keeps the card's offset shadow and bottom border
   *  inside the stage rather than shaved off by it. */
  function fitPreviewFrame() {
    const stage = $("#prevStage");
    if (!stage || !prevFrame || !stage.contains(prevFrame)) return;
    const w = stage.clientWidth;
    if (!w) return;
    const h = prevFrame.contentDocument?.body?.scrollHeight;
    if (h) prevDocHeight = h + 12;
    const s = Math.min(1, w / 600);
    prevFrame.style.height = prevDocHeight + "px";
    prevFrame.style.transform = "scale(" + s + ")";
    stage.style.height = Math.round(prevDocHeight * s) + "px";
  }

  function renderPreview() {
    const sel = $("#prevTrigger");
    if (sel instanceof HTMLSelectElement) {
      if (!sel.options.length) {
        sel.innerHTML = TRIGGERS.map(function (t) {
          return '<option value="' + t.value + '">' + t.label + "</option>";
        }).join("");
      }
      sel.value = crm.prevTrigger;
    }

    const sub = $("#prevSub");
    if (sub) {
      const trig =
        TRIGGERS.find(function (t) {
          return t.value === crm.prevTrigger;
        })?.label ?? crm.prevTrigger;
      sub.textContent =
        channelLabel(crm.prevChannel) +
        " · " +
        delayLabel(crm.prevDelay) +
        " after " +
        trig.toLowerCase();
    }

    const stage = $("#prevStage");
    if (!stage) return;
    const ctx = previewCtx();

    if (crm.prevChannel === "TEXT") {
      prevFrame = null;
      stage.style.height = "";
      stage.innerHTML =
        '<div class="prev-sms"><div class="prev-sms-hd">' +
        escapeAttr(orgBrand.name) +
        '</div><div class="prev-sms-bub">' +
        escapeAttr(followUpSmsText(crm.prevTrigger, ctx)) +
        "</div>" +
        (smsEnabled
          ? ""
          : '<div class="prev-sms-warn">' + TEXT_NEEDS_TWILIO + "</div>") +
        "</div>";
      return;
    }

    const { html } = renderEmail(followUpEmailDoc(crm.prevTrigger, ctx));
    if (!prevFrame || !stage.contains(prevFrame)) {
      stage.innerHTML = "";
      const frame = document.createElement("iframe");
      frame.className = "prev-frame";
      frame.title = "Follow-up email preview";
      frame.setAttribute("sandbox", "allow-same-origin");
      frame.addEventListener("load", function () {
        fitPreviewFrame();
      });
      stage.appendChild(frame);
      prevFrame = frame;
    }
    prevFrame.srcdoc = html;
    fitPreviewFrame();
  }

  // ================= QUEUE =================
  function severity(q: QueueItem) {
    // In a person's hands (lib/followUps/agent): the draft is on the Today tab.
    if (q.waiting) return { cls: "sev--soon", label: "waiting for you" };
    if (!q.overdue) return { cls: "sev--sched", label: q.rel };
    if (q.days <= 0) return { cls: "sev--soon", label: "due today" };
    if (q.days >= 7) return { cls: "sev--vlate", label: q.days + "d late" };
    if (q.days >= 3) return { cls: "sev--late", label: q.days + "d late" };
    return { cls: "sev--soon", label: q.days + "d late" };
  }

  /** Everything about the queue EXCEPT the rows: the four counters, the empty
   *  state and the pager. Split out so `leaveRow`'s commit can bring them up to
   *  date without rebuilding `#queueBody` — a rebuild would replace the
   *  surviving <tr>s the FLIP is measuring and the gap would snap shut. */
  function renderQueueChrome() {
    const nAll = $('[data-qn="ALL"]');
    if (nAll) nAll.textContent = String(queueData.length);
    const nDue = $('[data-qn="DUE"]');
    if (nDue) nDue.textContent = String(dueNow().length);
    const nSched = $('[data-qn="SCHEDULED"]');
    if (nSched) nSched.textContent = String(scheduled().length);
    const tabN = $("#queueTabN");
    if (tabN) tabN.textContent = String(dueNow().length);

    const pages = Math.max(1, Math.ceil(qRows().length / Q_PAGE));
    if (crm.qPage > pages) crm.qPage = pages;
    const card = $("#queueCard");
    if (card) card.classList.toggle("is-hidden", queueData.length === 0);
    const qEmpty = $("#queueEmpty");
    if (qEmpty) qEmpty.classList.toggle("is-hidden", queueData.length !== 0);
    const el = $("#queuePager");
    if (!el) return;
    if (pages <= 1) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML =
      '<span class="pager-info">Page ' +
      crm.qPage +
      " / " +
      pages +
      "</span>" +
      '<button class="pager-btn" type="button" data-pg="prev"' +
      (crm.qPage <= 1 ? " disabled" : "") +
      ' aria-label="Previous"><svg class="ic rot-l"><use href="#i-chev"/></svg></button>' +
      '<button class="pager-btn" type="button" data-pg="next"' +
      (crm.qPage >= pages ? " disabled" : "") +
      ' aria-label="Next"><svg class="ic rot-r"><use href="#i-chev"/></svg></button>';
  }

  /** The rows the active queue tab shows. */
  function qRows(): QueueItem[] {
    return crm.qTab === "DUE" ? dueNow() : crm.qTab === "SCHEDULED" ? scheduled() : queueData;
  }

  function renderQueue() {
    renderQueueChrome();
    const slice = qRows().slice((crm.qPage - 1) * Q_PAGE, crm.qPage * Q_PAGE);
    const body = $("#queueBody");
    if (!body) return;
    body.innerHTML = slice
      .map(function (q) {
        const sev = severity(q);
        const busy = crm.busyQueue === q.id ? " disabled" : "";
        return (
          '<tr class="prow q-row" data-q="' +
          escapeAttr(q.id) +
          '">' +
          '<td><div class="q-who">' +
          escapeAttr(q.client) +
          '</div><div class="q-title">' +
          escapeAttr(q.title || "Follow-up") +
          "</div></td>" +
          '<td><span class="sev ' +
          sev.cls +
          '">' +
          escapeAttr(sev.label) +
          "</span></td>" +
          '<td><div class="q-date">' +
          escapeAttr(q.date) +
          '</div><div class="q-rel">' +
          escapeAttr(q.rel) +
          "</div>" +
          // Why the agent is holding it ("Someone wrote to them Nov 9 — waiting 2 days").
          (q.reason && !q.waiting ? '<div class="q-rel" data-q-reason>' + escapeAttr(q.reason) + "</div>" : "") +
          "</td>" +
          '<td><div class="q-act">' +
          '<button class="btn btn-ghost btn--sm" type="button" data-act="q-done"' +
          busy +
          '><svg class="ic"><use href="#i-check"/></svg><span data-q-lbl>Done</span></button>' +
          '<button class="btn btn-primary btn--sm" type="button" data-act="q-send"' +
          busy +
          '><svg class="ic"><use href="#i-send"/></svg><span data-q-lbl>Send</span></button>' +
          "</div></td></tr>"
        );
      })
      .join("");
  }

  function renderCrm() {
    renderStats();
    renderFresh();
    renderActions();
    renderRecent();
    renderCbTiles();
    renderCbChips();
    renderCbTable();
    renderRules();
    renderPreview();
    renderQueue();
  }

  // ================= EVENTS =================
  /** A panel's row cascade plays once, the first time that panel is actually on
   *  screen. Staggering inside a `display: none` subtree leaves the inline
   *  `transform: none` pinned forever, which outranks every stylesheet `:hover`
   *  rule — the rows silently stop lifting. */
  const staggered: Record<string, boolean> = { overview: true };
  function playPanelStagger(name: string) {
    if (staggered[name]) return;
    staggered[name] = true;
    const ids =
      name === "customers" ? ["#cbTiles", "#cbBody"] : name === "queue" ? ["#queueBody"] : [];
    ids.forEach((id) => {
      const host = $(id);
      if (!host) return;
      staggerIn(Array.from(host.querySelectorAll<HTMLElement>(".prow, .stat, .cb-tile")));
    });
  }

  function switchTab(name: string) {
    crm.tab = name;
    $$("#crmTabs .crm-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    $$(".ppanel").forEach(function (p) {
      p.classList.toggle("is-hidden", p.dataset.panel !== name);
    });
    playPanelStagger(name);
    // The preview frame was scaled against a zero-width stage while the panel
    // was `display: none`; measure it now that it has a column to fit.
    if (name === "workflows") fitPreviewFrame();
  }

  const crmTabs = $("#crmTabs");
  if (crmTabs) {
    on(crmTabs, "click", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest<HTMLElement>(".crm-tab");
      if (btn && !btn.classList.contains("active") && btn.dataset.tab) switchTab(btn.dataset.tab);
    });
  }

  const cbChips = $("#cbChips");
  if (cbChips) {
    on(cbChips, "click", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const chip = target.closest<HTMLElement>(".cb-chip");
      if (!chip) return;
      const v = chip.dataset.cb;
      if (!v) return;
      if (v === "ALL") crm.cbFilter = [];
      else {
        const i = crm.cbFilter.indexOf(v);
        if (i === -1) crm.cbFilter.push(v);
        else crm.cbFilter.splice(i, 1);
      }
      renderCbChips();
      renderCbTable();
    });
  }

  const qTabs = $("#qTabs");
  if (qTabs) {
    on(qTabs, "click", function (e) {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest<HTMLElement>(".ptab");
      if (!btn || btn.classList.contains("active")) return;
      crm.qTab = btn.dataset.q || "ALL";
      crm.qPage = 1;
      $$("#qTabs .ptab").forEach(function (t) {
        t.classList.toggle("active", t === btn);
      });
      renderQueue();
    });
  }

  const newRuleBtn = $("#newRuleBtn");
  if (newRuleBtn) {
    on(newRuleBtn, "click", function () {
      crm.creating = true;
      crm.editing = null;
      // A brand-new rule opens on the defaults its form ships, so the preview
      // beside it starts on the same message.
      syncPreviewFromForm("SENT", "EMAIL", 60 * 24 * 2);
      renderRules();
    });
  }

  /** One place the preview's state is set, so the card and the form can never
   *  disagree about which message is being previewed. */
  function syncPreviewFromForm(trigger: string, channel: FollowUpChannel, delayMinutes: number) {
    crm.prevTrigger = trigger;
    crm.prevChannel = channel;
    crm.prevDelay = delayMinutes;
    renderPreview();
  }

  // The shared select treatment greys a placeholder through `data-empty="1"`,
  // so the flag has to be kept in sync or a chosen value stays grey. Delegated
  // on `root` so it also covers the edit form, which is re-rendered into a
  // rules <li> rather than #ruleForm — and so the rule form's own trigger /
  // channel selects can drive the preview card next to them.
  on(root, "change", function (e) {
    const el = e.target;
    if (!(el instanceof HTMLSelectElement)) return;

    if (el.classList.contains("bp-sel-in")) {
      if (el.value) el.removeAttribute("data-empty");
      else el.setAttribute("data-empty", "1");
    }

    if (el.id === "prevTrigger") {
      crm.prevTrigger = el.value;
      renderPreview();
      return;
    }

    const form = el.closest<HTMLElement>("[data-form]");
    if (!form) return;
    const field = (f: string) =>
      form.querySelector<HTMLInputElement | HTMLSelectElement>('[data-f="' + f + '"]');
    if (el.dataset.f === "mode" || el.dataset.f === "words") {
      const note = form.querySelector<HTMLElement>("[data-rf-agent]");
      if (note) note.textContent = agentNote(parseMode(field("mode")?.value), parseWords(field("words")?.value));
      return;
    }
    if (el.dataset.f === "trigger" || el.dataset.f === "channel") {
      syncPreviewFromForm(
        field("trigger")?.value || "SENT",
        (field("channel")?.value as FollowUpChannel) || "EMAIL",
        Math.max(1, parseInt(field("days")?.value ?? "", 10) || 1) * 60 * 24,
      );
    }
  });

  // The delay is an <input>, not a <select> — the prose says it out loud ("we
  // sent this over 2 days ago"), so the preview follows it as it is typed.
  on(root, "input", function (e) {
    const el = e.target;
    if (!(el instanceof HTMLInputElement) || el.dataset.f !== "days") return;
    const form = el.closest<HTMLElement>("[data-form]");
    if (!form) return;
    const field = (f: string) =>
      form.querySelector<HTMLInputElement | HTMLSelectElement>('[data-f="' + f + '"]');
    syncPreviewFromForm(
      field("trigger")?.value || "SENT",
      (field("channel")?.value as FollowUpChannel) || "EMAIL",
      Math.max(1, parseInt(el.value, 10) || 1) * 60 * 24,
    );
  });

  // The frame is scaled to its column, so a window resize has to re-fit it.
  on(window, "resize", function () {
    fitPreviewFrame();
  });

  /** Button label + disabled state while an action is in flight. */
  function setBtnBusy(btn: HTMLElement | null, busy: boolean, label: string) {
    if (!btn) return;
    if (btn instanceof HTMLButtonElement) btn.disabled = busy;
    btn.classList.toggle("is-busy", busy);
    const lbl = btn.querySelector<HTMLElement>("[data-save-lbl], [data-q-lbl]");
    if (lbl) lbl.textContent = label;
  }

  on(document, "click", function (e) {
    const target = e.target;
    if (!(target instanceof Element)) return;

    const goto = target.closest<HTMLElement>("[data-goto]");
    if (goto && root.contains(goto)) {
      if (goto.dataset.goto) switchTab(goto.dataset.goto);
      return;
    }
    const pg = target.closest<HTMLButtonElement>(".pager-btn");
    if (pg && root.contains(pg) && !pg.disabled) {
      crm.qPage += pg.dataset.pg === "next" ? 1 : -1;
      renderQueue();
      return;
    }
    const nav = target.closest<HTMLElement>("[data-nav]");
    if (nav && root.contains(nav) && nav.dataset.nav) {
      options.navigate?.(nav.dataset.nav);
      return;
    }

    const defaultsBtn = target.closest<HTMLButtonElement>("#fuDefaultsBtn");
    if (defaultsBtn && root.contains(defaultsBtn)) {
      if (!defaultsBtn.disabled) void turnOnDefaults(defaultsBtn);
      return;
    }

    const act = target.closest<HTMLElement>("[data-act]");
    if (!act || !root.contains(act)) return;
    const kind = act.dataset.act;
    const ruleLi = act.closest<HTMLElement>("[data-rule]");

    // The rule's own message in the card beside the list, on the demo proposal
    // (lib/followUps/copy previewContext) — nothing is sent.
    if (kind === "preview" && ruleLi) {
      const r = rulesData.find((x) => x.id === ruleLi.dataset.rule);
      if (r) {
        syncPreviewFromForm(r.triggerStatus, r.channel, r.delayMinutes);
        const card = root.querySelector<HTMLElement>(".prev-card");
        // Beside the list on a wide desk; under it once the columns stack.
        if (card && card.getBoundingClientRect().top > window.innerHeight * 0.6) {
          card.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        }
      }
      return;
    }

    if (kind === "toggle" && ruleLi) {
      if (crm.busyRule) return;
      const r = rulesData.find(function (x) {
        return x.id === ruleLi.dataset.rule;
      });
      if (r) void toggleRule(r, act, ruleLi);
      return;
    }
    if (kind === "edit" && ruleLi) {
      crm.editing = ruleLi.dataset.rule || null;
      crm.creating = false;
      showErr("#rulesErr", null);
      const editing = rulesData.find((x) => x.id === crm.editing);
      if (editing) {
        syncPreviewFromForm(editing.triggerStatus, editing.channel, editing.delayMinutes);
      }
      renderRules();
      return;
    }
    if (kind === "del-rule" && ruleLi) {
      if (crm.busyRule) return;
      void removeRule(ruleLi);
      return;
    }
    if (kind === "cancel-rule") {
      if (crm.savingRule) return;
      crm.editing = null;
      crm.creating = false;
      renderRules();
      return;
    }
    if (kind === "save-rule") {
      if (crm.savingRule) return;
      const body = act.closest<HTMLElement>("[data-form]");
      if (body) void saveRule(body, act);
      return;
    }
    if (kind === "q-done" || kind === "q-send") {
      if (crm.busyQueue) return;
      const row = act.closest<HTMLElement>("[data-q]");
      if (row) void workQueueRow(row, act, kind === "q-send");
      return;
    }
  });

  // ================= WRITES (real server actions) =================
  // src/actions/followUps.ts — the same actions the classic CRM pages called.
  // Rule CRUD is manager-gated; working the queue is allowed to sales too. All
  // of them are org-scoped and they revalidate /dashboard/crm and
  // /dashboard/crm/queue, so the classic pages agree with this sheet.

  /** Enable / disable. The switch is patched IN PLACE, never re-rendered: an
   *  innerHTML rebuild replaces the switch node, so the knob's slide and the
   *  badge's colour crossfade never get to run. The optimistic flip is reverted
   *  on the same nodes if the action refuses. */
  /** "Turned off" for a starter rule (deleting one turns it off), "off" for the company's own. */
  function ruleBadge(r: FollowUpRule) {
    return r.enabled ? "active" : r.isDefault ? "Turned off" : "off";
  }

  function paintToggle(r: FollowUpRule, tgl: HTMLElement, li: HTMLElement) {
    tgl.classList.toggle("on", r.enabled);
    tgl.setAttribute("aria-pressed", r.enabled ? "true" : "false");
    const badge = li.querySelector<HTMLElement>(".rule-name .pstatus");
    if (badge) {
      badge.classList.toggle("rst--on", r.enabled);
      badge.classList.toggle("rst--off", !r.enabled);
      badge.textContent = ruleBadge(r);
    }
  }

  async function toggleRule(r: FollowUpRule, tgl: HTMLElement, li: HTMLElement) {
    const next = !r.enabled;
    crm.busyRule = r.id;
    showErr("#rulesErr", null);
    r.enabled = next;
    paintToggle(r, tgl, li);
    renderFuStatus();
    try {
      await setFollowUpRuleEnabled(r.id, next);
    } catch (err) {
      r.enabled = !next;
      paintToggle(r, tgl, li);
      renderFuStatus();
      showErr("#rulesErr", actionError(err));
    } finally {
      crm.busyRule = null;
    }
  }

  /** Delete. The row leaves alone and the rows below close the gap — the list
   *  is NOT re-rendered, or the FLIP would have nothing left to move. A starter
   *  rule is turned off instead (actions/followUps): its row stays, repainted. */
  async function removeRule(li: HTMLElement) {
    const id = li.dataset.rule;
    if (!id) return;
    crm.busyRule = id;
    showErr("#rulesErr", null);
    try {
      const res = await deleteFollowUpRule(id);
      const rule = rulesData.find((x) => x.id === id);
      if (res.turnedOff && rule) {
        rule.enabled = false;
        crm.busyRule = null;
        renderRules();
        return;
      }
      leaveRow(
        li,
        () => {
          rulesData = rulesData.filter((x) => x.id !== id);
          renderFuStatus();
          const empty = $("#rulesEmpty");
          if (empty) empty.classList.toggle("is-hidden", rulesData.length !== 0 || crm.creating);
        },
        after,
      );
    } catch (err) {
      showErr("#rulesErr", actionError(err));
    } finally {
      crm.busyRule = null;
    }
  }

  /** "Turn on defaults": the starter rules written and switched on
   *  (actions/followUps); the list repaints from the rules it hands back. */
  async function turnOnDefaults(btn: HTMLButtonElement) {
    showErr("#rulesErr", null);
    btn.disabled = true;
    btn.classList.add("is-busy");
    try {
      const res = await turnOnDefaultFollowUps();
      rulesData = res.rules.map((r) => ({ ...r }));
      crm.editing = null;
      renderRules();
    } catch (err) {
      showErr("#rulesErr", actionError(err));
    } finally {
      btn.disabled = false;
      btn.classList.remove("is-busy");
    }
  }

  /** Create or update. `data-form` carries "new" or the rule's id — the same
   *  discriminator `upsertFollowUpRule` uses on the server. */
  async function saveRule(body: HTMLElement, btn: HTMLElement) {
    const field = (f: string) =>
      body.querySelector<HTMLInputElement | HTMLSelectElement>('[data-f="' + f + '"]');
    const get = (f: string) => field(f)?.value ?? "";
    const errBox = body.querySelector<HTMLElement>("[data-rf-err]");
    const setFormErr = (msg: string | null) => {
      if (!errBox) return;
      errBox.textContent = msg || "";
      errBox.classList.toggle("is-hidden", !msg);
    };

    const name = get("name").trim();
    if (!name) {
      setFormErr("Give the rule a name.");
      field("name")?.focus();
      return;
    }
    // Whole days in range — `parseInt(...) || 1` sent 40 nines on as 1.44e43
    // minutes and the save came back a 500 (QA F-fd2683fc).
    const days = readDelayDays(get("days"));
    if (typeof days === "string") {
      setFormErr("Delay: " + days);
      field("days")?.focus();
      return;
    }
    const id = body.dataset.form;
    const editing = id && id !== "new" ? id : undefined;
    const existing = editing ? rulesData.find((x) => x.id === editing) : undefined;
    const payload = {
      id: editing,
      name,
      triggerStatus: get("trigger"),
      delayMinutes: days * 60 * 24,
      // A new rule starts active, exactly as the donor's form implied; an edit
      // must not silently re-enable a rule the user switched off.
      enabled: existing ? existing.enabled : true,
      channel: (get("channel") || "EMAIL") as FollowUpChannel,
      mode: parseMode(get("mode")),
      words: parseWords(get("words")),
    };

    crm.savingRule = true;
    setFormErr(null);
    setBtnBusy(btn, true, "Saving…");
    try {
      const res = await upsertFollowUpRule(payload);
      if (!res.ok) {
        // A refusal is the action's answer, in words for the person.
        crm.savingRule = false;
        setBtnBusy(btn, false, "Save rule");
        setFormErr(res.error);
        if (res.field === "name" || res.field === "delayMinutes") field(res.field === "name" ? "name" : "days")?.focus();
        return;
      }
      if (existing) {
        Object.assign(existing, {
          name: payload.name,
          triggerStatus: payload.triggerStatus,
          delayMinutes: payload.delayMinutes,
          channel: payload.channel,
          mode: payload.mode,
          words: payload.words,
        });
        crm.editing = null;
      } else {
        rulesData.push({
          id: res.id,
          name: payload.name,
          triggerStatus: payload.triggerStatus,
          delayMinutes: payload.delayMinutes,
          enabled: payload.enabled,
          channel: payload.channel,
          mode: payload.mode,
          words: payload.words,
        });
        crm.creating = false;
      }
      // The page reads rules `orderBy: { name: "asc" }`; keep the live list in
      // that order so a reload does not appear to shuffle the card.
      rulesData.sort((a, b) => a.name.localeCompare(b.name));
      crm.savingRule = false;
      renderRules();
      // The card keeps showing the rule that was just saved.
      syncPreviewFromForm(payload.triggerStatus, payload.channel, payload.delayMinutes);
    } catch (err) {
      crm.savingRule = false;
      setBtnBusy(btn, false, "Save rule");
      setFormErr(actionError(err));
    }
  }

  /** Queue: Send dispatches the follow-up email now, Done just closes it out.
   *  Both complete the FollowUp server-side, so either way the row is gone. */
  async function workQueueRow(row: HTMLElement, btn: HTMLElement, send: boolean) {
    const id = row.dataset.q;
    if (!id) return;
    crm.busyQueue = id;
    showErr("#queueErr", null);
    setBtnBusy(btn, true, send ? "Sending…" : "Saving…");
    try {
      if (send) await runFollowUpNow(id);
      else await markFollowUpDone(id);
      leaveRow(
        row,
        () => {
          queueData = queueData.filter((q) => q.id !== id);
          renderFuStatus();
          // Chrome only — rebuilding #queueBody here would replace the very
          // rows the FLIP is closing the gap with.
          renderQueueChrome();
          renderStats();
          renderActions();
        },
        after,
      );
    } catch (err) {
      setBtnBusy(btn, false, send ? "Send" : "Done");
      showErr("#queueErr", actionError(err));
    } finally {
      crm.busyQueue = null;
    }
  }

  // The Today tab's band (crm-agent.tsx, React) sent, skipped or closed a follow-up: the queue here drops the row.
  on(window, "crm:follow-up-closed", function (e) {
    const id = (e as CustomEvent<string>).detail;
    if (!id || !queueData.some((q) => q.id === id)) return;
    queueData = queueData.filter((q) => q.id !== id);
    safe("queue-sync", function () {
      renderQueue();
      renderFuStatus();
      renderStats();
      renderActions();
    });
  });

  // ================= INITIALIZATION =================
  safe("init", function () {
    renderCrm();
  });

  // The mobile nav drawer and FLUID SCALE belong to the persistent chrome and
  // live in components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // (The donor's local EASE constant is gone with its row-stagger block —
    // `staggerIn` / `leaveRow` carry the system curve now.)

    // Reveal: load + scroll. Reveal adapts to scroll speed: a slow scroll gets
    // the full 420ms animation; a fast one gets a shorter pass.
    const vpH = window.innerHeight;
    const scrollHost = main;
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    if (scrollHost) {
      on(
        scrollHost,
        "scroll",
        () => {
          const now = performance.now();
          scrollVel = Math.abs(scrollHost.scrollTop - velLastY) / Math.max(1, now - velLastT);
          velLastY = scrollHost.scrollTop;
          velLastT = now;
        },
        { passive: true },
      );
    }
    const blocks = $$(".content > *");
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    // Second layer of the arrival — Overview cascades its `.kpi` strip here.
    // This page has no `.kpi`, so the layer was silently absent; its strip of
    // small units is the section tab row (`.stat` and `.cb-tile` already
    // stagger through animateRows below, so they stay out of this). Skip
    // anything the block cascade claimed — never `rv` and `rv-cell` together.
    const cells = $$(".crm-tab").filter((el) => !el.classList.contains("rv"));
    cells.forEach((el, i) => {
      el.classList.add("rv-cell");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? 160 + (i % 8) * 45 + "ms" : "200ms";
    });
    const io = new IntersectionObserver(
      (es) => {
        es.forEach((en) => {
          if (!en.isIntersecting) return;
          const target = en.target as HTMLElement;
          if (target.dataset.rvScroll) {
            // below the fold: duration follows the current scroll speed
            const dur = Math.round(Math.max(550, 900 - scrollVel * 160));
            target.style.transitionDuration = dur + "ms";
          }
          target.classList.add("rv-in");
          io.unobserve(target);
          target.addEventListener("transitionend", function te() {
            target.style.transitionDelay = "";
            target.style.transitionDuration = "";
            target.removeEventListener("transitionend", te);
          });
        });
      },
      { threshold: 0, rootMargin: "0px 0px 60px 0px" },
    );
    blocks.concat(cells).forEach((el) => io.observe(el));
    disposers.push(() => io.disconnect());

    // (Sidebar cascade lives in the shell — it plays once, on first load.)

    // Row stagger — on ARRIVAL only.
    //
    // The donor wired this to `new MutationObserver(…, { childList: true })` on
    // each list, so EVERY render replayed the full 45ms-per-row entrance: a
    // chip filter, a queue tab, a pager step, one row leaving. The list dropped
    // to opacity 0 and crawled back each time, which reads as "the list wiped
    // itself" — and with the queue now doing real writes it would have fought
    // `leaveRow` for the same nodes on every Done/Send. The observer is gone;
    // the caller decides when a list genuinely arrives. Overview is the only
    // panel visible on mount, so it is the only one staggered here — the other
    // three play on first reveal, in `playPanelStagger`, because a stagger
    // inside a `display: none` subtree pins `transform: none` and kills hover.
    ["#statGrid", "#freshList"].forEach((sel) => {
      const list = $(sel);
      if (!list) return;
      staggerIn(Array.from(list.querySelectorAll<HTMLElement>(".prow, .stat, .cb-tile")));
    });

    // Numeral count-up — Overview's `.kpi-val`; here the stat grid, the
    // callback tiles and the tab counts. The donor rebuilt the text from
    // digits alone, safe only for its own plain "$12,400"/"18": it drops any
    // trailing unit and would wipe an inline icon. So keep whatever frames the
    // number, skip decimals (digits-only mangles them), and skip nodes that
    // hold elements rather than bare text.
    $$(".stat-val, .cb-val, .ptab-count").forEach((el) => {
      if (el.children.length) return;
      const m = (el.textContent || "").trim().match(/^([^\d]*)(\d[\d,]*)([^\d]*)$/);
      if (!m) return;
      const [, prefix, digits, suffix] = m;
      const target = parseInt(digits.replace(/,/g, ""), 10);
      if (!isFinite(target)) return;
      let t0: number | null = null;
      function frame(t: number) {
        if (!t0) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        el.textContent = prefix + Math.round(target * e).toLocaleString("en-US") + suffix;
        if (pr < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });

    // Press effects. Shell controls (.icon-btn, .sb-foot-*) press from the shell.
    // Delegated to `root` so nodes injected after init (menu items, JS-rendered
    // buttons, innerHTML re-renders) still press.
    function pressify(sel: string, cls: string) {
      on(root, "click", (e) => {
        const el = (e.target as Element).closest<HTMLElement>(sel);
        if (!el || !root.contains(el)) return;
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
      });
      on(root, "animationend", (e) => {
        const el = e.target as HTMLElement;
        if (el.matches && el.matches(sel)) el.classList.remove(cls);
      });
    }
    pressify(
      ".btn, .card-foot-btn, .ptab, .pchip, .pager-btn, .pmenu-item, .photo-box, .pt-open",
      "pressed",
    );
    pressify(".week-strip .day", "day-pressed");

    // (Graph-paper parallax lives in the shell — it owns .main.)
  })();

  // The sliding sidebar indicator lives in the shell — it survives navigation
  // and re-points at whichever item React marks `active`.

  return () => {
    disposers.forEach((d) => d());
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
  };
}
