"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/Modal";

export type RegisterForm = { name: string; phone: string; idNumber: string; place: string; business: string; type: string };

const TYPES = [
  ["RETAIL", "Retail"],
  ["WHOLESALE", "Wholesale"],
  ["DISTRIBUTOR", "Distributor"],
  ["BUSINESS", "Business"],
  ["OTHER", "Other"],
] as const;

function Form({ kind, onClose, onSave }: { kind: "winga" | "credit"; onClose: () => void; onSave: (f: RegisterForm) => Promise<string | null> }) {
  const [f, setF] = useState<RegisterForm>({ name: "", phone: "", idNumber: "", place: "", business: "", type: "RETAIL" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof RegisterForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const winga = kind === "winga";

  async function save() {
    setError(null);
    if (f.name.trim().length < 2) return setError("Enter the full name.");
    if (f.phone.trim().length < 6) return setError("Enter the phone number.");
    if (f.idNumber.trim().length < 4) return setError("Enter the ID number.");
    if (!f.place.trim()) return setError(winga ? "Enter where the Winga sells." : "Enter where the customer lives or works.");
    setBusy(true);
    const err = await onSave(f);
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{winga ? "Register a Winga" : "Register a credit customer"}</h2>
          <p className="text-sm text-slate-500">Full details are needed before goods can go on credit.</p>
        </div>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm shrink-0" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        <div>
          <label className="label" htmlFor="reg-name">
            {winga ? "Winga's full name" : "Customer or business name"} <span className="text-brand-red">*</span>
          </label>
          <input id="reg-name" autoFocus className="input" value={f.name} onChange={set("name")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="reg-phone">
              Phone number <span className="text-brand-red">*</span>
            </label>
            <input id="reg-phone" className="input" inputMode="tel" value={f.phone} onChange={set("phone")} />
          </div>
          <div>
            <label className="label" htmlFor="reg-id">
              ID number <span className="text-brand-red">*</span>
            </label>
            <input id="reg-id" className="input" value={f.idNumber} onChange={set("idNumber")} />
          </div>
          <div>
            <label className="label" htmlFor="reg-place">
              {winga ? "Where he sells" : "Place (lives or works)"} <span className="text-brand-red">*</span>
            </label>
            <input id="reg-place" className="input" value={f.place} onChange={set("place")} placeholder={winga ? "e.g. Mwenge market" : ""} />
          </div>
          {winga ? (
            <div>
              <label className="label" htmlFor="reg-business">
                Business name (if any)
              </label>
              <input id="reg-business" className="input" value={f.business} onChange={set("business")} />
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="reg-type">
                Type
              </label>
              <select id="reg-type" className="input" value={f.type} onChange={set("type")}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        {winga && <p className="text-xs text-slate-500">A Winga takes goods on credit and must pay within 3 days.</p>}
        {error && <p className="field-error">{error}</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : winga ? "Save Winga" : "Save customer"}
        </button>
      </div>
    </form>
  );
}

/** "New Winga" / "New credit customer" as a pop-up form. Resets each time it opens. onSave returns an error text, or null when saved. */
export default function RegisterModal({ open, kind, onClose, onSave }: { open: boolean; kind: "winga" | "credit"; onClose: () => void; onSave: (f: RegisterForm) => Promise<string | null> }) {
  return (
    <Modal open={open} onClose={onClose} label={kind === "winga" ? "Register a Winga" : "Register a credit customer"}>
      <Form kind={kind} onClose={onClose} onSave={onSave} />
    </Modal>
  );
}
