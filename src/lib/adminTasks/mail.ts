// ADMIN TASKS — sending the notices a write produced (2026-10-11).
// SERVER ONLY. The service decides who hears of what (lib/adminTasks/model:
// never the person who made the change, never the console's shared address);
// this turns each notice into the shared email and sends it with reply-to
// support. A failed send is logged and never fails the write.

import { renderEmail } from "@/lib/email/renderEmail";
import { buildTaskAssigned, buildTaskClosed } from "@/lib/email/build/adminTasks";
import { sendEmail } from "@/lib/sdk/resend";
import { taskPath, taskRef } from "./model";
import type { TaskNotice } from "./service";

export async function sendTaskNotices(notices: TaskNotice[], baseUrl: string): Promise<void> {
  const base = baseUrl.replace(/\/$/, "");
  for (const n of notices) {
    const href = `${base}${taskPath(n.task.id)}`;
    const ref = taskRef(n.task.id);
    const doc =
      n.kind === "assigned"
        ? buildTaskAssigned({ title: n.task.title, by: n.by, priority: n.task.priority, dueDate: n.task.dueDate, description: n.task.description, href, ref })
        : buildTaskClosed({ title: n.task.title, by: n.by, status: n.task.status, href, ref });
    try {
      const { subject, html, text } = renderEmail(doc);
      await sendEmail({ mailClass: "transactional", to: n.to.email, subject, html, text, replyTo: "support@jobflex.app" });
    } catch (err) {
      console.warn(`[adminTasks] ${n.kind} notice to ${n.to.email} not sent:`, err instanceof Error ? err.message : err);
    }
  }
}
