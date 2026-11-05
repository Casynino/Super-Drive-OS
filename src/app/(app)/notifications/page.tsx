import Link from "next/link";
import { Bell } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { markNotificationsRead } from "../sales/reversal-actions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Things that need your attention."
        actions={
          unread > 0 && (
            <form action={markNotificationsRead}>
              <button type="submit" className="btn-secondary">
                Mark all as read
              </button>
            </form>
          )
        }
      />
      <div className="card overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={<Bell size={22} />} title="No notifications yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((n) => {
              const inner = (
                <>
                  <span className="flex items-start gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-brand-red"}`} aria-label={n.readAt ? "Read" : "Unread"} />
                    <span className="min-w-0">
                      <span className={`block text-sm ${n.readAt ? "text-slate-700" : "font-semibold text-slate-900"}`}>{n.title}</span>
                      {n.body && <span className="block truncate text-sm text-slate-500">{n.body}</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                </>
              );
              return (
                <li key={n.id}>
                  {n.link ? (
                    <Link href={n.link} className="flex items-start justify-between gap-3 px-5 py-3.5 hover:bg-slate-50">
                      {inner}
                    </Link>
                  ) : (
                    <div className="flex items-start justify-between gap-3 px-5 py-3.5">{inner}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
