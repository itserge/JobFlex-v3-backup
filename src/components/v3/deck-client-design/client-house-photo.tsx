"use client";
// THE CLIENT BUILDS THEIR HOUSE FROM A PHOTO (2026-10-23) — Stage 4 of "build the house from a photo of the back
// wall". Owner: "so the client will just give the back wall picture … and it just takes the shapes and move it into our
// 3D shaper". The studio's own card and review (deck-variant-1/deck-v1-house-photo), the same read and the same
// lining-up with the picture's edges, through the link's doors (actions/deckClientDesign: the token the key, each with
// its own brake): the picture kept in the shop's folder under this link's own, so it goes back with the design and the
// contractor opens it in the studio. Nothing about prices here.

import * as React from "react";
import type { DeckDesign } from "@/lib/deck/design";
import type { DeckPatch } from "@/lib/deck/checks";
import { clientHousePhotoHref, readClientHouseCorner, readClientHouseDepth, readClientHousePhoto, uploadClientHousePhoto } from "@/actions/deckClientDesign";
import { HousePhotoCard, HousePhotoReview, useHousePhoto, type HousePhotoApi } from "@/components/v3/deck-variant-1/deck-v1-house-photo";
import "@/components/v3/deck-variant-1/deck-variant-1.css";

export function ClientHousePhoto({ token, design, patch, onBuilt }: { token: string; design: DeckDesign; patch: (p: DeckPatch) => void; onBuilt?: () => void }) {
  const api = React.useMemo<HousePhotoApi>(
    () => ({
      read: (form) => readClientHousePhoto(token, form),
      depth: (form) => readClientHouseDepth(token, form),
      corner: (form) => readClientHouseCorner(token, form),
      upload: (form) => uploadClientHousePhoto(token, form),
      href: (url) => clientHousePhotoHref(token, url),
    }),
    [token],
  );
  const hp = useHousePhoto({ design, patch, api, audience: "client", onBuilt });
  return (
    <div className="jf-deck-v1 v1-hp-client" data-nest data-client-house-photo>
      <HousePhotoCard hp={hp} design={design} />
      <HousePhotoReview hp={hp} design={design} />
    </div>
  );
}
