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
            // Set just below the measured 96.96/100/100/97.1 — close enough
            // to fire on a real regression, loose enough not to flap.
            thresholds: {
                lines: 95,
                branches: 98,
                functions: 98,
                statements: 95,
            },
        },
    },
});
