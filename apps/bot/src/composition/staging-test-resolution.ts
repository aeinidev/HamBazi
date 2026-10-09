import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { parseStagingTestResolutionConfig } from "@hambazi/config";
import { createStagingTestIdentityObserver } from "../staging-test-identity.js";

export const stagingTestIdentityPath = "/tmp/hambazi-staging-test-identity.json";
export function createStagingTestResolution(
  env: Readonly<Record<string, string | undefined>>,
  botId: string,
  botUsername: string,
) {
  const config = parseStagingTestResolutionConfig(env);
  if (!config) return undefined;
  return createStagingTestIdentityObserver({
    username: config.username,
    botId,
    botUsername,
    now: Date.now,
    async writeOnce(identity) {
      let file;
      try {
        file = await open(
          stagingTestIdentityPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
      } catch (error) {
        if ((error as { code?: string }).code === "EEXIST") return;
        throw new Error("STAGING_TEST_IDENTITY_WRITE_FAILED", { cause: error });
      }
      try {
        await file.writeFile(JSON.stringify(identity) + "\n");
      } finally {
        await file.close();
      }
    },
  });
}
