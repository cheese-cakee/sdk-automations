import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Never collect Stryker's sandbox copies of the suite.
        exclude: ["**/node_modules/**", "**/.stryker-tmp/**"],
    },
});
