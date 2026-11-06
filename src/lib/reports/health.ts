// "How healthy is the business?" in one score, with the six things behind it and what to do about the weak ones.
// Plain rules of thumb on real figures (nothing is stored). The Reports page and the downloadable report both use this,
// so they always agree.

export type HealthInput = {
  sales: number;
  prevSales: number;
  /** gross profit, only for people allowed to see it */
  profit: number | null;
  expenses: number;
  /** sold on credit in the period */
  creditGiven: number;
  /** owed by customers and winga past the due date, today */
  overdue: number;
  products: number;
  outOfStock: number;
  lowStock: number;
};

export type HealthStatus = "good" | "ok" | "bad";
export type HealthIndicator = {
  key: string;
  label: string;
  /** the figure as text, e.g. "37.8%" */
  value: string;
  /** what it measures, in a few words */
  note: string;
  /** 0 to 100, for the bar */
  score: number;
  status: HealthStatus;
};
export type Health = {
  score: number;
  label: "Strong" | "Healthy" | "Needs attention" | "At risk";
  tone: HealthStatus;
  indicators: HealthIndicator[];
  /** what to do next, the weakest points first (or one line of praise when everything is fine) */
  advice: string[];
};

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const pctText = (v: number) => `${v.toFixed(1)}%`;

export function computeHealth(i: HealthInput, fmt: (n: number) => string): Health {
  const rows: { ind: HealthIndicator; weight: number; advice: string }[] = [];
  const add = (key: string, label: string, value: string, note: string, score: number, good: boolean, ok: boolean, weight: number, advice: string) =>
    rows.push({ ind: { key, label, value, note, score: Math.round(clamp(score)), status: good ? "good" : ok ? "ok" : "bad" }, weight, advice });

  // 1. Growth against the period before
  if (i.prevSales > 0) {
    const g = ((i.sales - i.prevSales) / i.prevSales) * 100;
    add("growth", "Sales growth", `${g >= 0 ? "+" : "−"}${Math.abs(g).toFixed(1)}%`, "against the period before", 60 + g * 2, g >= 5, g >= -10, 20, `Sales are ${Math.abs(g).toFixed(0)}% lower than before. Look at which products and which days dropped, and talk to the customers who stopped buying.`);
  }

  // 2. Profit margin
  if (i.profit !== null && i.sales > 0) {
    const m = (i.profit / i.sales) * 100;
    add("margin", "Profit margin", pctText(m), "gross profit ÷ sales", (m / 30) * 100, m >= 25, m >= 12, 20, `Only ${m.toFixed(0)}% of each sale is profit. Check the selling prices against the buying cost, and be careful with discounts.`);
  }

  // 3. Expenses against sales
  if (i.sales > 0) {
    const e = (i.expenses / i.sales) * 100;
    add("expenses", "Spent on expenses", pctText(e), "expenses ÷ sales", 100 - (e - 5) * 5, e <= 10, e <= 20, 15, `Expenses take ${e.toFixed(0)}% of sales (${fmt(i.expenses)}). Review the biggest expense categories and cut what is not needed.`);
  }

  // 4. Money collected at the time of sale
  if (i.sales > 0) {
    const c = clamp(((i.sales - i.creditGiven) / i.sales) * 100);
    add("collected", "Paid at the time of sale", pctText(c), "paid ÷ sold", c, c >= 80, c >= 50, 15, `${fmt(i.creditGiven)} was sold on credit (${(100 - c).toFixed(0)}% of sales). Sell for cash where you can, and keep credit for customers who pay on time.`);
  }

  // 5. Debts past their due date
  if (i.sales > 0 || i.overdue > 0) {
    const o = i.sales > 0 ? (i.overdue / i.sales) * 100 : 100;
    add("overdue", "Debts past due", pctText(o), "overdue ÷ sales", 100 - o * 4, o <= 5, o <= 15, 15, `${fmt(i.overdue)} is past its due date. Open Credit and send reminders to the customers who are late.`);
  }

  // 6. Stock that is out or low
  if (i.products > 0) {
    const s = ((i.outOfStock + i.lowStock) / i.products) * 100;
    add("stock", "Stock out or low", pctText(s), `${i.outOfStock} out, ${i.lowStock} low of ${i.products}`, 100 - s * 2.5, s <= 10, s <= 25, 15, `${i.outOfStock} product${i.outOfStock === 1 ? " is" : "s are"} out of stock and ${i.lowStock} low. Order them early so you do not lose sales.`);
  }

  const weight = rows.reduce((t, r) => t + r.weight, 0);
  const score = weight > 0 ? Math.round(rows.reduce((t, r) => t + r.ind.score * r.weight, 0) / weight) : 0;
  const label = score >= 80 ? "Strong" : score >= 65 ? "Healthy" : score >= 45 ? "Needs attention" : "At risk";
  const weak = rows.filter((r) => r.ind.status !== "good").sort((a, b) => a.ind.score - b.ind.score);
  return {
    score,
    label,
    tone: score >= 65 ? "good" : score >= 45 ? "ok" : "bad",
    indicators: rows.map((r) => r.ind),
    advice: weak.length > 0 ? weak.slice(0, 4).map((r) => r.advice) : rows.length > 0 ? ["Everything we measure is in good shape. Keep doing what you are doing and keep stock and collections up to date."] : ["There is not enough activity in this period to judge the business yet."],
  };
}

/** Feeds computeHealth from the figures the Reports page already works out. */
export function healthInputFrom(
  sales: { totals: { sales: number; prevSales: number; profit: number | null; creditGiven: number } },
  inv: { list: unknown[]; out: unknown[]; low: unknown[] },
  fin: { expenseTotal: number; customerOverdue: number; resellerOverdue: number },
): HealthInput {
  return {
    sales: sales.totals.sales,
    prevSales: sales.totals.prevSales,
    profit: sales.totals.profit,
    expenses: fin.expenseTotal,
    creditGiven: sales.totals.creditGiven,
    overdue: fin.customerOverdue + fin.resellerOverdue,
    products: inv.list.length,
    outOfStock: inv.out.length,
    lowStock: inv.low.length,
  };
}
