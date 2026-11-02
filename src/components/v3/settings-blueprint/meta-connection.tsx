"use client";

import Link from "next/link";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, Facebook, Link2, Pause, ShieldCheck } from "lucide-react";
import { chooseMetaPage, disconnectMeta, importMetaLeads, setMetaLeadsAuto } from "@/actions/metaLeads";
import type { MetaData } from "./settings-data";
import styles from "./meta-connection.module.css";

const notices: Record<string, string> = {
  denied: "Meta authorization was canceled. You can connect again when ready.",
  invalid_state: "The connection request expired or your workspace changed. Please connect again.",
  no_pages: "No Pages returned. Connect using a Facebook Page ID.",
  page_unavailable: "Meta could not verify this Page. Check the Page ID and use the Facebook account with access to its lead forms.",
  failed: "Meta could not authorize this connection. Check that the app role invitation is accepted, all required permissions are granted, and the configuration uses a User access token. Then try again.",
  choose_page: "Authorization received. Choose the Page whose leads belong in this workspace.",
};

function MetaPagePicker({ id, pages, value, disabled, onChange }: { id: string; pages: MetaData["pages"]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = pages.findIndex(page => page.id === value);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => { if (open) root.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" }); }, [open, active]);
  function expand() { setActive(Math.max(0, selected)); setOpen(true); }
  function choose(index: number) { if (pages[index]) onChange(pages[index].id); setOpen(false); }
  return <div className={styles.pagePicker} ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button id={id} type="button" role="combobox" aria-label="Facebook Page" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? listId + "-" + active : undefined} disabled={disabled} className={styles.pagePickerButton}
      onClick={() => open ? setOpen(false) : expand()}
      onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) expand(); else setActive(index => (index + (event.key === "ArrowDown" ? 1 : -1) + pages.length) % pages.length); }
        else if (event.key === "Home" || event.key === "End") { event.preventDefault(); setOpen(true); setActive(event.key === "Home" ? 0 : pages.length - 1); }
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (open) choose(active); else expand(); }
        else if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        else if (event.key === "Tab") setOpen(false);
      }}><span>{pages[selected]?.name || "Choose a Page"}</span><ChevronDown size={18} aria-hidden="true" /></button>
    {open && <div id={listId} role="listbox" aria-label="Facebook Pages" className={styles.pageOptions}>
      {pages.map((page, index) => <div key={page.id} id={listId + "-" + index} role="option" aria-selected={page.id === value} data-active={active === index} className={styles.pageOption}
        onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(index)}><span>{page.name}</span>{page.id === value && <Check size={17} aria-hidden="true" />}</div>)}
    </div>}
  </div>;
}

export function MetaConnection({ data, mobile = false }: { data: MetaData; mobile?: boolean }) {
  const router = useRouter();
  const query = useSearchParams();
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; done: boolean } | null>(null);
  const running = useRef(false);
  const [auto, setAuto] = useState(data.autoImport);
  const [autoBusy, setAutoBusy] = useState(false);
  // A refresh after another change (reconnect, disconnect) brings the stored value back.
  const [seenAuto, setSeenAuto] = useState(data.autoImport);
  if (data.autoImport !== seenAuto) { setSeenAuto(data.autoImport); setAuto(data.autoImport); }
  useEffect(() => () => { running.current = false; }, []);
  const primary = `${styles.button} ${styles.primary}`;
  const secondary = styles.button;
  const hasPages = data.pages.length > 0;
  const pageChoice = selected || (data.pages.length === 1 ? data.pages[0].id : "");
  const manualNotice = !data.connected && !message && query.get("meta") === "no_pages";
  const status = data.connected ? "Connected" : data.comingSoon ? "Coming soon" : hasPages ? "Choose a Page" : "Not connected";
  const feedback = message || (!data.connected ? notices[query.get("meta") || ""] : "");
  // Said where the click happened (owner, 2026-10-28: "when I click on it nothing happens" — a failed connect only
  // showed a grey line at the bottom of the card): right under the button, red when it failed.
  const feedbackLine = feedback && !manualNotice ? <p role={error ? "alert" : "status"} aria-live="polite" className={error ? styles.error : styles.notice}>{feedback}</p> : null;

  async function choose() {
    if (!pageChoice || busy) return;
    setBusy(true); setError(false);
    try {
      const result = await chooseMetaPage(pageChoice);
      if (!result.ok) { setError(true); setMessage(result.error); }
      else { setMessage("Page connected. Click Import leads when you are ready."); router.refresh(); }
    } catch { setError(true); setMessage("Connection interrupted. Please try again."); }
    finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(false);
    try {
      const result = await disconnectMeta();
      if (!result.ok) { setError(true); setMessage(result.error); }
      else { setMessage("Disconnected. Existing imported leads remain in your workspace."); router.refresh(); }
    } catch { setError(true); setMessage("Could not disconnect. Please try again."); }
    finally { setBusy(false); }
  }
  async function toggleAuto() {
    if (autoBusy) return;
    const next = !auto;
    setAuto(next); setAutoBusy(true); setError(false); setMessage("");
    try {
      const result = await setMetaLeadsAuto(next);
      if (!result.ok) { setAuto(!next); setError(true); setMessage(result.error); }
      else { setMessage(next ? "On. New Facebook leads show up in Leads within about 5 minutes." : "Off. New Facebook leads wait for Import leads."); router.refresh(); }
    } catch { setAuto(!next); setError(true); setMessage("Could not save. Please try again."); }
    finally { setAutoBusy(false); }
  }
  async function startImport(resume: boolean) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setImporting(true); setPaused(false); setError(false);
    setImportResult(null);
    setMessage("Checking the Page's lead forms…");
    let done = false;
    try {
      let restart = !resume;
      while (running.current) {
        const result = await importMetaLeads(restart);
        restart = false;
        if (!result.ok) { setError(true); setMessage(result.error); break; }
        setImportResult({ imported: result.imported, skipped: result.skipped, done: result.done });
        setMessage("");
        if (result.done) { done = true; break; }
      }
    } catch { setError(true); setMessage("Import interrupted. Resume to continue without duplicates."); }
    finally {
      running.current = false;
      setBusy(false); setImporting(false); setPaused(!done);
      router.refresh();
    }
  }

  return (
    <section className={`${styles.root} ${mobile ? styles.mobile : ""}`} aria-label="Meta Business connection" data-tour="leads:meta">
      <header className={styles.header}>
        <div className={styles.brand}><Facebook size={22} aria-hidden="true" /><h2>Meta Business</h2></div>
        <span className={`${styles.status} ${data.connected ? styles.connected : ""}`}>
          {data.connected && <Check size={14} aria-hidden="true" />}{status}
        </span>
      </header>
      <div className={styles.body}>
        {data.connected ? <>
          <div className={styles.page}>
            <div><p className={styles.label}>Connected Facebook Page</p><h3>{data.pageName || "Facebook Page"}</h3></div>
            <div className={styles.activity}><span className={styles.label}>Last import activity</span>{data.lastImportAt ? <time dateTime={data.lastImportAt}>{new Date(data.lastImportAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time> : <span>No imports yet</span>}</div>
          </div>
          <div className={styles.task}>
            <div className={styles.taskCopy}>
              <h4>Lead forms</h4>
              <p>Import submissions into Leads. Duplicates are skipped.</p>
            </div>
            <div className={styles.actions}>
              <button type="button" className={primary} disabled={busy || !data.canManage || data.comingSoon} onClick={() => void startImport(false)}><ArrowDownToLine size={18} aria-hidden="true" />{importing ? "Importing…" : "Import leads"}</button>
              {(data.canResume || paused) && !importing && <button type="button" className={secondary} disabled={busy || !data.canManage || data.comingSoon} onClick={() => void startImport(true)}>Resume import</button>}
              {importing && <button type="button" className={secondary} onClick={() => { running.current = false; setMessage("Pausing after the current batch…"); }}><Pause size={16} aria-hidden="true" />Pause import</button>}
            </div>
          </div>
          <div className={styles.task}>
            <div className={styles.taskCopy}>
              <h4 id={mobile ? "meta-auto-mobile" : "meta-auto-desktop"}>New leads come in by themselves</h4>
              <p>Every new Facebook lead lands in Leads within about 5 minutes, marked Facebook.</p>
            </div>
            <button type="button" role="switch" aria-checked={auto} aria-labelledby={mobile ? "meta-auto-mobile" : "meta-auto-desktop"} className={styles.switch}
              disabled={autoBusy || !data.canManage || data.comingSoon} onClick={() => void toggleAuto()}>
              <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchKnob} /></span>
              <span className={styles.switchWord}>{auto ? "On" : "Off"}</span>
            </button>
          </div>
          {importResult && <div className={styles.importResult} role="status" aria-live="polite">
            <div className={styles.importCounts}><span className={styles.imported}><strong>{importResult.imported}</strong> imported</span><span className={styles.skipped}><strong>{importResult.skipped}</strong> already imported</span></div>
            <span className={importResult.done ? styles.finished : styles.importProgress}>{importResult.done ? <><Check size={16} aria-hidden="true" />Finished</> : importing ? "Importing…" : "Paused"}</span>
          </div>}
          {!importing && (importResult || data.lastImportAt) && <div className={styles.actions}><Link className={secondary} href="/dashboard/leads?imported=meta">View imported leads<ArrowUpRight size={16} aria-hidden="true" /></Link></div>}
        </> : <>
          <div className={styles.intro}>
            <h3>{hasPages ? "Choose a Page" : "Connect your leads"}</h3>
            <p>{hasPages ? "Pick the Facebook Page whose lead forms should come into Leads in this workspace." : "Bring Facebook and Instagram form submissions into Leads."}</p>
          </div>
          {hasPages ? <div className={styles.choice}>
            <div className={styles.field}>
              <label htmlFor={mobile ? "meta-page-mobile" : "meta-page-desktop"}>Facebook Page</label>
              <MetaPagePicker id={mobile ? "meta-page-mobile" : "meta-page-desktop"} pages={data.pages} value={pageChoice} disabled={busy || !data.canManage} onChange={setSelected} />
            </div>
            <button type="button" className={primary} disabled={!pageChoice || busy || !data.canManage || data.comingSoon} onClick={() => void choose()}><Link2 size={18} aria-hidden="true" />{busy ? "Connecting…" : "Connect leads"}</button>
          </div> : <div className={styles.connectAction}>
            <button type="button" className={primary} disabled={busy || data.comingSoon || !data.canManage} onClick={() => { window.location.assign("/api/integrations/meta/connect"); }}><Link2 size={18} aria-hidden="true" />{data.comingSoon ? "Coming soon" : "Connect Meta Business"}</button>
            <p>Sign in to Facebook, then choose your Page.</p>
          </div>}
          {feedbackLine}
          {hasPages && <div className={styles.actions}>
            <button type="button" className={styles.textButton} disabled={busy || data.comingSoon || !data.canManage} onClick={() => { window.location.assign("/api/integrations/meta/connect"); }}>Use another Facebook account<ArrowUpRight size={16} aria-hidden="true" /></button>
            <button type="button" className={styles.textButton} disabled={busy || !data.canManage} onClick={() => void disconnect()}>Cancel connection</button>
          </div>}
          {!data.comingSoon && data.canManage && <details className={`${styles.details} ${styles.manual}`} open={query.get("meta") === "no_pages" || query.get("meta") === "page_unavailable" ? true : undefined}>
            <summary>Connect with a Page ID<ChevronDown size={16} className={styles.chevron} aria-hidden="true" /></summary>
            {manualNotice && <p role="status" className={styles.manualNotice}>{notices.no_pages}</p>}
            <form className={styles.manualForm} action="/api/integrations/meta/connect" method="get">
              <div className={styles.field}>
                <label htmlFor={mobile ? "meta-page-id-mobile" : "meta-page-id-desktop"}>Facebook Page ID</label>
                <input id={mobile ? "meta-page-id-mobile" : "meta-page-id-desktop"} name="pageId" type="text" inputMode="numeric" pattern="[0-9]{1,40}" maxLength={40} required disabled={busy} autoComplete="off" aria-describedby={mobile ? "meta-page-id-help-mobile" : "meta-page-id-help-desktop"} />
              </div>
              <button type="submit" className={secondary} disabled={busy}>Find Page<ArrowUpRight size={16} aria-hidden="true" /></button>
              <p id={mobile ? "meta-page-id-help-mobile" : "meta-page-id-help-desktop"} className={styles.fieldHelp}>Find your Page ID in Meta Business Settings → Accounts → Pages.</p>
            </form>
          </details>}
        </>}
        {!data.canManage && <p className={styles.notice}>Only workspace owners and managers can manage this connection.</p>}
        {data.connected && feedbackLine}
      </div>
      <footer className={styles.footer}>
        <details className={styles.details}>
          <summary><ShieldCheck size={17} aria-hidden="true" />Access & privacy<ChevronDown size={16} className={styles.chevron} aria-hidden="true" /></summary>
          <div className={styles.disclosure}>
            <p>JobFlex stores an encrypted Page token. Imported contact details and form answers are visible to authorized workspace members. No ads are created or messages sent.</p>
            <a href="/privacy#meta-leads" target="_blank" rel="noopener noreferrer">Privacy policy<ArrowUpRight size={14} aria-hidden="true" /></a>
            {data.connected && <p>Disconnect removes the stored token; imported leads stay in JobFlex. To also revoke Meta access, open <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener noreferrer">Facebook Business Integrations</a>.</p>}
          </div>
        </details>
        {data.connected && <button type="button" className={`${styles.textButton} ${styles.disconnect}`} disabled={busy || !data.canManage} onClick={() => void disconnect()}>Disconnect</button>}
      </footer>
    </section>
  );
}
