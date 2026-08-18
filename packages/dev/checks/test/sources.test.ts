/**
 * Source files stay readable to text tools — born from a NUL byte that made a
 * source file read as binary to grep, which nothing else reports.
 * One invariant per file (D89).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, sourceFiles } from "./repository.js";

describe("source files stay readable to text tools", () => {
    const files = sourceFiles();

    it("finds the workspace's TypeScript sources", () => {
        // A walk that silently returned nothing makes the check below vacuous.
        expect(files.length).toBeGreaterThan(20);
    });

    it("contains no control characters that make a file read as binary", () => {
        // Tab, newline and carriage return only. Anything else in this range
        // makes grep report "Binary file matches" and stops diffs rendering.
        const offenders: string[] = [];
        for (const file of files) {
            const bytes = readFileSync(join(repoRoot, file));
            for (const byte of bytes) {
                if (byte > 0x1f) continue;
                if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
                offenders.push(`${file} (byte 0x${byte.toString(16)})`);
                break;
            }
        }
        expect(offenders).toEqual([]);
    });
});
