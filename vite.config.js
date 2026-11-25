import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The app is deployed as a static site on GitHub Pages under /kelasoffline/.
// During local development Vite serves from /, so only apply the base path
// for production builds.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/kelasoffline/" : "/",
  plugins: [react(), tailwindcss()],
}));
