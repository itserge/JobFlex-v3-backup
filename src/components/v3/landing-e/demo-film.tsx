"use client";

/* THE DEMO FILM IN THE HERO SHOT'S PLACE (2026-10-19) — the HVAC,
   roofing, fencing and deck landings. The landing's first screen with
   its estimator's film where the product shot plays: the same app frame
   (showcase-kit AppFrame), under the line "Real product demo · address to
   proposal in under a minute" (the film's own caption, if it has one).
   THE WHOLE FILM IN THE FIRST SCREEN (2026-10-19): the frame is as wide as
   lets the picture end above the screen's foot — hero.tsx measures where
   the picture starts (data-fit) and the stylesheet does the rest. Which film is the landing's `film`
   (landing-variants); its files are in demo-media.ts.

   The hero renders its visual twice — a phone build under 640 px and a desk
   build from 640 px (hero.tsx), one of them display:none. Each copy gets a
   poster <picture> switched by the same media query, so both ask for the one
   poster this width needs (the first screen's largest paint).

   PLAYING IT EVERYWHERE (2026-10-19). The <video> is in the server's HTML in
   both copies, autoplaying, muted, inline, with its files, so a browser
   plays it even when the page's JavaScript never runs. No `poster` on it:
   the <picture> under it is the poster (a poster attribute would fetch the
   hidden copy's poster too), and a video with no frame yet is transparent.
   While the ▶ waits the video is hidden — paused with data, it would paint
   its first frame over the poster. Each copy's
   <source>s carry that copy's media query: only the copy this width shows
   chooses a file, so one is fetched — the 16:9 cut on a desk, the 4:5 cut on
   a phone. MP4 (H.264) first, WebM (VP9) second, each typed with its codecs:
   Safari takes the first source it says it can play and does not move on
   when it then fails to decode it, so the file every browser decodes leads.
   Once the script runs:
   - a visitor who asked for reduced motion gets the poster and a ▶ — the
     film plays only on a tap;
   - a play() the browser refuses (iOS Low Power Mode, Low Data Mode, an
     autoplay policy) leaves the poster with the same ▶, played from the tap;
   - when no file will play, the poster stays, no ▶, and demo_error goes to
     the tracker with the browser's error and user agent.

   demo_play once it plays, then demo_25 / demo_50 / demo_100 by the film's
   own time — each once per browser session (demo-track). */

import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { AppFrame } from "./showcase-kit";
import { DEMO_CAPTION, DEMO_DESK_MEDIA, DEMO_FILMS, DEMO_PHONE_MEDIA, type DemoFilmKey } from "./demo-media";
import { trackDemoError, trackDemoOnce, type DemoEvent } from "./demo-track";
import "./demo-film.css";

type Pct = 0 | 25 | 50 | 100;
const EVENT: Record<Pct, DemoEvent> = { 0: "demoPlay", 25: "demo25", 50: "demo50", 100: "demo100" };

export function DemoFilm({
  film,
  slot,
  landing,
  hook,
}: {
  film: DemoFilmKey;
  /** Which of the hero's two builds this is: its <source>s match only the width that shows it. */
  slot: "phone" | "desk";
  /** The landing's key ("hvac", "roofing", "fencing"), named on the events. */
  landing: string;
  /** The ad hook the headline shows, for the events. */
  hook?: string;
}) {
  /** The ▶ over the poster: reduced motion, or a refused play(). */
  const [tap, setTap] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef(0);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const desk = window.matchMedia(DEMO_DESK_MEDIA);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    const lastSource = v.querySelector("source:last-of-type");
    let shown = false;
    let dead = false;
    const fail = () => {
      if (!shown || dead) return;
      dead = true;
      setTap(false);
      v.pause();
      const e = v.error;
      trackDemoError(landing, { code: e?.code ?? 0, reason: e ? "media" : "no_source", message: e?.message ?? "", src: v.currentSrc }, hook);
    };
    const start = () => {
      if (dead) return;
      // Muted set on the element itself before play(): an inserted <video>
      // does not always autoplay on iOS from the attribute alone.
      v.muted = true;
      v.play().then(
        () => setTap(false),
        (err: unknown) => {
          // Refused, yet the HTML's autoplay already has it going: no ▶.
          if (dead || !shown || !v.paused) return;
          const name = err instanceof DOMException ? err.name : "";
          // A load() or pause() cut in — not a refusal. No file: fail() has it.
          if (name === "AbortError" || name === "NotSupportedError") return;
          setTap(true);
        },
      );
    };
    const sync = () => {
      const was = shown;
      shown = desk.matches === (slot === "desk");
      if (!shown) {
        v.pause();
        setTap(false);
        return;
      }
      if (v.error) return fail();
      if (still.matches) {
        v.autoplay = false;
        // Back to the poster if the HTML's autoplay already started it.
        if (!v.paused || v.currentTime > 0) v.load();
        else v.pause();
        setTap(true);
        return;
      }
      // A copy that came on screen after its <source>s were passed over (the
      // other width at load), or whose files all failed before this script
      // ran, chooses again — the error listeners now hear the outcome.
      if (!was && v.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) v.load();
      start();
    };
    v.addEventListener("error", fail);
    lastSource?.addEventListener("error", fail);
    sync();
    desk.addEventListener("change", sync);
    still.addEventListener("change", sync);
    return () => {
      v.removeEventListener("error", fail);
      lastSource?.removeEventListener("error", fail);
      desk.removeEventListener("change", sync);
      still.removeEventListener("change", sync);
    };
  }, [slot, landing, hook]);

  const playFromTap = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().then(() => setTap(false), () => {});
  };
  const mark = (pct: Pct) => trackDemoOnce(EVENT[pct], landing, hook);
  const onTime = (v: HTMLVideoElement) => {
    if (!v.duration || !Number.isFinite(v.duration)) return;
    const t = v.currentTime;
    // Back at the start after the end was near: the whole film played.
    if (t < last.current - 1 && last.current / v.duration > 0.9) mark(100);
    last.current = t;
    const p = t / v.duration;
    if (p >= 0.25) mark(25);
    if (p >= 0.5) mark(50);
    if (p >= 0.98) mark(100);
  };
  const f = DEMO_FILMS[film];
  const cut = f[slot];
  const media = slot === "desk" ? DEMO_DESK_MEDIA : DEMO_PHONE_MEDIA;
  return (
    <figure className="lp-film-fig">
      <figcaption className="lp-film-cap">{f.caption ?? DEMO_CAPTION}</figcaption>
      <AppFrame path={f.path} body={f.body}>
        {/* data-fit: the box hero-fit measures — the film's frame is as wide
            as lets this box end inside the first screen (hero.tsx). */}
        <div className="lp-film" data-fit="film">
          <picture>
            <source media={DEMO_DESK_MEDIA} srcSet={f.desk.poster} />
            <img className="lp-film-media" src={f.phone.poster} alt="" fetchPriority="high" decoding="async" />
          </picture>
          <video
            ref={videoRef}
            className={tap ? "lp-film-media lp-film-media--wait" : "lp-film-media"}
            autoPlay
            muted
            playsInline
            loop
            preload="metadata"
            aria-label={f.label}
            onPlaying={() => {
              setTap(false);
              mark(0);
            }}
            onTimeUpdate={(e) => onTime(e.currentTarget)}
          >
            <source src={cut.mp4} type={cut.mp4Type} media={media} />
            <source src={cut.webm} type={cut.webmType} media={media} />
          </video>
          {tap ? (
            <button type="button" className="lp-film-play" onClick={playFromTap} aria-label={`Play the demo: ${f.label}`}>
              <Play aria-hidden size={28} fill="currentColor" strokeWidth={0} />
            </button>
          ) : null}
        </div>
      </AppFrame>
    </figure>
  );
}
