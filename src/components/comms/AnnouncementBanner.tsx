"use client";
import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Megaphone } from "lucide-react";
import styles from "./AnnouncementBanner.module.css";

export interface Announcement {
  id: string;
  title: string;
  body: string;
  priority: number; // 0 normal, 1 warn, 2 high
  createdAt: Date | string;
  expiresAt?: Date | string | null;
}

interface AnnouncementBannerProps {
  announcements: Announcement[];
  onDismiss?: (id: string) => Promise<void> | void;
}

export function AnnouncementBanner({ announcements, onDismiss }: AnnouncementBannerProps) {
  const [expanded, setExpanded] = React.useState(false);
  const sorted = React.useMemo(
    () => [...announcements].sort((a, b) => b.priority - a.priority),
    [announcements],
  );
  if (sorted.length === 0) return null;
  const [primary, ...rest] = sorted;

  return (
    <div className={styles.root} data-nest data-announcement>
      <AnnouncementRow a={primary} onDismiss={onDismiss} />
      {rest.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setExpanded((x) => !x)}
            type="button"
            aria-expanded={expanded}
            className={styles.more}
          >
            <span className="h-1 w-1 rounded-full bg-[color:var(--ink-faint)]" />
            +{rest.length} more announcement{rest.length === 1 ? "" : "s"}
          </button>
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="mt-2 space-y-2"
              >
                {rest.map((a) => (
                  <AnnouncementRow key={a.id} a={a} onDismiss={onDismiss} />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function AnnouncementRow({
  a,
  onDismiss,
}: {
  a: Announcement;
  onDismiss?: (id: string) => Promise<void> | void;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div
      className={styles.card}
      data-priority={a.priority >= 2 ? "high" : a.priority === 1 ? "warn" : "normal"}
    >
      <Megaphone
        className={styles.icon}
        aria-hidden="true"
      />
      <div className={styles.copy}>
        <p className={styles.title}>{a.title}</p>
        <p className={styles.body}>{a.body}</p>
      </div>
      {onDismiss && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onDismiss(a.id);
            } finally {
              setBusy(false);
            }
          }}
          type="button"
          className={styles.dismiss}
          aria-label={`Dismiss ${a.title}`}
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
