import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // A small pool on a developer's machine (it shares one Postgres with other projects); the default in production.
  const max = Number(process.env.DB_POOL_MAX) || (process.env.NODE_ENV === "production" ? 10 : 5);
  // Timeouts so a sleeping Neon database (it wakes in a second or two) or an exhausted pool answers with an error instead of hanging a page for ever.
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 30_000 }) });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Db = typeof db;
