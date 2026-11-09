// Proposals blueprint — SVG icon sprite, verbatim from the donor file.
// Line style: 24×24 / stroke 2 / currentColor (styling comes from svg.ic CSS).

export function Sprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-logo" viewBox="0 0 24 24"><path d="M15 4v11a4 4 0 0 1-4 4 4 4 0 0 1-4-4" /><path d="M11 4h6" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></symbol>
        <symbol id="i-plans" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 10h6" /><path d="M13 10h8" /><path d="M11 3v10" /><path d="M14 21v-6h7" /><path d="M6 15v3" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></symbol>
        <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></symbol>
        <symbol id="i-crm" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></symbol>
        {/* OPTICAL CORRECTION (not a donor value) — `stroke-width: 2.5`.
            These two are the only symbols built around one LARGE thin rect
            (18×18 and 20×14 of a 24 box). At the 17px sidebar size a 2-unit
            stroke lands on half-pixels along those long straight edges and
            smears across two columns at ~50% alpha each, so both icons read
            grey next to i-grid / i-file, whose shorter runs happen to land on
            whole pixels. Verified by rasterising every sidebar symbol to a
            17px canvas: total ink was mid-range (i-cal 94, i-jobs 96 vs i-file
            93), but the per-edge alpha was visibly washed. 2.5 snaps them back
            to solid at 17px and is imperceptible at larger sizes. */}
        <symbol id="i-cal" viewBox="0 0 24 24" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="1" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></symbol>
        <symbol id="i-jobs" viewBox="0 0 24 24" strokeWidth="2.5"><rect x="2" y="7" width="20" height="14" rx="1" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M2 13h20" /></symbol>
        <symbol id="i-hardhat" viewBox="0 0 24 24"><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" /><path d="M10 10V5a2 2 0 1 1 4 0v5" /><path d="M4 15v-3a8 8 0 0 1 16 0v3" /></symbol>
        <symbol id="i-userplus" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></symbol>
        <symbol id="i-building" viewBox="0 0 24 24"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /><path d="M10 18h4" /></symbol>
        <symbol id="i-bank" viewBox="0 0 24 24"><path d="M3 22h18" /><path d="M6 18v-7" /><path d="M10 18v-7" /><path d="M14 18v-7" /><path d="M18 18v-7" /><path d="m12 2 9 5H3z" /></symbol>
        {/* Subscription's nav mark. Paths copied verbatim from the mobile
            sprite's i-card so the same nav item draws identically on both
            shells — NAV_SECTIONS feeds the desktop sidebar and the handheld
            drawer from one list, and a symbol present in only one sprite
            renders as a blank slot on the other. */}
        <symbol id="i-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="1" /><path d="M2 10h20" /></symbol>
        <symbol id="i-roof" viewBox="0 0 24 24"><path d="m2 11 10-8 10 8" /><path d="M5 9v12h14V9" /></symbol>
        <symbol id="i-fence" viewBox="0 0 24 24"><path d="M4 21V8l2-3 2 3v13" /><path d="M10 21V8l2-3 2 3v13" /><path d="M16 21V8l2-3 2 3v13" /><path d="M2 12h20" /><path d="M2 17h20" /></symbol>
        {/* Added 2026-08-22 for the Video estimator port — the one symbol its
            donor (jobflex-videoestimator-blueprint.html) carries that this
            sprite did not. Verbatim from that file; the sidebar's own "Video
            estimator" item draws it too, which is why it lives here and not in
            a page-local sprite. */}
        <symbol id="i-video" viewBox="0 0 24 24"><rect x="2" y="6" width="13" height="12" rx="1.5" /><path d="M15 10.5 21 7v10l-6-3.5" /></symbol>
        {/* Added 2026-09-18 for the Smart Proposal brief: a microphone —
            press and speak. Same line style as the rest. */}
        <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /><path d="M8 21h8" /></symbol>
        {/* Added 2026-09-18 for the HVAC estimator: an outdoor unit — the box
            and its fan. Drawn in the sprite's own line style; the nav asked
            for `i-bolt`, which only the Financials sprite has, so every other
            page drew a blank. */}
        <symbol id="i-heatpump" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12V8.5" /><path d="m12 12 3 1.8" /><path d="m12 12-3 1.8" /></symbol>
        <symbol id="i-deck" viewBox="0 0 24 24"><path d="M2 10h20" /><path d="M2 13h20" /><path d="M4 13v8" /><path d="M20 13v8" /><path d="M12 13v8" /><path d="M5 10V5h14v5" /></symbol>
        <symbol id="i-sofa" viewBox="0 0 24 24"><path d="M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" /><path d="M3 11a2 2 0 0 1 2 2v2h14v-2a2 2 0 1 1 4 0v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Z" /><path d="M5 18v2" /><path d="M19 18v2" /></symbol>
        <symbol id="i-leaf" viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></symbol>
        <symbol id="i-phone" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" /></symbol>
        {/* Same optical correction as i-cal / i-jobs above, same reason: one
            large thin outline filling the box (18×14 of a 24), whose long
            straight top and bottom runs land on half-pixels at the 17px sidebar
            size and read grey next to i-file / i-users. 2.5 snaps it solid. */}
        <symbol id="i-msg" viewBox="0 0 24 24" strokeWidth="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></symbol>
        {/* Texting (2026-10-16, nav-map): a phone with a text on it — lucide smartphone, two lines in the screen. */}
        <symbol id="i-sms" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6" /><path d="M9 11h4" /><path d="M12 18h.01" /></symbol>
        {/* Sign out. lucide log-out, same 24×24 line style as the rest. */}
        <symbol id="i-out" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></symbol>
        <symbol id="i-megaphone" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 13z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></symbol>
        <symbol id="i-board" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></symbol>
        <symbol id="i-gift" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></symbol>
        <symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></symbol>
        <symbol id="i-arrow" viewBox="0 0 24 24"><path d="M7 7h10v10" /><path d="M7 17 17 7" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
        <symbol id="i-bulb" viewBox="0 0 24 24"><path d="M9 15c-.2-1-.7-1.7-1.4-2.4A4.9 4.9 0 0 1 7.1 9.4a4.9 4.9 0 0 1 9.8 0c0 1.2-.5 2.3-1.5 3.2-.7.7-1.2 1.4-1.4 2.4" /><path d="M9.5 18h5" /><path d="M10.5 21h3" /><path d="M12 1.5V3" /><path d="m5.4 4.2 1.1 1.1" /><path d="m18.6 4.2-1.1 1.1" /><path d="M3 9.5h1.5" /><path d="M19.5 9.5H21" /></symbol>
        <symbol id="i-thumb" viewBox="0 0 24 24"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></symbol>
        <symbol id="i-dots" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></symbol>
        <symbol id="i-pen" viewBox="0 0 24 24"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></symbol>
        {/* Added 2026-09-20: the views plate on the proposals list. */}
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></symbol>
        <symbol id="i-ext" viewBox="0 0 24 24"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></symbol>
        <symbol id="i-dup" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="1" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></symbol>
        <symbol id="i-send" viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></symbol>
        <symbol id="i-box" viewBox="0 0 24 24"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></symbol>
        {/* A wrench — repairs and come-backs (2026-11-09), lucide path. */}
        <symbol id="i-wrench" viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></symbol>
        <symbol id="i-undo" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></symbol>
        <symbol id="i-imgadd" viewBox="0 0 24 24"><path d="M16 5h6" /><path d="M19 2v6" /><path d="M21 11.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7.5" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /><circle cx="9" cy="9" r="2" /></symbol>
        <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></symbol>
        {/* Calendar form controls — same line style (24×24 / stroke 2), lucide paths. */}
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2.2" /></symbol>
        <symbol id="i-hourglass" viewBox="0 0 24 24"><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" /></symbol>
        <symbol id="i-filter" viewBox="0 0 24 24"><path d="M22 3H2l8 9.46V19l4 2v-8.54z" /></symbol>
        <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></symbol>
        <symbol id="i-user" viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></symbol>
        <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="m5.6 5.6 12.8 12.8" /></symbol>
        {/* Added for the manual builder's card 11 (Download PDF). Same line
            style as the rest — 24x24, stroke 2, currentColor. */}
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></symbol>
      </defs>
    </svg>
  );
}
