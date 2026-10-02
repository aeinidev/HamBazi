import { expect, it } from "vitest";
import { probeQueue } from "../../src/queue-connection.js";
it("uses only ready connections and drops all INFO/error details", async () => {
  const client = { status: "ready", info: async () => "PRIVATE_SERVER_METADATA" };
  const transport = { getBackend: () => ({ client: Promise.resolve(client) }) };
  expect(await probeQueue(transport)).toBe(true);
  client.status = "end";
  expect(await probeQueue(transport)).toBe(false);
  client.status = "ready";
  client.info = async () => {
    throw new Error("PRIVATE_REDIS_URL");
  };
  expect(await probeQueue(transport)).toBe(false);
});
