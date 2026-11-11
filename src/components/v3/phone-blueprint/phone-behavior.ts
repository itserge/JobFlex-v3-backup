// Phone blueprint — runtime behaviors, ported from the donor file's <script>
// (jobflex-phone-blueprint_1.html). Every duration, easing, stagger, interval
// and template string is the donor's exact value. Adaptations are mechanical
// only:
// - queries are scoped to the mounted `.content` root;
// - document/window listeners, observers, intervals and timeouts are tracked
//   for unmount cleanup;
// - the donor's chrome modules (the `window.matchMedia` polyfill, the mobile
//   nav drawer, FLUID SCALE, the sidebar entry cascade, the sliding active
//   indicator and the graph-paper parallax) are NOT ported here — the shared
//   shell (components/v3/blueprint-shell/shell-behavior.ts) already owns all
//   of them;
// - the donor's `safe(name, fn)` try/catch wrapper is dropped: the modules it
//   guarded are either shell-owned or replaced by the strict null checks below;
// - the reveal cascade skips `#sheetBg` / `#sheet`: in the donor those two
//   fixed overlays live OUTSIDE `.content` and therefore never joined the
//   `.content > *` cascade. Excluding them here reproduces the donor exactly
//   (and keeps a `display:none` element from being frozen at `opacity: 0`).
//
// WHAT IS NO LONGER THE DONOR'S — the four controls it faked:
//
// 1. "Create lead" wrote `c.lead = 'L-' + random()` into the local array, so
//    the badge appeared and was gone on the next navigation. It now awaits
//    `createLeadFromCall(callId)` — the same org-scoped, plan-limited action
//    the classic sheet called — and surfaces the action's own error text.
// 2. "Open lead" was `data-flash="Opened"`: a checkmark on a 1.5s timer and
//    nothing else. It is now an anchor to /dashboard/leads/<leadId>.
// 3. "Call back" was `data-flash="Calling"`. It is now a `tel:` anchor on the
//    other party's number — which is the whole of "call back" on a device that
//    can place calls, and needs no backend.
// 4. The recording player was a `setInterval` advancing a bar over a duration
//    the fixture asserted. It now drives a real `<audio>` off
//    `AiPhoneCall.recordingUrl`, and the section is absent when there is none.
//
// Also: the Copy button swapped its own label to "Copied" without ever
// touching the clipboard. It now writes to the clipboard and only claims
// success when the write resolved.
//
// Rendering rules the page obeys (see decisions.md, Session 3): a filter chip
// PATCHES the chip strip (rebuilding it would destroy the button the user just
// pressed and steal its focus), and a created lead PATCHES the one row, the one
// stat and the sheet's action bar rather than re-rendering the log. The row
// stagger plays on first paint only.

import { createLeadFromCall } from "@/actions/aiPhoneCalls";
import { staggerIn } from "@/components/v3/blueprint-shell/list-motion";
import { CALLS_SEED, type Call, type PhoneStats } from "./phone-data";

export type PhoneContentOptions = {
  /** The org's real call log, read server-side. Omit to fall back to the donor
   *  fixture (a standalone mock route has no session to read from). */
  entries?: Call[];
  /** Whole-table counts, read server-side. Derived from `entries` if omitted. */
  stats?: PhoneStats;
};

/** Server actions reject with an Error whose message is written for the user
 *  ("You've reached the Lead limit on your plan."). Surface that text; fall
 *  back to a generic line for anything unrecognisable. */
function actionError(err: unknown): string {
  const msg = err instanceof Error ? err.message.trim() : "";
  // A Next.js server-action transport failure has no useful message.
  if (!msg || msg.toLowerCase().includes("fetch failed")) {
    return "Something went wrong. Check your connection and try again.";
  }
  return msg;
}

/** Everything below is concatenated into innerHTML, and every value in it is
 *  attacker-influenced: a caller controls the number they dial from, and the
 *  transcript and summary are machine-written from what they said. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** `tel:` accepts digits, `+`, and the DTMF pause characters. Anything else in
 *  a stored number is presentation (spaces, parens, dashes) and is dropped, so
 *  a hostile "number" cannot become a different URL scheme. */
function telHref(num: string): string | null {
  const cleaned = num.replace(/[^\d+,;*#]/g, "");
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return "tel:" + cleaned;
}

export function initPhoneContent(
  content: HTMLElement,
  options: PhoneContentOptions = {},
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
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
    return id;
  };
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const $$ = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

  // A per-mount COPY of the rows. `createLeadFromCall` patches `c.lead` on
  // success so the log repaints immediately instead of waiting on a round trip
  // through the router; cloning keeps that write off the module-level fixture.
  // `script` is never written, so a shallow record copy is enough.
  const seed = options.entries ?? CALLS_SEED;
  const callsData: Call[] = seed.map((c) => ({ ...c }));

  // Counted over the whole table server-side. Without a server count (the
  // fixture path) the loaded rows are all there is to count.
  const stats: PhoneStats = options.stats ?? {
    today: callsData.filter((c) => /m ago|h ago|just now/.test(c.when)).length,
    week: callsData.length,
    leads: callsData.filter((c) => c.lead).length,
    deskMinutes: Math.round(callsData.reduce((n, c) => n + (c.desk?.seconds ?? 0), 0) / 60),
  };

  // Dismiss Lead Center banners (smooth height + gap collapse) — inert on this
  // page (no `.banner` in the markup), kept for donor parity with shared shells.
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

  // ================= PHONE: STATE =================
  const ph = {
    filter: "ALL",
    selected: null as string | null,
    /** A create-lead write is on the wire; the sheet must not be dismissed or
     *  the button pressed again while it is. */
    saving: false,
  };

  function fmtDur(sec: number | null) {
    if (sec == null) return "—";
    const m = Math.floor(sec / 60),
      s2 = sec % 60;
    return m + ":" + String(s2).padStart(2, "0");
  }
  function statusLabel(v: string) {
    return v.toLowerCase().replace("_", " ");
  }
  function byId(id: string | null) {
    return callsData.find((x) => x.id === id) ?? null;
  }
  /** Whoever is on the other end of the line — the party a "call back" reaches. */
  function counterparty(c: Call) {
    return c.dir === "INBOUND" ? c.from : c.to;
  }

  // ================= RENDER =================
  function renderStats() {
    const cards: Array<{ k: keyof PhoneStats; l: string; h: string; accent?: boolean }> = [
      { k: "today", l: "Calls today", h: "Since midnight" },
      { k: "week", l: "Calls · 7d", h: "Inbound and outbound" },
      { k: "leads", l: "Auto-leads · 7d", h: "Created from transcripts", accent: true },
      { k: "deskMinutes", l: "Desk minutes · month", h: "The AI desk on the line" },
    ];
    const grid = $("#statGrid");
    if (!grid) return;
    grid.innerHTML = cards
      .map(
        (c) =>
          '<div class="stat" data-stat="' +
          c.k +
          '"><div class="kpi-lbl">' +
          esc(c.l) +
          "</div>" +
          '<div class="stat-val' +
          (c.accent ? " accent" : "") +
          '">' +
          stats[c.k] +
          "</div>" +
          '<div class="stat-hint">' +
          esc(c.h) +
          "</div></div>",
      )
      .join("");
  }
  /** One figure moved. Patch that figure — a rebuilt grid would replay three
   *  entrance animations for a single incremented number. */
  function patchStat(k: keyof PhoneStats) {
    const val = $('[data-stat="' + k + '"] .stat-val');
    if (val) val.textContent = String(stats[k]);
  }

  function filterCount(k: string) {
    if (k === "ALL") return callsData.length;
    if (k === "LEADS") return callsData.filter((c) => c.lead).length;
    if (k === "DESK") return callsData.filter((c) => c.desk).length;
    return callsData.filter((c) => c.dir === k).length;
  }
  function filtered() {
    if (ph.filter === "ALL") return callsData;
    if (ph.filter === "LEADS") return callsData.filter((c) => c.lead);
    if (ph.filter === "DESK") return callsData.filter((c) => c.desk);
    return callsData.filter((c) => c.dir === ph.filter);
  }

  const FILTER_DEFS = [
    { k: "ALL", l: "All" },
    { k: "INBOUND", l: "Inbound" },
    { k: "OUTBOUND", l: "Outbound" },
    { k: "LEADS", l: "Became leads" },
    { k: "DESK", l: "AI desk" },
  ];
  /** Built ONCE. Pressing a chip must not rebuild this strip: the pressed
   *  button would be destroyed mid-click and the focus ring with it. */
  function renderFilters() {
    const box = $("#phFilters");
    if (!box) return;
    box.innerHTML = FILTER_DEFS.map(
      (d) =>
        '<button class="ph-chip" type="button" data-f="' +
        d.k +
        '" aria-pressed="false">' +
        esc(d.l) +
        ' <span data-n>0</span></button>',
    ).join("");
    syncFilters();
  }
  function syncFilters() {
    FILTER_DEFS.forEach((d) => {
      const chip = $('.ph-chip[data-f="' + d.k + '"]');
      if (!chip) return;
      const active = ph.filter === d.k;
      chip.classList.toggle("on", active);
      chip.setAttribute("aria-pressed", active ? "true" : "false");
      const n = chip.querySelector<HTMLElement>("[data-n]");
      if (n) n.textContent = String(filterCount(d.k));
    });
  }

  /** The row's first cell: the caller's name when the call is on a lead, the number under it. */
  function whoHtml(c: Call) {
    const inbound = c.dir === "INBOUND";
    if (!c.name) return '<div class="ph-num">' + esc(c.from) + '</div><div class="ph-to">to ' + esc(c.to) + "</div>";
    return inbound
      ? '<div class="ph-num">' + esc(c.name) + '</div><div class="ph-to">' + esc(c.from) + " · to " + esc(c.to) + "</div>"
      : '<div class="ph-num">' + esc(c.from) + '</div><div class="ph-to">to ' + esc(c.name) + " · " + esc(c.to) + "</div>";
  }
  function rowHtml(c: Call) {
    return (
      '<tr class="prow" data-call="' +
      esc(c.id) +
      '">' +
      "<td>" +
      whoHtml(c) +
      "</td>" +
      '<td data-cell="dir"><span class="pstatus dir--' +
      (c.dir === "INBOUND" ? "in" : "out") +
      '">' +
      esc(c.dir.toLowerCase()) +
      "</span>" +
      (c.lead ? '<span class="pstatus lead-flag">lead</span>' : "") +
      (c.desk ? '<span class="pstatus desk-flag">' + esc(c.desk.label) + "</span>" : "") +
      "</td>" +
      '<td><span class="ph-dur">' +
      fmtDur(c.dur) +
      "</span></td>" +
      "<td>" +
      (c.summary
        ? '<span class="ph-sum">' + esc(c.summary) + "</span>"
        : '<span class="ph-sum none">No transcript yet</span>') +
      "</td>" +
      '<td><span class="ph-when">' +
      esc(c.when) +
      "</span></td>" +
      '<td class="num"><button type="button" class="pt-open" aria-label="Open transcript"><svg class="ic"><use href="#i-arrow"/></svg></button></td>' +
      "</tr>"
    );
  }
  function renderCalls() {
    const body = $("#callBody");
    const empty = $("#callEmpty");
    if (!body || !empty) return;
    const rows = filtered();
    body.innerHTML = rows.map(rowHtml).join("");
    empty.classList.toggle("is-hidden", rows.length !== 0);
  }
  /** One call became a lead. Add that one badge; leave the other 99 rows and
   *  their entrance animations alone. */
  function patchRowLead(id: string) {
    const cell = $('tr[data-call="' + CSS.escape(id) + '"] [data-cell="dir"]');
    if (!cell || cell.querySelector(".lead-flag")) return;
    const flag = document.createElement("span");
    flag.className = "pstatus lead-flag";
    flag.textContent = "lead";
    cell.appendChild(flag);
  }

  function renderPhone() {
    renderStats();
    renderFilters();
    renderCalls();
  }
  /**
   * Installed by the motion module below; null under reduced motion.
   *
   * Nothing on this page adds a call — the log is a read-only record of what
   * the line already did — so first paint is currently its only genuine
   * arrival. A live feed pushing a new call in would be the second call site.
   */
  let playStagger: (() => void) | null = null;

  // ================= RECORDING PLAYER (real audio) =================
  // The donor animated a bar off a `setInterval` and a fixture duration; this
  // streams `AiPhoneCall.recordingUrl`. One element at a time — the sheet shows
  // one call — torn down whenever the sheet's body is replaced.
  let audio: HTMLAudioElement | null = null;

  function paintPlayer(cur: number, total: number | null) {
    const fill = $("#playFill");
    const time = $("#playTime");
    if (fill) fill.style.width = total ? Math.min(100, (cur / total) * 100) + "%" : "0%";
    if (time) time.textContent = fmtDur(Math.floor(cur)) + " / " + fmtDur(total);
  }
  function setPlayingUi(playing: boolean) {
    const btn = $("#playBtn");
    if (!btn) return;
    btn.classList.toggle("is-playing", playing);
    btn.setAttribute("aria-label", playing ? "Pause recording" : "Play recording");
  }
  function teardownAudio() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    audio = null;
  }
  function mountAudio(c: Call) {
    teardownAudio();
    if (!c.rec) return;
    const el = new Audio(c.rec);
    el.preload = "metadata";
    audio = el;
    const total = () => (isFinite(el.duration) && el.duration > 0 ? el.duration : c.dur);
    el.addEventListener("timeupdate", () => paintPlayer(el.currentTime, total()));
    el.addEventListener("loadedmetadata", () => paintPlayer(el.currentTime, total()));
    el.addEventListener("play", () => setPlayingUi(true));
    el.addEventListener("pause", () => setPlayingUi(false));
    el.addEventListener("ended", () => {
      setPlayingUi(false);
      paintPlayer(0, total());
    });
    el.addEventListener("error", () => {
      setPlayingUi(false);
      const time = $("#playTime");
      // The URL is Twilio's and can expire or 404; say so where the clock was
      // rather than leaving a button that silently does nothing.
      if (time) time.textContent = "Recording unavailable";
    });
  }
  function togglePlay() {
    if (!audio) return;
    if (audio.paused) {
      void audio.play().catch(() => setPlayingUi(false));
    } else {
      audio.pause();
    }
  }
  disposers.push(() => teardownAudio());

  // ================= PANEL =================
  function actionsHtml(c: Call) {
    const tel = telHref(counterparty(c));
    return (
      (c.lead
        ? '<a class="btn btn-ghost btn--sm" href="/dashboard/leads/' +
          esc(encodeURIComponent(c.lead)) +
          '"><svg class="ic"><use href="#i-ext"/></svg>Open lead</a>'
        : '<button class="btn btn-primary btn--sm" type="button" data-act="make-lead">' +
          '<svg class="ic"><use href="#i-target"/></svg><span data-save-lbl>Create lead</span></button>') +
      (tel
        ? '<a class="btn btn-ghost btn--sm" href="' +
          esc(tel) +
          '"><svg class="ic"><use href="#i-phone"/></svg>Call back</a>'
        : "")
    );
  }
  function badgesHtml(c: Call) {
    return (
      '<span class="pstatus dir--' +
      (c.dir === "INBOUND" ? "in" : "out") +
      '">' +
      esc(c.dir.toLowerCase()) +
      "</span>" +
      '<span class="pstatus st--' +
      esc(c.status.toLowerCase()) +
      '">' +
      esc(statusLabel(c.status)) +
      "</span>" +
      '<span class="pstatus">' +
      fmtDur(c.dur) +
      "</span>" +
      (c.lead ? '<span class="pstatus lead-flag" data-lead-badge>lead</span>' : "") +
      (c.desk ? '<span class="pstatus desk-flag">AI desk · ' + esc(c.desk.label) + "</span>" : "")
    );
  }
  /** What the AI desk did on the call, and the visit it booked — a link onto the calendar. */
  function deskHtml(c: Call) {
    if (!c.desk) return "";
    const a = c.desk.appointment;
    return (
      '<div class="sh-sec" data-sheet-desk><div class="kpi-lbl">The AI desk</div><div class="sh-desk">' +
      (c.desk.word === "failed"
        ? "<div>The desk couldn't take this call" +
          (c.desk.error ? ": " + esc(c.desk.error) : "") +
          " — the caller was asked to leave a message.</div>"
        : "<div>The desk " +
          esc(c.desk.label) +
          " and was on the line " +
          fmtDur(c.desk.seconds) +
          ".</div>") +
      (a
        ? '<a class="btn btn-ghost btn--sm" href="/dashboard/calendar?date=' +
          esc(encodeURIComponent(a.date)) +
          "&ev=apt:" +
          esc(encodeURIComponent(a.id)) +
          '" data-desk-visit><svg class="ic"><use href="#i-ext"/></svg>Open the visit · ' +
          esc(a.when) +
          "</a>"
        : "") +
      "</div></div>"
    );
  }
  function transcriptHtml(c: Call) {
    if (c.script.length) {
      return (
        '<div class="script">' +
        c.script
          .map(
            (l) =>
              '<div class="script-line ' +
              (l[0] === "agent" || l[0] === "desk" ? "agent" : "") +
              '">' +
              '<span class="script-who">' +
              (l[0] === "desk" ? "AI desk" : l[0] === "agent" ? "Shop" : "Caller") +
              "</span>" +
              "<span>" +
              esc(l[1]) +
              "</span></div>",
          )
          .join("") +
        "</div>"
      );
    }
    // Twilio's raw transcription carries no speaker labels. The classic sheet
    // showed it as one pre-wrapped block; throwing it away because it does not
    // fit the two-column script would hide the only record of the call.
    if (c.transcript) {
      return '<div class="sh-raw">' + esc(c.transcript) + "</div>";
    }
    return '<div class="sh-none">No transcript yet — it is posted once the recording completes.</div>';
  }

  function openCall(id: string) {
    const c = byId(id);
    if (!c) return;
    ph.selected = id;
    const title = $("#sheetTitle");
    const body = $("#sheetBody");
    const sheet = $("#sheet");
    const bg = $("#sheetBg");
    if (!title || !body || !sheet || !bg) return;
    title.textContent = c.dir === "OUTBOUND" ? "Call to " + (c.name || c.to) : "Call from " + (c.name || c.from);
    body.innerHTML =
      '<div class="sh-badges" id="shBadges">' +
      badgesHtml(c) +
      "</div>" +
      (c.rec
        ? '<div class="sh-sec"><div class="kpi-lbl">Recording</div>' +
          '<div class="player"><button class="play-btn" type="button" id="playBtn" aria-label="Play recording">' +
          '<svg class="ic"><use href="#i-arrow"/></svg></button>' +
          '<span class="play-track"><span class="play-fill" id="playFill"></span></span>' +
          '<span class="play-time" id="playTime">0:00 / ' +
          fmtDur(c.dur) +
          "</span></div></div>"
        : "") +
      deskHtml(c) +
      '<div class="sh-sec"><div class="kpi-lbl">Call summary</div>' +
      (c.summary
        ? '<div class="sh-summary">' + esc(c.summary) + "</div>"
        : '<div class="sh-none">No summary yet — it is written once the recording finishes processing.</div>') +
      "</div>" +
      '<div class="sh-sec"><div class="kpi-lbl">Transcript</div>' +
      transcriptHtml(c) +
      "</div>" +
      '<div class="mf-err is-hidden" id="callErr" role="alert"></div>' +
      '<div class="sh-act" id="shAct">' +
      actionsHtml(c) +
      "</div>";
    mountAudio(c);
    sheet.classList.add("open");
    bg.classList.add("open");
  }
  function closeSheet() {
    // A dismiss must never interrupt a write that is already on the wire.
    if (ph.saving) return;
    teardownAudio();
    $("#sheet")?.classList.remove("open");
    $("#sheetBg")?.classList.remove("open");
    ph.selected = null;
  }

  function setCallError(msg: string | null) {
    const box = $("#callErr");
    if (!box) return;
    box.textContent = msg || "";
    box.classList.toggle("is-hidden", !msg);
  }
  /** Button label + disabled state while the create-lead write is in flight. */
  function setLeadSaving(saving: boolean) {
    ph.saving = saving;
    const btn = $<HTMLButtonElement>('[data-act="make-lead"]');
    if (!btn) return;
    btn.disabled = saving;
    btn.classList.toggle("is-busy", saving);
    const lbl = btn.querySelector<HTMLElement>("[data-save-lbl]");
    if (lbl) lbl.textContent = saving ? "Creating…" : "Create lead";
  }

  // ================= WRITES (real server action) =================
  // `createLeadFromCall` is the same action the classic transcript sheet
  // called: it is org-scoped, sales/manager-gated, enforces the plan's lead
  // limit, copies the transcript onto the new Lead and revalidates
  // /dashboard/phone. Everything below the await is a PATCH of what the write
  // changed — one badge, one row, one figure, one action bar — so a reload
  // reads exactly the same page back.
  async function submitMakeLead() {
    if (ph.saving) return;
    const id = ph.selected;
    const c = byId(id);
    if (!c || c.lead) return;
    setCallError(null);
    setLeadSaving(true);
    try {
      const res = await createLeadFromCall(c.id);
      c.lead = res.leadId;
      ph.saving = false;

      stats.leads += 1;
      patchStat("leads");
      syncFilters();
      patchRowLead(c.id);

      const badges = $("#shBadges");
      if (badges && !badges.querySelector("[data-lead-badge]")) {
        const flag = document.createElement("span");
        flag.className = "pstatus lead-flag";
        flag.setAttribute("data-lead-badge", "");
        flag.textContent = "lead";
        badges.appendChild(flag);
      }
      // Only the action bar changes shape: "Create lead" becomes the link to
      // the lead it created. The player above keeps playing.
      const act = $("#shAct");
      if (act) act.innerHTML = actionsHtml(c);
    } catch (err) {
      setLeadSaving(false);
      setCallError(actionError(err));
    }
  }

  // ================= CLIPBOARD =================
  // The donor's Copy button only relabelled itself. This one writes, and only
  // claims success when the write resolved.
  async function copyHook() {
    const b = $("#hookCopy");
    if (!b || b.dataset.busy) return;
    const url = $("#hookUrl")?.textContent?.trim() ?? "";
    if (!url) return;
    b.dataset.busy = "1";
    const html = b.innerHTML;
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      // Clipboard permission denied, or an insecure origin. Select the URL so
      // the keyboard shortcut still works instead of lying about having copied.
      const node = $("#hookUrl");
      const sel = window.getSelection();
      if (node && sel) {
        const range = document.createRange();
        range.selectNodeContents(node);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    b.innerHTML = ok
      ? '<svg class="ic"><use href="#i-dup"/></svg>Copied'
      : '<svg class="ic"><use href="#i-x"/></svg>Press ⌘C';
    later(() => {
      b.innerHTML = html;
      delete b.dataset.busy;
    }, 1400);
  }

  // ================= EVENTS =================
  on(document, "click", function (e) {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (!root.contains(target)) return;

    const f = target.closest<HTMLElement>("[data-f]");
    if (f) {
      ph.filter = f.dataset.f || "ALL";
      syncFilters();
      renderCalls();
      // No cascade: a chip narrows the log the user is already reading. This is
      // the case the MutationObserver got wrong — the table blanked to opacity 0
      // and crawled back on every chip.
      return;
    }
    const row = target.closest<HTMLElement>("[data-call]");
    if (row) {
      if (row.dataset.call) openCall(row.dataset.call);
      return;
    }
    if (target.closest('[data-sheet="close"]') || target.id === "sheetBg") {
      closeSheet();
      return;
    }
    if (target.closest("#playBtn")) {
      togglePlay();
      return;
    }
    if (target.closest("#hookCopy")) {
      void copyHook();
      return;
    }
    const act = target.closest<HTMLElement>("[data-act]");
    if (act && act.dataset.act === "make-lead") {
      void submitMakeLead();
    }
  });

  // Escape closes the transcript panel — it is a modal overlay with a scrim,
  // and the × is the only other way out.
  on(document, "keydown", (e) => {
    if ((e as KeyboardEvent).key !== "Escape") return;
    if (ph.selected) closeSheet();
  });

  // ================= INITIALIZATION =================
  renderPhone();

  // The matchMedia polyfill, mobile nav drawer and FLUID SCALE belong to the
  // persistent chrome and live in
  // components/v3/blueprint-shell/shell-behavior.ts.

  // ================= MOTION SYSTEM — BALANCED (package 02) =================
  (function () {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // The row cascade's curve now lives in blueprint-shell/list-motion, which
    // owns both halves of list motion for every blueprint page.

    // Reveal: load + scroll.
    // Reveal adapts to scroll speed: slow scroll — the full 420ms animation;
    // fast — a short one (down to 200ms): never lags, still visible.
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
    // `#sheetBg` / `#sheet` are excluded: in the donor they are not `.content`
    // children, so the cascade never touched them.
    const blocks = $$(".content > *").filter(
      (el) => !el.classList.contains("sheet") && !el.classList.contains("sheet-bg"),
    );
    blocks.forEach((el, i) => {
      el.classList.add("rv");
      const initial = el.getBoundingClientRect().top < vpH;
      if (!initial) el.dataset.rvScroll = "1";
      el.style.transitionDelay = initial ? i * 60 + "ms" : "200ms";
    });
    // Second layer of the arrival — Overview cascades its `.kpi` strip here.
    // This page ships no `.kpi` element (its tiles are `.stat`, staggered by
    // animateRows below), so the donor's layer is silently empty. Kept
    // verbatim rather than re-pointed: the donor plays no `rv-cell` pass here.
    const cells = $$(".kpi");
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
            // below the fold: duration from the current scroll speed
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

    // Entrance cascade — on FIRST PAINT only.
    //
    // This used to hang off a MutationObserver on #callBody and #statGrid, so
    // the call log replayed its entrance on every filter chip AND the three
    // stat tiles re-cascaded whenever a transcript turned into a lead. Both are
    // repaints of records already on screen: the chips only narrow the same
    // log, and "Create lead" changes one row's badge and one tile's number.
    // See blueprint-shell/list-motion for the reasoning.
    playStagger = () => {
      ["callBody", "statGrid"].forEach((id) => {
        const list = $("#" + id);
        if (!list) return;
        staggerIn(Array.from(list.querySelectorAll<HTMLElement>(".prow, .stat")));
      });
    };
    playStagger();

    // KPI count-up. Like the donor, this targets `.kpi-val`; the phone page
    // has none (its figures are `.stat-val`), so no number counts up here —
    // that is the donor's own behavior, preserved.
    $$(".kpi-val").forEach((el) => {
      const raw = (el.textContent || "").trim();
      const money = raw.charAt(0) === "$";
      const target = parseInt(raw.replace(/[^0-9]/g, ""), 10);
      if (!isFinite(target)) return;
      let t0: number | null = null;
      function frame(t: number) {
        if (!t0) t0 = t;
        const pr = Math.min(1, (t - t0) / 750);
        const e = 1 - Math.pow(1 - pr, 3);
        el.textContent = (money ? "$" : "") + Math.round(target * e).toLocaleString("en-US");
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
      ".btn, .card-foot-btn, .ptab, .ph-chip, .pager-btn, .pmenu-item, .photo-box, .pt-open, .play-btn, .hook-copy, .sheet-x",
      "pressed",
    );
    pressify(".week-strip .day", "day-pressed");

    // (Graph-paper parallax lives in the shell — it owns .main.)
  })();

  // The sliding sidebar indicator lives in the shell — it survives navigation
  // and re-points at whichever item React marks `active`.

  return () => {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    disposers.forEach((d) => d());
  };
}
