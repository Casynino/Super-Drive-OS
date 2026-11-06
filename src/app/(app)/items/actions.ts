"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { guarded, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { labelExistingStock } from "@/lib/inventory/items";

/** Gives stock that was received before item tracking existed its own item numbers and QR codes. Safe to press twice. */
export async function labelExistingStockAction(): Promise<ActionState> {
  return guarded("inventory.adjust", async (user) => {
    const made = await db.$transaction(
      async (tx) => {
        const n = await labelExistingStock(tx, user.id);
        if (n > 0) await writeAudit(tx, { user, action: "items.label_existing_stock", entityType: "InventoryItem", after: { created: n } });
        return n;
      },
      { timeout: 120000, maxWait: 15000 },
    );
    revalidatePath("/items");
    return { ok: true, message: made > 0 ? `${made} item${made === 1 ? "" : "s"} created. You can print their labels now.` : "Everything already has item numbers." };
  });
}
