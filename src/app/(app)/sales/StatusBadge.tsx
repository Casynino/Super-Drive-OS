export function SaleStatusBadge({ status, paymentStatus }: { status: "COMPLETED" | "CANCELLED"; paymentStatus: "PAID" | "PARTIALLY_PAID" | "UNPAID" }) {
  if (status === "CANCELLED") return <span className="badge-gray">Cancelled</span>;
  return <PaymentStatusBadge status={paymentStatus} />;
}

export function PaymentStatusBadge({ status }: { status: "PAID" | "PARTIALLY_PAID" | "UNPAID" }) {
  if (status === "PAID") return <span className="badge-green">Paid</span>;
  if (status === "PARTIALLY_PAID") return <span className="badge-yellow">Part paid</span>;
  return <span className="badge-red">Unpaid</span>;
}
