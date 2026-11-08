import { Children } from "react";
import { cn } from "@/lib/utils";

// how many cells sit side by side, by how many there are: two across on a phone, the rest as wide as the screen allows
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

/**
 * The headline figures of a page as ONE slim card: thin lines between the cells, no big tiles (Nino 2026-11-09, copied from the new Stock overview).
 * Put `KpiCard`s inside. An odd last cell takes the full row on a phone, so there is never a hole.
 */
export default function KpiStrip({ children, className }: { children: React.ReactNode; className?: string }) {
  const items = Children.toArray(children);
  if (items.length === 0) return null;
  return (
    <section className={cn("card overflow-hidden", className)}>
      {/* each cell draws its right and bottom line; the grid is pulled 1 px outside the card so the outer edge shows no double line */}
      <div className={cn("-mb-px -mr-px grid [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1", COLS[items.length] ?? COLS[6])}>{items}</div>
    </section>
  );
}
