import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const previewIdentity = new URLSearchParams({
  preview: "synthetic",
  user: JSON.stringify({ id: 777000123, first_name: "Preview", username: "hambazi_preview" }),
}).toString();

export default defineConfig(({ command, mode }) => {
  if (command !== "serve" || mode === "production" || process.env.NODE_ENV === "production")
    throw new Error("Local preview is available only through the development server");
  return {
    plugins: [
      react(),
      tailwind(),
      {
        name: "local-preview-telegram-bridge",
        transformIndexHtml() {
          return [
            {
              tag: "meta",
              attrs: { name: "hambazi-local-preview", content: "synthetic" },
              injectTo: "head-prepend",
            },
            {
              tag: "meta",
              attrs: {
                name: "hambazi-coup-preview-match",
                content: "33333333-3333-4333-8333-333333333333",
              },
              injectTo: "head-prepend",
            },
            {
              tag: "script",
              injectTo: "head-prepend",
              children: `window.Telegram = { WebApp: {
  initData: ${JSON.stringify(previewIdentity)},
  colorScheme: "light",
  viewportStableHeight: window.innerHeight,
  ready() {}, expand() {}, onEvent() {}, offEvent() {},
  BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} }
} };`,
            },
          ];
        },
        configureServer(server) {
          if (server.config.server.host !== "127.0.0.1")
            throw new Error("Local preview must bind to 127.0.0.1");
        },
      },
    ],
    server: { host: "127.0.0.1", port: 4173, strictPort: true },
  };
});
