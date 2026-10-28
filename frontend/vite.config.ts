import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api/diet": { target: "http://127.0.0.1:8006", changeOrigin: true } },
    strictPort: true,
    watch: { ignored: ["**/android/**", "**/ios/**"] },
  },
  test: { include: ["src/**/*.test.ts"] },
});
