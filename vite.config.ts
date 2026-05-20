import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In production we ship to GitHub Pages at /locala/. In dev we serve from /.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/locala/" : "/",
  plugins: [react()],
  server: { port: 5173 },
}));
