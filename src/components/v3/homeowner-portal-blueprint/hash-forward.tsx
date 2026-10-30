"use client";

// The contractor's "please add photos" email links /home/<key>#folder-<token>
// (lib/home/files) — the old one-page dashboard's anchor. The project now has
// its own page, so that anchor forwards to the project's Photos & files.
// Without JavaScript the hash still lands on the project's card (its id).

import { useEffect } from "react";

export function HashForward({ projectBase }: { projectBase: string }) {
  useEffect(() => {
    const m = /^#folder-(.+)$/.exec(window.location.hash);
    if (m) window.location.replace(`${projectBase}/${m[1]}#files`);
  }, [projectBase]);
  return null;
}
