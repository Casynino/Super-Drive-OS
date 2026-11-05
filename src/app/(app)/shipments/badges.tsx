export function ShipmentStatusBadge({ status }: { status: "EXPECTED" | "PARTIAL" | "RECEIVED" | "CANCELLED" }) {
  if (status === "EXPECTED") return <span className="badge-blue">On the way</span>;
  if (status === "PARTIAL") return <span className="badge-yellow">Part received</span>;
  if (status === "RECEIVED") return <span className="badge-green">Received</span>;
  return <span className="badge-gray">Cancelled</span>;
}

export function IssueBadge({ issue }: { issue: "NONE" | "OPEN" | "RESOLVED" }) {
  if (issue === "OPEN") return <span className="badge-red">Needs investigation</span>;
  if (issue === "RESOLVED") return <span className="badge-gray">Investigated</span>;
  return null;
}
