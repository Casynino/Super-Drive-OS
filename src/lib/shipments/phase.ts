// Where a shipment stands, in the words the shop and the owner use. Derived from stored fields, never stored itself.
//
//   ON_THE_WAY     announced by the owner, not at the shop yet
//   ARRIVED        the shop marked it arrived, nobody has confirmed a count yet
//   CHECKING       some of it counted and in stock, more still to come
//   INVESTIGATION  something was damaged, missing or extra: the owner must look into it
//   DONE           everything counted and in stock (any problem was investigated)
//   CANCELLED      withdrawn by the owner before it arrived

export type ShipmentPhase = "ON_THE_WAY" | "ARRIVED" | "CHECKING" | "INVESTIGATION" | "DONE" | "CANCELLED";

export function shipmentPhase(s: { status: "EXPECTED" | "PARTIAL" | "RECEIVED" | "CANCELLED"; issue: "NONE" | "OPEN" | "RESOLVED"; arrivedAt: Date | null }): ShipmentPhase {
  if (s.status === "CANCELLED") return "CANCELLED";
  if (s.issue === "OPEN") return "INVESTIGATION";
  if (s.status === "RECEIVED") return "DONE";
  if (s.status === "PARTIAL") return "CHECKING";
  return s.arrivedAt ? "ARRIVED" : "ON_THE_WAY";
}

/** The shop can still count it (arrived, or part counted). */
export const canCount = (s: { status: "EXPECTED" | "PARTIAL" | "RECEIVED" | "CANCELLED"; arrivedAt: Date | null }) => (s.status === "EXPECTED" && s.arrivedAt !== null) || s.status === "PARTIAL";

/** The shop can still say it arrived. */
export const canMarkArrived = (s: { status: "EXPECTED" | "PARTIAL" | "RECEIVED" | "CANCELLED"; arrivedAt: Date | null }) => s.status === "EXPECTED" && s.arrivedAt === null;

export const PHASE_LABEL: Record<ShipmentPhase, string> = {
  ON_THE_WAY: "On the way",
  ARRIVED: "Arrived",
  CHECKING: "Part checked",
  INVESTIGATION: "Investigation",
  DONE: "In stock",
  CANCELLED: "Cancelled",
};
