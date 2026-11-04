import "dotenv/config";
import { defineConfig } from "prisma/config";

// The CLI (migrate, studio) uses the DIRECT (non-pooled) Neon connection.
// The app and worker connect with the pooled DATABASE_URL in lib/db/client.ts.
// process.env (not env()) so `prisma generate` works without a .env file.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL,
  },
});
