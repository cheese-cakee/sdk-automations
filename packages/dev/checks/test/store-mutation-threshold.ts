import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

interface Report {
    readonly files?: Readonly<
        Record<string, { readonly mutants?: readonly { readonly status?: string }[] }>
    >;
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

export function mutationScore(report: Report, path: string): number | null {
    let detected = 0;
    let measured = 0;
    for (const [file, result] of Object.entries(report.files ?? {})) {
        const normalized = file.replaceAll("\\", "/");
        if (!normalized.startsWith(path) && !normalized.includes(`/${path}`)) continue;
        for (const mutant of result.mutants ?? []) {
            if (DETECTED.has(mutant.status ?? "")) {
                detected += 1;
                measured += 1;
            } else if (UNDETECTED.has(mutant.status ?? "")) {
                measured += 1;
            }
        }
    }
    return measured === 0 ? null : (detected / measured) * 100;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const file = process.argv[2];
    const path = process.argv[3];
    const minimum = Number(process.argv[4]);
    if (!file || !path || !Number.isFinite(minimum)) process.exit(2);
    const score = mutationScore(JSON.parse(readFileSync(file, "utf8")) as Report, path);
    if (score === null || score < minimum) {
        console.error(
            `store mutation score ${score?.toFixed(2) ?? "unavailable"} is below ${minimum}`,
        );
        process.exit(1);
    }
    console.log(`store mutation score ${score.toFixed(2)} meets ${minimum}`);
}
