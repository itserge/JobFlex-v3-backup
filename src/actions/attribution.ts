"use server";
import { z } from "zod";
import { validateAttribution } from "@/lib/attribution";

// Public, unauthenticated: powers the "Referred by …" pill on /auth/register.
// One generic failure shape for every miss (unknown / inactive / suspended) so
// the endpoint can't be used to probe code state. Codes are semi-public
// marketing artifacts; a valid lookup only exposes a display name.

const schema = z.object({
  kind: z.enum(["promo", "ref"]),
  code: z.string().trim().min(3).max(40),
});

export type AttributionCheck =
  | { ok: false }
  | { ok: true; kind: "promo" | "ref"; code: string; displayName: string; percentOff: number | null; discountMonths: number | null };

export async function validateAttributionCode(raw: unknown): Promise<AttributionCheck> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false };
  try {
    const valid = await validateAttribution(parsed.data.kind, parsed.data.code);
    if (!valid) return { ok: false };
    return {
      ok: true,
      kind: valid.kind,
      code: valid.code,
      displayName: valid.displayName,
      percentOff: valid.kind === "promo" ? valid.percentOff : null,
      // How many paid months the percent lasts (lib/promoDiscount); a referral is one.
      discountMonths: valid.kind === "promo" ? valid.discountMonths : null,
    };
  } catch {
    return { ok: false };
  }
}
