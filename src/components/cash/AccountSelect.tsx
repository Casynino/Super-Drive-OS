import { inputClass } from "@/components/FormBits";

export type FormAccount = { id: string; name: string; accountNumber: string | null; method: string };

/** A select of the open accounts ("CRDB Bank · 0152841983800"). The account decides the payment method, so nobody picks both. */
export default function AccountSelect({ accounts, id, name = "accountId", defaultValue, error }: { accounts: FormAccount[]; id: string; name?: string; defaultValue?: string; error?: string }) {
  return (
    <select id={id} name={name} defaultValue={defaultValue ?? accounts[0]?.id ?? ""} className={inputClass(error)}>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.accountNumber ? ` · ${a.accountNumber}` : ""}
        </option>
      ))}
    </select>
  );
}
