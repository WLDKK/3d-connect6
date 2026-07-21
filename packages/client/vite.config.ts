import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@connect6/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
  build: {
    // The large renderer is intentionally isolated behind GameBoard's lazy boundary.
    chunkSizeWarningLimit: 1000,
  },
});
