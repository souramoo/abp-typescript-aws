import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "modules/*/test/**/*.test.ts", "templates/*/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
  oxc: {
    target: "es2022",
    decorator: { legacy: true },
  },
});
