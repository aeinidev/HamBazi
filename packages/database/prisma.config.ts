import { defineConfig } from "prisma/config";

// No implicit .env loading. Only migration commands need credentials.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.MIGRATION_DATABASE_URL ?? "" },
});
