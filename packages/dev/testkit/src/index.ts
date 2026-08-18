/**
 * Test-only support shared by more than one package: the captured webhook
 * payloads, and the temp-dir helper every package that touches disk rewrote.
 *
 * Fixtures are MODULE-MEDIATED, never path-read from outside this package.
 * That is the `documents.ts` lesson (D82) stated as an interface: Stryker's
 * sandbox is the mutated package's own directory, so a fixture read by path
 * from somewhere above it is simply absent when the mutants run — the tests
 * pass, kill nothing, and report 0.00%. A fixture reached through a package
 * export travels with the dependency into the sandbox; a fixture reached
 * through `../../other-package/test/…` does not. Hence `bytes()`/`json()`
 * rather than an exported directory path: there is no path to leak.
 *
 * Deliberately absent: config and declaration builders. Core's tests are the
 * ones that want them, and core cannot depend on a package that depends on
 * core — the cycle the architecture check would reject on sight. A helper
 * graduates here only when a SECOND package needs it.
 *
 * The temp directory comes in two shapes, and they are not interchangeable.
 * `withTempDir` is the callback form: the directory's whole life is inside
 * one test or one helper function, where there is no `afterEach` to reach
 * for — the interleaving suite opens and closes its two store handles around
 * one. `useTempDir` is the hook form, and it is here because six suites had
 * hand-rolled the identical beforeEach/afterEach pair.
 */

import { afterEach, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One captured delivery, with the provenance that makes it evidence rather
 * than a payload someone wrote. `synthetic: false` is a type-level claim: a
 * hand-written payload could never be admitted to this array without the
 * field going false-by-widening, which the compiler rejects.
 */
export interface WebhookCapture {
    /** The fixture's filename, and the key `capture()` takes. */
    readonly name: string;
    /** The `X-GitHub-Event` header this delivery arrived under. */
    readonly event: string;
    /** The capture session's date (protocol 7.1). */
    readonly capturedAt: string;
    /** The capture protocol that scrubbed and reviewed it. */
    readonly protocol: string;
    /** Every capture here is a real delivery GitHub sent. */
    readonly synthetic: false;
    /**
     * The raw bytes, as the shell's socket would have received them.
     *
     * `Buffer<ArrayBuffer>` rather than a bare `Buffer`: that is what
     * `readFileSync` returns, and the narrower type is what lets a caller
     * hand these bytes straight to `fetch` as a request body — a bare
     * `Buffer` admits `SharedArrayBuffer` and `BodyInit` does not.
     */
    bytes(): Buffer<ArrayBuffer>;
    /** The parsed payload, as the normalizer would be handed it. */
    json(): unknown;
}

/** The 2026-08-07 session; every fixture in this package came from it. */
const CAPTURED_AT = "2026-08-07";
const PROTOCOL = "7.1";

function makeCapture(name: string): WebhookCapture {
    // The naming scheme IS the header: `<event>.<action>.json`. Recovering
    // the event from the filename keeps one fact in one place.
    const event = name.split(".")[0]!;
    const bytes = (): Buffer<ArrayBuffer> =>
        readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
    return {
        name,
        event,
        capturedAt: CAPTURED_AT,
        protocol: PROTOCOL,
        synthetic: false,
        bytes,
        json: () => JSON.parse(bytes().toString("utf8")) as unknown,
    };
}

/**
 * Every capture the 7.1 session produced, listed rather than discovered: the
 * list is an assertion about what evidence exists, and a directory read would
 * quietly go empty — the vacuous-check shape `checks/` keeps finding.
 */
export const WEBHOOK_CAPTURES: readonly WebhookCapture[] = [
    "issues.opened.json",
    "issues.labeled.json",
    "issues.closed.json",
    "pull_request.opened.json",
    "pull_request.closed.json",
].map(makeCapture);

/** One capture by filename. A typo names the alternatives rather than throwing ENOENT. */
export function capture(name: string): WebhookCapture {
    const found = WEBHOOK_CAPTURES.find((candidate) => candidate.name === name);
    if (found === undefined) {
        const available = WEBHOOK_CAPTURES.map((candidate) => candidate.name).join(", ");
        throw new Error(`no captured fixture named ${name}; available: ${available}`);
    }
    return found;
}

/**
 * Run `fn` against a fresh temporary directory and remove it afterwards,
 * including when `fn` throws — the cleanup is the whole point, since the
 * hand-rolled version in each suite leaked a directory on every failure.
 *
 * An async `fn` RETURNS before its work finishes, so the obvious `finally`
 * deletes the directory out from under a test still using it, and `T`
 * inferring as a promise means the compiler never says so. The removal is
 * chained onto the result instead, which is why the wrong call is not
 * merely documented here — it cannot be written.
 */
export function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    const remove = (): void => {
        rmSync(dir, { recursive: true, force: true });
    };

    let result: T;
    try {
        result = fn(dir);
    } catch (error) {
        remove();
        throw error;
    }

    // `.then` rather than `.finally`, so any thenable is handled and not
    // just a real Promise. The cast restores the caller's own type: the
    // chained promise settles to exactly what `fn` settled to.
    try {
        const thenable = result as PromiseLike<unknown> | undefined;
        if (typeof thenable?.then === "function") {
            return thenable.then(
                (value) => {
                    remove();
                    return value;
                },
                (error: unknown) => {
                    remove();
                    throw error;
                },
            ) as T;
        }
    } catch (error) {
        remove();
        throw error;
    }

    remove();
    return result;
}

/** A per-test temporary directory, and paths inside the CURRENT one. */
export interface TempDirHandle {
    readonly dir: string;
    file(name: string): string;
}

/**
 * Register the hooks for a fresh temporary directory per test. Call this at a
 * suite's top level; read `dir` — or `file("store.sqlite")` — from inside a
 * test or a hook.
 *
 * Hook ORDER is what makes this safe for a suite holding file handles. The
 * caller registers its own hooks after this call, so vitest creates the
 * directory before their `beforeEach` opens anything, and — `afterEach` being
 * LIFO — removes it after their `afterEach` has closed it again.
 */
export function useTempDir(prefix: string): TempDirHandle {
    let current: string | undefined;

    beforeEach(() => {
        current = mkdtempSync(join(tmpdir(), prefix));
    });

    afterEach(() => {
        if (current !== undefined) rmSync(current, { recursive: true, force: true });
        current = undefined;
    });

    const currentDir = (): string => {
        if (current === undefined) {
            throw new Error(
                `useTempDir(${prefix}): no directory outside a test — read it from a test or a hook, not at module load`,
            );
        }
        return current;
    };

    return {
        get dir() {
            return currentDir();
        },
        file: (name) => join(currentDir(), name),
    };
}
