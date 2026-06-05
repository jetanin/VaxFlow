import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev: proxy /api -> backend (port 4000). prod: nginx ทำ proxy ให้
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
