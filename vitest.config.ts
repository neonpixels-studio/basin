import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "~": `${root}app`,
      "#imports": `${root}tests/__mocks__/nuxt-imports.ts`,
      "#shared": `${root}shared`,
    },
  },
  define: {
    "import.meta.client": true,
  },
  test: {
    environment: "happy-dom",
    environmentOptions: { timezone: "UTC" },
    include: ["tests/**/*.test.{js,ts}"],
    setupFiles: ["tests/setup.ts"],
    globals: true,
    passWithNoTests: true,
  },
});
