// WHAT A SIGNED-IN LAYOUT MOUNTS FOR THE TRIAL WATCH (2026-09-24).
//
// Both signed-in layouts mount the page-view beacon. It ran only in a
// company's first WATCH_DAYS until 2026-11-04; now it runs for every company
// and actions/pageView decides what is kept (every screen in the first weeks,
// then each screen once a quarter hour — the investors' usage chart counts a
// member who is signed in). The diagonal trial watermark is no longer mounted.

import { PageViewBeacon } from "./page-view-beacon";

export function TrialWatchMount() {
  return <PageViewBeacon />;
}
