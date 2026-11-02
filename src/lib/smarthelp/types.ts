// SmartHelp shared types. Pure: no server-only, no db — client and server both import this.

export type SetupKey =
  | "profile"
  | "aiDesk"
  | "texting"
  | "payments"
  | "booking"
  | "website"
  | "team"
  | "proposalSent";

export type SetupState = Record<SetupKey, boolean>;

/** `open` is an app path (may carry ?query / #hash); `show` is a `data-tour` target name. */
export type HelpStep = { text: string; open?: string; show?: string };

export type Guide = {
  id: string;
  title: string;
  group: "setup" | "how";
  /** lucide-react export name */
  icon: string;
  steps: HelpStep[];
  needs?: SetupKey;
  feature?: "booking" | "website";
};

export type HelpContext = {
  role: string | null;
  plan: string | null;
  lockedHrefs: string[];
  setup: SetupState;
  features: { booking: boolean; website: boolean };
  page: string;
};

export type GuideCard = {
  id: string;
  title: string;
  group: "setup" | "how";
  icon: string;
  state: "todo" | "done" | "none";
};

export type StepView = HelpStep & { blocked?: "role" | "plan" };
