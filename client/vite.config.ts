import { defineConfig, loadEnv } from "vite";
import { heyApiPlugin } from "@hey-api/vite-plugin";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, resolve(import.meta.dirname, ".."), "");
  const api = `http://localhost:${env.KITE_PORT ?? 3000}`;

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
          logs: { file: false },
        },
        vite: { apply: "serve" },
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        "@": resolve(import.meta.dirname, "src"),
      },
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
