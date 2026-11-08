import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations and the seed go through the DIRECT (unpooled) Neon address when it is given; the running app uses DATABASE_URL
    // (the pooled "-pooler" address) through the adapter in src/lib/db.ts. On a laptop with one local database only DATABASE_URL is set.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "",
  },
});
