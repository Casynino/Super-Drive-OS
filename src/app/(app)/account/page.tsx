import { PageHeader } from "@/components/ui";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { formatDate, formatDateTime } from "@/lib/utils";
import ChangePasswordForm from "./ChangePasswordForm";
import ProfileForm from "./ProfileForm";

export const metadata = { title: "My profile" };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");

/** "sale.post" → "Sale post" (plain wording for the activity list). */
const activityLabel = (action: string) => {
  const s = action.replace(/[._]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export default async function AccountPage() {
  const session = await requireUser();
  const [me, activity, devices] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: session.id }, select: { name: true, email: true, phone: true, lastLoginAt: true, createdAt: true } }),
    db.auditLog.findMany({ where: { userId: session.id }, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, reference: true, createdAt: true } }),
    db.session.count({ where: { userId: session.id, expiresAt: { gt: new Date() } } }),
  ]);

  const facts = [
    { label: "Sign-in email", value: me.email },
    { label: "Role", value: session.roleName },
    { label: "Last sign-in", value: me.lastLoginAt ? formatDateTime(me.lastLoginAt) : "—" },
    { label: "Member since", value: formatDate(me.createdAt) },
    { label: "Signed in on", value: `${devices} ${devices === 1 ? "device" : "devices"}` },
  ];

  return (
    <>
      <PageHeader title="My profile" description="Your details, password and what you did lately." />

      <div className="card mb-6 overflow-hidden">
        <div className="h-16 bg-navy-700" />
        <div className="flex flex-col gap-5 px-5 pb-5 sm:flex-row sm:items-end sm:gap-6 sm:px-6">
          <span className="-mt-9 flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full border-4 border-[var(--card)] bg-navy-700 text-2xl font-semibold text-white" aria-hidden>
            {initials(me.name)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold text-slate-900">{me.name}</h2>
            <p className="truncate text-sm text-slate-500">
              {session.roleName} · {me.email}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line px-5 py-4 sm:px-6 lg:grid-cols-5">
          {facts.map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{f.label}</dt>
              <dd className="mt-1 truncate text-sm text-slate-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="card card-pad">
            <h2 className="text-base font-semibold text-slate-900">My details</h2>
            <p className="mt-1 text-sm text-slate-500">Your name appears on sales, receipts and reports. Your email is how you sign in; your role is set by the owner.</p>
            <ProfileForm name={me.name} email={me.email ?? ""} phone={me.phone ?? ""} />
          </div>

          <div className="card card-pad">
            <h2 className="text-base font-semibold text-slate-900">Recent activity</h2>
            {activity.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Nothing recorded yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-slate-800">
                      {activityLabel(a.action)}
                      {a.reference && <span className="ml-2 text-slate-500">{a.reference}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div id="password" className="card card-pad scroll-mt-24">
          <h2 className="text-base font-semibold text-slate-900">Change password</h2>
          <p className="mt-1 text-sm text-slate-500">You will be signed out of other devices.</p>
          <ChangePasswordForm />
        </div>
      </div>
    </>
  );
}
