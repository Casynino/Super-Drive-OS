import type { ItemStatus } from "@/generated/prisma/client";
import { ITEM_STATUS_BADGE, ITEM_STATUS_LABEL } from "@/lib/inventory/item-labels";

export default function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <span className={ITEM_STATUS_BADGE[status]}>{ITEM_STATUS_LABEL[status]}</span>;
}
