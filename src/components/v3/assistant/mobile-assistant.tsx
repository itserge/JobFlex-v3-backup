"use client";
// THE ASSISTANT · THE HANDHELD PAGE (2026-11-04) — /mobile-assistant-v1, where the
// phone drawers' Assistant row goes. The shared handheld chrome (MobileNav), a
// short head, and the same conversation as the desk panel, filling the screen
// with its box on the foot above the home indicator. The conversation is read
// from the database when the page opens, so it is the one on the desk too.

import { useEffect } from "react";
import { AudioLines } from "lucide-react";
import { MobileNav } from "@/components/v3/mobile-shell/mobile-nav";
import { Conversation } from "./conversation";
import { useAssistant } from "./use-assistant";
import "./mobile-assistant.css";

export function MobileAssistant() {
  const state = useAssistant();
  const { load } = state;
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="jf-mobile-assistant">
      <MobileNav />
      <main className="mas-main">
        <header className="mas-head">
          <span className="mas-mark" aria-hidden="true">
            <AudioLines />
          </span>
          <div className="mas-headText">
            <h1 className="mas-title">Assistant</h1>
            <p className="mas-sub">Ask, or tell JobFlex what to do.</p>
          </div>
          <span className="mas-tag" aria-hidden="true">
            NEW
          </span>
        </header>
        <div className="mas-body">
          <Conversation state={state} variant="page" />
        </div>
      </main>
    </div>
  );
}
