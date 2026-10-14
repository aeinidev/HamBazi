import { useQuery } from "@tanstack/react-query";
import { lobbyAvailabilitySchema } from "../../platform/contracts.js";
import { useRuntime, useSession } from "../../ui/shared.js";

export function useLobbyAvailability() {
  const runtime = useRuntime();
  const session = useSession((s) => s.session);
  return useQuery({
    queryKey: ["lobby-availability", session?.sessionId],
    queryFn: ({ signal }) =>
      runtime.http(
        "/v1/games/availability",
        lobbyAvailabilitySchema,
        undefined,
        "GET",
        true,
        signal,
      ),
    enabled: !!session,
    staleTime: 5000,
  });
}
export function availabilityLabel(state: string | undefined) {
  return state === "AVAILABLE"
    ? "فعال"
    : state === "TEMPORARILY_DISABLED"
      ? "موقتاً غیرفعال"
      : state === "COMING_SOON"
        ? "به‌زودی"
        : "در حال بررسی";
}
