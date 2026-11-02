import type { Metadata } from "next";
import { pickView } from "@/lib/smartbook/engine";
import { PickVisit } from "./pick-visit";
import "../../book/book-public.css";

// SMARTBOOK · THE CUSTOMER'S PAGE (2026-10-31) — /b/<token>, the link in SmartBook's first text and every email: the
// times on offer, every open time, "none of these — here's mine", the company's other time to say yes to, the visit
// once booked, and "Text me about this visit". The booking page's sheet (book-public.css, root `.jf-book`), its
// calendar and its time buttons. `?t=<ms>` opens on one time (an email's row): one tap books it.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pick a time", description: "Choose a time for your visit.", robots: { index: false } };

export default async function PickPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ t?: string }> }) {
  const [{ token }, { t }] = await Promise.all([params, searchParams]);
  const view = await pickView(token);
  const at = t && /^\d{10,14}$/.test(t) ? new Date(Number(t)).toISOString() : null;
  return (
    <main className="jf-book">
      <div className="jfb-sheet">
        <header className="jfb-head">
          <div className="jfb-kicker">{view ? view.company : "Your visit"}</div>
          <h1 className="jfb-title jfb-title--sm">{!view ? "This link is not active" : view.status === "booked" ? "You're booked" : view.status === "asked" ? "We're checking" : view.status === "countered" ? "Does this work?" : view.status === "closed" ? "This link is closed" : "Pick a time"}</h1>
          {view && <p className="jfb-for">{view.first ? `Hi ${view.first} — for` : "For"} your {/^free\b/i.test(view.price) ? "free " : ""}{view.visit.toLowerCase()}</p>}
          {view?.phone && (
            <div className="jfb-contact">
              <a className="jfb-contact-a" href={`tel:${view.phone.replace(/[^\d+]/g, "")}`}>
                <svg className="jfb-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" /></svg>
                <span>Rather call? {view.phone}</span>
              </a>
            </div>
          )}
        </header>
        <div className="jfb-body">{view ? <PickVisit token={token} initial={view} preselect={at} /> : <p className="jfb-state">Please contact the company for a fresh link.</p>}</div>
      </div>
    </main>
  );
}
