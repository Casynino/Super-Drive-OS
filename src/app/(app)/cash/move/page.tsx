import { randomUUID } from "node:crypto";
import MoveMoneyForm from "@/components/cash/MoveMoneyForm";
import { PageHeader } from "@/components/ui";
import { requirePagePermission } from "@/lib/auth/guard";
import { defaultLocationId, getAccountBalances } from "@/lib/cash/ledger";
import { db } from "@/lib/db";
import { getCurrency } from "@/lib/settings";
import { moveMoneyAction } from "../move-actions";

export const metadata = { title: "Move money" };

/** Move money from one of the shop's accounts to another (owner). */
export default async function MoveMoneyPage() {
  await requirePagePermission("cash.adjust");
  const currency = await getCurrency();
  const accounts = (await getAccountBalances(db, await defaultLocationId(db))).filter((a) => a.status === "ACTIVE");
  return (
    <>
      <PageHeader title="Move money" description="From one account to another." back={{ href: "/cash", label: "Accounts" }} />
      <div className="card card-pad max-w-3xl">
        <MoveMoneyForm action={moveMoneyAction} accounts={accounts.map((a) => ({ id: a.id, name: a.name, accountNumber: a.accountNumber, method: a.method, balance: Number(a.balance.toString()) }))} symbol={currency.symbol} submissionKey={randomUUID()} />
      </div>
    </>
  );
}
