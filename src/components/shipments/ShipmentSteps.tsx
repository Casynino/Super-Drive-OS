import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = { title: string; detail: string };

/** The journey of a shipment: On the way, Arrived, Checked, In stock. `done` steps are finished, the next one is the current step. */
export default function ShipmentSteps({ steps, done }: { steps: Step[]; done: number }) {
  return (
    <ol className="grid gap-4 sm:grid-cols-4 sm:gap-0">
      {steps.map((s, i) => {
        const finished = i < done;
        const current = i === done;
        return (
          <li key={s.title} className="relative flex gap-3 sm:flex-col sm:items-center sm:gap-2 sm:px-2 sm:text-center">
            {i > 0 && <span aria-hidden className={cn("absolute -top-4 left-[15px] h-4 w-0.5 sm:left-auto sm:right-1/2 sm:top-[15px] sm:h-0.5 sm:w-full", i <= done ? "bg-emerald-500" : "bg-slate-200")} />}
            <span
              className={cn(
                "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold",
                finished && "border-emerald-500 bg-emerald-500 text-white",
                current && "border-oil-400 bg-oil-soft text-yellow-800 ring-4 ring-oil-400/25",
                !finished && !current && "border-slate-200 bg-white text-slate-400",
              )}
            >
              {finished ? <Check size={16} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={cn("text-sm font-semibold", finished || current ? "text-slate-900" : "text-slate-400")}>{s.title}</p>
              <p className="text-xs text-slate-500">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
