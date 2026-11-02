// Route patterns of the app, read from every page.tsx under src/app.
// Route groups "(x)" are removed, "[id]" segments are kept.
import { readdirSync } from "node:fs";
import { join } from "node:path";

export function appRoutes(root = "src/app"): string[] {
  const out = new Set<string>();
  const walk = (dir: string, segs: string[]) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        const group = /^\(.*\)$/.test(e.name);
        walk(join(dir, e.name), group ? segs : [...segs, e.name]);
      } else if (e.name === "page.tsx") {
        out.add("/" + segs.join("/"));
      }
    }
  };
  walk(root, []);
  return [...out].sort();
}

/** `[seg]` in a route matches any one segment of the path. */
export function isRealRoute(path: string, routes: string[]): boolean {
  const want = path.split("/").filter(Boolean);
  return routes.some((r) => {
    const have = r.split("/").filter(Boolean);
    return have.length === want.length && have.every((s, i) => /^\[.+\]$/.test(s) || s === want[i]);
  });
}
