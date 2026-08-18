import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Never collect Stryker's sandbox copies of the suite.
        exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
        coverage: {
            provider: "v8",
            reporter: ["text", "html"],
            include: ["src/**/*.ts"],
            // main.ts is exercised as a real process in test/main.test.ts, and
            // v8 attributes nothing across a spawn — index.ts's reason exactly.
            exclude: ["src/index.ts", "src/main.ts"],
            // Set just below the measured 98.34/93.75/94.28/96.15 — close
            // enough to fire on a real regression, loose enough not to flap.
            thresholds: {
                lines: 96,
                branches: 92,
                functions: 92,
                statements: 94,
            },
        },
    },
});
