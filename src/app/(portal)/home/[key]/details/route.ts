// /home/[key]/details — a page of its own from 2026-10-30 to 2026-10-31; now the
// #details section of the one-page portal. A permanent redirect, so the links
// people already have (emails, bookmarks) still land on it.
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return new Response(null, { status: 301, headers: { Location: `/home/${encodeURIComponent(key)}#details` } });
}
