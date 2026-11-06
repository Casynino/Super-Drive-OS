// Barcode maths with no dependencies: EAN-13 check digits, the shop's own numbers, and the bar pattern to draw.
// Our own numbers start with 200, a range the retail standard keeps for in-store use, so they can never clash
// with a code a manufacturer printed on a bottle, and any ordinary scanner reads them.

const PREFIX = "200";

export function ean13CheckDigit(d12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export const isEan13 = (v: string) => /^\d{13}$/.test(v) && ean13CheckDigit(v.slice(0, 12)) === Number(v[12]);

/** The shop's own barcode for the n-th product (1, 2, 3 ...). */
export function internalBarcode(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999_999) throw new Error("Barcode number out of range");
  const d12 = PREFIX + String(seq).padStart(9, "0");
  return d12 + ean13CheckDigit(d12);
}

// ---- drawing ----
const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

export type BarcodeDrawing = { kind: "ean13" | "ean8"; digits: string; modules: string };

/**
 * The bars for a number, as a string of 1 (black) and 0 (white) modules, or null when the number is not a
 * standard retail barcode (then only the digits are shown). 12-digit UPC-A numbers are drawn as EAN-13 with a leading 0.
 */
export function drawBarcode(value: string): BarcodeDrawing | null {
  const v = value.trim();
  const ean13 = /^\d{12}$/.test(v) ? `0${v}` : v;
  if (isEan13(ean13)) {
    const first = Number(ean13[0]);
    const parity = PARITY[first]!;
    let m = "101";
    for (let i = 0; i < 6; i++) m += (parity[i] === "L" ? L : G)[Number(ean13[i + 1])];
    m += "01010";
    for (let i = 0; i < 6; i++) m += R[Number(ean13[i + 7])];
    return { kind: "ean13", digits: ean13, modules: `${m}101` };
  }
  if (/^\d{8}$/.test(v)) {
    const check = (10 - ([0, 1, 2, 3, 4, 5, 6].reduce((s, i) => s + Number(v[i]) * (i % 2 === 0 ? 3 : 1), 0) % 10)) % 10;
    if (check === Number(v[7])) {
      let m = "101";
      for (let i = 0; i < 4; i++) m += L[Number(v[i])];
      m += "01010";
      for (let i = 4; i < 8; i++) m += R[Number(v[i])];
      return { kind: "ean8", digits: v, modules: `${m}101` };
    }
  }
  return null;
}
