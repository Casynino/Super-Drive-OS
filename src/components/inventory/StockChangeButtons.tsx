"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, ClipboardCheck, ImageOff, Minus, Plus, X } from "lucide-react";
import Modal from "@/components/Modal";
import { Alert } from "@/components/ui";
import type { ActionState } from "@/lib/action";
import { adjustStockAction } from "@/app/(app)/inventory/actions";
import { qtyText, type Pack } from "@/lib/qty";
import { cn } from "@/lib/utils";

type Mode = "ADD" | "REMOVE" | "COUNT";
export type StockChangeProps = {
  productId: string;
  name: string;
  sku: string;
  imageV: number | null;
  pack: Pack | null;
  baseSymbol: string;
  /** pieces in the warehouse in all, including goods already sold and waiting to be collected */
  total: number;
  /** of those, sold and waiting to be collected (they cannot be taken out) */
  reserved?: number;
  /** may set the counted quantity (inventory.count) */
  canCount?: boolean;
  /** smaller buttons that share the row */
  compact?: boolean;
  /** may add and remove (inventory.adjust); false shows only Count. Default true */
  allowChange?: boolean;
};
const initial: ActionState = {};
const num = (v: string) => (v.trim() === "" ? 0 : Number(v));
const clean = (v: string) => v.replace(/[^0-9.]/g, "");
const TEXT: Record<Mode, { title: string; ask: string; why: string; placeholder: string; button: string; done: string }> = {
  ADD: { title: "Add stock", ask: "How much came in?", why: "Where did it come from?", placeholder: "e.g. Came from the boss in China, no purchase order", button: "Add to stock", done: "Stock added" },
  REMOVE: { title: "Remove stock", ask: "How much to take out?", why: "Why is it taken out?", placeholder: "e.g. Wrong count, sent to another place", button: "Take out of stock", done: "Stock removed" },
  COUNT: { title: "Set the counted stock", ask: "How much is on the shelf now?", why: "Note", placeholder: "e.g. Counted the whole shelf this morning", button: "Save the count", done: "Count saved" },
};

function Form({ p, mode, onClose }: { p: StockChangeProps; mode: Mode; onClose: () => void }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(adjustStockAction, initial);
  const [ctn, setCtn] = useState("");
  const [pcs, setPcs] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const fe = state.fieldErrors ?? {};
  const t = TEXT[mode];
  const reserved = p.reserved ?? 0;
  const available = Math.max(p.total - reserved, 0);
  const typed = (p.pack ? num(ctn) * p.pack.factor : 0) + num(pcs);
  const filled = ctn.trim() !== "" || pcs.trim() !== "";
  const valid = Number.isFinite(typed) && (mode === "COUNT" ? filled : typed > 0);
  const say = (n: number) => qtyText(n, p.pack, p.baseSymbol).main;
  const after = mode === "ADD" ? available + (valid ? typed : 0) : mode === "REMOVE" ? Math.max(available - (valid ? typed : 0), 0) : valid ? Math.max(typed - reserved, 0) : available;
  const diff = mode === "COUNT" && valid ? typed - p.total : 0;

  if (state.ok) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-[#ffffff]">
          <CircleCheck size={30} />
        </span>
        <p className="text-lg font-semibold text-slate-900">{t.done}</p>
        <p className="text-sm text-slate-500">
          {p.name}: {mode === "ADD" ? `${say(typed)} added` : mode === "REMOVE" ? `${say(typed)} taken out` : `${say(typed)} counted on the shelf`}. The record is {state.message}.
        </p>
        <button
          type="button"
          className="btn-primary h-11 px-6"
          onClick={() => {
            router.refresh();
            onClose();
          }}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex min-h-0 flex-1 flex-col">
      <input type="hidden" name="productId" value={p.productId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="quantity" value={valid ? String(Number(typed.toFixed(3))) : ""} />
      <input type="hidden" name="submissionKey" value={key} />
      <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="text-base font-semibold text-slate-900">{t.title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-full text-slate-500 hover:bg-slate-100">
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-gradient-to-b from-white to-slate-100">
            {p.imageV ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/product-image/${p.productId}?size=thumb&v=${p.imageV}`} alt="" className="h-full w-full object-contain" />
            ) : (
              <ImageOff size={18} className="text-slate-300" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-900">{p.name}</span>
            <span className="block text-xs text-slate-500">
              {p.sku} · {mode === "COUNT" ? `${say(p.total)} on the shelf in all` : `${say(available)} available now`}
              {reserved > 0 && mode === "COUNT" ? ` (${say(reserved)} sold, waiting to be collected)` : ""}
            </span>
          </span>
        </div>

        <div>
          <p className="label">{t.ask}</p>
          <div className="flex items-center gap-2">
            {p.pack && (
              <>
                <input className="input h-11 w-20 text-center text-lg font-semibold tabular-nums" inputMode="numeric" placeholder="0" value={ctn} onChange={(e) => setCtn(clean(e.target.value))} aria-label="Cartons" autoFocus />
                <span className="w-10 text-sm font-medium text-slate-500">{p.pack.symbol}</span>
              </>
            )}
            <input className="input h-11 w-20 text-center text-lg font-semibold tabular-nums" inputMode="numeric" placeholder="0" value={pcs} onChange={(e) => setPcs(clean(e.target.value))} aria-label="Pieces" autoFocus={!p.pack} />
            <span className="w-10 text-sm font-medium text-slate-500">{p.baseSymbol}</span>
          </div>
          {valid && mode !== "COUNT" && (
            <p className="mt-1.5 text-sm text-slate-600">
              Then {say(after)} is available.
            </p>
          )}
          {valid && mode === "COUNT" && (
            <p className="mt-1.5 text-sm text-slate-600">
              {diff === 0 ? "Same as the system, nothing changes." : diff > 0 ? <>The system adds <span className="font-semibold text-emerald-700">{say(diff)}</span>.</> : <>The system takes out <span className="font-semibold text-brand-red-dark">{say(-diff)}</span>.</>}
            </p>
          )}
          {fe.quantity && <p className="field-error">{fe.quantity}</p>}
        </div>

        <div>
          <label className="label" htmlFor="sc-note">
            {t.why}
          </label>
          <input id="sc-note" name="note" className={cn("input h-11", fe.note && "input-error")} placeholder={t.placeholder} autoComplete="off" maxLength={300} />
          {fe.note && <p className="field-error">{fe.note}</p>}
        </div>
        {state.error && !fe.quantity && !fe.note && <Alert>{state.error}</Alert>}
      </div>
      <div className="border-t border-line px-5 py-3.5">
        <button type="submit" disabled={pending || !valid} className={cn("h-12 w-full rounded-xl text-base font-semibold text-[#ffffff] transition disabled:opacity-60", mode === "REMOVE" ? "bg-brand-red hover:bg-brand-red-dark" : "bg-navy-700 hover:bg-navy-800")}>
          {pending ? "Saving…" : t.button}
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">It is recorded with your name and the owner is told. Goods already sold and waiting to be collected cannot be taken out.</p>
      </div>
    </form>
  );
}

/** "Add", "Remove" and "Count" on a product: pop-ups with cartons + pieces and a note. */
export default function StockChangeButtons(p: StockChangeProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const btn = p.compact ? "inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-line bg-white px-2.5 max-sm:w-9 max-sm:px-0 text-[13px] font-semibold text-slate-700 transition hover:border-navy-200 hover:bg-slate-50" : "btn-secondary btn-sm";
  return (
    <>
      <div className={cn("flex items-center", p.compact ? "gap-1.5" : "flex-wrap gap-2")}>
        {p.allowChange !== false && (
          <>
            <button type="button" className={p.compact ? btn : "btn-primary btn-sm"} onClick={() => setMode("ADD")} aria-label="Add stock" title="Add stock">
              <Plus size={14} /> <span className={cn(p.compact && "max-sm:hidden")}>Add</span>
            </button>
            <button type="button" className={btn} onClick={() => setMode("REMOVE")} aria-label="Remove stock" title="Remove stock">
              <Minus size={14} /> <span className={cn(p.compact && "max-sm:hidden")}>Remove</span>
            </button>
          </>
        )}
        {p.canCount && (
          <button type="button" className={btn} onClick={() => setMode("COUNT")} aria-label="Set the counted stock" title="Set the counted stock">
            <ClipboardCheck size={14} /> <span className={cn(p.compact && "max-sm:hidden")}>Count</span>
          </button>
        )}
      </div>
      <Modal open={mode !== null} onClose={() => setMode(null)} label={mode ? TEXT[mode].title : "Change stock"}>
        {mode && <Form p={p} mode={mode} onClose={() => setMode(null)} />}
      </Modal>
    </>
  );
}
