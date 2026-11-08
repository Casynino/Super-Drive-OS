"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, Trash2, X } from "lucide-react";
import Modal from "@/components/Modal";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";

const initial: ActionState = {};

function Confirm({ productId, name, action, onClose }: { productId: string; name: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState>; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initial);
  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-[#ffffff]">
          <CircleCheck size={30} />
        </span>
        <p className="text-lg font-semibold text-slate-900">{state.message}</p>
        <button type="button" className="btn-primary h-11 px-6" onClick={() => router.push("/products")}>
          Back to the products
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="id" value={productId} />
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-base font-semibold text-slate-900">Delete this product?</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>
      <div className="space-y-3 px-5 py-4">
        <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900">{name}</p>
        <p className="text-sm text-slate-600">It leaves the product lists, the till and the stock pages. Its history stays in the records (sales, movements, prices), and it can be brought back later.</p>
        {state.error && <Alert>{state.error}</Alert>}
      </div>
      <div className="flex gap-2 border-t border-line px-5 py-3.5">
        <button type="submit" disabled={pending} className="h-11 flex-1 rounded-xl bg-brand-red text-sm font-semibold text-[#ffffff] transition hover:bg-brand-red-dark disabled:opacity-60">
          {pending ? "Deleting…" : "Delete product"}
        </button>
        <button type="button" className="btn-secondary h-11 px-5" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** "Delete product": asks in a pop-up first. Not offered while the product still has stock (the page says why). */
export default function DeleteProductButton({ productId, name, action }: { productId: string; name: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        <Trash2 size={15} /> Delete product
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label="Delete this product">
        {open && <Confirm productId={productId} name={name} action={action} onClose={() => setOpen(false)} />}
      </Modal>
    </>
  );
}
