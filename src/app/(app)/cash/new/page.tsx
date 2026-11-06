import { PageHeader } from "@/components/ui";
import { AddAccountForm } from "@/components/cash/AccountAdmin";
import { requirePagePermission } from "@/lib/auth/guard";

export const metadata = { title: "Add an account" };

export default async function NewCashAccountPage() {
  await requirePagePermission("cash.adjust");
  return (
    <>
      <PageHeader title="Add an account" back={{ href: "/cash", label: "Accounts" }} description="A bank account, M-PESA, a Lipa number, Airtel Money... Once it exists it can be chosen when selling, collecting a debt, paying an expense or a supplier. Its balance is the total of the money recorded in it." />
      <div className="card card-pad max-w-2xl">
        <AddAccountForm />
        <p className="mt-4 text-xs text-slate-500">If money is already in the account, open it after adding and record the opening balance.</p>
      </div>
    </>
  );
}
