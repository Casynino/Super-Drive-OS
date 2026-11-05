import Image from "next/image";
import AppShell from "@/components/AppShell";
import { NAV } from "@/components/nav";
import { canAny } from "@/lib/auth/can";
import { requireUser } from "@/lib/auth/guard";
import { logout } from "@/lib/auth/actions";
import { db } from "@/lib/db";
import { getBusinessName } from "@/lib/settings";
import ChangePasswordForm from "./account/ChangePasswordForm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // First sign-in after a password reset: nothing else is reachable until a new password is set.
  if (user.mustChangePassword) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Image src="/brand/logo-full.png" alt="Super Drive Oil" width={900} height={456} className="mx-auto mb-6 h-16 w-auto" />
          <h1 className="text-xl font-semibold text-slate-900">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-500">You must choose your own password before continuing.</p>
          <ChangePasswordForm />
        </div>
      </div>
    );
  }

  const visibleHrefs = NAV.flatMap((g) => g.items)
    .filter((i) => i.ready && (i.permissions.length === 0 || canAny(user, i.permissions)))
    .map((i) => i.href);

  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });

  return (
    <AppShell
      businessName={await getBusinessName()}
      user={{ name: user.name, roleName: user.roleName }}
      visibleHrefs={visibleHrefs}
      logoutAction={logout}
      unread={unread}
    >
      {children}
    </AppShell>
  );
}
