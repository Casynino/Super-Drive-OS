// Loads the products from prisma/catalog/catalog.json (Nino's stock sheet) with their pictures.
// Safe to run again: products that already exist are left alone (only a missing picture is added).
// It sets NO prices and NO stock: the Owner enters prices in Products and receives stock normally.
// usage: npm run db:import-catalog
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { backfillBarcodes } from "../src/lib/product-codes";
import { processProductImage } from "../src/lib/product-images";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: (process.env.DIRECT_URL || process.env.DATABASE_URL)! }) });
const dir = join(__dirname, "..", "prisma", "catalog");

type Item = { sku: string; name: string; brand: string; category: string; packaging: string; perCarton: number; description: string; image: string };

async function main() {
  const catalog = JSON.parse(readFileSync(join(dir, "catalog.json"), "utf8")) as { categories: string[]; brands: string[]; products: Item[] };
  const piece = await db.unit.findFirstOrThrow({ where: { symbol: "PCS" } });
  const carton = await db.unit.findFirstOrThrow({ where: { symbol: "CTN" } });

  const categoryId = new Map<string, string>();
  for (const name of catalog.categories) {
    const c = (await db.category.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ?? (await db.category.create({ data: { name } }));
    categoryId.set(name, c.id);
  }
  const brandId = new Map<string, string>();
  for (const name of catalog.brands) {
    const b = (await db.brand.findFirst({ where: { name: { equals: name, mode: "insensitive" } } })) ?? (await db.brand.create({ data: { name } }));
    brandId.set(name, b.id);
  }

  let created = 0;
  let pictures = 0;
  for (const p of catalog.products) {
    let product = await db.product.findUnique({ where: { sku: p.sku } });
    if (!product) {
      product = await db.product.create({
        data: {
          sku: p.sku,
          name: p.name,
          description: p.description,
          categoryId: categoryId.get(p.category)!,
          brandId: brandId.get(p.brand)!,
          packagingType: p.packaging,
          baseUnitId: piece.id,
          purchasePrice: 0,
          sellingPrice: 0,
          units: { create: [{ unitId: carton.id, factor: p.perCarton }] },
          defaultSalesUnitId: carton.id, // cartons first
          defaultPurchaseUnitId: carton.id,
        },
      });
      await db.auditLog.create({ data: { userName: "Catalog import", action: "catalog.import", entityType: "Product", entityId: product.id, reference: p.sku, after: { name: p.name, perCarton: p.perCarton } } });
      created++;
    }
    if (!(await db.productImage.findUnique({ where: { productId: product.id }, select: { productId: true } }))) {
      const img = await processProductImage(readFileSync(join(dir, "images", p.image)));
      await db.productImage.create({ data: { productId: product.id, mime: img.mime, full: new Uint8Array(img.full), thumb: new Uint8Array(img.thumb), width: img.width, height: img.height } });
      pictures++;
    }
  }
  await backfillBarcodes(db as unknown as Parameters<typeof backfillBarcodes>[0]); // every product gets its own barcode
  console.log(`Catalog: ${created} product(s) created, ${pictures} picture(s) added, ${catalog.products.length - created} already existed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
