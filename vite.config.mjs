import { defineConfig } from "vite";

export default defineConfig({
  root: "viewer",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  // PORT is honoured so the dev server can be given a free port when 4173 is
  // already taken by something else on the machine; 4173 stays the default.
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.PORT) || 4173,
  },
});

