// Plain, serialisable shapes shared by the POS page (server) and the POS screen (client).
import type { PickerProduct, PickerUnit } from "@/lib/inventory/types";

export type PosUnit = PickerUnit & { retail: string; wholesale: string };
export type PosProduct = Omit<PickerProduct, "units"> & {
  units: PosUnit[];
  brand: string | null;
  categoryId: string;
  categoryName: string;
  packaging: string | null;
  /** picture version (changes when the picture is replaced); null = no picture */
  imageV: number | null;
};

export type PosCustomer = {
  id: string;
  name: string;
  phone: string | null;
  type: string;
  /** only sent to people who may sell on credit */
  creditLimit?: string;
  outstanding?: string;
};

export type CartLine = {
  productId: string;
  unitId: string;
  quantity: string;
  price: string;
  /** pieces scanned for this line (base unit only): those exact pieces are marked sold at checkout */
  scanned?: { token: string; itemNo: string }[];
};

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "BANK", label: "Bank" },
] as const;

export const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? m;
