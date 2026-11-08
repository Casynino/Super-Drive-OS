import BrandLogo from "@/components/BrandLogo";
import AppShell from "@/components/AppShell";
import { NAV } from "@/components/nav";
import { can, canAny } from "@/lib/auth/can";
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
          <BrandLogo className="mx-auto mb-6 h-16" />
          <h1 className="text-xl font-semibold text-slate-900">Set a new password</h1>
          <p className="mt-1 text-sm text-slate-500">You must choose your own password before continuing.</p>
          <ChangePasswordForm />
        </div>
      </div>
    );
  }

  // The shop attendant's home is the POS, so "Home" is not in their menu (POS and Overview are)
  const sellerOnly = can(user, "sales.pos") && !can(user, "dashboard.view");
  const visibleHrefs = NAV.flatMap((g) => g.items)
    .filter((i) => i.ready && (i.permissions.length === 0 || canAny(user, i.permissions)) && !(i.hideIfAny && canAny(user, i.hideIfAny)) && !(i.onlyIf && !canAny(user, i.onlyIf)) && !(sellerOnly && i.href === "/dashboard"))
    .map((i) => i.href);

  // Items hidden for this person even though another item with the same page is shown (the Stock group's "Orders" and the Warehouse group's "Receiving" are the same page)
  // keyed by group too: the same page can be listed in two groups (Products: under Stock for most people, under Warehouse for the warehouse person)
  const hiddenItems = NAV.flatMap((g) => g.items.map((i) => ({ g, i })))
    .filter(({ i }) => (i.hideIfAny && canAny(user, i.hideIfAny)) || (i.onlyIf && !canAny(user, i.onlyIf)))
    .map(({ g, i }) => `${g.label}|${i.href}|${i.label}`);

  // Counts beside the menu items that need someone to act
  const [unread, shipmentsToCount, shipmentIssues] = await Promise.all([
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    can(user, "shipments.receive") ? db.shipment.count({ where: { status: { in: ["EXPECTED", "PARTIAL"] }, arrivedAt: { not: null } } }) : 0,
    can(user, "shipments.manage") ? db.shipment.count({ where: { issue: "OPEN" } }) : 0,
  ]);
  const badges = { approvals: 0, incoming: can(user, "shipments.receive") ? shipmentsToCount : shipmentIssues };

  return (
    <AppShell
      businessName={await getBusinessName()}
      user={{ name: user.name, roleName: user.roleName }}
      visibleHrefs={visibleHrefs}
      hiddenItems={hiddenItems}
      logoutAction={logout}
      unread={unread}
      badges={badges}
      labels={
        // names that fit the shop person's work (the Director keeps "Closing" and the stock "Overview")
        can(user, "closing.submit") || sellerOnly ? { ...(can(user, "closing.submit") ? { "/closing": "Close & deposit" } : {}), ...(sellerOnly ? { "/inventory": "Stock", "/pos": "Home" } : {}) } : undefined
      }
    >
      {children}
    </AppShell>
  );
}
