import { parseDocument } from "yaml";

export const REPOSITORY_MODES = ["disabled", "observe", "dry-run", "active"] as const;
export type RepositoryMode = (typeof REPOSITORY_MODES)[number];
export interface LinkedIssueConfig {
    readonly mode: RepositoryMode;
    readonly enabled: boolean;
}
export interface ConfigError {
    readonly code: "documentUnparseable" | "invalidConfiguration" | "unknownKey";
    readonly path: string | null;
    readonly message: string;
}
export type ConfigResult =
    | { readonly ok: true; readonly config: LinkedIssueConfig }
    | { readonly ok: false; readonly errors: readonly ConfigError[] };
const mapping = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
function unknownKeys(
    value: Record<string, unknown>,
    allowed: readonly string[],
    path: string,
): ConfigError[] {
    return Object.keys(value)
        .filter((key) => !allowed.includes(key))
        .map((key) => ({
            code: "unknownKey" as const,
            path: path ? `${path}.${key}` : key,
            message: `unknown key "${path ? `${path}.` : ""}${key}"`,
        }));
}
export function parseConfigDocument(text: string): ConfigResult {
    if (text.trim() === "") return { ok: true, config: { mode: "observe", enabled: false } };
    let value: unknown;
    try {
        const document = parseDocument(text, { uniqueKeys: true });
        if (document.errors.length > 0) throw document.errors[0];
        value = document.toJS();
    } catch (error) {
        return {
            ok: false,
            errors: [{ code: "documentUnparseable", path: null, message: String(error) }],
        };
    }
    if (!mapping(value))
        return {
            ok: false,
            errors: [
                {
                    code: "invalidConfiguration",
                    path: null,
                    message: "configuration must be a mapping",
                },
            ],
        };
    const errors = unknownKeys(value, ["schemaVersion", "mode", "capabilities"], "");
    if (value.schemaVersion !== 1)
        errors.push({
            code: "invalidConfiguration",
            path: "schemaVersion",
            message: "schemaVersion must be 1",
        });
    if (!REPOSITORY_MODES.includes(value.mode as RepositoryMode))
        errors.push({
            code: "invalidConfiguration",
            path: "mode",
            message: "mode must be disabled, observe, dry-run, or active",
        });
    if (!mapping(value.capabilities))
        errors.push({
            code: "invalidConfiguration",
            path: "capabilities",
            message: "capabilities must be a mapping",
        });
    let enabled = false;
    if (mapping(value.capabilities)) {
        errors.push(...unknownKeys(value.capabilities, ["linkedIssue"], "capabilities"));
        const linkedIssue = value.capabilities.linkedIssue;
        if (!mapping(linkedIssue))
            errors.push({
                code: "invalidConfiguration",
                path: "capabilities.linkedIssue",
                message: "linkedIssue must be a mapping",
            });
        else {
            errors.push(
                ...unknownKeys(linkedIssue, ["enabled", "settings"], "capabilities.linkedIssue"),
            );
            if (typeof linkedIssue.enabled !== "boolean")
                errors.push({
                    code: "invalidConfiguration",
                    path: "capabilities.linkedIssue.enabled",
                    message: "enabled must be boolean",
                });
            else enabled = linkedIssue.enabled;
            if (
                linkedIssue.settings !== undefined &&
                (!mapping(linkedIssue.settings) || Object.keys(linkedIssue.settings).length !== 0)
            )
                errors.push({
                    code: "invalidConfiguration",
                    path: "capabilities.linkedIssue.settings",
                    message: "settings must be an empty mapping",
                });
        }
    }
    return errors.length > 0
        ? { ok: false, errors }
        : { ok: true, config: { mode: value.mode as RepositoryMode, enabled } };
}
