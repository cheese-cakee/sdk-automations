/**
 * Negative controls and regression tests for incremental mutation invalidation policy.
 */

import { describe, expect, it } from "vitest";
import {
    discoverWorkspaceDependencies,
    shouldForceMutation,
    type WorkspaceDependencyMap,
} from "./mutation-invalidation.js";

describe("mutation invalidation policy guarantees safe incremental reuse", () => {
    const workspaceDeps: WorkspaceDependencyMap = {
        core: { dependencies: [], consumesTestkit: true },
        probes: { dependencies: ["core"], consumesTestkit: false },
        shell: { dependencies: ["core", "probes", "store"], consumesTestkit: true },
        store: { dependencies: ["core"], consumesTestkit: true },
    };

    it("discovers workspace dependencies accurately from repository manifests", () => {
        const discovered = discoverWorkspaceDependencies();
        expect(discovered.core?.dependencies).toEqual([]);
        expect(discovered.core?.consumesTestkit).toBe(true);

        expect(discovered.store?.dependencies).toEqual(["core"]);
        expect(discovered.store?.consumesTestkit).toBe(true);

        expect(discovered.shell?.dependencies).toEqual(["core", "probes", "store"]);
        expect(discovered.shell?.consumesTestkit).toBe(true);

        expect(discovered.probes?.dependencies).toEqual(["core"]);
        expect(discovered.probes?.consumesTestkit).toBe(false);
    });

    // Control 1: an ordinary changed mutated source file may use incremental mode
    it("permits incremental mode when only mutated source files or test specs changed in the package", () => {
        const changed = [
            "packages/core/src/safety/validator.ts",
            "packages/core/test/safety/validator.test.ts",
        ];
        const decision = shouldForceMutation("core", changed, workspaceDeps);
        expect(decision.force).toBe(false);
    });

    // Control 2: a package-local helper change forces a full run
    it("forces a full mutation run when a package-local test helper or fixture changes", () => {
        const helperChanged = ["packages/core/test/config/builders.ts"];
        expect(shouldForceMutation("core", helperChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/test/config/builders.ts",
        });

        const storeHelperChanged = ["packages/store/test/worker-build.ts"];
        expect(shouldForceMutation("store", storeHelperChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/store/test/worker-build.ts",
        });

        const configDocumentChanged = ["packages/core/test/config/documents.ts"];
        expect(shouldForceMutation("core", configDocumentChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/test/config/documents.ts",
        });
    });

    it("forces a full mutation run when package configuration changes", () => {
        expect(
            shouldForceMutation("core", ["packages/core/stryker.config.json"], workspaceDeps),
        ).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/stryker.config.json",
        });
        expect(
            shouldForceMutation("core", ["packages/core/vitest.config.ts"], workspaceDeps),
        ).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/vitest.config.ts",
        });
        expect(shouldForceMutation("core", ["packages/core/tsconfig.json"], workspaceDeps)).toEqual(
            {
                force: true,
                reason: "package-local helper, fixture, or configuration changed: packages/core/tsconfig.json",
            },
        );
        expect(shouldForceMutation("core", ["packages/core/package.json"], workspaceDeps)).toEqual({
            force: true,
            reason: "package-local helper, fixture, or configuration changed: packages/core/package.json",
        });
    });

    // Control 3: a shared testkit helper or fixture change forces affected packages
    it("forces a full run on every package consuming testkit when testkit changes", () => {
        const testkitCodeChanged = ["packages/dev/testkit/src/index.ts"];
        expect(shouldForceMutation("core", testkitCodeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/src/index.ts",
        });
        expect(shouldForceMutation("store", testkitCodeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/src/index.ts",
        });
        expect(shouldForceMutation("shell", testkitCodeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/src/index.ts",
        });
        // probes does not consume testkit
        expect(shouldForceMutation("probes", testkitCodeChanged, workspaceDeps)).toEqual({
            force: false,
        });

        const fixtureChanged = ["packages/dev/testkit/fixtures/issues.opened.json"];
        expect(shouldForceMutation("core", fixtureChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "shared testkit changed: packages/dev/testkit/fixtures/issues.opened.json",
        });
    });

    // Control 4: a relevant workspace dependency change forces the dependent package
    it("forces a full run on dependent packages when a workspace dependency changes", () => {
        const coreChanged = ["packages/core/src/types.ts"];

        // store depends on core
        expect(shouldForceMutation("store", coreChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'core' changed: packages/core/src/types.ts",
        });

        // shell depends on core
        expect(shouldForceMutation("shell", coreChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'core' changed: packages/core/src/types.ts",
        });

        // probes depends on core
        expect(shouldForceMutation("probes", coreChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'core' changed: packages/core/src/types.ts",
        });

        // core itself changed only source, so core uses incremental mode
        expect(shouldForceMutation("core", coreChanged, workspaceDeps)).toEqual({
            force: false,
        });

        // store changed: forces shell (which depends on store), but not core or probes
        const storeChanged = ["packages/store/src/index.ts"];
        expect(shouldForceMutation("shell", storeChanged, workspaceDeps)).toEqual({
            force: true,
            reason: "workspace dependency 'store' changed: packages/store/src/index.ts",
        });
        expect(shouldForceMutation("core", storeChanged, workspaceDeps)).toEqual({
            force: false,
        });
        expect(shouldForceMutation("probes", storeChanged, workspaceDeps)).toEqual({
            force: false,
        });
    });

    // Control 5: a documentation-only change does not force unrelated full mutation runs
    it("does not force full runs on documentation-only changes", () => {
        const docChanges = [
            "README.md",
            "CONTRIBUTING.md",
            "design/architecture.md",
            "design/operations/threat-model.md",
            "docs/guide.md",
            "packages/dev/lab/protocols/6.2-webhook-delivery.md",
            "packages/dev/checks/README.md",
        ];
        expect(shouldForceMutation("core", docChanges, workspaceDeps)).toEqual({ force: false });
        expect(shouldForceMutation("probes", docChanges, workspaceDeps)).toEqual({ force: false });
        expect(shouldForceMutation("shell", docChanges, workspaceDeps)).toEqual({ force: false });
        expect(shouldForceMutation("store", docChanges, workspaceDeps)).toEqual({ force: false });
    });

    it("forces all packages when global lockfile or root configuration changes", () => {
        for (const file of [
            "pnpm-lock.yaml",
            "package.json",
            "pnpm-workspace.yaml",
            "tsconfig.json",
        ]) {
            expect(shouldForceMutation("core", [file], workspaceDeps)).toEqual({
                force: true,
                reason: `global dependency or configuration file changed: ${file}`,
            });
            expect(shouldForceMutation("store", [file], workspaceDeps)).toEqual({
                force: true,
                reason: `global dependency or configuration file changed: ${file}`,
            });
        }
    });
});
