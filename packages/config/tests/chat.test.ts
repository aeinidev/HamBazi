import { expect, it } from "vitest";
import { parseChatConfig } from "../src/index.js";
it("requires explicit bounded Chat opt-in without selecting retention or enabling services", () => {
  expect(parseChatConfig({})).toBeUndefined();
  const env = {
    CHAT_MESSAGE_LIMIT: "500",
    CHAT_PAGE_LIMIT: "50",
    CHAT_SEND_LIMIT: "10",
    CHAT_READ_LIMIT: "60",
  };
  expect(parseChatConfig(env)).toEqual({
    policy: { messageLimit: 500, pageLimit: 50 },
    sendLimit: 10,
    readLimit: 60,
  });
  for (const key of Object.keys(env)) {
    expect(() => parseChatConfig({ ...env, [key]: undefined })).toThrow(
      "Chat configuration is invalid",
    );
    expect(() => parseChatConfig({ ...env, [key]: "999999" })).toThrow(
      "Chat configuration is invalid",
    );
    expect(() => parseChatConfig({ ...env, [key]: "0" })).toThrow("Chat configuration is invalid");
  }
});
