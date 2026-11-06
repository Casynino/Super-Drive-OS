/**
 * Shown the moment a page is opened (a product, an order, a list) until its data is ready, so a press always gives instant feedback
 * and nobody presses a second time. It sits inside the app's frame: the menu and top bar stay where they are.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-live="polite">
      <div className="h-7 w-56 rounded-lg bg-slate-200/70" />
      <div className="h-4 w-80 max-w-full rounded bg-slate-200/50" />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24 bg-slate-100/60" />
        ))}
      </div>
      <div className="card h-64 bg-slate-100/60" />
      <span className="sr-only">Opening…</span>
    </div>
  );
}
