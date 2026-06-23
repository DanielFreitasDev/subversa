import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Separa as libs pesadas (realce e animação) do bundle principal — reduz o
  // tamanho do chunk inicial e o cold-start do webview.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          highlight: ["lowlight"],
          motion: ["framer-motion"],
        },
      },
    },
  },

  // Opções do Vite adaptadas ao desenvolvimento com Tauri.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
