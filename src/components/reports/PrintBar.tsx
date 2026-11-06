"use client";

import { useEffect } from "react";
import { Printer, X } from "lucide-react";

/** The bar above a printable page: Print / Save as PDF (choose "Save as PDF" in the print window) and Close. Hidden when printing. */
export default function PrintBar({ auto, title, save }: { auto: boolean; title: string; save?: boolean }) {
  useEffect(() => {
    if (!auto) return;
    // wait for the picture(s) so the logo is on the paper
    const imgs = Array.from(document.images).map((img) => (img.complete ? null : new Promise<void>((done) => { img.onload = img.onerror = () => done(); })));
    const t = setTimeout(() => void Promise.all(imgs).then(() => window.print()), 350);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="print-hide" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, maxWidth: 900, margin: "0 auto 14px", padding: "0 2px" }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: "#0f172a" }}>
        {title}
        {save && <span style={{ display: "block", marginTop: 2, fontSize: 12, fontWeight: 400, color: "#475569" }}>To download it: in the print window choose “Save as PDF” as the destination, then Save.</span>}
      </span>
      <span style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={() => window.print()} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "none", background: "#0E3D6E", color: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>
          <Printer size={15} /> Download PDF / Print
        </button>
        <button type="button" onClick={() => window.close()} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff", color: "#0f172a", fontSize: 13, cursor: "pointer" }}>
          <X size={15} /> Close
        </button>
      </span>
    </div>
  );
}
