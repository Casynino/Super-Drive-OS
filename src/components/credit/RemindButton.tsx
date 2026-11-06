"use client";

import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { logReminderAction } from "@/app/(app)/credit/actions";
import { cn } from "@/lib/utils";

/**
 * Opens WhatsApp with the payment reminder already written; the person presses Send there.
 * A link (not a script popup), so browsers never block it. When pressed it also records the reminder.
 */
export default function RemindButton({ href, customerId, saleIds, lastText, className, label = "Remind" }: { href: string | null; customerId: string; saleIds: string[]; lastText?: string | null; className?: string; label?: string }) {
  const router = useRouter();
  if (!href) {
    return (
      <span className="text-xs text-slate-400" title="Add a phone number to the customer to send reminders">
        No WhatsApp number
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => {
          void logReminderAction(customerId, saleIds)
            .then(() => router.refresh())
            .catch(() => {});
        }}
        className={cn("btn-secondary !px-3 !py-1.5 text-sm", className)}
        title="Opens WhatsApp with the reminder already written"
      >
        <MessageCircle size={14} /> {label}
      </a>
      {lastText && <span className="text-[11px] text-slate-500">{lastText}</span>}
    </span>
  );
}
