"use client";

import { LogOut, MonitorSmartphone } from "lucide-react";
import { useTransition } from "react";
import { ClayIcon } from "@/components/ClayIcon";
import { clearAllCaches } from "@/lib/pwa/client";

/** The two session rows of «بیشتر»: this device (LogOut, mirrored in RTL) or every device (MonitorSmartphone). */
const MARKS = {
  device: { icon: LogOut, mirror: true },
  devices: { icon: MonitorSmartphone, mirror: false },
} as const;

/**
 * Logout as a list row (a full-width button with a grey clay mark, so the /more lists read as one set) that first
 * empties this origin's Cache Storage (a shared phone must not keep the previous student's shell), then calls the
 * server action, which revokes the session and redirects to /login?out=1 (Clear-Site-Data). `mark` is a string
 * key rather than a component because the page that renders this row is a Server Component.
 */
export function LogoutButton({ action, label, mark = "device" }: { action: () => Promise<never>; label: string; mark?: keyof typeof MARKS }) {
  const [pending, start] = useTransition();
  const m = MARKS[mark];
  return (
    <li>
      <button
        type="button"
        className="pressable flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start text-base text-text first:rounded-t-card last:rounded-b-card hover:bg-surface-sunken disabled:opacity-70"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await clearAllCaches();
            await action();
          })
        }
      >
        <ClayIcon icon={m.icon} shade="grey" mirror={m.mirror} />
        <span>{pending ? "در حال خروج…" : label}</span>
      </button>
    </li>
  );
}

