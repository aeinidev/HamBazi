import { parseRoomStartParam } from "@hambazi/contracts";
import { z } from "zod";

/** Navigation intent only. Every read/mutation still requires the existing server session. */
export function kahrobaLaunch(value: string | undefined) {
  if (value === "kahroba_test") return { kind: "testing" as const };
  if (value?.startsWith("kahroba_test_")) {
    const id = z.uuid().safeParse(value.slice(13));
    if (id.success) return { kind: "testing" as const, roomId: id.data };
  }
  if (parseRoomStartParam(value)) return { kind: "invite" as const, startParam: value! };
  return undefined;
}
