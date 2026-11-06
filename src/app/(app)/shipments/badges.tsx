import { PHASE_LABEL, type ShipmentPhase } from "@/lib/shipments/phase";

const CLASS: Record<ShipmentPhase, string> = {
  ON_THE_WAY: "badge-blue",
  ARRIVED: "badge-yellow",
  CHECKING: "badge-yellow",
  INVESTIGATION: "badge-red",
  DONE: "badge-green",
  CANCELLED: "badge-gray",
};

/** One badge for where a shipment stands (On the way, Arrived, Part checked, Investigation, In stock, Cancelled). */
export function PhaseBadge({ phase }: { phase: ShipmentPhase }) {
  return <span className={CLASS[phase]}>{PHASE_LABEL[phase]}</span>;
}
