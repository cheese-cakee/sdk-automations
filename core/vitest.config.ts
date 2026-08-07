import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Never collect Stryker's sandbox copies of the suite.
        exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts"],
            thresholds: {
                lines: 80,
                branches: 80,
                functions: 80,
                statements: 80,
            },
        },
    },
});
