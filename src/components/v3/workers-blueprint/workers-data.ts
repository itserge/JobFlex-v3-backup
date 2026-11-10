// Workers blueprint — the donor's embedded demo data, hardcoded exactly as
// authored in jobflex-workers-blueprint.html (the `WORKER_ROLES`, `wkSeq` and
// `workersData` literals from its <script>). Same architecture as
// proposals-data.ts: the page renders from this seed, and the behavior module
// clones it per mount so runtime edits (invite / edit / remove) never leak
// between navigations.

export type WorkerRoleValue = "INSTALLER" | "SALES" | "ESTIMATOR" | "MANAGER";
export type InviteStatus = "PENDING" | "ACCEPTED" | "DECLINED";

export type WorkerRoleOption = { value: WorkerRoleValue; label: string };

export type WorkerJob = { id: string; title: string };

/** LedgerEntry: folio, name, email, phone, specialties, hourlyRate, token,
 *  inviteStatus (PENDING | ACCEPTED | DECLINED), role, joinedISO, activeJobs. */
export type WorkerEntry = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Texts their schedule to that phone (2026-09-24). */
  sms?: boolean;
  specialties: string[];
  rate: number | null;
  /** Pay on this worker's jobs, all of it and the part not yet marked paid (2026-09-20). */
  earned?: number;
  unpaid?: number;
  /** Come-backs over the last year (2026-11-09, lib/repairs/server crewComebackStats): repairs on their work (only
   *  "our work" counts), what those cost, and the repairs they were sent on. */
  comebacks?: { count: number; cost: number; sentOn: number };
  /** The login behind the profile — what the sales commission is set on (2026-11-10, part 4). */
  userId?: string;
  /** Sales commission (2026-11-10): their percent, and what they have earned of the whole on their sold deals —
   *  earned as the client's money is collected, before tax. */
  commission?: { pct: number | null; earned: number; full: number; deals: number };
  token: string;
  invite: InviteStatus;
  role: string;
  joined: string;
  /** "Active 2h ago" / "Never" — the later of WorkerProfile.lastSeenAt and
   *  their newest ActivityEvent (2026-09-24). Null when unknown. */
  lastActive: string | null;
  jobs: WorkerJob[];
};

/** "Active 2h ago" / "Active Mar 3" / "Never" — the roster's last-active plate. */
export function lastActiveLabel(d: Date | null | undefined): string {
  if (!d) return "Never";
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 60) return "Active just now";
  if (s < 3600) return `Active ${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `Active ${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `Active ${Math.floor(s / 86400)}d ago`;
  return `Active ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/** The later of two optional dates. */
export function laterOf(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

export const WORKER_ROLES: WorkerRoleOption[] = [
  { value: "INSTALLER", label: "Installer" }, { value: "SALES", label: "Sales" },
  { value: "ESTIMATOR", label: "Estimator" }, { value: "MANAGER", label: "Manager" },
];

/** Donor: `let wkSeq = 10;` — new ids continue from w11. */
export const WK_SEQ_START = 10;

export const WORKERS_SEED: WorkerEntry[] = [
  { id: 'w1', name: 'Marcus Bell',   email: 'marcus@bellroofing.com', phone: '(425) 555-0141', specialties: ['Roofing', 'Fencing'], rate: 42, token: 'wk_8f2a41', invite: 'ACCEPTED', role: 'INSTALLER', joined: 'Mar 2024', lastActive: null,
    jobs: [{ id: 'j1', title: 'Roof tear-off — 4812 Maple Ave' }, { id: 'j4', title: 'Asphalt reroof — Henderson' }, { id: 'j5', title: 'Cedar fence — 902 Alder Ct' }] },
  { id: 'w2', name: 'Sofia Ramos',   email: 'sofia@bellroofing.com',  phone: '(425) 555-0152', specialties: ['Estimating', 'Decking'], rate: 38, token: 'wk_1c77b0', invite: 'ACCEPTED', role: 'ESTIMATOR', joined: 'Jun 2024', lastActive: null,
    jobs: [] },
  { id: 'w3', name: 'Dan Kowalski',  email: 'dan.k@bellroofing.com',  phone: '(425) 555-0163', specialties: ['Gutters', 'Roofing'], rate: 36, token: 'wk_59de23', invite: 'ACCEPTED', role: 'INSTALLER', joined: 'Sep 2024', lastActive: null,
    jobs: [{ id: 'j2', title: 'Dumpster swap — Maple Ave' }, { id: 'j6', title: 'Skylight install — 210 Fir St' }] },
  { id: 'w4', name: 'Ivan Petrov',   email: 'ivan@bellroofing.com',   phone: '(425) 555-0100', specialties: ['Roofing', 'Siding', 'Decking'], rate: null, token: 'wk_0a3f77', invite: 'ACCEPTED', role: 'MANAGER', joined: 'Jan 2023', lastActive: null,
    jobs: [{ id: 'j4', title: 'Asphalt reroof — Henderson' }] },
  { id: 'w5', name: 'Tyler Brooks',  email: 'tyler.brooks@mail.com',  phone: '(425) 555-0188', specialties: ['Fencing'], rate: 34, token: 'wk_b41e09', invite: 'PENDING', role: 'INSTALLER', joined: 'Jul 2026', lastActive: null, jobs: [] },
  { id: 'w6', name: 'Amara Cole',    email: null,                     phone: '(425) 555-0195', specialties: [], rate: null, token: 'wk_77c2ab', invite: 'PENDING', role: 'SALES', joined: 'Jul 2026', lastActive: null, jobs: [] },
  { id: 'w7', name: 'Grant Mueller', email: 'grant.m@mail.com',       phone: null,             specialties: ['Siding'], rate: 30, token: 'wk_e6d105', invite: 'DECLINED', role: 'INSTALLER', joined: 'May 2026', lastActive: null, jobs: [] },
];
