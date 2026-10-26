import { adminErrorSchema } from "@hambazi/validation";
export class AdminClientError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function adminRequest(
  path: string,
  input?: unknown,
  csrfToken?: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/v1/admin/${path}`, {
    method: input === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    ...(signal ? { signal } : {}),
    ...(input === undefined
      ? {}
      : {
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
          body: JSON.stringify(input),
        }),
  });
  if (!response.ok) {
    const error = adminErrorSchema.safeParse(await response.json().catch(() => null));
    throw new AdminClientError(error.success ? error.data.error.code : "ADMIN_UNAVAILABLE");
  }
  return response.json() as Promise<unknown>;
}
