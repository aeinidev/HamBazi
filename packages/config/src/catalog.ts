import { z } from "zod";
export function parseCatalogConfig(env: Readonly<Record<string, string | undefined>>) {
  const result = z
    .object({
      CATALOG_READ_LIMIT: z
        .string()
        .regex(/^\d+$/)
        .transform(Number)
        .pipe(z.number().int().min(1).max(600)),
    })
    .safeParse(env);
  if (!result.success) throw new Error("Catalog configuration is invalid");
  return Object.freeze({ readLimit: result.data.CATALOG_READ_LIMIT });
}
