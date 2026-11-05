"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { PickerProduct } from "@/lib/inventory/types";
import { cn } from "@/lib/utils";

/**
 * Type a name, SKU or barcode and pick a product. Pressing Enter picks the highlighted result, or an exact
 * SKU/barcode match (so a barcode scanner that types the code and presses Enter adds the product straight away).
 */
export default function ProductPicker({
  products,
  onPick,
  placeholder = "Search product by name, SKU or barcode…",
  autoFocus,
}: {
  products: PickerProduct[];
  onPick: (p: PickerProduct) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return products
      .filter((p) => p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || (p.barcode ?? "").toLowerCase().includes(term))
      .slice(0, 8);
  }, [q, products]);

  const choose = (p: PickerProduct) => {
    onPick(p);
    setQ("");
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault(); // never submit the form from the search box
      const term = q.trim().toLowerCase();
      const exact = products.find((p) => p.sku.toLowerCase() === term || (p.barcode && p.barcode.toLowerCase() === term));
      const pick = exact ?? results[active];
      if (pick) choose(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="input pl-9"
        aria-label="Search products"
      />
      {open && q.trim() && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-white py-1 shadow-lg">
          {results.length === 0 && <li className="px-3 py-2.5 text-sm text-slate-500">No active product matches “{q}”.</li>}
          {results.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
                className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm", i === active ? "bg-navy-50" : "hover:bg-slate-50")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{p.name}</span>
                  <span className="block text-xs text-slate-500">{p.sku}</span>
                </span>
                <span className="shrink-0 text-xs text-slate-400">{p.units[0]?.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
