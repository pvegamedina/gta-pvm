import { defineConfig } from "vitest/config";
import path from "node:path";

// Mirrors the path aliases declared in tsconfig.json so unit tests can import
// "@shared/protocol" and "@/..." the same way the app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
