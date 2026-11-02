import type { Metadata } from "next";
import { requestView } from "@/lib/smartbook/engine";
import { AnswerRequest } from "./answer-request";
import "../../../book/book-public.css";

// SMARTBOOK · THE COMPANY'S ANSWER PAGE (2026-10-31) — /b/r/<token>, the button in the request email: a new lead
// asked for a time of their own; Yes books it, No offers them other open times, or another day and time goes back
// to them to say yes to. The same answer a reply to SmartBook's text gives. Nothing is done on opening the link.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Answer the request", description: "A customer asked for a time.", robots: { index: false } };

export default async function AnswerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await requestView(token);
  return (
    <main className="jf-book">
      <div className="jfb-sheet">
        <header className="jfb-head">
          <div className="jfb-kicker">{view ? `${view.company} · SmartBook` : "SmartBook"}</div>
          <h1 className="jfb-title jfb-title--sm">{view ? `${view.name} asks for ${view.asked}` : "This link is not active"}</h1>
        </header>
        <div className="jfb-body">{view ? <AnswerRequest token={token} view={view} /> : <p className="jfb-state">Open the lead in JobFlex to see where it stands.</p>}</div>
      </div>
    </main>
  );
}
