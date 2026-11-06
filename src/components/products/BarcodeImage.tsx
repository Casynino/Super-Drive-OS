import { drawBarcode } from "@/lib/barcode";
import { cn } from "@/lib/utils";

/**
 * A scannable barcode as a crisp SVG on its own white background (scanners need dark bars on a light field, even in the dark theme).
 * Numbers that are not standard retail barcodes are shown as plain text.
 */
export default function BarcodeImage({ value, className, height = 56 }: { value: string; className?: string; height?: number }) {
  const d = drawBarcode(value);
  if (!d) return <span className={cn("font-mono text-sm", className)}>{value}</span>;

  const Q = 9; // quiet zone, in modules
  const n = d.modules.length;
  const width = n + Q * 2;
  const textH = 11;
  const rects: React.ReactNode[] = [];
  for (let i = 0; i < n; ) {
    if (d.modules[i] !== "1") {
      i++;
      continue;
    }
    let j = i;
    while (j < n && d.modules[j] === "1") j++;
    // the guard bars (start, centre, end) reach a little lower than the rest, like printed barcodes
    const tall = i < 3 || j > n - 3 || (i >= 45 && j <= 50);
    rects.push(<rect key={i} x={Q + i} y={2} width={j - i} height={height - (tall ? 0 : 5)} />);
    i = j;
  }

  const text: React.ReactNode[] = [];
  if (d.kind === "ean13") {
    text.push(<text key="f" x={3.5} y={height + textH - 1}>{d.digits[0]}</text>);
    for (let k = 0; k < 6; k++) text.push(<text key={`l${k}`} x={Q + 3 + 7 * k + 3.5} y={height + textH - 1}>{d.digits[k + 1]}</text>);
    for (let k = 0; k < 6; k++) text.push(<text key={`r${k}`} x={Q + 50 + 7 * k + 3.5} y={height + textH - 1}>{d.digits[k + 7]}</text>);
  } else {
    for (let k = 0; k < 4; k++) text.push(<text key={`l${k}`} x={Q + 3 + 7 * k + 3.5} y={height + textH - 1}>{d.digits[k]}</text>);
    for (let k = 0; k < 4; k++) text.push(<text key={`r${k}`} x={Q + 36 + 7 * k + 3.5} y={height + textH - 1}>{d.digits[k + 4]}</text>);
  }

  return (
    <svg viewBox={`0 0 ${width} ${height + textH + 1}`} className={cn("h-auto w-full", className)} role="img" aria-label={`Barcode ${d.digits}`} shapeRendering="crispEdges">
      <rect width={width} height={height + textH + 1} fill="#fff" />
      <g fill="#000">{rects}</g>
      <g fill="#000" fontFamily="ui-monospace, Menlo, monospace" fontSize="9" textAnchor="middle" shapeRendering="auto">
        {text}
      </g>
    </svg>
  );
}
