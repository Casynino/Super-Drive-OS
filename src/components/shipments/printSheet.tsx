"use client";

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * Opens a clean window with just the given document and the print dialog (choose "Save as PDF" there to download it).
 * The document must be fully inline-styled and use absolute picture addresses. Returns false if the browser blocked the window.
 */
export function printDocument(node: ReactElement, title: string): boolean {
  const w = window.open("", "_blank", "width=980,height=1100");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:A4;margin:12mm}html,body{margin:0;background:#fff;color:#0f172a;font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}body{padding:16px}@media print{body{padding:0}}</style></head><body>${renderToStaticMarkup(node)}</body></html>`,
  );
  w.document.close();
  const pictures = Array.from(w.document.images).map((img) => (img.complete ? null : new Promise<void>((done) => { img.onload = img.onerror = () => done(); })));
  Promise.all(pictures).then(() =>
    setTimeout(() => {
      w.focus();
      w.print();
    }, 250),
  );
  return true;
}
