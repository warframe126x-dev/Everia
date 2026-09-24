import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.9.0") },
  plugins: [react()],
  server: { port: 1420, strictPort: true },
  clearScreen: false,
});
