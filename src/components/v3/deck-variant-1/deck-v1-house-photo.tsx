"use client";
// THE HOUSE BUILT FROM ITS PHOTO, in Variant 1's House step (2026-10-23). Owner: "when I upload the picture of my back
// wall … get from that picture approximate shape already, and even windows and where the doors is, and if there is any
// jogs … apply it to the 3D shaper … the client will just give the back wall picture … and we just upload it" — "and
// contractor can upload the picture as well". Only the house — "read just a shape of that back wall and don't show
// existing deck or porch roofs, just shape and windows".
//
// Three ways in — a photo from the computer or the phone, the phone's camera, a photo a client already put in their job
// folder — one way through: the picture shrunk, its black bands cut, read by the vision model (actions readHousePhoto)
// in two looks — the whole picture to find the wall (and to say it IS a house: anything else is refused on the card,
// 2026-10-26), then the wall cut out and enlarged so each window reads at its size, each in the picture's own pixels
// (a GPT-6 model held to a schema; the grid of tenths once drawn here is gone) — straightened when it was taken at an
// angle, its depth map read for which way each part of the wall stands (actions readHouseDepth), its wall's colour and
// its roof's measured off its own pixels, saved; then "Here's what I see": the
// picture with every line the read found, each one draggable, and the house that would be built, in words; "Build my
// house" lays it over the design (lib/deck/houseFromPhoto). The photo stays beside the wall drawing to look back at —
// never pasted on the wall in the 3D (owner, 2026-10-11).

import * as React from "react";
import { createPortal } from "react-dom";
import { Camera, ImagePlus, RotateCcw, Users, X } from "lucide-react";
import type { DeckDesign } from "@/lib/deck/design";
import type { DeckPatch } from "@/lib/deck/checks";
import { isHouseHex, type HousePhoto } from "@/lib/deck/house";
import {
  addReadDoor,
  addReadJog,
  addReadWindow,
  blankHouseRead,
  mapHouseRead,
  mergeLooks,
  moveHouseMark,
  editReadOpening,
  rectifyHouseRead,
  readFromCrop,
  mainSection,
  readSections,
  setSectionOut,
  removeReadDoor,
  removeReadJog,
  removeReadWindow,
  wallCrop,
  type HouseMark,
  type HouseRead,
} from "@/lib/deck/houseRead";
import { colourZones, dominantColour, ftIn, houseFromPhoto, type PhotoHouse } from "@/lib/deck/houseFromPhoto";
import { snapRead, type Gray } from "@/lib/deck/photoSnap";
import { SQUARE_ON_PCT, levelRead, photoObliqueness, wallStepsReport, type WallStepsReport, type WallStepsWhy } from "@/lib/deck/wallSteps";
import { type WallJog, AUTO_STRAIGHTEN_PCT, applyHomography, obliqueness, transformRead } from "@/lib/deck/photoFit";
import { applyDepthVerdicts, type DepthRelief } from "@/lib/deck/houseDepthApply";
import { deckClientPhotoData, deckClientPhotos, deckPhotoHref, readHouseDepth, readHousePhoto, uploadDeckPhoto, type ClientPhoto, type DeckPhotoResult, type HouseDepthResult, type HousePhotoRead } from "@/actions/deckEstimator";
import { cropPhoto, shrinkPhoto, straightenPhoto, trimLetterbox } from "@/components/v3/deck-estimator-blueprint/deck-photo";
import { NumberInput, Toggle, cx, feetText, parseFeet } from "./deck-v1-parts";

export interface HouseReview {
  url: string;
  href: string;
  w: number;
  h: number;
  read: HouseRead;
  measured: { siding: string | null; roof: string | null };
  wallWidthFt: number | null;
  useHeight: boolean;
  veneer: boolean;
  /** How far off square the shot was, percent, when it was straightened. */
  straightened: number | null;
  /** The picture could not be read: the lines are a start to drag onto the wall. */
  byHand: string | null;
  /** How it was read: the looks taken, the model, the lines the picture's own edges moved. */
  how?: { looks: number; model: string; snapped: number; split: number; /** The wall's steps measured off the photo's own pixels (lib/deck/wallSteps) — 0 when the photo didn't show them and the model's read stands. */ stepsFromPhoto?: number; /** Windows read off the picture itself (lib/deck/photoSnap findWindows), 0 when the model's boxes were lined up instead (2026-10-25). */ windowsFromPhoto?: number; /** Why the photo's pixels said nothing about the steps, and how many corners they found anyway (2026-10-24). */ stepsWhy?: WallStepsWhy; cornersFromPhoto?: number; /** The steps were read on the clean picture, before it was straightened (the warp, made from the model's leaning lines, loses the corners). */ stepsBeforeWarp?: boolean; /** The model's lines leaned this much, percent — enough to straighten — but the photo's own rows of windows ran parallel: kept square (2026-10-24). */ squareOn?: number; /** What the depth map did (2026-10-26): how many parts of the wall it set out or back, how many of those it turned round, how many raised or sunk parts it saw. */ depth?: { sections: number; flipped: number; relief: number } } | null;
  /** The wall's relief the depth map found — a bay, a chimney, a recessed entry — as boxes in the picture's fractions, for the 3D's raised and sunk parts. */
  relief?: DepthRelief[];
}

/**
 * The server's half, by who is asking (2026-10-23): the studio's actions behind its gate, or the client's design link's
 * (actions/deckClientDesign, the token the key) — the same read, the picture kept under the link's own folder. Only the
 * studio has the photos clients put in their job folders.
 */
export interface HousePhotoApi {
  read: (form: FormData) => Promise<HousePhotoRead>;
  /** The depth map of the picture (2026-10-26): which way each part of the wall stands, and its relief. Absent = no depth pass. */
  depth?: (form: FormData) => Promise<HouseDepthResult>;
  upload: (form: FormData) => Promise<DeckPhotoResult>;
  href: (url: string) => Promise<string | null>;
  clientPhotos?: typeof deckClientPhotos;
  clientPhotoData?: typeof deckClientPhotoData;
}

const STUDIO_API: HousePhotoApi = { read: readHousePhoto, depth: readHouseDepth, upload: uploadDeckPhoto, href: deckPhotoHref, clientPhotos: deckClientPhotos, clientPhotoData: deckClientPhotoData };

export interface HousePhotoState {
  /** Who it is for: the card's words (the client's page has no clients' photos). */
  audience: "studio" | "client";
  busy: string | null;
  error: string | null;
  review: HouseReview | null;
  setReview: React.Dispatch<React.SetStateAction<HouseReview | null>>;
  built: PhotoHouse | null;
  thumb: string | null;
  /** The two hidden file inputs, as callback refs (the elements are kept in state): a picture, and the phone's camera. */
  setFileInput: (el: HTMLInputElement | null) => void;
  setCamInput: (el: HTMLInputElement | null) => void;
  pickFile: () => void;
  pickCamera: () => void;
  onFile: (file: File | null) => void;
  clientPhotos: ClientPhoto[] | null;
  openClientPhotos: () => Promise<void>;
  closeClientPhotos: () => void;
  pickClientPhoto: (id: string) => Promise<void>;
  build: () => void;
  lookAgain: () => Promise<void>;
  removePhoto: () => void;
}

function loadImg(file: Blob): Promise<{ img: HTMLImageElement; release: () => void }> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve({ img: el, release: () => URL.revokeObjectURL(url) });
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That picture could not be opened — use a JPEG or PNG."));
    };
    el.src = url;
  });
}

/** The wall's colour and the roof's, off the picture's own pixels (lib/deck/houseFromPhoto colourZones + dominantColour). */
async function measureColours(file: Blob, read: HouseRead): Promise<{ siding: string | null; roof: string | null }> {
  const none = { siding: null, roof: null };
  try {
    const { img, release } = await loadImg(file);
    try {
      const W = 360;
      const H = Math.max(16, Math.round((W * img.naturalHeight) / Math.max(1, img.naturalWidth)));
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return none;
      g.drawImage(img, 0, 0, W, H);
      const data = g.getImageData(0, 0, W, H).data;
      const z = colourZones(read, W, H);
      const wall: number[] = [];
      const roof: number[] = [];
      for (let y = Math.max(0, Math.floor(z.box.y0 * H)); y < Math.min(H, Math.ceil(z.box.y1 * H)); y += 2) {
        for (let x = Math.max(0, Math.floor(z.box.x0 * W)); x < Math.min(W, Math.ceil(z.box.x1 * W)); x += 2) {
          const fx = (x + 0.5) / W;
          const fy = (y + 0.5) / H;
          const i = (y * W + x) * 4;
          if (z.wall(fx, fy)) wall.push(data[i], data[i + 1], data[i + 2]);
          else if (z.roof?.(fx, fy)) roof.push(data[i], data[i + 1], data[i + 2]);
        }
      }
      const siding = dominantColour(wall);
      let roofHex = dominantColour(roof, { maxSat: 0.25 });
      // The sky or a pale soffit is not the roof: a roof reads darker than this.
      if (roofHex && luma(roofHex) > 0.6) roofHex = null;
      return { siding, roof: roofHex };
    } finally {
      release();
    }
  } catch {
    return none;
  }
}
/**
 * The picture as the model sees it (2026-10-26: no grid any more — a GPT-6 model reads positions in the picture's own
 * pixels, and the picture's size goes with the form): enlarged to at least `minW` px wide for the close look, 2048 px
 * at most on its long side (what the model takes whole). Back come the file and its size in pixels.
 */
async function forTheModel(src: { file: File; w: number; h: number }, minW: number): Promise<{ file: File; w: number; h: number }> {
  const k = Math.min(Math.max(1, minW / Math.max(1, src.w)), 2048 / Math.max(src.w, src.h, 1));
  if (Math.abs(k - 1) < 1e-6 && src.file.type === "image/jpeg") return src;
  const { img, release } = await loadImg(src.file);
  try {
    const W = Math.max(16, Math.round(src.w * k));
    const H = Math.max(16, Math.round(src.h * k));
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d");
    if (!g) return src;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, 0, 0, W, H);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? { file: new File([blob], "house.jpg", { type: "image/jpeg" }), w: W, h: H } : src;
  } finally {
    release();
  }
}

/** The picture in grey, at most 1000 px across, for lining the read up with its edges (lib/deck/photoSnap). */
async function grayOf(file: Blob): Promise<Gray | null> {
  const { img, release } = await loadImg(file);
  try {
    const k = Math.min(1, 1000 / Math.max(1, img.naturalWidth));
    const w = Math.max(16, Math.round(img.naturalWidth * k));
    const h = Math.max(16, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data;
    const data = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) data[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    return { w, h, data };
  } finally {
    release();
  }
}

/** The one depth for the wall's steps: the model's median, else none (the house takes its usual 2 ft, said to be a guess). */
function stepDepthOf(read: HouseRead): number | null {
  const depths = read.jogs.map((j) => j.depthFt).filter((d): d is number => d !== null && d > 0).sort((a, b) => a - b);
  return depths.length ? depths[Math.floor(depths.length / 2)] : null;
}

/** What the review says the depth map did. */
function depthWords(d: { sections: number; flipped: number; relief: number }): string {
  const steps = d.sections ? `the depth map set ${d.sections} ${d.sections === 1 ? "part" : "parts"} of the wall out or back${d.flipped ? ` (${d.flipped} turned round)` : ""}` : "the depth map agreed with the steps";
  return `, ${steps}${d.relief ? `, ${d.relief} raised or sunk ${d.relief === 1 ? "part" : "parts"} seen on the wall` : ""}`;
}

/** What the review says when the photo's pixels didn't settle the wall's steps. */
function stepsWhyWords(why: WallStepsWhy | undefined, corners: number): string {
  const found = corners ? `${corners} corner${corners === 1 ? "" : "s"} found` : "no corner found";
  switch (why) {
    case "no-eave":
      return "the wall's steps as the model read them (no eave line to read the photo by)";
    case "no-corners":
      return "the wall's steps as the model read them (no corner showed up both storeys of the photo)";
    case "no-band":
      return `${found} in the photo, its eave's shadow not plain enough to tell which way — tap a part to set it out or back`;
    case "flat":
      return `${found} in the photo, its eave level across them — tap a part to set it out or back`;
    default:
      return "the wall's steps as the model read them";
  }
}

/** The form for one look: the picture at the model's size, that size in pixels (the model answers in them), and which look it is. */
async function lookForm(src: { file: File; w: number; h: number }, look: "wide" | "close"): Promise<FormData> {
  const form = new FormData();
  const pic = await forTheModel(src, look === "close" ? 1600 : 0);
  form.set("file", pic.file);
  form.set("w", String(pic.w));
  form.set("h", String(pic.h));
  form.set("look", look);
  return form;
}

const luma = (hex: string) => (0.299 * parseInt(hex.slice(1, 3), 16) + 0.587 * parseInt(hex.slice(3, 5), 16) + 0.114 * parseInt(hex.slice(5, 7), 16)) / 255;

export function useHousePhoto({
  design,
  patch,
  clientId,
  onBuilt,
  api = STUDIO_API,
  audience = "studio",
}: {
  design: DeckDesign;
  patch: (p: DeckPatch, keys?: string[]) => void;
  clientId?: string;
  onBuilt?: () => void;
  api?: HousePhotoApi;
  audience?: "studio" | "client";
}): HousePhotoState {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [review, setReview] = React.useState<HouseReview | null>(null);
  const [clientPhotos, setClientPhotos] = React.useState<ClientPhoto[] | null>(null);
  const [thumb, setThumb] = React.useState<string | null>(null);
  const [fileInput, setFileInput] = React.useState<HTMLInputElement | null>(null);
  const [camInput, setCamInput] = React.useState<HTMLInputElement | null>(null);
  const photo = design.house.photo ?? null;

  // The saved picture's link (the stored URL never goes to the browser as is).
  React.useEffect(() => {
    let live = true;
    if (!photo?.url) {
      queueMicrotask(() => live && setThumb(null));
      return;
    }
    void api.href(photo.url).then((h) => live && setThumb(h));
    return () => {
      live = false;
    };
  }, [photo?.url, api]);

  const built = React.useMemo(
    () =>
      review
        ? houseFromPhoto({
            read: review.read,
            photoW: review.w,
            photoH: review.h,
            deckWidthFt: design.shape.widthFt,
            house: design.house,
            wallWidthFt: review.wallWidthFt,
            measured: review.measured,
          })
        : null,
    [review, design.shape.widthFt, design.house],
  );

  const fromFile = async (file: File) => {
    setBusy("Reading the picture…");
    setError(null);
    setClientPhotos(null);
    try {
      const small = await shrinkPhoto(file);
      const clean = await trimLetterbox(small.file, small.w, small.h);
      setBusy("Finding the house's wall…");
      const res = await api.read(await lookForm(clean, "wide"));
      // NOT A HOUSE (2026-10-26 — owner: "first we gotta make sure it's the house"): a room, a car, a plan drawing gets
      // the model's word on the card, and nothing to drag lines onto.
      if (!res.ok && res.reason === "not-a-house") {
        setError(res.error);
        return;
      }
      let image: { file: File; w: number; h: number } = clean;
      let read: HouseRead = blankHouseRead();
      let straightened: number | null = null;
      let byHand: string | null = null;
      let looks = 1;
      let how: HouseReview["how"] = null;
      let squareOn: number | null = null;
      let levelSlope: number | null = null;
      let stepsFromPhoto = false;
      let relief: DepthRelief[] | undefined;
      let gray0: Awaited<ReturnType<typeof grayOf>> = null;
      if (res.ok) {
        read = res.read;
        // Read the enlarged wall before straightening: cropping at an uncertain eave
        // first could cut off upper windows and make the closer look get skipped.
        const crop = wallCrop(read);
        if (crop) {
          setBusy("Looking closer at the windows and doors…");
          const cut = await cropPhoto(image.file, crop, image.w, image.h);
          const at = { x: Math.round(crop.x * image.w) / image.w, y: Math.round(crop.y * image.h) / image.h, w: cut.w / image.w, h: cut.h / image.h };
          const close = await api.read(await lookForm(cut, "close")).catch(() => null);
          if (close?.ok) {
            const merged = mergeLooks(read, readFromCrop(close.read, at));
            if (merged !== read) looks = 2;
            read = merged;
          }
        }
        // A SQUARE-ON SHOT STAYS SQUARE (2026-10-24 — owner, the same photo: "still wrong"). The model's eave and base
        // lines lean a few per cent off the wall's; 3 % made a square-on photo look angled, it was "straightened", its
        // corners leaned and the wall's steps went unread. The photo says which it is (lib/deck/wallSteps
        // photoObliqueness): its rows of window heads run parallel when the shot is square-on. Then the model's lines
        // are turned to the wall's own way across the picture, and nothing is warped.
        gray0 = await grayOf(clean.file).catch(() => null);
        // THE STEPS OFF THE CLEAN PICTURE FIRST (2026-10-24 — owner, the same photo a fourth time: "it's still wrong"):
        // when the photo's rows of windows can't say the shot is square-on (the model missed some), the model's leaning
        // lines have the square-on photo straightened, and on the warped picture the corner boards lean and no corner
        // is found — the model's misread stood. The steps read here, on the photo as it is, are carried through the warp.
        let early: WallStepsReport | null = null;
        let mapPt = (p: { x: number; y: number }) => p;
        if (gray0) {
          const seen = photoObliqueness(snapRead(read, gray0, { preserveOpenings: true }).read, gray0);
          if (seen && seen.obliquePct < SQUARE_ON_PCT) {
            const leaned = obliqueness(read);
            read = levelRead(read, seen.slope, gray0);
            levelSlope = seen.slope;
            if (leaned !== null && leaned >= AUTO_STRAIGHTEN_PCT) squareOn = leaned;
          }
          early = wallStepsReport(snapRead(read, gray0, { preserveOpenings: true }).read, gray0, { depthFt: stepDepthOf(read) });
        }
        // An angled shot is straightened first (lib/deck/photoFit autoRectify), so a foot is a foot across the wall.
        const plan = rectifyHouseRead(read, clean.w, clean.h);
        if (plan) {
          setBusy("Straightening the picture…");
          const warped = await straightenPhoto(clean.file, plan.H, { w: plan.w, h: plan.h }, { w: clean.w, h: clean.h }).catch(() => null);
          if (warped) {
            const pt = (p: { x: number; y: number }) => {
              const m = applyHomography(plan.H, {
                x: p.x * clean.w,
                y: p.y * clean.h,
              });
              return { x: m.x / warped.w, y: m.y / warped.h };
            };
            read = mapHouseRead(read, (r) => transformRead(r, plan.H, clean.w, clean.h, warped.w, warped.h), pt);
            mapPt = pt;
            image = warped;
            straightened = plan.obliquePct;
          }
        }
        // The close look draws its own lines: on a square-on shot they take the wall's way across too.
        if (levelSlope !== null && gray0 && image === clean) read = levelRead(read, levelSlope, gray0);
        // THEN THE PICTURE'S OWN EDGES (lib/deck/photoSnap): every box, corner and line moved onto the frame or the
        // corner it stands for — the model says roughly where, the pixels say exactly.
        // The wall's parts as the model read them, in this picture's fractions — the depth map takes a step's size from them.
        const modelSections = readSections(read);
        setBusy("Lining it up with the photo…");
        const gray = image === clean && gray0 ? gray0 : await grayOf(image.file).catch(() => null);
        if (gray) {
          const snapped = snapRead(read, gray, { preserveOpenings: true });
          read = snapped.read;
          // THE WALL'S STEPS FROM ITS PIXELS (lib/deck/wallSteps, 2026-10-23 night — owner: "still wrong, should be like
          // on the second pic"): its corners where an edge runs up every storey, which way each part stands by where its
          // eave sits in the picture. The model said one corner the wrong way round (a porch roof's side as the part
          // standing out); where the photo shows plainly, the photo's steps stand — at the model's own depth.
          const report = wallStepsReport(read, gray, { depthFt: stepDepthOf(read) });
          // The clean picture's steps, in this picture's places (the same when nothing was warped).
          const carry = (jogs: WallJog[]) => jogs.map((j) => ({ ...j, ...mapPt({ x: j.x, y: j.y }) }));
          const earlyJogs = early?.steps ? carry(early.steps.jogs) : null;
          // The steps: the clean picture's where this one was straightened (the warp, made from the model's lines,
          // can lose a corner); else this picture's (the close look's windows kept out of its rows); else the clean
          // picture's; else, where the photo shows corners but can't say which way, dividers there — the parts between
          // them to tap out or back, not the model's guess at them, which has been the wrong way round.
          const steps = straightened !== null && earlyJogs ? earlyJogs : report.steps ? report.steps.jogs : earlyJogs;
          const beforeWarp = !!steps && steps === earlyJogs && straightened !== null;
          stepsFromPhoto = !!steps;
          if (steps) read = { ...read, jogs: steps };
          else {
            const dividers = report.dividers.length ? report.dividers : early?.dividers.length ? carry(early.dividers) : [];
            if (dividers.length) read = { ...read, jogs: dividers };
          }
          const why = steps ? null : report.why ?? early?.why ?? null;
          const corners = Math.max(report.corners.length, early?.corners.length ?? 0);
          how = { looks, model: res.model, snapped: snapped.moved, split: snapped.split, windowsFromPhoto: snapped.found, stepsFromPhoto: steps ? steps.length : 0, ...(why ? { stepsWhy: why, cornersFromPhoto: corners } : {}), ...(beforeWarp ? { stepsBeforeWarp: true } : {}), ...(squareOn !== null ? { squareOn } : {}) };
        } else how = { looks, model: res.model, snapped: 0, split: 0 };
        // THE DEPTH MAP (2026-10-26 — owner: "changes in walls if a certain part comes out or goes deeper"): which way
        // each part of the wall stands, read off a depth map of the picture (lib/deck/houseDepth) rather than guessed
        // from the eave's shadow — the sign from the map, the size from the model's word (lib/deck/houseDepthApply);
        // and the wall's relief — a bay, a chimney, a recessed entry — kept for the 3D.
        if (api.depth) {
          setBusy("Reading the wall's depth…");
          const small = await shrinkPhoto(image.file, 1024).catch(() => null);
          if (small) {
            const df = new FormData();
            df.set("file", small.file);
            df.set("read", JSON.stringify(read));
            const depth = await api.depth(df).catch(() => null);
            if (depth?.ok) {
              const applied = applyDepthVerdicts(read, depth.verdicts, { modelSections, stepsFromPhoto });
              read = applied.read;
              relief = depth.relief;
              how = { ...(how ?? { looks, model: res.model, snapped: 0, split: 0 }), depth: { sections: applied.changed, flipped: applied.flipped, relief: depth.relief.length } };
            }
          }
        }
      } else
        byHand = res.configured
          ? `${res.error} Drag the lines onto the wall, then add the windows and the door.`
          : "The picture can't be read here — drag the lines onto the wall, then add the windows and the door.";
      setBusy("Matching the colours…");
      const measured = res.ok ? await measureColours(image.file, read) : { siding: null, roof: null };
      setBusy("Saving the picture…");
      const up = new FormData();
      up.set("file", image.file);
      up.set("w", String(image.w));
      up.set("h", String(image.h));
      const saved = await api.upload(up);
      if (!saved.ok) {
        setError(saved.error);
        return;
      }
      setReview({
        url: saved.url,
        // No file store on the server (the client's page): the picture is shown from the browser's own copy, and the
        // house is built without keeping it.
        href: saved.href || URL.createObjectURL(image.file),
        w: saved.w,
        h: saved.h,
        read,
        measured,
        wallWidthFt: null,
        useHeight: true,
        veneer: true,
        straightened,
        byHand,
        how,
        relief,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The picture could not be read.");
    } finally {
      setBusy(null);
      if (fileInput) fileInput.value = "";
      if (camInput) camInput.value = "";
    }
  };
  const onFile = (file: File | null) => {
    if (file && !busy) void fromFile(file);
  };

  const openClientPhotos = async () => {
    setError(null);
    setBusy("Finding your clients' photos…");
    if (!api.clientPhotos) return;
    const res = await api.clientPhotos({ clientId: clientId ?? null }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      setError(res && !res.ok ? res.error : "The clients' photos could not be read right now.");
      return;
    }
    setClientPhotos(res.photos);
  };
  const pickClientPhoto = async (id: string) => {
    if (!api.clientPhotoData) return;
    setBusy("Opening the photo…");
    const res = await api.clientPhotoData(id).catch(() => null);
    if (!res || !res.ok) {
      setBusy(null);
      setError(res && !res.ok ? res.error : "That photo could not be opened.");
      return;
    }
    const blob = await fetch(res.dataUrl).then((r) => r.blob());
    await fromFile(
      new File([blob], res.name || "house.jpg", {
        type: blob.type || "image/jpeg",
      }),
    );
  };

  /** The house the review shows, laid over the design, the photo kept with it. */
  const build = () => {
    if (!review || !built) return;
    const kept: HousePhoto = {
      url: review.url,
      w: review.w,
      h: review.h,
      read: review.read,
      wallFt: built.wallFt,
      by: built.scale.by,
      deckAtFt: built.deckAtFt,
      at: new Date().toISOString(),
    };
    const p: DeckPatch = { house: { ...built.house, photo: review.url ? kept : null } };
    if (review.useHeight && built.heightIn) p.heightIn = built.heightIn;
    const veneer = built.house.material === "brick" || built.house.material === "stone";
    if (veneer && review.veneer) p.wall = "brick-veneer";
    patch(p, ["house-photo", ...(p.heightIn ? ["height"] : [])]);
    setReview(null);
    onBuilt?.();
  };

  /** The review again, from the saved picture and its read — no second look by the model. */
  const lookAgain = async () => {
    if (!photo) return;
    const href = thumb ?? (await api.href(photo.url).catch(() => null));
    if (!href) {
      setError("The saved picture could not be opened — upload it again.");
      return;
    }
    const own = (v: string) => (isHouseHex(v) ? v : null);
    setReview({
      url: photo.url,
      href,
      w: photo.w,
      h: photo.h,
      read: photo.read ?? blankHouseRead(),
      measured: {
        siding: own(design.house.siding),
        roof: own(design.house.roofColour),
      },
      wallWidthFt: photo.by === "width" ? photo.wallFt : null,
      useHeight: false,
      veneer: design.wall === "brick-veneer",
      straightened: null,
      byHand: photo.read ? null : "Drag the lines onto the wall, then add the windows and the door.",
    });
  };
  const removePhoto = () => patch({ house: { photo: null } });

  return {
    audience,
    busy,
    error,
    review,
    setReview,
    built,
    thumb,
    setFileInput,
    setCamInput,
    pickFile: () => fileInput?.click(),
    pickCamera: () => camInput?.click(),
    onFile,
    clientPhotos,
    openClientPhotos,
    closeClientPhotos: () => setClientPhotos(null),
    pickClientPhoto,
    build,
    lookAgain,
    removePhoto,
  };
}

/* ── The card at the top of the House step ─────────────────────────────── */

/** The two hidden file inputs: a picture from the phone or the computer, and the phone's camera. */
function PhotoInputs({ fileInput, camInput, onFile }: { fileInput: (el: HTMLInputElement | null) => void; camInput: (el: HTMLInputElement | null) => void; onFile: (file: File | null) => void }) {
  return (
    <>
      <input
        ref={fileInput}
        className="v1-file-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        data-deck-house-photo-input
      />
      <input ref={camInput} className="v1-file-hidden" type="file" accept="image/*" capture="environment" tabIndex={-1} aria-hidden="true" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </>
  );
}

export function HousePhotoCard({ hp, design }: { hp: HousePhotoState; design: DeckDesign }) {
  const photo = design.house.photo ?? null;
  const n = design.house.openings?.length ?? 0;
  const wins = design.house.openings?.filter((o) => o.kind === "window").length ?? 0;
  return (
    <div className="v1-hp-card" data-deck-house-photo={photo ? "built" : "none"} data-tour="deck:house-photo">
      {photo ? (
        <div className="v1-hp-built">
          {hp.thumb ? (
            <button type="button" className="v1-hp-thumb" onClick={() => void hp.lookAgain()} aria-label="Look at the photo again">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link */}
              <img src={hp.thumb} alt="The back of the house" />
            </button>
          ) : (
            <span className="v1-hp-thumb" aria-hidden="true" />
          )}
          <div className="v1-hp-built-text">
            <b>Built from the photo</b>
            <span>
              ≈ {ftIn(Math.round(photo.wallFt * 2) / 2)} wall · {wins} {wins === 1 ? "window" : "windows"}
              {n - wins ? ` · ${n - wins} ${n - wins === 1 ? "door" : "doors"}` : ""} · {design.house.storeys === 2 ? "two storeys" : "one storey"}
            </span>
            <div className="v1-row-acts">
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => void hp.lookAgain()} data-deck-house-photo-again>
                <RotateCcw size={15} aria-hidden="true" /> Look again
              </button>
              <button type="button" className="v1-btn v1-btn-sm" onClick={hp.pickFile} disabled={!!hp.busy}>
                <ImagePlus size={15} aria-hidden="true" /> New photo
              </button>
              <button type="button" className="v1-btn v1-btn-sm v1-btn-quiet" onClick={hp.removePhoto} title="The house stays as it was built">
                Remove the photo
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="v1-hp-lead">
            <b>{hp.audience === "client" ? "Build your house from a photo" : "Build the house from a photo"}</b>
            <span>
              {hp.audience === "client"
                ? "Stand in the yard and take the back (or side) wall where the deck goes, the whole wall in the picture. Its shape, steps, windows and doors, storeys, roof and colour come off it — then adjust anything."
                : "The back (or side) wall where the deck goes — the client’s picture or yours. The wall, its steps, the windows and doors, the storeys, the roof and the colour come off it; then adjust anything."}
            </span>
          </div>
          <div className="v1-row-acts">
            <button type="button" className="v1-btn v1-btn-sm v1-btn-primary" onClick={hp.pickFile} disabled={!!hp.busy} data-deck-house-photo-upload>
              <ImagePlus size={15} aria-hidden="true" /> Upload a photo
            </button>
            <button type="button" className="v1-btn v1-btn-sm" onClick={hp.pickCamera} disabled={!!hp.busy} data-deck-house-photo-camera>
              <Camera size={15} aria-hidden="true" /> Take a photo
            </button>
            {hp.audience === "studio" ? (
              <button type="button" className="v1-btn v1-btn-sm" onClick={() => void hp.openClientPhotos()} disabled={!!hp.busy} data-deck-house-photo-clients>
                <Users size={15} aria-hidden="true" /> Client&rsquo;s photos
              </button>
            ) : null}
          </div>
        </>
      )}
      <PhotoInputs fileInput={hp.setFileInput} camInput={hp.setCamInput} onFile={hp.onFile} />
      {hp.busy ? (
        // One square with the line running round its frame, the step in words beside it (owner, 2026-10-26).
        <div className="v1-hp-busy" role="status" aria-live="polite" data-deck-house-photo-busy>
          <svg className="v1-hp-busy-box" viewBox="0 0 56 56" aria-hidden="true">
            <rect className="v1-hp-busy-track" x="2" y="2" width="52" height="52" />
            <rect className="v1-hp-busy-run" x="2" y="2" width="52" height="52" />
          </svg>
          <span>{hp.busy}</span>
        </div>
      ) : null}
      {hp.error ? <p className="v1-call v1-call-bad">{hp.error}</p> : null}
      {hp.clientPhotos ? (
        <div className="v1-hp-clients" data-deck-house-photo-client-list>
          <div className="v1-pop-head">
            <b>Photos your clients sent</b>
            <button type="button" className="v1-icon-btn" onClick={hp.closeClientPhotos} aria-label="Close">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {hp.clientPhotos.length ? (
            hp.clientPhotos.map((p) => (
              <button key={p.id} type="button" className="v1-hp-client-row" onClick={() => void hp.pickClientPhoto(p.id)} disabled={!!hp.busy}>
                <span>
                  <b>{p.from}</b>
                  {p.mine ? <span className="v1-stamp is-info">This client</span> : null}
                </span>
                <span className="v1-meta">
                  {p.name} ·{" "}
                  {new Date(p.at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </button>
            ))
          ) : (
            <p className="v1-hint">No photos from clients yet. A homeowner adds them to the job folder on their request; or upload one here.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ── "Here's what I see" — the review ─────────────────────────────────── */

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;
type Sel = { kind: "win" | "door" | "jog" | "sec"; i: number } | null;

/** A part of the wall in words: how it stands against the main wall. */
const sectionWords = (outFt: number) => (outFt > 0 ? `Out ${ftIn(outFt)}` : outFt < 0 ? `Back ${ftIn(-outFt)}` : "Main wall");

/**
 * The wall seen from above (2026-10-23 evening): its parts as they stand, the yard below — so a step read the wrong
 * way round shows at a glance. Each part can be tapped, like its chip on the photo.
 */
function WallTopView({ sections, selected, onPick }: { sections: ReturnType<typeof readSections>; selected: number | null; onPick: (i: number) => void }) {
  if (!sections.length) return null;
  const x0 = sections[0].x0;
  const span = Math.max(1e-6, sections[sections.length - 1].x1 - x0);
  const most = Math.max(2, ...sections.map((s) => Math.abs(s.outFt)));
  const W = 1000;
  const X = (x: number) => ((x - x0) / span) * (W - 40) + 20;
  const Y = (out: number) => 34 + (out / most) * 22;
  const path = sections.map((s, i) => `${i ? "L" : "M"}${X(s.x0).toFixed(1)},${Y(s.outFt).toFixed(1)} L${X(s.x1).toFixed(1)},${Y(s.outFt).toFixed(1)}`).join(" ");
  return (
    <figure className="v1-hp-top" data-deck-house-top-view>
      <svg viewBox={`0 0 ${W} 74`} role="group" aria-label="The wall seen from above">
        <path className="v1-hp-top-house" d={`${path} L${X(sections[sections.length - 1].x1).toFixed(1)},4 L${X(x0).toFixed(1)},4 Z`} />
        <path className="v1-hp-top-wall" d={path} />
        {sections.map((s, i) => (
          <rect key={i} className={cx("v1-hp-top-hit", selected === i && "is-sel")} x={X(s.x0)} y={0} width={Math.max(4, X(s.x1) - X(s.x0))} height={74} onClick={() => onPick(i)} aria-label={`${sectionWords(s.outFt)} — part ${i + 1}`} />
        ))}
      </svg>
      <figcaption>Seen from above — the house at the top, the yard below</figcaption>
    </figure>
  );
}

export function HousePhotoReview({ hp, design }: { hp: HousePhotoState; design: DeckDesign }) {
  const r = hp.review;
  const stageRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    mark: HouseMark;
    moved: boolean;
    x: number;
    y: number;
    sel: Sel;
  } | null>(null);
  const [sel, setSel] = React.useState<Sel>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const isOpen = !!r;
  React.useEffect(() => {
    if (isOpen) closeRef.current?.focus();
  }, [isOpen]);
  React.useEffect(() => {
    if (!isOpen) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hp.setReview(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [isOpen, hp]);
  if (!r) return null;
  const read = r.read;
  const b = hp.built;
  const setRead = (next: HouseRead) => hp.setReview((v) => (v ? { ...v, read: next } : v));
  // The wall as its parts: tinted on the photo, a chip on each, and seen from above.
  const sections = readSections(read);
  const lineY = (l: { left: { x: number; y: number }; right: { x: number; y: number } }, x: number) => l.left.y + ((l.right.y - l.left.y) * (x - l.left.x)) / Math.max(1e-6, l.right.x - l.left.x);
  const eaveY = (x: number) => (read.eave ? lineY(read.eave, x) : lineY(read.base, x) - 0.25);
  const secSel = sel?.kind === "sec" && sections[sel.i] ? sel.i : null;
  const mainAt = mainSection(sections);
  const setOut = (i: number, outFt: number) => {
    const next = setSectionOut(read, i, outFt);
    setRead(next);
    // A part merged into its neighbour (its step dropped) leaves nothing to keep picked.
    setSel(readSections(next).length === sections.length ? { kind: "sec", i } : null);
  };
  const at = (e: React.PointerEvent) => {
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return {
      x: (e.clientX - box.left) / Math.max(1, box.width),
      y: (e.clientY - box.top) / Math.max(1, box.height),
    };
  };
  const begin = (mark: HouseMark, s: Sel) => (e: React.PointerEvent) => {
    e.preventDefault();
    setSel(s);
    drag.current = { mark, moved: false, x: e.clientX, y: e.clientY, sel: s };
    stageRef.current?.setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
    // A step dragged re-draws the wall's parts: a part picked before is not the same part any more.
    if (!d.moved && d.mark.startsWith("jog-")) setSel((v) => (v?.kind === "sec" ? null : v));
    d.moved = true;
    setRead(moveHouseMark(read, d.mark, at(e)));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) setSel(d.sel);
  };
  const handle = (mark: HouseMark, x: number, y: number, label: string, s: Sel = null, cls = "") => (
    <button
      key={mark}
      type="button"
      className={cx("v1-hp-handle", cls, s && sel && s.kind === sel.kind && s.i === sel.i && "is-sel")}
      style={{ left: pct(x), top: pct(y) }}
      aria-label={label}
      onPointerDown={begin(mark, s)}
      onClick={() => setSel(s)}
      onKeyDown={(e) => {
        const delta = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -delta / r.w : e.key === "ArrowRight" ? delta / r.w : 0;
        const dy = e.key === "ArrowUp" ? -delta / r.h : e.key === "ArrowDown" ? delta / r.h : 0;
        if (dx || dy) { e.preventDefault(); setRead(moveHouseMark(read, mark, { x: x + dx, y: y + dy })); }
      }}
      data-house-mark={mark}
    />
  );
  const removeSel = () => {
    if (!sel) return;
    if (sel.kind === "win") setRead(removeReadWindow(read, sel.i));
    else if (sel.kind === "door") setRead(removeReadDoor(read, sel.i));
    else setRead(removeReadJog(read, sel.i));
    setSel(null);
  };
  const selectedKind = sel?.kind === "win" || sel?.kind === "door" ? sel.kind : null;
  const selectedWindow = sel?.kind === "win" ? read.windows[sel.i] : null;
  const selectedDoor = sel?.kind === "door" ? read.doors[sel.i] : null;
  const selectedBox = selectedWindow ? { x0: selectedWindow.x0, x1: selectedWindow.x1, top: selectedWindow.head, bottom: selectedWindow.sill } : selectedDoor;
  const selectedName = sel ? (selectedKind === "win" ? "Window" : "Door") + " " + (sel.i + 1) : "";
  const veneer = b?.house.material === "brick" || b?.house.material === "stone";
  // On the page itself, above the app's sidebar (the studio's own layer sits under it), in the studio's style scope.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="jf-deck-v1 v1-hp-portal" data-nest>
      <div className="v1-hp-scrim" role="dialog" aria-modal="true" aria-label="The house read off the photo" data-deck-house-review>
        <div className="v1-hp-sheet">
          <div className="v1-hp-head">
            <div>
              <h3 className="v1-h3">Here&rsquo;s what I see</h3>
              <span className="v1-meta">
                {r.byHand ? "Marked by hand" : `Read off the photo${r.how ? ` in ${r.how.looks === 2 ? "two looks" : "one look"}${r.how.windowsFromPhoto ? `, its ${r.how.windowsFromPhoto} windows read off the picture` : r.how.snapped ? ", lined up with its edges" : ""}${r.how.stepsFromPhoto ? `, the wall's steps measured off the photo${r.how.stepsBeforeWarp ? " before it was straightened" : ""}` : r.how.stepsFromPhoto === 0 ? `, ${stepsWhyWords(r.how.stepsWhy, r.how.cornersFromPhoto ?? 0)}` : ""}${r.how.squareOn ? ", shot square-on — not straightened" : ""}${r.how.depth ? depthWords(r.how.depth) : ""} (${r.how.model})` : ""}${r.straightened ? ` · straightened (the shot was ${r.straightened}% off square)` : ""}`} — drag any line that&rsquo;s off; tap a part
                of the wall to set it out or back. Select a window or door to move it, resize its corners, or change its bounds below.
              </span>
            </div>
            <button ref={closeRef} type="button" className="v1-icon-btn" onClick={() => hp.setReview(null)} aria-label="Close without building">
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <div className="v1-hp-body">
            <div className="v1-hp-picwrap">
              <div
                ref={stageRef}
                className="v1-hp-pic"
                style={
                  {
                    "--ar": `${r.w} / ${r.h}`,
                    "--arn": r.w / r.h,
                  } as React.CSSProperties
                }
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                data-deck-house-review-pic
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind this app's own signed link */}
                <img src={r.href} alt="The back of the house" draggable={false} />
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                  <line className="v1-hp-l-base" x1={read.base.left.x * 1000} y1={read.base.left.y * 1000} x2={read.base.right.x * 1000} y2={read.base.right.y * 1000} />
                  {read.eave ? <line className="v1-hp-l-eave" x1={read.eave.left.x * 1000} y1={read.eave.left.y * 1000} x2={read.eave.right.x * 1000} y2={read.eave.right.y * 1000} /> : null}
                  {read.eave ? (
                    <>
                      <line className="v1-hp-l-side" x1={read.base.left.x * 1000} y1={read.base.left.y * 1000} x2={read.eave.left.x * 1000} y2={read.eave.left.y * 1000} />
                      <line className="v1-hp-l-side" x1={read.base.right.x * 1000} y1={read.base.right.y * 1000} x2={read.eave.right.x * 1000} y2={read.eave.right.y * 1000} />
                    </>
                  ) : null}
                  {sections.map((sec, i) => (
                    <polygon
                      key={`s${i}`}
                      className={cx("v1-hp-l-sec", sec.outFt > 0 ? "is-out" : sec.outFt < 0 ? "is-back" : "is-main", secSel === i && "is-sel")}
                      points={[
                        [sec.x0, eaveY(sec.x0)],
                        [sec.x1, eaveY(sec.x1)],
                        [sec.x1, lineY(read.base, sec.x1)],
                        [sec.x0, lineY(read.base, sec.x0)],
                      ]
                        .map(([x, y]) => `${(x * 1000).toFixed(1)},${(y * 1000).toFixed(1)}`)
                        .join(" ")}
                    />
                  ))}
                  {read.windows.map((w, i) => (
                    <rect
                      key={`w${i}`}
                      className={cx("v1-hp-l-win", sel?.kind === "win" && sel.i === i && "is-sel")}
                      x={w.x0 * 1000}
                      y={w.head * 1000}
                      width={(w.x1 - w.x0) * 1000}
                      height={(w.sill - w.head) * 1000}
                    />
                  ))}
                  {read.doors.map((d, i) => (
                    <rect
                      key={`d${i}`}
                      className={cx("v1-hp-l-door", sel?.kind === "door" && sel.i === i && "is-sel")}
                      x={d.x0 * 1000}
                      y={d.top * 1000}
                      width={(d.x1 - d.x0) * 1000}
                      height={(d.bottom - d.top) * 1000}
                    />
                  ))}
                  {read.jogs.map((j, i) => (
                    <line
                      key={`j${i}`}
                      className={cx("v1-hp-l-jog", j.depthFt === 0 && "is-flat", sel?.kind === "jog" && sel.i === i && "is-sel")}
                      x1={j.x * 1000}
                      y1={
                        (read.eave ? read.eave.left.y + ((read.eave.right.y - read.eave.left.y) * (j.x - read.eave.left.x)) / Math.max(1e-6, read.eave.right.x - read.eave.left.x) : j.y - 0.25) * 1000
                      }
                      x2={j.x * 1000}
                      y2={j.y * 1000}
                    />
                  ))}
                </svg>
                {handle("base-left", read.base.left.x, read.base.left.y, "The wall's base, left corner", null, "is-corner")}
                {handle("base-right", read.base.right.x, read.base.right.y, "The wall's base, right corner", null, "is-corner")}
                {read.eave ? handle("eave-left", read.eave.left.x, read.eave.left.y, "The eave, left end", null, "is-corner") : null}
                {read.eave ? handle("eave-right", read.eave.right.x, read.eave.right.y, "The eave, right end", null, "is-corner") : null}
                {read.jogs.map((j, i) => handle(`jog-${i}`, j.x, j.y, `Step ${i + 1} in the wall`, { kind: "jog", i }, "is-jog"))}
                {read.doors.map((d, i) => (
                  <React.Fragment key={`dh${i}`}>
                    {handle(`door-${i}`, (d.x0 + d.x1) / 2, d.bottom, `${d.kind === "garage" ? "Garage door" : "Door"} ${i + 1} — its ${d.kind === "garage" ? "bottom" : "threshold"}`, { kind: "door", i }, "is-door")}
                    {handle(`door-top-${i}`, (d.x0 + d.x1) / 2, d.top, `${d.kind === "garage" ? "Garage door" : "Door"} ${i + 1} — its top`, { kind: "door", i }, "is-door is-small")}
                  </React.Fragment>
                ))}
                {read.windows.map((w, i) => handle(`win-${i}`, (w.x0 + w.x1) / 2, (w.head + w.sill) / 2, `Window ${i + 1}`, { kind: "win", i }, "is-win"))}
                {sel && selectedKind && selectedBox ? ([
                  ["nw", selectedBox.x0, selectedBox.top], ["ne", selectedBox.x1, selectedBox.top],
                  ["sw", selectedBox.x0, selectedBox.bottom], ["se", selectedBox.x1, selectedBox.bottom],
                ] as const).map(([corner, x, y]) => handle(`${selectedKind}-${corner}-${sel.i}`, x, y, `Resize ${selectedName.toLowerCase()}, ${corner}`, sel, "is-resize")) : null}
                {sections.map((sec, i) => (
                  <button
                    key={`sc${i}`}
                    type="button"
                    className={cx("v1-hp-sec", sec.outFt > 0 ? "is-out" : sec.outFt < 0 ? "is-back" : "is-main", secSel === i && "is-sel")}
                    style={{ left: pct((sec.x0 + sec.x1) / 2), top: pct(Math.min(0.97, lineY(read.base, (sec.x0 + sec.x1) / 2) + 0.03)) }}
                    onClick={() => setSel(secSel === i ? null : { kind: "sec", i })}
                    aria-pressed={secSel === i}
                    data-deck-house-section={i}
                  >
                    {i === mainAt && sections.length > 1 ? "Main wall" : sectionWords(sec.outFt)}
                  </button>
                ))}
              </div>
              <WallTopView sections={sections} selected={secSel} onPick={(i) => setSel(secSel === i ? null : { kind: "sec", i })} />
              {sel && selectedKind && selectedBox ? <div className="v1-hp-opening" data-house-opening-editor>
                <b>{selectedName}</b>
                <span className="v1-hint">Drag the window’s centre or the door’s bottom handle to move it; drag a corner to resize. Arrow keys move a handle one pixel; Shift moves ten. Bounds below are pixels in the photo.</span>
                <div className="v1-hp-bounds">
                  {([
                    ["Left", selectedBox.x0 * r.w, (1 - selectedBox.x1 + selectedBox.x0) * r.w, (n: number) => ({ x0: n / r.w, x1: n / r.w + selectedBox.x1 - selectedBox.x0 })],
                    ["Top", selectedBox.top * r.h, (1 - selectedBox.bottom + selectedBox.top) * r.h, (n: number) => ({ top: n / r.h, bottom: n / r.h + selectedBox.bottom - selectedBox.top })],
                    ["Width", (selectedBox.x1 - selectedBox.x0) * r.w, (1 - selectedBox.x0) * r.w, (n: number) => ({ x1: selectedBox.x0 + n / r.w })],
                    ["Height", (selectedBox.bottom - selectedBox.top) * r.h, (1 - selectedBox.top) * r.h, (n: number) => ({ bottom: selectedBox.top + n / r.h })],
                  ] as const).map(([label, value, max, patch]) => <label key={label} className="v1-hp-width">
                    <span className="v1-lbl">{label} (px)</span>
                    <NumberInput label={selectedName + " " + label.toLowerCase() + " in photo pixels"} value={Math.round(value)} min={label === "Width" || label === "Height" ? 4 : 0} max={max}
                      parse={(text) => text.trim() && Number.isFinite(Number(text)) ? Number(text) : null} format={(n) => String(Math.round(n))}
                      onCommit={(n) => setRead(editReadOpening(read, selectedKind, sel.i, patch(n)))} />
                  </label>)}
                </div>
                {selectedDoor ? <label className="v1-hp-width"><span className="v1-lbl">Door type</span>
                  <select className="v1-in" aria-label={selectedName + " type"} value={selectedDoor.kind} onChange={(e) => setRead(editReadOpening(read, "door", sel.i, { kind: e.target.value as typeof selectedDoor.kind }))}>
                    <option value="hinged">Hinged door</option><option value="slider">Sliding glass door</option><option value="french">French doors</option><option value="garage">Garage door</option>
                  </select>
                </label> : null}
              </div> : null}
              {secSel !== null ? (
                <div className="v1-row-acts v1-hp-tools v1-hp-sec-tools" data-deck-house-section-tools>
                  {secSel === mainAt ? (
                    <span className="v1-hp-sec-note">
                      {sections.length > 1 ? "The main wall — the widest part. The other parts come out or step back from it: tap one of them." : "One flat wall. Where it steps, add a step (+ Step) and drag it there — then tap the part that comes out."}
                    </span>
                  ) : (
                    <>
                  <span className="v1-lbl">This part of the wall</span>
                  <div className="v1-seg" role="group" aria-label="How this part stands">
                    {(
                      [
                        ["back", "Set back"],
                        ["main", "Main wall"],
                        ["out", "Comes out"],
                      ] as const
                    ).map(([k, label]) => {
                      const cur = sections[secSel].outFt;
                      const on = k === "main" ? cur === 0 : k === "out" ? cur > 0 : cur < 0;
                      return (
                        <button
                          key={k}
                          type="button"
                          className={cx("v1-seg-btn", on && "is-on")}
                          aria-pressed={on}
                          onClick={() => setOut(secSel, k === "main" ? 0 : (k === "out" ? 1 : -1) * Math.max(1, Math.abs(cur) || 2))}
                          data-deck-house-section-set={k}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  {sections[secSel].outFt !== 0 ? (
                    <span className="v1-hp-sec-depth">
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => setOut(secSel, Math.sign(sections[secSel].outFt) * Math.max(0.5, Math.abs(sections[secSel].outFt) - 0.5))} aria-label="Half a foot less">
                        −
                      </button>
                      <b>{ftIn(Math.abs(sections[secSel].outFt))}</b>
                      <button type="button" className="v1-btn v1-btn-sm" onClick={() => setOut(secSel, Math.sign(sections[secSel].outFt) * Math.min(8, Math.abs(sections[secSel].outFt) + 0.5))} aria-label="Half a foot more">
                        +
                      </button>
                    </span>
                  ) : null}
                    </>
                  )}
                </div>
              ) : null}
              <div className="v1-row-acts v1-hp-tools">
                <button type="button" className="v1-btn v1-btn-sm" onClick={() => setRead(addReadWindow(read, r.w, r.h))} data-deck-house-review-add-window>
                  + Window
                </button>
                <button type="button" className="v1-btn v1-btn-sm" onClick={() => setRead(addReadDoor(read, r.w, r.h))} data-deck-house-review-add-door>
                  + Door
                </button>
                <button
                  type="button"
                  className="v1-btn v1-btn-sm"
                  onClick={() => {
                    setRead(addReadJog(read));
                    setSel(null);
                  }}
                  disabled={read.jogs.length >= 4}
                  data-deck-house-review-add-step
                >
                  + Step
                </button>
                {sel && sel.kind !== "sec" ? (
                  <button type="button" className="v1-btn v1-btn-sm v1-btn-danger" onClick={removeSel} data-deck-house-review-remove>
                    Remove the {sel.kind === "win" ? "window" : sel.kind === "door" ? "door" : "step"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="v1-hp-side">
              {r.byHand ? <p className="v1-call v1-call-warn">{r.byHand}</p> : null}
              {b ? (
                <ul className="v1-hp-facts" data-deck-house-review-facts>
                  {b.facts.map((f) => (
                    <li key={f.id} data-fact={f.id}>
                      <span className="v1-lbl">{f.label}</span>
                      <span className="v1-hp-fact">
                        {f.swatch ? <span className="v1-swatch" style={{ background: f.swatch }} aria-hidden="true" /> : null}
                        {f.value}
                        {f.guess ? <span className="v1-stamp is-warn">estimate</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="v1-call v1-call-warn">Nothing in the picture gives a size yet — mark the door, or type the wall&rsquo;s width below.</p>
              )}
              <label className="v1-hp-width">
                <span className="v1-lbl">Measured the wall? Its width corner to corner</span>
                <NumberInput
                  label="The wall's width, corner to corner, feet"
                  value={r.wallWidthFt ?? 0}
                  parse={(t) => (t.trim() === "" ? 0 : parseFeet(t))}
                  format={(n) => (n > 0 ? feetText(n) : "")}
                  min={0}
                  max={200}
                  onCommit={(n) => hp.setReview((v) => (v ? { ...v, wallWidthFt: n >= 4 ? n : null } : v))}
                />
              </label>
              {b?.heightIn ? (
                <Toggle checked={r.useHeight} onChange={(on) => hp.setReview((v) => (v ? { ...v, useHeight: on } : v))}>
                  Set the deck&rsquo;s floor from the door — {b.heightIn} in. (an inch under its threshold; now {design.heightIn} in.)
                </Toggle>
              ) : null}
              {veneer ? (
                <Toggle checked={r.veneer} onChange={(on) => hp.setReview((v) => (v ? { ...v, veneer: on } : v))}>
                  The wall is {b?.house.material} veneer — no ledger can be bolted to it: set the house wall to brick veneer.
                </Toggle>
              ) : null}
              {b?.checks.length ? (
                <div className="v1-call v1-call-warn" data-deck-house-review-checks>
                  <b>Look at</b>
                  <ul>
                    {b.checks.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="v1-row-acts v1-hp-go">
                <button type="button" className="v1-btn v1-btn-primary" onClick={hp.build} disabled={!b} data-deck-house-build>
                  Build my house
                </button>
                <button type="button" className="v1-btn v1-btn-quiet" onClick={() => hp.setReview(null)}>
                  Cancel
                </button>
              </div>
              <p className="v1-hint">The photo stays with the design to look back at. Everything it built can be changed afterwards in the wall drawing and the fields below it.</p>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
