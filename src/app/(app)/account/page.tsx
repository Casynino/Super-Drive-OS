import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/guard";
import ChangePasswordForm from "./ChangePasswordForm";

export const metadata = { title: "My account" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="My account" description={`${user.name} · ${user.roleName} · @${user.username}`} />
      <div className="card card-pad max-w-md">
        <h2 className="text-base font-semibold text-slate-900">Change password</h2>
        <p className="mt-1 text-sm text-slate-500">You will be signed out of other devices.</p>
        <ChangePasswordForm />
      </div>
    </>
  );
}
