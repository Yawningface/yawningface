import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1601,
    strictPort: true,
  },
  build: {
    target: "es2022",
  },
});
