import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { adminCommandResultSchema } from "@hambazi/validation";
import { OperationFlow } from "../../src/features/management/index.js";

it("keeps new and legacy ban requests read-only even for OWNER with old grants", () => {
  const id = "33333333-3333-4333-8333-333333333333";
  const action = {
    operation: "USER_STATUS" as const,
    targetId: id,
    expectedVersion: 0,
    status: "BANNED" as const,
  };
  for (const state of [null, "PENDING", "APPROVED", "UNKNOWN"] as const) {
    const existing = state
      ? adminCommandResultSchema.parse({
          schemaVersion: 1,
          commandId: id,
          operation: action.operation,
          targetId: id,
          actorId: id,
          action,
          reasonCode: "MAINTENANCE",
          digest: "a".repeat(64),
          state,
          mode: "OWNER_FINAL",
          expiresAt: "2026-10-28T00:00:00.000Z",
          resultCode: null,
        })
      : undefined;
    const html = renderToStaticMarkup(
      <OperationFlow
        action={action}
        {...(existing ? { existing } : {})}
        isOwner
        permissions={["users.manage", "users.approve"]}
        csrf="synthetic-csrf"
        refreshed={async () => {}}
        completed={() => {}}
      />,
    );
    expect(html).toContain("این درخواست فقط قابل مشاهده است");
    expect(html).toContain(id);
    expect(html).not.toMatch(
      /<form|<input|ثبت درخواست تأیید|تأیید همین عملیات|اجرای همین درخواست|درخواست تأیید تازه/,
    );
  }
});
