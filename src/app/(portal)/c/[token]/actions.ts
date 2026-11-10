"use server";
// The client's page (/c/<token>, Smart CRM part 5): the one public write — a message to the company. No account: the
// token is the key, the words are capped and the hour is rate-limited (lib/clientHome/server postHomeMessage).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { postHomeMessage, type PostResult } from "@/lib/clientHome/server";

export async function postClientHomeMessage(token: string, body: string): Promise<PostResult> {
  const t = z.string().max(80).safeParse(token);
  const b = z.string().max(4000).safeParse(body);
  if (!t.success || !b.success) return { ok: false, error: "That message couldn't be sent." };
  const r = await postHomeMessage(t.data, b.data);
  if (r.ok) revalidatePath(`/c/${t.data}`);
  return r;
}
