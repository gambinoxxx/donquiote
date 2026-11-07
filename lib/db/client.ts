// One shared Prisma client for app/ and worker/. Must not import Next.js.
import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { z } from "zod";
import { PrismaClient } from "./generated/client";

// Node 22+ has a global WebSocket; the Neon driver uses it for pooled queries.
neonConfig.webSocketConstructor = WebSocket;

const dbEnvSchema = z.object({
  DATABASE_URL: z.url(),
});

function createClient(): PrismaClient {
  const parsed = dbEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Never include the value itself in the message.
    throw new Error("DATABASE_URL is missing or not a valid URL");
  }
  const adapter = new PrismaNeon({ connectionString: parsed.data.DATABASE_URL });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as typeof globalThis & {
  __dgPrisma?: PrismaClient;
  /** The PrismaClient class the cached client was built from. */
  __dgPrismaClass?: typeof PrismaClient;
};

/**
 * Returns the shared Prisma client, creating it on first use. Created lazily
 * so importing this module (e.g. during `next build`) never needs the env var.
 * Cached on globalThis so dev hot reload does not open new pools.
 */
export function getDb(): PrismaClient {
  // After `prisma generate` (a new migration), dev hot reload brings a new
  // PrismaClient class while the old client is still cached: rebuild it, or
  // new tables are missing (e.g. "settingsVersion is undefined").
  if (globalForDb.__dgPrisma && globalForDb.__dgPrismaClass !== PrismaClient) {
    void globalForDb.__dgPrisma.$disconnect().catch(() => {});
    globalForDb.__dgPrisma = undefined;
  }
  if (!globalForDb.__dgPrisma) {
    globalForDb.__dgPrisma = createClient();
    globalForDb.__dgPrismaClass = PrismaClient;
  }
  return globalForDb.__dgPrisma;
}
