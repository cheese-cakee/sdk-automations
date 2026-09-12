import { CAPABILITIES } from "@hiero-hackers/automation-capabilities";
import type { DeclaredTrigger, RequiredMappings } from "@hiero-hackers/automation-core";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeNewlines, repoRoot, repositoryFiles } from "./repository.js";

export interface ShippedCapability {
    readonly name: string;
    readonly folder: string;
    readonly triggers: readonly DeclaredTrigger[];
    readonly configKeys: readonly string[];
    readonly requiredMappings: RequiredMappings;
    readonly intents: readonly string[];
    readonly purpose: string;
}

function designPurpose(folder: string): string {
    const page = join(repoRoot, folder, "design.md");
    if (!existsSync(page)) throw new Error(`${folder} has no design.md`);
    const title = normalizeNewlines(readFileSync(page, "utf8")).split("\n")[0] ?? "";
    const purpose = /^# [A-Za-z-]+ — (.+)$/.exec(title)?.[1];
    if (purpose === undefined) {
        throw new Error(`${folder}/design.md's title is not "# name — purpose"`);
    }
    return purpose;
}

export function shippedCapabilities(): readonly ShippedCapability[] {
    return CAPABILITIES.map(({ declaration }) => {
        const folder = `packages/capabilities/src/${declaration.name}`;
        return {
            name: declaration.name,
            folder,
            triggers: declaration.triggers,
            configKeys: declaration.configKeys,
            requiredMappings: declaration.requiredMappings,
            intents: declaration.intents,
            purpose: designPurpose(folder),
        };
    });
}

export function declaredCapabilityNames(): readonly string[] {
    return [
        ...new Set(
            repositoryFiles()
                .map((path) => /^packages\/capabilities\/src\/([A-Za-z]+)\//.exec(path)?.[1])
                .filter((name): name is string => name !== undefined),
        ),
    ].sort();
}
