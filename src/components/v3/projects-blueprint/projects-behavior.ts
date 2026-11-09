// Projects blueprint — runtime behaviors, ported verbatim from the donor
// file's <script> (jobflex-projects-blueprint_2.html). Every duration, easing,
// stagger and formula is the donor's exact value. Adaptations are mechanical
// only:
// - queries are scoped to the mounted `.content` root;
// - listeners on shell-owned nodes (`.main` scroll) plus observers and timers
//   are tracked for unmount cleanup;
// - the donor blocks that drive the PERSISTENT chrome are omitted, because
//   components/v3/blueprint-shell/shell-behavior.ts already owns them: the
//   mobile nav drawer, FLUID SCALE, the sidebar entry cascade, the sliding
//   active-item indicator, the graph-paper parallax and press feedback on
//   shell controls.

import { createClient } from "@/actions/clients";
import { buildAnswersFromStrings } from "@/lib/projectPhases/shared";
import { createProject } from "@/actions/projects";
import { closeMdl, openMdl, MDL_EXIT_MS } from "@/components/v3/blueprint-shell/mdl-motion";
import { staggerIn } from "@/components/v3/blueprint-shell/list-motion";
import { initDatePopovers } from "@/components/v3/shared/date-popover";
import { STATUSES, type Project } from "./projects-data";
import { money, moneyShort, progressOf, projectFlags } from "./projects-data";

export type ProjectsContentOptions = {
  /** The org's real project book, read server-side in
   *  src/app/dashboard/projects/page.tsx. REQUIRED — there is no fixture to
   *  fall back to, and an empty book renders the empty state rather than
   *  demo rows. */
  projects: Project[];
  /** The workspace's kind (2026-11-09, lib/projectSpaces): New project makes one of these and does not ask. */
  kind?: "REMODEL" | "NEW_BUILD" | "JOB";
};

/** `createProject` rejects with an Error whose message is written for the user
 *  (the plan-limit refusal, the role refusal). Surface that text; fall back to
 *  a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  // A Next.js server-action transport failure has no useful message.
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** Project names and scope notes are user text and the grid is built from HTML
 *  strings — everything interpolated has to be escaped. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The date popover writes this exact shape into the two schedule fields. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function initProjectsContent(
  content: HTMLElement,
  options: ProjectsContentOptions,
): () => void {
  // Scoped to `.content`, which the shared shell owns and re-fills on every
  // navigation. `.main` lives in the shell, above this element.
  const root = content;
  const main = content.closest<HTMLElement>(".main");
  const disposers: Array<() => void> = [];
  const on = (
    target: EventTarget,
    ev: string,
    fn: EventListener,
    opts?: AddEventListenerOptions,
  ) => {
    target.addEventListener(ev, fn, opts);
    disposers.push(() => target.removeEventListener(ev, fn, opts));
  };
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const timers: Array<ReturnType<typeof setTimeout>> = [];
  /** Tracked `setTimeout` — the teardown at the bottom clears the whole list,
   *  so an unmount mid-animation cannot fire into a detached tree. */
  const after = (ms: number, fn: () => void) => {
    timers.push(setTimeout(fn, ms));
  };

  // ================= SAFETY: module isolation =================
  // Each block is wrapped so a failure in one does not disable the rest.
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

  // ================= PROJECTS: DATA =================
  // The org's real project book, read in the page's server component. Copied
  // per mount because the create dialog unshifts the created row onto it —
  // mutating the array React handed down would leave a stale row behind on the
  // next render pass.
  const projectsData: Project[] = options.projects.map((p) => ({ ...p }));

  const pjstate = { filter: "ALL" };

  function flagsOf(p: Project) {
    return projectFlags(p);
  }
  function statusLabel(s: string) {
    return s.toLowerCase().replace("_", " ");
  }
  function progress(p: Project) {
    // The stages' % done when the project has stages (2026-11-05), else the jobs closed out.
    return progressOf(p);
  }
  function rmOk() {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  // ================= PROJECTS: RENDER =================
  function chipCount(f: string) {
    if (f === "ALL") return projectsData.length;
    if (f === "ATTENTION") return projectsData.filter((p) => flagsOf(p).length > 0).length;
    return projectsData.filter(function (p) {
      return p.status === f;
    }).length;
  }
  const CHIP_LABEL: Record<string, string> = { ALL: "All", ATTENTION: "Needs a look" };

  /** Built ONCE. A filter click patches the four chips in place (see
   *  `paintChips`) rather than rebuilding the row — rebuilding destroys the
   *  very button the user just pressed, taking its focus and its press
   *  animation with it, and drops the reveal cascade's `rv-cell` classes. */
  function buildChips() {
    const chips = $("#pjChips");
    if (!chips) return;
    chips.innerHTML = ["ALL"]
      .concat(STATUSES)
      .concat(["ATTENTION"])
      .map(function (f) {
        return (
          '<button class="pchip' +
          (pjstate.filter === f ? " active" : "") +
          (f === "ATTENTION" ? " pchip--attn" : "") +
          '" type="button" data-f="' +
          f +
          '">' +
          (CHIP_LABEL[f] ?? statusLabel(f)) +
          " <b>" +
          chipCount(f) +
          "</b></button>"
        );
      })
      .join("");
  }

  function paintChips() {
    $$("#pjChips .pchip").forEach(function (c) {
      const f = c.dataset.f || "ALL";
      c.classList.toggle("active", f === pjstate.filter);
      const b = c.querySelector("b");
      if (b) b.textContent = String(chipCount(f));
    });
  }

  /** One ledger row. Shared by the full render and the single-row insert the
   *  create dialog does, so both stay identical by construction. The title is
   *  a real link (⌘-click opens a tab); a click anywhere else on the row
   *  follows it too — see the tbody listener in the events section. */
  function cardHTML(p: Project) {
    const pct = progress(p);
    const done = p.jobCount > 0 && pct >= 100;
    const flags = flagsOf(p);
    const spent = p.spent ?? 0;
    const sold = p.sold ?? 0;
    const open = p.open ?? 0;
    const openCount = p.openCount ?? 0;
    const proposals = p.proposalCount ?? 0;
    const budgetPct = p.budget > 0 ? Math.min(100, Math.round((spent / p.budget) * 100)) : 0;
    const budgetTone = p.budget > 0 && spent > p.budget ? " over" : p.budget > 0 && spent >= p.budget * 0.8 ? " warn" : "";
    const href = "/dashboard/projects/" + encodeURIComponent(p.id);
    const sub = [p.clientName, p.description].filter(Boolean).map((t) => esc(t as string)).join(" · ");
    return (
      '<tr class="prow pj-row" data-id="' + esc(p.id) + '" data-href="' + href + '">' +
      // project
      '<td><a class="pt-title pt-link" href="' + href + '">' + esc(p.name) + "</a>" +
      (sub ? '<div class="pt-sub">' + sub + "</div>" : '<div class="pt-sub pj-sub--none">No client on this project</div>') +
      "</td>" +
      // status + flags
      '<td><span class="pstatus pjs--' + esc(p.status.toLowerCase()) + '">' + esc(statusLabel(p.status)) + "</span>" +
      (flags.length || p.kind === "NEW_BUILD"
        ? '<div class="pj-flags">' +
          (p.kind === "NEW_BUILD" ? '<span class="pj-flag pj-flag--kind" title="New construction">New build</span>' : "") +
          flags.map((f) => '<span class="pj-flag pj-flag--' + f.kind + '" title="' + esc(f.text) + '">' + esc(f.text) + "</span>").join("") +
          "</div>"
        : "") +
      "</td>" +
      // sold
      '<td class="num"><span class="pt-money' + (sold > 0 ? "" : " pj-zero") + '">' + (sold > 0 ? money(sold) : "—") + "</span>" +
      '<div class="pt-sub"' + (open > 0 ? ' title="' + money(open) + ' still with the client"' : "") + ">" +
      (proposals === 0
        ? "no proposals yet"
        : proposals + " proposal" + (proposals === 1 ? "" : "s") + (openCount > 0 ? " · " + openCount + " waiting" : "")) +
      "</div></td>" +
      // budget
      '<td><div class="pj-budget">' +
      (p.budget > 0
        ? '<div class="pj-budget-top"><b class="' + budgetTone.trim() + '">' + moneyShort(spent) + "</b><span>of " + moneyShort(p.budget) + "</span><i>" + budgetPct + "%</i></div>" +
          '<div class="pjc-track pj-track"><div class="pjc-fill pj-fill' + budgetTone + '" data-w="' + budgetPct + '"></div></div>'
        : '<div class="pj-budget-top"><b class="pj-zero">' + (spent > 0 ? moneyShort(spent) + " spent" : "—") + '</b><span>no budget</span></div>') +
      "</div></td>" +
      // jobs
      '<td><div class="pj-jobs">' +
      // With stages (2026-11-05) the cell is the project's own progress: % done and the stage it is on.
      (p.done != null
        ? '<b class="' + (done ? "done" : "") + '">' + p.done + '%</b><span title="' + esc(done ? "all stages done" : p.stageNow ? "done · on " + p.stageNow : "done") + '">' + esc(done ? "done" : (p.stageNow ?? "done")) + "</span>" +
          '<div class="pjc-track pj-track"><div class="pjc-fill' + (done ? " done" : "") + '" data-w="' + pct + '"></div></div>'
        : p.jobCount > 0
          ? '<b class="' + (done ? "done" : "") + '">' + p.completedJobs + " of " + p.jobCount + "</b><span>" +
            // "0 of 3 scheduled" read as none of them on the calendar; the count is the jobs DONE (2026-11-04).
            ((p.inProgressJobs ?? 0) > 0 && !done ? "done · " + (p.inProgressJobs ?? 0) + " in progress" : "done") + "</span>" +
            '<div class="pjc-track pj-track"><div class="pjc-fill' + (done ? " done" : "") + '" data-w="' + pct + '"></div></div>'
          : '<b class="pj-zero">—</b><span>no jobs yet</span>') +
      "</div></td>" +
      // window
      '<td class="pjc-window"><span class="pt-mono">' + (p.startsAt ? esc(p.startsAt) + (p.endsAt ? " → " + esc(p.endsAt) : "") : "—") + "</span></td>" +
      // updated
      '<td class="pjc-updated"><span class="pt-mono">' + esc(p.updatedAgo ?? "") + "</span></td>" +
      // open
      '<td class="num"><a class="pt-open pj-open" href="' + href + '" aria-label="Open ' + esc(p.name) + '"><svg class="ic"><use href="#i-arrow"/></svg></a></td>' +
      "</tr>"
    );
  }

  /** The masthead: the book's four numbers, over every project the page lists. */
  function paintMast() {
    const active = projectsData.filter((p) => p.status === "ACTIVE");
    const onHold = projectsData.filter((p) => p.status === "ON_HOLD").length;
    const sold = projectsData.reduce((n, p) => n + (p.sold ?? 0), 0);
    const open = projectsData.reduce((n, p) => n + (p.open ?? 0), 0);
    const budget = projectsData.filter((p) => p.status !== "COMPLETED").reduce((n, p) => n + p.budget, 0);
    const spent = projectsData.filter((p) => p.status !== "COMPLETED").reduce((n, p) => n + (p.spent ?? 0), 0);
    const attn = projectsData.filter((p) => flagsOf(p).length > 0);
    const over = projectsData.filter((p) => flagsOf(p).some((f) => f.kind === "over")).length;
    const put = (id: string, text: string) => {
      const el = $("#" + id);
      if (el) el.textContent = text;
    };
    put("pjKActive", String(active.length));
    put("pjKActiveSub", onHold ? onHold + " on hold" : projectsData.length + " in the book");
    put("pjKSold", money(sold));
    put("pjKSoldSub", open > 0 ? moneyShort(open) + " still open · before tax" : "accepted, with approved changes · before tax");
    put("pjKSpent", money(spent));
    put("pjKSpentSub", budget > 0 ? Math.round((spent / budget) * 100) + "% of " + moneyShort(budget) + " budgeted" : "no budgets set yet");
    put("pjKAttn", String(attn.length));
    const losing = projectsData.filter((p) => flagsOf(p).some((f) => f.kind === "loss")).length;
    put("pjKAttnSub", over ? over + " over budget" : losing ? losing + " losing money" : attn.length ? "waiting or near the line" : "all clear");
    const attnVal = $("#pjKAttn");
    if (attnVal) attnVal.classList.toggle("pj-k--bad", over > 0);
  }

  /** Progress bars grow from zero on the frame after they land. */
  function paintFills(scope: ParentNode) {
    const fills = Array.from(scope.querySelectorAll<HTMLElement>(".pjc-fill"));
    const set = function () {
      fills.forEach(function (f) {
        f.style.width = String(f.dataset.w) + "%";
      });
    };
    if (rmOk()) {
      requestAnimationFrame(function () {
        requestAnimationFrame(set);
      });
    } else {
      set();
    }
  }

  function visibleRows() {
    if (pjstate.filter === "ALL") return projectsData;
    if (pjstate.filter === "ATTENTION") return projectsData.filter((p) => flagsOf(p).length > 0);
    return projectsData.filter(function (p) {
      return p.status === pjstate.filter;
    });
  }

  function renderGrid() {
    const rows = visibleRows();
    const grid = $("#pjGrid");
    if (grid) grid.innerHTML = rows.map(cardHTML).join("");
    const empty = $("#pjEmpty");
    // An empty BOOK hides the ledger and shows the note; an empty FILTER keeps
    // the ledger's frame and says nothing matched.
    if (empty) {
      empty.classList.toggle("is-hidden", rows.length !== 0);
      if (rows.length === 0 && projectsData.length > 0) {
        empty.innerHTML = "<b>Nothing under this filter</b>";
      }
    }
    $("#pjLedgerCard")?.classList.toggle("is-hidden", rows.length === 0);
    if (grid) paintFills(grid);
  }

  /** Add ONE card to the top of the grid without touching the others. A full
   *  re-render would replay every card's entrance for a change that affects a
   *  single row. */
  function insertCard(p: Project) {
    const grid = $("#pjGrid");
    if (!grid) return;
    // A <tr> only parses inside a table section, never inside a <div>.
    const holder = document.createElement("tbody");
    holder.innerHTML = cardHTML(p);
    const node = holder.firstElementChild as HTMLElement | null;
    if (!node) return;
    grid.prepend(node);
    $("#pjEmpty")?.classList.add("is-hidden");
    $("#pjLedgerCard")?.classList.remove("is-hidden");
    paintFills(node);
    staggerIn([node]);
    paintMast();
  }

  function renderProjects() {
    buildChips();
    paintMast();
    renderGrid();
  }

  // A click on a row opens the project, like the proposals ledger: links,
  // buttons and a text selection keep their own behavior, and ⌘ / Ctrl-click
  // opens a tab.
  const ledgerBody = $("#pjGrid");
  if (ledgerBody) {
    on(ledgerBody, "click", (e) => {
      const ev = e as MouseEvent;
      const target = ev.target as HTMLElement;
      if (target.closest("a, button, input, select, textarea, label")) return;
      if ((window.getSelection()?.toString() ?? "").length > 0) return;
      const row = target.closest<HTMLElement>(".pj-row");
      const href = row?.dataset.href;
      if (!href) return;
      if (ev.metaKey || ev.ctrlKey) window.open(href, "_blank", "noopener");
      else window.location.assign(href);
    });
  }

  // ================= PROJECTS: EVENTS =================
  const chipsHost = $("#pjChips");
  if (chipsHost)
    chipsHost.addEventListener("click", function (e) {
      const chip = (e.target as HTMLElement).closest<HTMLElement>(".pchip");
      if (!chip) return;
      const next = chip.dataset.f || "ALL";
      if (next === pjstate.filter) return;
      pjstate.filter = next;
      // The chip row is patched, not rebuilt; the grid's set genuinely changed,
      // so it repaints — silently. A filter toggle must NOT replay the row
      // cascade (see blueprint-shell/list-motion for why).
      paintChips();
      renderGrid();
    });

  // ================= CREATE DIALOG (new project) =================
  // Replaces the donor's placeholder button (a 1.6s "New project form" flash)
  // with a real dialog. The frame is the one the Leads page uses for its delete
  // confirmation (`.mdl`), extended with a form body. Submitting calls the same
  // `createProject` server action the classic /dashboard/projects/new form
  // calls — org-scoped, plan-limit enforced, revalidating /dashboard/projects —
  // so the row the grid gains is the database row, id included.
  const newProjectBtn = $("#newProjectBtn");
  const pjDlg = $("#pjNew");
  const pjForm = root.querySelector<HTMLFormElement>("#pjNewForm");
  if (pjDlg && pjForm) {
    const inp = (sel: string) => root.querySelector<HTMLInputElement>(sel);
    const descEl = root.querySelector<HTMLTextAreaElement>("#pjfDesc");
    let draftStatus = STATUSES[0];
    // The kind and the remodel's question (2026-11-07), painted like the status segment.
    const homeKind = options.kind ?? "REMODEL";
    let draftKind: string = homeKind;
    let draftOccupied = false;
    // In a workspace the kind is the workspace's: the question is not asked (2026-11-09).
    if (options.kind) $("#pjfKind")?.closest<HTMLElement>(".fld")?.classList.add("is-hidden");
    // A new build's start questions (part 4): the picks by question, as the buttons' values; unsaid = the usual.
    let draftBuild: Record<string, string> = {};
    // Who it is for and how the money is made (part 5): a new build for a client with one margin unless said.
    let draftForWhom = "CLIENT";
    let draftMode = "PROJECT_MARGIN";
    let restoreFocus: HTMLElement | null = null;
    let saving = false;

    /** "2026-08-04" → "Aug 04" — the grid's own display format. Parsed field
     *  by field on purpose: `new Date("2026-08-04")` is read as UTC midnight and
     *  renders as the previous day in every negative-offset timezone. */
    function shortDate(v: string): string | null {
      const m = ISO_DATE.exec(v);
      if (!m) return null;
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
    }

    // Schedule fields: the blueprint month-grid popover replaces the two native
    // date inputs. Both used to draw the SAME grey browser calendar glyph, so
    // Starts and Ends were indistinguishable at a glance; they now carry the
    // calendar page's own pairing — a clock for the start, an hourglass for the
    // end (DTP_ICON there) — and the same two icons mean the same two things on
    // both surfaces. `shortDate` above still reads "YYYY-MM-DD" off `.value`.
    disposers.push(
      initDatePopovers(root, [
        { sel: "#pjfStart", icon: "i-clock", label: "Starts" },
        { sel: "#pjfEnd", icon: "i-hourglass", label: "Ends" },
      ]),
    );

    function markErr(on: boolean) {
      pjDlg!.querySelector<HTMLElement>('[data-fld="name"]')?.classList.toggle("is-err", on);
      if (!on) pjDlg!.querySelector<HTMLElement>('[data-fld="client"]')?.classList.remove("is-err");
    }

    /** "+ New client…" opens the name and phone fields under the picker. */
    function paintNewClient() {
      const open = pjDlg!.querySelector<HTMLSelectElement>("#pjfClient")?.value === "__new";
      $("#pjfNewClient")?.classList.toggle("is-hidden", !open);
      return open;
    }

    /** The server action's own refusal text — the plan-limit message and the
     *  role refusal are both written for the user. */
    function setDlgErr(msg: string | null) {
      const box = $("#pjNewErr");
      if (!box) return;
      box.textContent = msg || "";
      box.classList.toggle("is-hidden", !msg);
    }

    function setBusy(on: boolean) {
      saving = on;
      const btn = root.querySelector<HTMLButtonElement>("#pjNewOk");
      if (btn) {
        btn.disabled = on;
        btn.classList.toggle("is-busy", on);
        const lbl = btn.querySelector<HTMLElement>("[data-save-lbl]");
        if (lbl) lbl.textContent = on ? "Creating…" : "Create project";
      }
      // A write on the wire must not be cancelled out from under itself.
      pjDlg!.querySelectorAll<HTMLButtonElement>('[data-mdl="close"]').forEach((b) => {
        b.disabled = on;
      });
    }

    function paintStatus() {
      $$("#pjfStatus .fseg-btn").forEach((b) => {
        const on = b.dataset.v === draftStatus;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    const KIND_HINT: Record<string, string> = {
      REMODEL: "The house stands: a kitchen, a bath, an addition, a whole house.",
      NEW_BUILD: "A lot, then a house: land, permits, foundation to the keys.",
      JOB: "One trade, bigger than a visit: a deck, a roof, a fence, a new system.",
    };
    function paintKind() {
      $$("#pjfKind .fseg-btn").forEach((b) => {
        const on = b.dataset.v === draftKind;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const hint = $("#pjfKindHint");
      if (hint) hint.textContent = KIND_HINT[draftKind] ?? "";
      // The question is a remodel's.
      $("#pjfOccupiedFld")?.classList.toggle("is-hidden", draftKind !== "REMODEL");
      $$("#pjfOccupied .fseg-btn").forEach((b) => {
        const on = (b.dataset.v === "yes") === draftOccupied;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      // The lot's questions and the money are a new build's.
      $("#pjfBuildFld")?.classList.toggle("is-hidden", draftKind !== "NEW_BUILD");
      $("#pjfMoneyFld")?.classList.toggle("is-hidden", draftKind !== "NEW_BUILD");
      $$("#pjfForWhom .fseg-btn").forEach((b) => {
        const on = b.dataset.v === draftForWhom;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const whoHint = $("#pjfForWhomHint");
      if (whoHint) whoHint.textContent = draftForWhom === "SELF" ? "A spec house, your own home, a flip: one budget from the land to the keys, no margin." : "The client has a budget; you earn a margin or a fee on the work.";
      $("#pjfModeFld")?.classList.toggle("is-hidden", draftForWhom !== "CLIENT");
      $("#pjfSaleFld")?.classList.toggle("is-hidden", draftForWhom !== "SELF");
      $$("#pjfMode .fseg-btn").forEach((b) => {
        const on = b.dataset.v === draftMode;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
      const marginLbl = $("#pjfMarginLbl");
      if (marginLbl) marginLbl.textContent = draftMode === "COST_PLUS" ? "Fee, percent of cost" : "Margin, percent of cost";
      $$("#pjfBuild [data-build]").forEach((g) => {
        const key = g.dataset.build ?? "";
        const v = draftBuild[key] ?? g.dataset.default ?? "";
        g.querySelectorAll<HTMLElement>(".fseg-btn").forEach((b) => {
          const on = b.dataset.v === v;
          b.classList.toggle("on", on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        });
      });
    }

    function openDlg() {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openMdl(pjDlg!);
      // land on the first field, not on the dialog frame
      requestAnimationFrame(() => inp("#pjfName")?.focus());
    }

    function closeDlg() {
      // The dialog animates out over MDL_EXIT_MS (see mdl-motion). Focus goes
      // back to the opener immediately — waiting for the exit would leave the
      // keyboard stranded inside a dialog that is already on its way out.
      if (saving) return;
      if (!closeMdl(pjDlg!, after)) return;
      markErr(false);
      restoreFocus?.focus();
    }

    function resetDlg() {
      pjForm!.reset();
      paintNewClient();
      nameAuto = false;
      draftStatus = STATUSES[0];
      draftKind = homeKind;
      draftOccupied = false;
      draftBuild = {};
      draftForWhom = "CLIENT";
      draftMode = "PROJECT_MARGIN";
      paintKind();
      paintStatus();
      markErr(false);
      setDlgErr(null);
    }

    if (newProjectBtn) on(newProjectBtn, "click", openDlg);

    // Picking a client names a still-blank project for the client and the
    // street ("Dima Petrov — 12103 202nd St SE"); a name the contractor typed
    // is never overwritten, and a name this filled in follows a re-pick.
    let nameAuto = false;
    const clientSelEl = pjDlg!.querySelector<HTMLSelectElement>("#pjfClient");
    const nameInput = pjDlg!.querySelector<HTMLInputElement>("#pjfName");
    if (clientSelEl && nameInput) {
      on(nameInput, "input", () => {
        nameAuto = false;
      });
      on(clientSelEl, "change", () => {
        const opt = clientSelEl.selectedOptions[0];
        if (paintNewClient()) {
          // The new client's name names the project as they type it, as a picked one does.
          requestAnimationFrame(() => inp("#pjfClientName")?.focus());
          return;
        }
        if (!clientSelEl.value || !opt) {
          if (nameAuto) {
            nameInput.value = "";
            nameAuto = false;
          }
          return;
        }
        if (nameInput.value.trim() && !nameAuto) return;
        const name = (opt.textContent ?? "").split(" — ")[0];
        const street = opt.dataset.street ?? "";
        nameInput.value = street ? `${name} — ${street}` : name;
        nameAuto = true;
        markErr(false);
      });
      const newNameEl = inp("#pjfClientName");
      if (newNameEl) {
        on(newNameEl, "input", () => {
          if (nameInput.value.trim() && !nameAuto) return;
          nameInput.value = newNameEl.value.trim();
          nameAuto = !!nameInput.value;
        });
      }
    }

    on(pjDlg, "click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-mdl="close"]')) {
        closeDlg();
        return;
      }
      if (saving) return;
      const seg = t.closest<HTMLElement>("#pjfStatus .fseg-btn");
      if (seg) {
        draftStatus = seg.dataset.v || STATUSES[0];
        paintStatus();
      }
      const kindSeg = t.closest<HTMLElement>("#pjfKind .fseg-btn");
      if (kindSeg) {
        draftKind = kindSeg.dataset.v === "NEW_BUILD" || kindSeg.dataset.v === "JOB" ? kindSeg.dataset.v : "REMODEL";
        paintKind();
      }
      const occSeg = t.closest<HTMLElement>("#pjfOccupied .fseg-btn");
      if (occSeg) {
        draftOccupied = occSeg.dataset.v === "yes";
        paintKind();
      }
      const whoSeg = t.closest<HTMLElement>("#pjfForWhom .fseg-btn");
      if (whoSeg) {
        draftForWhom = whoSeg.dataset.v === "SELF" ? "SELF" : "CLIENT";
        paintKind();
      }
      const modeSeg = t.closest<HTMLElement>("#pjfMode .fseg-btn");
      if (modeSeg) {
        draftMode = modeSeg.dataset.v || "PROJECT_MARGIN";
        paintKind();
      }
      const buildSeg = t.closest<HTMLElement>("#pjfBuild .fseg-btn");
      const buildGroup = buildSeg?.closest<HTMLElement>("[data-build]");
      if (buildSeg && buildGroup?.dataset.build) {
        draftBuild[buildGroup.dataset.build] = buildSeg.dataset.v ?? "";
        paintKind();
      }
    });

    on(document, "keydown", (e) => {
      const ev = e as KeyboardEvent;
      if (!pjDlg.classList.contains("open")) return;
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeDlg();
        return;
      }
      // aria-modal: Tab must not walk out of the dialog and into the page behind
      if (ev.key !== "Tab") return;
      const items = Array.from(
        pjDlg.querySelectorAll<HTMLElement>("button, input, textarea, select, [href]"),
      ).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (ev.shiftKey && (active === first || !pjDlg.contains(active))) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    });

    on(pjForm, "input", () => markErr(false));

    on(pjForm, "submit", (e) => {
      e.preventDefault();
      void submitNew();
    });

    async function submitNew() {
      if (saving) return;
      const nameEl = inp("#pjfName");
      const name = (nameEl?.value || "").trim();
      if (!name) {
        markErr(true);
        nameEl?.focus();
        return;
      }
      setDlgErr(null);

      const startRaw = (inp("#pjfStart")?.value || "").trim();
      const endRaw = (inp("#pjfEnd")?.value || "").trim();
      const description = (descEl?.value || "").trim() || null;
      const status = draftStatus;
      const kind = draftKind;
      const occupied = draftKind === "REMODEL" && draftOccupied;
      // The lot's answers: the picks, the usual for the rest (lib/projectPhases reads them).
      const build = draftKind === "NEW_BUILD" ? buildAnswersFromStrings(Object.fromEntries($$("#pjfBuild [data-build]").map((g) => [g.dataset.build ?? "", draftBuild[g.dataset.build ?? ""] ?? g.dataset.default ?? ""]))) : undefined;
      // Who it is for and the money (part 5): a new build says; a remodel stays a client build with no mode (the Edit dialog changes it).
      const numOf = (v: string | undefined) => {
        const n = Number((v ?? "").replace(/[^\d.]/g, ""));
        return (v ?? "").trim() && Number.isFinite(n) ? n : null;
      };
      const money = draftKind === "NEW_BUILD" ? { forWhom: draftForWhom, moneyMode: draftForWhom === "SELF" ? "NONE" : draftMode, marginPct: draftForWhom === "CLIENT" ? numOf(inp("#pjfMargin")?.value) : null, salePrice: draftForWhom === "SELF" ? numOf(inp("#pjfSale")?.value) : null } : {};
      const budget = Math.round(
        Number((inp("#pjfBudget")?.value || "").replace(/[^\d.]/g, "")) || 0,
      );
      const clientSel = pjDlg!.querySelector<HTMLSelectElement>("#pjfClient");
      const making = clientSel?.value === "__new";
      const newName = (inp("#pjfClientName")?.value || "").trim();
      if (making && !newName) {
        pjDlg!.querySelector<HTMLElement>('[data-fld="client"]')?.classList.add("is-err");
        inp("#pjfClientName")?.focus();
        return;
      }
      let clientId = making ? null : clientSel?.value || null;
      const clientName = making ? newName : clientSel && clientSel.value ? (clientSel.selectedOptions[0]?.textContent ?? "").split(" — ")[0] : null;

      setBusy(true);
      try {
        if (making) {
          const made = await createClient({ name: newName, phone: (inp("#pjfClientPhone")?.value || "").trim() || undefined });
          clientId = made.id;
          // Keep it picked if the project itself is refused, so a second press does not make the client twice.
          const opt = document.createElement("option");
          opt.value = made.id;
          opt.textContent = made.name;
          clientSel!.insertBefore(opt, clientSel!.options[2] ?? null);
          clientSel!.value = made.id;
          paintNewClient();
        }
        // The action's schema coerces the dates; "YYYY-MM-DD" is read as UTC
        // midnight, which is exactly what the page formats back for display.
        const res = await createProject({
          name,
          description,
          status,
          startsAt: ISO_DATE.test(startRaw) ? startRaw : null,
          endsAt: ISO_DATE.test(endRaw) ? endRaw : null,
          budget,
          clientId,
          kind,
          occupied,
          build,
          ...money,
        });
        projectsData.unshift({
          id: res.id,
          kind,
          name,
          description,
          status,
          startsAt: shortDate(startRaw),
          endsAt: shortDate(endRaw),
          budget,
          jobCount: 0,
          completedJobs: 0,
          clientName,
          proposalCount: 0,
          sold: 0,
          open: 0,
          openCount: 0,
          spent: 0,
          inProgressJobs: 0,
          updatedAgo: "just now",
        });
        setBusy(false);
        if (pjstate.filter === "ALL") {
          // One row arrived — add that one card. Rebuilding the grid would
          // replay every other card's entrance for a change none of them saw.
          insertCard(projectsData[0]);
        } else {
          // Drop back to All, so a project created while a status filter was
          // active is actually visible. The whole visible set changes here, so
          // the grid does repaint — silently.
          pjstate.filter = "ALL";
          renderGrid();
        }
        paintChips();
        closeDlg();
        // Clear the form only once the box has finished animating out — reset it
        // on the same frame and you watch the fields blank while the dialog is
        // still visible.
        after(MDL_EXIT_MS, resetDlg);
      } catch (err) {
        setBusy(false);
        setDlgErr(actionError(err));
      }
    }
  }

  // ================= INITIALIZATION =================
  safe("init", function () {
    renderProjects();
  });

  // FLUID SCALE and the mobile nav drawer belong to the persistent chrome and
  // live in components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // (The Balanced ease itself now lives in blueprint-shell/list-motion, which
    // owns the row stagger below.)

    // Reveal: load + scroll.
    // Reveal adapts to scroll speed: slow scroll — the full 420ms animation;
    // fast — a short one (down to 200ms): it does not lag, but stays visible.
    const vpH = window.innerHeight;
    const scrollHost = main;
    let velLastY = scrollHost ? scrollHost.scrollTop : 0;
    let velLastT = performance.now();
    let scrollVel = 0; // px/ms
    if (scrollHost)
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
    // `.mdl` is skipped: it is a `.content` child only because the port moved
    // the dialog inside the mounted root, and `.rv` would strand the fixed
    // overlay at `opacity: 0` until it happened to intersect the viewport.
    const blocks = $$(".content > *").filter((el) => !el.classList.contains("mdl"));
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    // Overview cascades its `.kpi` strip as the second layer of the arrival.
    // This page has no `.kpi`, so the selector matched nothing and the layer
    // was silently missing; its equivalent strip is the filter chip row.
    // Elements the block cascade already claimed are skipped — nothing should
    // carry `rv` and `rv-cell` at once.
    const cells = $$(".pchip").filter((el) => !el.classList.contains("rv"));
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
            // element below the fold: duration follows the current scroll speed
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

    // Row stagger — played ONCE, when the grid first arrives.
    //
    // The donor drove this from a `MutationObserver` on `#pjGrid` with
    // `{ childList: true }`, which fired on every render: toggling a status
    // chip dropped all eight cards to `opacity: 0` and crawled them back, and
    // creating a project replayed the entrance of every card that had not
    // changed. `staggerIn` moves the decision to the caller — first paint here,
    // and the single new card in `insertCard`.
    const grid = $("#pjGrid");
    if (grid) staggerIn(Array.from(grid.querySelectorAll<HTMLElement>(".pjc")));

    // Numeral count-up — Overview's `.kpi-val`, here the project cards' stats.
    // The donor rebuilt the text from digits alone, which is only safe for its
    // own plain "$12,400"/"18": it drops any unit and would wipe an inline
    // icon. So keep whatever frames the number, skip decimals (digits-only
    // mangles them) and skip nodes holding elements rather than bare text —
    // which is how the Jobs cell keeps its icon while Budget counts up.
    $$(".pjc-val:not(.date)").forEach((el) => {
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

    // Press effects
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
    // Shell controls (.icon-btn, .sb-foot-*) press from the shell module.
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
    timers.forEach((t) => clearTimeout(t));
    disposers.forEach((d) => d());
  };
}
