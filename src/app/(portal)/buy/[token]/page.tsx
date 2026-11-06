// THE BUYER'S PAGE — /buy/<token> (the buying build, 2026-11-05). The list someone was asked to buy for a project:
// the crew, the office, a helper — anyone with the link, no sign-in. They tick what they bought and type what they
// paid; the office sees it on the project's Deliveries card and marks what arrived. The token is the only key,
// and the page shows nothing but this one order: the company's name, the project's name, the lines.
// The look is the plain stylesheet ./buy.css (root `.jf-buy`), the sibling of /review/[token].
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buyerView } from "@/lib/projectBuying/server";
import { BuyForm } from "./buy-form";
import "./buy.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Things to buy — JobFlex",
  description: "The materials you were asked to buy for a project.",
  robots: { index: false, follow: false },
};

export default async function BuyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  const view = await buyerView(token);
  if (!view) notFound();
  return (
    <main className="jf-buy">
      <BuyForm token={token} view={view} />
    </main>
  );
}
