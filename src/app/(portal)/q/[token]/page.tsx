// THE CONTRACTOR'S PAGE — /q/<token> (2026-11-07, part 2 of the plan "Projects: Remodel and New construction"). A
// quote the company asked a contractor for: the company's name, the project, the scope, the reply-by day, a price
// box and a note — no sign-in; the token is the only key. Once awarded, the same page asks for the invoice. The
// look is the buyer's plain stylesheet (../../buy/[token]/buy.css, root `.jf-buy`): the same kind of page for the
// same kind of visitor, someone outside the company with one thing to do.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { quoteView } from "@/lib/projectSubs/server";
import { QuoteForm } from "./quote-form";
import "../../buy/[token]/buy.css";
import "./quote.css";
import { publicLinkPaused } from "@/lib/publicLinks";
import { LinkPaused } from "@/components/v3/upgrade-gate/link-paused";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quote request — JobFlex",
  description: "A quote a company asked you for.",
  robots: { index: false, follow: false },
};

export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  // Paused while the company that sent it is on the Free plan (owner, 2026-11-09; lib/publicLinks).
  if (await publicLinkPaused("sub-quote", token)) return <LinkPaused />;
  const view = await quoteView(token);
  if (!view) notFound();
  return (
    <main className="jf-buy">
      <QuoteForm token={token} view={view} />
    </main>
  );
}
