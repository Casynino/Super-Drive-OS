import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/lib/db";
import { cn } from "@/lib/utils";

/**
 * A small notifications bell with the unread count, for the banners at the top of the home pages (there is no top bar on a computer or
 * tablet any more). On a phone the phone top bar already has the bell, so this one only shows from `lg`. The caller gives it its position
 * and size (it must be `relative` or `absolute` so the count badge sits on it); `cn` here does not merge conflicting classes.
 */
export async function BannerBell({ userId, className }: { userId: string; className?: string }) {
  const unread = await db.notification.count({ where: { userId, readAt: null } });
  return (
    <Link href="/notifications" title={unread > 0 ? `Notifications (${unread} new)` : "Notifications"} className={cn("hidden place-items-center text-white/65 transition hover:text-white lg:inline-grid", className)}>
      <Bell size={15} />
      <span className="sr-only">Notifications{unread > 0 ? `, ${unread} unread` : ""}</span>
      {unread > 0 && <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-red px-1 text-[10px] font-bold leading-none text-white">{unread > 9 ? "9+" : unread}</span>}
    </Link>
  );
}

/** Today's date, small, in the shop's time zone. */
export function bannerDate() {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
}
