import { cookies } from "next/headers";
import { UNIT_COOKIE, type UnitMode } from "@/lib/qty";

/** The CTN | PCS choice of the person looking at the screen (cookie set by the switch in the top bar). Cartons unless they chose pieces. Server only. */
export async function getUnitMode(): Promise<UnitMode> {
  return (await cookies()).get(UNIT_COOKIE)?.value === "pcs" ? "pcs" : "ctn";
}
