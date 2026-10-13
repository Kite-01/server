import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, ".."), "");
  const api =
    process.env.KITE_API_URL ??
    env.KITE_API_URL ??
    `http://localhost:${env.PORT ?? 3000}`;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": resolve(import.meta.dirname, "src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": api,
        "/callback": api,
        "/openapi": api,
      },
    },
  };
});
