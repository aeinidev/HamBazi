import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { browserPolicyPlugin } from "./dev/browser-policy.js";
export default defineConfig({
  plugins: [react(), tailwind(), browserPolicyPlugin()],
  build: { outDir: "dist/client" },
  server: { host: "127.0.0.1" },
});
