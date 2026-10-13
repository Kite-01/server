import { heyApiPlugin } from "@hey-api/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, ".."), "");
  const api =
    process.env.KITE_API_URL ??
    env.KITE_API_URL ??
    `http://localhost:${env.KITE_PORT ?? 3000}`;

  return {
    plugins: [
      heyApiPlugin({
        config: {
          input: {
            path: `${api}/openapi/json`,
            watch: true,
          },
          output: resolve(import.meta.dirname, "src/api"),
          plugins: [
            "@hey-api/typescript",
            "@hey-api/sdk",
            {
              name: "@hey-api/client-fetch",
              baseUrl: false,
              throwOnError: true,
            },
            "@tanstack/react-query",
          ],
          logs: {
            file: false,
          },
        },
        vite: {
          apply: "serve",
        },
      }),
      react(),
      tailwindcss(),
    ],
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
