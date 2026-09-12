import tseslint from "typescript-eslint";

export default tseslint.config(
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/.stryker-tmp/**",
            "**/coverage/**",
            ".claude/worktrees/**",
            "pnpm-lock.yaml",
            // Never-tracked local-only trees. CI never sees them, so
            // linting them made `pnpm lint` disagree with CI on exactly
            // the machines that do the work (D95).
            "packages/dev/lab/harness/**",
            "packages/runtime/data/**",
        ],
    },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts"],
        rules: {
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
);