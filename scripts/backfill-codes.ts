// Gives every product that has no barcode its own barcode (the shop's own EAN-13 numbers, starting 200).
// Safe to run again: products that already have one are left alone. Run it once after updating an existing database.
// usage: npm run db:backfill-codes
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { backfillBarcodes } from "../src/lib/product-codes";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

backfillBarcodes(db as unknown as Parameters<typeof backfillBarcodes>[0])
  .then((n) => console.log(n === 0 ? "Every product already has a barcode." : `${n} product(s) got a barcode.`))
  .finally(() => db.$disconnect());
