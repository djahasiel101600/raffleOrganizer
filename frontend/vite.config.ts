import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Backend proxy shared by the dev and preview servers.
const backendProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
  // Uploaded ticket background images are served by Django under /media.
  // The API returns root-relative URLs, so without this proxy the browser
  // would request them from the Vite origin and get a 404 (the background
  // would never show in the designer or on the printed sheet).
  "/media": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
  "/ws": {
    target: "ws://127.0.0.1:8000",
    ws: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Listen on all interfaces so http://127.0.0.1:5173 and
    // http://localhost:5173 (IPv4 or IPv6) both reach the app.
    host: true,
    port: 5173,
    proxy: backendProxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy: backendProxy,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});