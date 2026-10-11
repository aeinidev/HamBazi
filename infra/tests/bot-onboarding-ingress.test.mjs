import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
it("allows only the exact Bot webhook with verified private TLS and stripped untrusted headers", async () => {
  const routes = await readFile(
    new URL("../docker/staging/bot-onboarding.routes.conf", import.meta.url),
    "utf8",
  );
  const bot = routes.slice(
    routes.indexOf("  server_name bot-staging.hambazi.top;"),
    routes.indexOf(" listen 8443 ssl default_server;"),
  );
  expect(bot).toContain("location = /v1/telegram/webhook");
  expect(bot).toContain("limit_except POST { deny all; }");
  expect(bot).toContain('if ($args != "") { return 404; }');
  expect(bot).toContain("proxy_pass_request_headers off;");
  expect(bot).toContain("X-Telegram-Bot-Api-Secret-Token $http_x_telegram_bot_api_secret_token");
  expect(bot).toContain("proxy_ssl_verify on;");
  expect(bot).toContain("proxy_ssl_name 10.89.18.11;");
  expect(bot).toContain("proxy_pass https://10.89.18.11:9444;");
  expect(bot).toContain("location / { return 404; }");
  expect(bot).not.toMatch(/X-Forwarded|Authorization|Origin|proxy_ssl_verify off/);
  expect(routes).toContain("location = /v1/auth/telegram-mini-app/registered-session");
  expect(routes).toContain(
    "location = /v1/auth/telegram-mini-app/registered-session-photo {\n" +
      "    limit_except POST OPTIONS { deny all; }\n" +
      "    proxy_pass http://10.89.18.10:8080;\n" +
      "  }",
  );
});
