import { qrSvg } from "@/lib/qr";
import { cn } from "@/lib/utils";

/** A scannable QR code (server-rendered SVG). `text` is exactly what the QR contains. */
export default async function QrImage({ text, className, label }: { text: string; className?: string; label?: string }) {
  const svg = await qrSvg(text);
  // the SVG comes from our own QR generator, never from user markup
  return <div role="img" aria-label={label ?? "QR code"} className={cn("[&>svg]:h-full [&>svg]:w-full [&>svg]:[shape-rendering:crispEdges]", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
