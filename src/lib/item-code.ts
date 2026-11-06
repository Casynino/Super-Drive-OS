// Reads what was scanned or typed. Pure (no database), so the browser can use it too.

/** Turns QR text, the bare token or a printed SDO-ITEM number into the lookup key, or null if it is not an item code. */
export function parseItemCode(raw: string): { token?: string; itemNo?: string } | null {
  let v = raw.trim().toUpperCase();
  if (!v) return null;
  if (v.startsWith("SDOI:")) v = v.slice(5);
  if (/^SDO-ITEM-\d{4,}$/.test(v)) return { itemNo: v };
  if (/^[A-HJ-NP-Z2-9]{16}$/.test(v)) return { token: v };
  return null;
}
