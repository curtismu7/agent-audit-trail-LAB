import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on AUDIT_TRAIL_PORT (default 6600) and Vite on VITE_PORT (default 6610); /api and /mcp are proxied.
const api = { target: `http://127.0.0.1:${Number(process.env.AUDIT_TRAIL_PORT) || 6600}` };

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 6610, strictPort: true, proxy: { "/api": api, "/mcp": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js" },
});
