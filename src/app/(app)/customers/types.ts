import { z } from "zod";

export const CUSTOMER_TYPES = [
  { value: "RETAIL", label: "Retail customer" },
  { value: "WHOLESALE", label: "Wholesale customer" },
  { value: "DISTRIBUTOR", label: "Distributor" },
  { value: "BUSINESS", label: "Business customer" },
  { value: "OTHER", label: "Other" },
] as const;

export const customerTypeSchema = z.enum(["RETAIL", "WHOLESALE", "DISTRIBUTOR", "BUSINESS", "OTHER"], { error: "Choose a customer type." });

export const customerTypeLabel = (t: string) => CUSTOMER_TYPES.find((c) => c.value === t)?.label ?? t;
