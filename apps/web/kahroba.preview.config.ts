import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig(({ command, mode }) => {
  if (command !== "serve" || mode === "production" || process.env.NODE_ENV === "production")
    throw new Error("Kahroba preview requires development mode");
  return {
    plugins: [
      react(),
      tailwind(),
      {
        name: "isolated-kahroba-preview",
        transformIndexHtml: {
          order: "pre",
          handler() {
            return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="hambazi-kahroba-local-preview" content="synthetic"><title>پیش‌نمایش محلی کهربا</title><link rel="stylesheet" href="/src/ui/launch.css"></head><body><div id="root"></div><script type="module" src="/src/dev/kahroba-preview.tsx"></script></body></html>';
          },
        },
        configureServer(server) {
          if (server.config.server.host !== "127.0.0.1")
            throw new Error("Kahroba preview must bind to loopback");
        },
      },
    ],
    server: { host: "127.0.0.1", port: 4183, strictPort: true },
  };
});
