/**
 * Where one protocol run keeps its evidence: a directory named for the stamp, the protocol and
 * its slug under the untracked `evidence/`, holding the logs, the run links and a JSONL record.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceLog } from "../evidence.js";

const EVIDENCE_DIR = fileURLToPath(new URL("../../evidence/", import.meta.url));

export interface Evidence {
    readonly directory: string;
    /** Writes a whole file into the directory. */
    write(name: string, text: string): void;
    /** Appends a line to a file in the directory. */
    append(name: string, line: string): void;
    record(step: string, detail: Readonly<Record<string, unknown>>): void;
}

/** A UTC instant spelled for a directory name: no colons, no fraction. */
export function stampOf(at: Date): string {
    return at
        .toISOString()
        .replace(/\.\d+Z$/, "Z")
        .replace(/:/g, "-");
}

export function evidenceName(stamp: string, id: string, slug: string): string {
    return `${stamp}-${id}-${slug}`;
}

export function createEvidence(
    stamp: string,
    id: string,
    slug: string,
    root = EVIDENCE_DIR,
): Evidence {
    const directory = join(root, evidenceName(stamp, id, slug));
    mkdirSync(directory, { recursive: true });
    const log = new EvidenceLog(`action-${id}`, stamp, directory);
    return {
        directory,
        write: (name, text) => writeFileSync(join(directory, name), text),
        append: (name, line) => appendFileSync(join(directory, name), `${line}\n`),
        record: (step, detail) => void log.record(step, detail),
    };
}
