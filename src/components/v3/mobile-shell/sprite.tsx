// MOBILE SPRITE — one <symbol> set for every handheld page.
//
// Generated as the UNION of the symbols the three mobile page components were
// each shipping privately (proposals 42, clients 39, dashboard 33 → 48 distinct).
// Rendered once by MobileNav, so a page never declares icons again: it just
// references them by id. Duplicated sprites in one document would give two
// elements the same symbol id, and the first would silently win.
//
// House style: line icons on a 24×24 grid, stroke 2, currentColor, only
// original lucide paths. i-bulb is the reference's hand-drawn "switched-on"
// bulb — the Smart Proposal mark, never an "AI" glyph.

export function MobileSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-arrow" viewBox="0 0 24 24"> <path d="M7 7h10v10" /> <path d="M7 17 17 7" /> </symbol>
        <symbol id="i-badge" viewBox="0 0 24 24"><path d="M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8z" /></symbol>
        <symbol id="i-bank" viewBox="0 0 24 24"><path d="M3 22h18" /><path d="M6 18v-7" /><path d="M10 18v-7" /><path d="M14 18v-7" /><path d="M18 18v-7" /><path d="m12 2 9 5H3z" /></symbol>
        <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></symbol>
        <symbol id="i-board" viewBox="0 0 24 24"><rect x="8" y="2" width="8" height="4" rx="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /><path d="M12 11h4" /><path d="M12 16h4" /><path d="M8 11h.01" /><path d="M8 16h.01" /></symbol>
        <symbol id="i-building" viewBox="0 0 24 24"><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" /><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" /><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" /><path d="M10 6h4" /><path d="M10 10h4" /><path d="M10 14h4" /><path d="M10 18h4" /></symbol>
        <symbol id="i-bulb" viewBox="0 0 24 24"><path d="M9 15c-.2-1-.7-1.7-1.4-2.4A4.9 4.9 0 0 1 7.1 9.4a4.9 4.9 0 0 1 9.8 0c0 1.2-.5 2.3-1.5 3.2-.7.7-1.2 1.4-1.4 2.4" /><path d="M9.5 18h5" /><path d="M10.5 21h3" /><path d="M12 1.5V3" /><path d="m5.4 4.2 1.1 1.1" /><path d="m18.6 4.2-1.1 1.1" /><path d="M3 9.5h1.5" /><path d="M19.5 9.5H21" /></symbol>
        <symbol id="i-cal" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="1" /><path d="M16 2v4" /><path d="M8 2v4" /><path d="M3 10h18" /></symbol>
        <symbol id="i-card" viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="1" /><path d="M2 10h20" /></symbol>
        {/* Tutorials (2026-11-11): a screen with a play mark. */}
        <symbol id="i-learn" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="14" rx="1" /><path d="M10 8.25v5.5L14.5 11z" /><path d="M8 21h8" /></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
        <symbol id="i-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></symbol>
        <symbol id="i-chevl" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></symbol>
        <symbol id="i-chevr" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></symbol>
        <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></symbol>
        <symbol id="i-copy" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="1" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></symbol>
        <symbol id="i-crm" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 13.5 6.8 4" /><path d="m15.4 6.5-6.8 4" /></symbol>
        <symbol id="i-dots" viewBox="0 0 24 24"><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></symbol>
        <symbol id="i-fence" viewBox="0 0 24 24"><path d="M4 21V8l2-3 2 3v13" /><path d="M10 21V8l2-3 2 3v13" /><path d="M16 21V8l2-3 2 3v13" /><path d="M2 12h20" /><path d="M2 17h20" /></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" /></symbol>
        <symbol id="i-plans" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M3 10h6" /><path d="M13 10h8" /><path d="M11 3v10" /><path d="M14 21v-6h7" /><path d="M6 15v3" /></symbol>
        <symbol id="i-fileplus" viewBox="0 0 24 24"> <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /> <path d="M14 2v6h6" /> <path d="M12 18v-6" /> <path d="M9 15h6" /> </symbol>
        <symbol id="i-filter" viewBox="0 0 24 24"><path d="M3 5h18" /><path d="M6 12h12" /><path d="M10 19h4" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></symbol>
        <symbol id="i-gear" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></symbol>
        <symbol id="i-gift" viewBox="0 0 24 24"><rect x="3" y="8" width="18" height="4" /><path d="M12 8v13" /><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" /><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5" /></symbol>
        <symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></symbol>
        <symbol id="i-hardhat" viewBox="0 0 24 24"><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1z" /><path d="M10 10V5a2 2 0 1 1 4 0v5" /><path d="M4 15v-3a8 8 0 0 1 16 0v3" /></symbol>
        <symbol id="i-hourglass" viewBox="0 0 24 24"><path d="M5 22h14" /><path d="M5 2h14" /><path d="M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22" /><path d="M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4a2 2 0 0 0 .6-1.4V2" /></symbol>
        <symbol id="i-imgplus" viewBox="0 0 24 24"><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /><path d="M18 3v6" /><path d="M21 6h-6" /></symbol>
        <symbol id="i-jobs" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="1" /><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" /><path d="M2 13h20" /></symbol>
        <symbol id="i-logo" viewBox="0 0 24 24"><path d="M15 4v11a4 4 0 0 1-4 4 4 4 0 0 1-4-4" /><path d="M11 4h6" /></symbol>
        <symbol id="i-mail" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="1" /><path d="m2 6 10 7 10-7" /></symbol>
        <symbol id="i-megaphone" viewBox="0 0 24 24"><path d="m3 11 18-5v12L3 13z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" /></symbol>
        <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></symbol>
        <symbol id="i-msg" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></symbol>
        {/* Texting (2026-10-16, nav-map): the desk sprite's glyph. */}
        <symbol id="i-sms" viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 7h6" /><path d="M9 11h4" /><path d="M12 18h.01" /></symbol>
        <symbol id="i-out" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></symbol>
        <symbol id="i-phone" viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.13.96.36 1.9.7 2.8a2 2 0 0 1-.45 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.45c.9.34 1.84.57 2.8.7A2 2 0 0 1 22 16.9z" /></symbol>
        <symbol id="i-pin" viewBox="0 0 24 24"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></symbol>
        <symbol id="i-roof" viewBox="0 0 24 24"><path d="m2 11 10-8 10 8" /><path d="M5 9v12h14V9" /></symbol>
        <symbol id="i-rotate" viewBox="0 0 24 24"><path d="M3 2v6h6" /><path d="M3 13a9 9 0 1 0 3-7.7L3 8" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></symbol>
        <symbol id="i-send" viewBox="0 0 24 24"><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></symbol>
        <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></symbol>
        <symbol id="i-thumb" viewBox="0 0 24 24"><path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" /></symbol>
        <symbol id="i-trash" viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></symbol>
        <symbol id="i-user" viewBox="0 0 24 24"> <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /> <circle cx="12" cy="7" r="4" /> </symbol>
        <symbol id="i-userplus" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6" /><path d="M22 11h-6" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></symbol>
        {/* Added 2026-08-22 with the handheld Video estimator. The nav map's
            "Video estimator" item already asks for `i-video`, so the drawer was
            drawing a blank box for it; the desktop sprite
            (proposals-blueprint/sprite.tsx) gained the same symbol when that
            page shipped. Donor path data verbatim. */}
        <symbol id="i-video" viewBox="0 0 24 24"><rect x="2" y="6" width="13" height="12" rx="1.5" /><path d="M15 10.5 21 7v10l-6-3.5" /></symbol>
        {/* Added 2026-09-18 with the desktop sprite: the HVAC estimator's outdoor unit. */}
        <symbol id="i-heatpump" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12V8.5" /><path d="m12 12 3 1.8" /><path d="m12 12-3 1.8" /></symbol>
        <symbol id="i-deck" viewBox="0 0 24 24"><path d="M2 10h20" /><path d="M2 13h20" /><path d="M4 13v8" /><path d="M20 13v8" /><path d="M12 13v8" /><path d="M5 10V5h14v5" /></symbol>
        <symbol id="i-sofa" viewBox="0 0 24 24"><path d="M5 10V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" /><path d="M3 11a2 2 0 0 1 2 2v2h14v-2a2 2 0 1 1 4 0v4a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Z" /><path d="M5 18v2" /><path d="M19 18v2" /></symbol>
        <symbol id="i-leaf" viewBox="0 0 24 24"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" /></symbol>
        {/* Added 2026-09-20 with the desktop sprite: the views plate. */}
        <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></symbol>
        <symbol id="i-x" viewBox="0 0 24 24"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></symbol>
      </defs>
    </svg>
  );
}
