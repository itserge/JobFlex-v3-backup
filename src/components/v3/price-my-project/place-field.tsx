"use client";
// "WHERE'S THE ROOF?" — one Places field (the roof estimator's own, components/estimator/roof/PlacesAutocomplete), US
// only, then the house on a map with the pin and "Yes, that's it". The pin's point is what the roof is read at. With
// no Maps browser key (a stand) the field is plain and a prefilled point (?lat=&lng=) stands in.
import * as React from "react";
import { PlacesAutocomplete, type PickedAddress } from "@/components/estimator/roof/PlacesAutocomplete";
import { AddressPinPreview } from "@/components/v3/roof-estimator-blueprint/address-pin-preview";
import { isMapsBrowserEnabled } from "@/lib/googleMaps";
import s from "./price.module.css";

export type Site = { address: string; city: string; state: string; zip: string; lat: number; lng: number };

export function siteFromPick(p: PickedAddress): Site | null {
  if (typeof p.lat !== "number" || typeof p.lng !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null;
  return { address: p.address, city: p.city, state: p.state, zip: p.zip, lat: p.lat, lng: p.lng };
}

export function PlaceField({ initial, onConfirm }: { initial: Site | null; onConfirm: (site: Site) => void }) {
  const [site, setSite] = React.useState<Site | null>(initial);
  const [moved, setMoved] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const maps = isMapsBrowserEnabled();
  return (
    <div className={s.panel} data-price-step="address">
      <div className={s.field}>
        <label className={s.label} htmlFor="price-addr">Where’s the roof?</label>
        <PlacesAutocomplete
          enableFind
          placeholder="Street address"
          inputWrapperClassName={s.placeBox}
          onPick={(p) => {
            const next = siteFromPick(p);
            if (!next) {
              setNote("Pick your address from the list so we can find the roof.");
              return;
            }
            setNote(null);
            setMoved(false);
            setSite(next);
          }}
        />
        {!maps && !site ? <p className={s.small}>Pick your address from the list, then say yes to the house on the map.</p> : null}
        {note ? <p className={s.err}>{note}</p> : null}
      </div>
      {site ? (
        <div style={{ display: "grid", gap: 12 }} data-price-pin>
          <AddressPinPreview
            lat={site.lat}
            lng={site.lng}
            label={`${site.address}, ${site.city}`}
            moved={moved}
            onMove={(p) => {
              setSite({ ...site, lat: p.lat, lng: p.lng });
              setMoved(true);
            }}
          />
          <p className={s.muted}>
            {site.address}, {site.city}, {site.state} {site.zip}
            {moved ? " · pin moved onto the house" : ""}
          </p>
          <div className={s.acts}>
            <button type="button" className={s.btn} onClick={() => onConfirm(site)} data-price-confirm>
              Yes, that’s it
            </button>
            <span className={s.small}>Wrong house? Drag the pin onto yours.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
