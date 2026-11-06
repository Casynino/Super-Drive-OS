"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui";
import EntityForm from "@/components/EntityForm";
import type { ActionState } from "@/lib/action";
import { accountOpAction, saveCashAccount } from "@/app/(app)/cash/account-actions";

const TYPES = [
  { value: "MOBILE_MONEY", label: "Mobile money (M-PESA, Lipa number, Airtel Money...)" },
  { value: "BANK", label: "Bank account (CRDB, NMB...)" },
];

/** The form to add a mobile-money or bank account. */
export function AddAccountForm() {
  return (
    <EntityForm
      action={saveCashAccount}
      submitLabel="Add account"
      fields={[
        { name: "method", label: "Type", type: "select", options: TYPES, value: "BANK" },
        { name: "name", label: "Name people recognise", placeholder: "e.g. CRDB Bank", required: true },
        { name: "accountNumber", label: "Account number", placeholder: "e.g. 0152841983800", hint: "A bank account number, a mobile-money number or a Lipa number." },
        { name: "holderName", label: "Registered in the name of", placeholder: "e.g. ABEL JACOB KIJYOMBO" },
      ]}
    />
  );
}

/** Change the name, number or holder of one account. */
export function EditAccountForm({ id, name, accountNumber, holderName }: { id: string; name: string; accountNumber: string | null; holderName: string | null }) {
  return (
    <EntityForm
      action={saveCashAccount}
      submitLabel="Save"
      hidden={{ id }}
      fields={[
        { name: "name", label: "Name", value: name, required: true },
        { name: "accountNumber", label: "Account number", value: accountNumber ?? "" },
        { name: "holderName", label: "Registered in the name of", value: holderName ?? "" },
      ]}
    />
  );
}

/** Close, open again, or make main: one small button with its own message. */
export function AccountOpButton({ id, op, children, danger }: { id: string; op: "close" | "reopen" | "default"; children: React.ReactNode; danger?: boolean }) {
  const [state, action, pending] = useActionState(accountOpAction, {} as ActionState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" value={op} />
      <button type="submit" disabled={pending} className={danger ? "btn-danger btn-sm" : "btn-secondary btn-sm"}>
        {pending ? "Please wait…" : children}
      </button>
      {state.error && <Alert>{state.error}</Alert>}
    </form>
  );
}
