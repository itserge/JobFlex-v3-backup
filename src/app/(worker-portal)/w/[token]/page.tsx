import { notFound, redirect } from "next/navigation";
import type { Route } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/Badge";
import { WorkerPortalHeader } from "@/components/workers/WorkerPortalHeader";
import { WorkerInviteContent } from "@/components/v3/worker-invite-blueprint/worker-invite-content";
import { JobResponseCard } from "./job-response";
import { TodayActions } from "./today-actions";
import { jobProgressInfo } from "@/lib/jobProgress";
import { crewHome } from "@/lib/crewField/server";
import { hoursWords } from "@/lib/crewField/shared";
import { longDate, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ChevronRight } from "lucide-react";

export default async function WorkerDashboard({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const worker = await db.workerProfile.findUnique({
    where: { token },
    include: {
      organization: { select: { name: true } },
      user: { select: { id: true, email: true, hashedPassword: true } },
      assignments: {
        include: {
          job: {
            select: {
              id: true,
              title: true,
              status: true,
              startsAt: true,
              endsAt: true,
              client: { select: { name: true, address: true } },
            },
          },
        },
        orderBy: { job: { startsAt: "asc" } },
      },
    },
  });
  if (!worker) return notFound();

  // Role lives on the membership; surface the real one on the invite card.
  const membership = await db.membership.findUnique({
    where: {
      userId_organizationId: { userId: worker.userId, organizationId: worker.organizationId },
    },
    select: { role: true },
  });
  const role = membership?.role ?? "INSTALLER";

  // ── Invite gate ──────────────────────────────────────────────────────────
  // The magic link is the invite link until the worker responds. Both branches
  // are the one blueprint landing page (the layout renders it without the
  // portal chrome); the declined state is a stage of it, not a separate card.
  if (worker.inviteStatus === "PENDING" || worker.inviteStatus === "DECLINED") {
    return (
      <WorkerInviteContent
        token={token}
        orgName={worker.organization?.name ?? "the team"}
        workerName={worker.displayName}
        email={worker.user?.email ?? ""}
        role={role}
        alreadyDeclined={worker.inviteStatus === "DECLINED"}
      />
    );
  }
  // ACCEPTED with a real password → the magic link becomes the dashboard link.
  // Legacy passwordless workers keep this token portal so they're never locked out.
  if (worker.user?.hashedPassword) {
    // ?offers=1: the jobs page's offers popup opens itself on arrival, so the
    // email's "Confirm or decline" click lands on the actual controls instead
    // of a bare jobs list (the dead-click bug, 2026-08-21).
    const session = await auth();
    if (session?.user?.id === worker.userId) redirect("/dashboard/jobs?offers=1");
    redirect(`/auth/login?next=${encodeURIComponent("/dashboard/jobs?offers=1")}`);
  }

  const now = new Date();
  // Jobs the office is waiting on — surfaced first, above the schedule.
  const needsResponse = worker.assignments.filter(
    (a) => a.status === "PENDING" && a.job.status !== "CANCELED",
  );
  const today = worker.assignments.filter(
    (a) =>
      a.status !== "PENDING" &&
      a.status !== "DECLINED" &&
      a.job.startsAt &&
      sameDay(a.job.startsAt, now),
  );
  const upcoming = worker.assignments.filter(
    (a) =>
      a.status !== "PENDING" &&
      a.status !== "DECLINED" &&
      a.job.startsAt &&
      a.job.startsAt > now &&
      !sameDay(a.job.startsAt, now),
  );
  const past = worker.assignments.filter(
    (a) =>
      a.status === "COMPLETED" ||
      (a.status !== "PENDING" &&
        a.job.startsAt &&
        a.job.startsAt < now &&
        !sameDay(a.job.startsAt, now)),
  );

  // The crew's own day (the crew build, 2026-11-05): the stage's tasks on today's jobs, who else is on them,
  // the week's hours.
  const home = await crewHome(
    worker.organizationId,
    worker.id,
    today.map((a) => ({ jobId: a.job.id, assignmentId: a.id, title: a.job.title })),
  );

  // The portal's header and column, moved here from the layout (stage C): the
  // job page is the blueprint job page now and brings its own bar.
  return (
    <div className="min-h-dvh bg-[color:var(--paper)]">
      <WorkerPortalHeader workerName={worker.displayName} orgName={worker.organization?.name} />
      <main className="max-w-[720px] mx-auto px-5 py-8">
      <div className="quiet-caps mb-2">Your jobs</div>
      <h1 className="font-display text-[34px] tracking-[-0.02em] leading-[1.05]">
        Hi, {worker.displayName.split(" ")[0]}.
      </h1>
      <p className="mt-2 text-[14px] text-[color:var(--ink-muted)]">
        Confirm the jobs sent your way, get directions, start and finish the work, and send photos of it — no login needed.
      </p>

      {needsResponse.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="quiet-caps">Needs your response</span>
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">
              {needsResponse.length}
            </span>
          </div>
          <div className="space-y-2.5">
            {needsResponse.map((a) => (
              <JobResponseCard
                key={a.id}
                token={token}
                job={{
                  id: a.id,
                  title: a.job.title,
                  clientName: a.job.client?.name ?? null,
                  startsAt: a.job.startsAt,
                }}
              />
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="quiet-caps mb-3">Today</div>
        {today.length === 0 ? (
          <p className="paper-card p-5 text-[12px] text-[color:var(--ink-muted)]">
            Nothing on your plate today. Enjoy.
          </p>
        ) : (
          <div className="space-y-2.5">
            {await Promise.all(
              today.map(async (a) => (
                <AssignmentCard
                  key={a.id}
                  a={a}
                  token={token}
                  mates={home.withMe[a.job.id] ?? []}
                  actions={
                    a.status !== "PENDING" && a.job.status !== "CANCELED" ? (
                      <TodayActions token={token} jobId={a.job.id} status={a.job.status} progress={await jobProgressInfo(worker.organizationId, a.job.id)} />
                    ) : null
                  }
                />
              )),
            )}
          </div>
        )}
      </section>

      {home.tasks.length > 0 && (
        <section className="mt-8" data-crew-tasks>
          <div className="quiet-caps mb-3">My tasks today</div>
          <div className="space-y-2.5">
            {home.tasks.map((t) => (
              <Link key={t.jobId} href={`/w/${token}/jobs/${t.assignmentId}` as Route} className="block paper-card p-4 transition-all hover:shadow-pop hover:-translate-y-0.5">
                <div className="text-[12px] text-[color:var(--ink-muted)]">
                  {t.jobTitle} · <b className="text-[color:var(--ink)]">{t.stage}</b>
                </div>
                {t.tasks.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {t.tasks.map((x) => (
                      <li key={x.id} className="flex items-start gap-2 text-[14px]">
                        <span className="mt-[3px] inline-block h-4 w-4 shrink-0 rounded-[3px] border-[1.5px] border-[color:var(--ink)]" aria-hidden="true" />
                        <span>
                          {x.title}
                          {x.photoNeeded ? <span className="quiet-caps ml-2 text-[color:var(--amber)]">photo</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-[13px] text-[color:var(--ink-muted)]">Nothing left on this stage — tell the office it is done.</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8" data-crew-week>
        <div className="quiet-caps mb-3">My week</div>
        <div className="paper-card flex flex-wrap gap-6 p-4">
          <div>
            <div className="font-display text-[26px] leading-none tabular">{hoursWords(home.week.hours)}</div>
            <div className="mt-1 text-[12px] text-[color:var(--ink-muted)]">hours logged this week</div>
          </div>
          <div>
            <div className="font-display text-[26px] leading-none tabular">{home.week.days}</div>
            <div className="mt-1 text-[12px] text-[color:var(--ink-muted)]">{home.week.days === 1 ? "day on site" : "days on site"}</div>
          </div>
          {home.problemsOpen > 0 && (
            <div>
              <div className="font-display text-[26px] leading-none tabular text-[color:var(--rose)]">{home.problemsOpen}</div>
              <div className="mt-1 text-[12px] text-[color:var(--ink-muted)]">{home.problemsOpen === 1 ? "problem you flagged, still open" : "problems you flagged, still open"}</div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <div className="quiet-caps mb-3">Upcoming</div>
        {upcoming.length === 0 ? (
          <p className="text-[12px] text-[color:var(--ink-muted)]">No upcoming jobs scheduled yet.</p>
        ) : (
          <div className="space-y-2.5">
            {upcoming.map((a) => (
              <AssignmentCard key={a.id} a={a} token={token} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="mt-8">
          <div className="quiet-caps mb-3">Completed / past</div>
          <div className="space-y-2.5">
            {past.slice(0, 8).map((a) => (
              <AssignmentCard key={a.id} a={a} token={token} muted />
            ))}
          </div>
        </section>
      )}
      </main>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function AssignmentCard({
  a,
  token,
  muted,
  actions,
  mates,
}: {
  a: {
    id: string;
    status: string;
    job: {
      title: string;
      status: string;
      startsAt: Date | null;
      client: { name: string; address: string | null } | null;
    };
  };
  token: string;
  muted?: boolean;
  /** Today's one-tap Start / Back on site / Complete row (2026-09-27). */
  actions?: React.ReactNode;
  /** Who else is on the job today (2026-11-05). */
  mates?: string[];
}) {
  const start = a.job.startsAt;
  const [mon, day] = start ? shortDate(start).split(" ") : ["—", ""];
  return (
    <Link
      href={`/w/${token}/jobs/${a.id}` as Route}
      className={cn(
        "group flex flex-wrap items-center gap-3.5 paper-card p-3.5 transition-all hover:shadow-pop hover:-translate-y-0.5",
        muted && "opacity-70",
      )}
    >
      <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[var(--r-md)] bg-[color:var(--ink)] text-white">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-white/60">
          {mon}
        </span>
        <span className="font-display text-[20px] leading-none tabular">{day || "—"}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-semibold text-[color:var(--ink)]">
          {a.job.title}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-[color:var(--ink-muted)]">
          {a.job.client?.name ?? ""}
          {a.job.client?.address ? ` · ${a.job.client.address}` : ""}
        </div>
        {start && (
          <div className="mt-0.5 text-[11px] tabular text-[color:var(--ink-faint)]">
            {longDate(start)}
          </div>
        )}
        {mates && mates.length > 0 && (
          <div className="mt-0.5 text-[12px] text-[color:var(--ink-muted)]" data-with-me>
            With you: {mates.join(", ")}
          </div>
        )}
      </div>
      <Badge
        tone={
          a.status === "ACCEPTED"
            ? "success"
            : a.status === "DECLINED"
              ? "danger"
              : a.status === "COMPLETED"
                ? "neutral"
                : "accent"
        }
      >
        {a.status.toLowerCase()}
      </Badge>
      <ChevronRight className="h-4 w-4 shrink-0 text-[color:var(--ink-faint)]" />
      {actions ? <div className="basis-full">{actions}</div> : null}
    </Link>
  );
}
