// THE SUB'S SUBCONTRACT — /s/<token> (2026-11-08, the subcontractors plan, part 4). The agreement a company sent a
// sub to sign: the parties, the scope, the price, the schedule, the payment schedule, the terms and the files, in
// full; then a typed name and the consent box (the time, the address and the browser are kept). Once signed, the
// same page shows both signatures, the signed PDF to download, and later the change orders to agree to or decline.
// No sign-in: the token is the only key; a deleted company or an unknown token is a 404, a withdrawn contract says
// so. The look is the buyer's plain stylesheet (../../buy/[token]/buy.css, root `.jf-buy`) and the quote page's
// (../../q/[token]/quote.css), with ./contract.css for the agreement's own parts.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contractView } from "@/lib/subContracts/server";
import { ContractSign } from "./contract-sign";
import "../../buy/[token]/buy.css";
import "../../q/[token]/quote.css";
import "./contract.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Subcontract — JobFlex",
  description: "A subcontract a company sent you to sign.",
  robots: { index: false, follow: false },
};

export default async function ContractPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(token)) notFound();
  const view = await contractView(token);
  if (!view) notFound();
  return (
    <main className="jf-buy">
      <ContractSign token={token} view={view} />
    </main>
  );
}
