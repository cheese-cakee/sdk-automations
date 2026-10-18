/**
 * The command line of `lab:action`: the flags parsed, the protocols they select, and the
 * arming guard that lists a writing or long protocol as skipped rather than run it half-armed.
 */

export interface Options {
    /** Protocol ids named; `null` is the pre-tag batch. */
    readonly only: readonly string[] | null;
    readonly arm: boolean;
    readonly long: boolean;
    /** Put the sandbox back to dry-run and `ARM_WRITES=false`, run nothing. */
    readonly disarm: boolean;
    readonly engine: string | null;
    readonly sandbox: string | null;
    /** Protocol 9.1's capabilities; none is all. */
    readonly capabilities: readonly string[];
}

export type Parsed =
    | { readonly ok: true; readonly options: Options }
    | { readonly ok: false; readonly error: string };

const VALUED = new Set(["--only", "--engine", "--sandbox", "--capability"]);

const SWITCHES = new Set(["--arm", "--long", "--disarm"]);

const listOf = (value: string): string[] =>
    value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);

/** The flags as options, or the first thing wrong with them. */
export function parseArgs(argv: readonly string[], known: readonly string[]): Parsed {
    const values = new Map<string, string>();
    const switches = new Set<string>();
    for (let at = 0; at < argv.length; at += 1) {
        const flag = argv[at] ?? "";
        if (SWITCHES.has(flag)) switches.add(flag);
        else if (VALUED.has(flag)) {
            const value = argv[at + 1];
            if (value === undefined || value.startsWith("--")) {
                return { ok: false, error: `${flag} needs a value` };
            }
            values.set(flag, value);
            at += 1;
        } else return { ok: false, error: `unknown argument ${flag}` };
    }
    const only = values.has("--only") ? listOf(values.get("--only") ?? "") : null;
    if (only !== null && only.length === 0) return { ok: false, error: "--only names no protocol" };
    const unknown = (only ?? []).filter((id) => !known.includes(id));
    if (unknown.length > 0) {
        return {
            ok: false,
            error: `no protocol ${unknown.join(", ")}; known: ${known.join(", ")}`,
        };
    }
    const engine = values.get("--engine") ?? null;
    if (engine !== null && !/^[0-9a-f]{40}$/.test(engine)) {
        return { ok: false, error: "--engine takes the full sha" };
    }
    const sandbox = values.get("--sandbox") ?? null;
    if (sandbox !== null && !/^[^/\s]+\/[^/\s]+$/.test(sandbox)) {
        return { ok: false, error: "--sandbox takes owner/repo" };
    }
    return {
        ok: true,
        options: {
            only,
            arm: switches.has("--arm"),
            long: switches.has("--long"),
            disarm: switches.has("--disarm"),
            engine,
            sandbox,
            capabilities: listOf(values.get("--capability") ?? ""),
        },
    };
}

export interface Candidate {
    readonly id: string;
    readonly writes: boolean;
    readonly long: boolean;
}

export interface Skip {
    readonly id: string;
    readonly reason: string;
}

/** What runs, in registry order, and what is listed as skipped with the reason. */
export function planOf<T extends Candidate>(
    options: Pick<Options, "only" | "arm" | "long">,
    protocols: readonly T[],
    batch: readonly string[],
): { readonly selected: T[]; readonly skipped: Skip[] } {
    const wanted = options.only ?? batch;
    const selected: T[] = [];
    const skipped: Skip[] = [];
    for (const protocol of protocols.filter(({ id }) => wanted.includes(id))) {
        if (protocol.long && !options.long)
            skipped.push({ id: protocol.id, reason: "runs for hours; needs --long" });
        else if (protocol.writes && !options.arm)
            skipped.push({ id: protocol.id, reason: "writes; needs --arm" });
        else selected.push(protocol);
    }
    return { selected, skipped };
}
