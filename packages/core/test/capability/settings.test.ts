/**
 * The settings toolkit — `design/guides/capability-kits.md` §3.
 *
 * Two halves, in the order a reader meets them. The constructors first, each
 * against the rule its row of §3's table states, and then against what it says
 * about itself; then the six capability designs, whose `automations.yml`
 * examples are the fixtures under `fixtures/settings/`. The second half is the
 * acceptance claim: the toolkit is proved against all six designs before the
 * second capability's code exists.
 *
 * The specs below are the DESIGNS' — including for the three capabilities that
 * have code, whose `settings.ts` today declares only the keys the seed reads.
 * A design's spec lives here until its seed is promoted to it.
 *
 * Two things the fixtures show about today's platform rather than about the
 * toolkit, both pinned rather than worked around:
 *
 * - A design's block is an EXCERPT, so it states no `schemaVersion`; the
 *   harness supplies the one line every document needs.
 * - `mappings` holds four families: three CLOSED (`labels`, `commands`,
 *   `skills`) and one OPEN (`alerts`). Every entry is a spelling string, so a
 *   design naming a family the platform does not have — intake's `types:`
 *   block, whose phase table lists it as work to come — is refused as an
 *   unknown key. `travel` records which family refused a document before
 *   reading the settings without it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    block,
    blocks,
    closed,
    commands,
    count,
    declareCapability,
    describeSpec,
    duration,
    DURATION_PATTERN,
    flag,
    MAX_CLOCK_HOURS,
    meanings,
    MIN_GRACE_HOURS,
    MIN_REAP_HOURS,
    oneOf,
    parseConfig,
    parseDuration,
    parseConfigDocument,
    principal,
    projectCapabilityView,
    readSettings,
    section,
    sections,
    skills,
    SKILL_TIERS,
    spec,
    text,
    texts,
    writeDuration,
    type CapabilityView,
    type ConfigResult,
    type RepositoryConfig,
    type RequiredMappings,
    type SettingsOf,
    type SettingsProblem,
    type SettingsResult,
    type Spec,
    type TypedDeclaration,
} from "../../src/index.js";

// ─── Reading a spec against a repository ─────────────────────────────

/** Everything a design fixture needs from a declaration, and nothing it does not. */
const declarationFor = <const S extends Spec>(
    name: string,
    settings: S,
    requiredMappings: RequiredMappings = {},
) =>
    declareCapability({
        name,
        triggers: [{ kind: "event", event: "issues" }],
        settings,
        requiredMappings,
        facts: ["issue"],
        needs: [],
        resolvers: [],
        intents: ["postManagedComment"],
    });

const fixture = (name: string): string =>
    readFileSync(
        fileURLToPath(new URL(`fixtures/settings/${name}.yml`, import.meta.url)),
        "utf8",
    ).replaceAll("\r\n", "\n");

/**
 * A mapping family a design's block names that today's platform does not
 * have: the one a document may have to shed before the parser will read the
 * rest of it. `types` is intake's, whose phase table lists it as work to come.
 */
const UNSHIPPED_FAMILIES = ["types"];

/**
 * Drop one family from a document's `mappings` section: the
 * family's own line, and the indented lines under it. Line-based on purpose —
 * the fixture must reach the real parser as text, so nothing here may parse it
 * first.
 */
function withoutFamily(document: string, family: string): string {
    const lines = document.split("\n");
    const start = lines.findIndex(
        (line) => line === `  ${family}:` || line.startsWith(`  ${family}: `),
    );
    if (start === -1) return document;
    let end = start + 1;
    while (end < lines.length && (lines[end] === "" || lines[end]?.startsWith("    ") === true)) {
        end += 1;
    }
    return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

/**
 * A section whose every family has just been stripped parses as `null`, which
 * is `notAMapping` rather than "absent" — so the emptied section goes too.
 */
function withoutEmptySections(document: string): string {
    const lines = document.split("\n");
    return lines
        .filter(
            (line, index) => !/^[a-z]+:$/.test(line) || lines[index + 1]?.startsWith("  ") === true,
        )
        .join("\n");
}

/** A parsed fixture, and what today's platform said on the way. */
interface Travelled {
    /** `code @ path` for every error the VERBATIM document draws today. */
    readonly refused: readonly string[];
    /** Which mapping families had to come out before the document would parse. */
    readonly stripped: readonly string[];
    readonly config: RepositoryConfig;
}

/** A design's block as a whole document: an excerpt states no `schemaVersion`. */
function documentOf(name: string): string {
    const verbatim = fixture(name);
    return verbatim.startsWith("schemaVersion") ? verbatim : `schemaVersion: 2\n${verbatim}`;
}

/** `code @ path` for every error one document draws against one declaration. */
const refusalsOf = (result: ConfigResult): readonly string[] =>
    result.ok ? [] : result.errors.map((e) => `${e.code} @ ${String(e.path)}`);

/**
 * Take one design's block through the real boundary: text → document →
 * `RepositoryConfig`. Everything is the file as its design doc wrote it.
 *
 * Since C1 the settings VALUES are read on this journey too, which is why
 * there is no second step: a design whose block travels clean has been read
 * whole, and one that does not throws here with the code that refused it.
 */
function travel(name: string, declaration: TypedDeclaration): Travelled {
    const document = documentOf(name);
    const options = { revision: `rev-${name}`, knownCapabilities: [declaration] };

    // Stripped only when the document as written is refused: a family the
    // parser now reads is one nothing has to come out for.
    const asWritten = parseConfigDocument(document, options);
    const stripped = asWritten.ok
        ? []
        : UNSHIPPED_FAMILIES.filter((family) => withoutFamily(document, family) !== document);
    const shippable = withoutEmptySections(stripped.reduce(withoutFamily, document));
    const result = parseConfigDocument(shippable, options);
    if (!result.ok) throw new Error(`${name}: ${refusalsOf(result).join(", ")}`);
    return { refused: refusalsOf(asWritten), stripped, config: result.config };
}

/**
 * The parsed fixture put back through the parser with one capability's
 * settings block swapped — how a suite says "this file, but with that value
 * wrong" now that a value is judged WITH the file.
 *
 * No YAML on the way back: a `RepositoryConfig`'s `mappings` and `principals`
 * are already in the shape a document writes them in. Its resolved SETTINGS
 * are not — an optional `text` resolves to `null`, which a document may not
 * write — so a caller spreading a resolved block states the fields it means
 * rather than handing back everything the parser materialised.
 */
function withSettings(
    config: RepositoryConfig,
    declaration: TypedDeclaration,
    settings: Readonly<Record<string, unknown>>,
): ConfigResult {
    return parseConfig(
        {
            schemaVersion: 2,
            mode: config.mode,
            capabilities: { [declaration.name]: { enabled: true, ...settings } },
            mappings: config.mappings,
            principals: config.principals,
        },
        { revision: config.revision, knownCapabilities: [declaration] },
    );
}

/** The view a fixture's capability receives — its settings already resolved. */
const viewOf = <const D extends TypedDeclaration>(declaration: D, config: RepositoryConfig) =>
    projectCapabilityView(declaration, config);

/** A view built by hand, for the constructor tests that want no document. */
function view(
    settings: Readonly<Record<string, unknown>>,
    of: {
        meanings?: string[];
        commands?: string[];
        skills?: string[];
        alerts?: string[];
        principals?: string[];
    } = {},
): CapabilityView<TypedDeclaration> {
    return {
        settings,
        mapped: {
            labels: (of.meanings ?? []) as [],
            commands: (of.commands ?? []) as [],
            skills: (of.skills ?? []) as [],
            alerts: of.alerts ?? [],
        },
        principals: of.principals ?? [],
    };
}

/**
 * One read, through the toolkit's document-level signature.
 *
 * `readSettings` takes the document's names and the raw block separately,
 * because the parser holds them separately. The constructor suites below state
 * both as one object — which is what a view is — so the split happens here
 * rather than at ninety call sites.
 */
function readFrom<const S extends Spec>(
    fields: S,
    from: CapabilityView<TypedDeclaration>,
): SettingsResult<SettingsOf<S>> {
    return readSettings(fields, from, from.settings);
}

/** What one read said went wrong, as `path: message`. */
const problemsOf = (result: { ok: boolean; problems?: readonly SettingsProblem[] }): string[] =>
    (result.problems ?? []).map((problem) => `${problem.path}: ${problem.message}`);

// ─── The fifteen constructors ────────────────────────────────────────

describe("flag", () => {
    const fields = spec({ announce: flag({ default: false }) });

    it("reads the boolean the repository wrote", () => {
        expect(readFrom(fields, view({ announce: true }))).toEqual({
            ok: true,
            value: { announce: true },
        });
        expect(readFrom(fields, view({ announce: false }))).toEqual({
            ok: true,
            value: { announce: false },
        });
    });

    it("falls back to the default when the key is absent", () => {
        expect(readFrom(fields, view({}))).toEqual({ ok: true, value: { announce: false } });
        expect(readFrom(spec({ announce: flag({ default: true }) }), view({}))).toEqual({
            ok: true,
            value: { announce: true },
        });
    });

    /** "Truthy is not consent" is the platform's own rule one level down. */
    it("reports a non-boolean rather than reading it as one", () => {
        expect(problemsOf(readFrom(fields, view({ announce: "yes" })))).toEqual([
            "announce: must be true or false",
        ]);
    });
});

describe("duration", () => {
    const fields = spec({ gracePeriod: duration({ default: "7d" }) });

    it("reads a written duration as hours, and defaults when absent", () => {
        expect(readFrom(fields, view({ gracePeriod: "21d" }))).toEqual({
            ok: true,
            value: { gracePeriod: 21 * 24 },
        });
        expect(readFrom(fields, view({ gracePeriod: "4h" }))).toEqual({
            ok: true,
            value: { gracePeriod: 4 },
        });
        expect(readFrom(fields, view({}))).toEqual({
            ok: true,
            value: { gracePeriod: 7 * 24 },
        });
        expect(readFrom(fields, view({ gracePeriod: "0h" }))).toEqual({
            ok: true,
            value: { gracePeriod: 0 },
        });
    });

    /** One spelling: no minutes, no weeks, no mixed units, no fractions. */
    it.each([
        ["a fraction", "14.5d"],
        ["a week", "2w"],
        ["minutes", "90m"],
        ["a mixed unit", "1d4h"],
        ["no unit at all", "14"],
        ["a leading zero", "014d"],
        ["a negative duration", "-1d"],
        ["a number", 7.5],
        ["a boolean", true],
    ])("reports %s rather than guessing at it", (_why, value) => {
        expect(problemsOf(readFrom(fields, view({ gracePeriod: value })))).toEqual([
            'gracePeriod: must be a duration: a whole number of hours or days, written "4h" or "14d"',
        ]);
    });

    /** The mistake worth its own sentence: the unit is the only thing missing. */
    it("shows a bare number the spelling it should have had", () => {
        expect(problemsOf(readFrom(fields, view({ gracePeriod: 14 })))).toEqual([
            'gracePeriod: must be a duration with a unit — write "14d" for days or "14h" for hours',
        ]);
        // `1e3` is YAML's number one thousand, so it meets the same sentence.
        expect(problemsOf(readFrom(fields, view({ gracePeriod: 1e3 })))).toEqual([
            'gracePeriod: must be a duration with a unit — write "1000d" for days or "1000h" for hours',
        ]);
    });

    it("reports a field with no value and no default", () => {
        expect(problemsOf(readFrom(spec({ after: duration() }), view({})))).toEqual([
            "after: must be set to a duration",
        ]);
    });

    /** The floor a destructive clock declares — `atLeast: MIN_REAP_HOURS`. */
    it("refuses a clock below the floor its spec declares", () => {
        const reaper = spec({ reapAfter: duration({ default: "2h", atLeast: MIN_REAP_HOURS }) });
        expect(problemsOf(readFrom(reaper, view({ reapAfter: "1h" })))).toEqual([
            "reapAfter: must be at least 2h",
        ]);
        expect(readFrom(reaper, view({ reapAfter: "2h" }))).toEqual({
            ok: true,
            value: { reapAfter: 2 },
        });
    });

    /** A spec that misspells its own default is a programming error, not a file's. */
    it("throws at construction on a default that is not a duration", () => {
        expect(() => duration({ default: "2w" })).toThrow(
            'duration default "2w" is not a duration',
        );
    });

    /**
     * The ceiling, and the file that found it: `reapAfter: 2147483647`
     * parsed, and `inactivity` then threw `Invalid time value` on every
     * delivery, because the date its warning names landed outside the range a
     * `Date` holds. A clock becomes a date, so a clock has a largest value.
     */
    it.each([
        ["one day past the ceiling", "36501d"],
        ["one hour past the ceiling", `${String(MAX_CLOCK_HOURS + 1)}h`],
        ["a number of days no date can hold", "2147483647d"],
    ])("refuses %s, which is a number no date can hold", (_why, value) => {
        expect(problemsOf(readFrom(fields, view({ gracePeriod: value })))).toEqual([
            "gracePeriod: must be at most 36500d",
        ]);
    });

    /** A century is legal, and it is the longest wait this vocabulary spells. */
    it("reads the ceiling itself", () => {
        expect(readFrom(fields, view({ gracePeriod: "36500d" }))).toEqual({
            ok: true,
            value: { gracePeriod: MAX_CLOCK_HOURS },
        });
    });

    /**
     * The ceiling is judged before the relation, so a maintainer hears about
     * the number they wrote rather than about a gap it made — and the value
     * an inner level INHERITS is bounded by the level that stated it.
     */
    it("names the key that is too large, not the one it is measured against", () => {
        const ladder = spec({
            remindAfter: duration({ default: "14d" }),
            reapAfter: duration({ inherits: "remindAfter", above: ["remindAfter", 24] }),
        });
        expect(problemsOf(readFrom(ladder, view({ reapAfter: "36501d" })))).toEqual([
            "reapAfter: must be at most 36500d",
        ]);

        // And from the other side, on the shape a real ladder has: a TARGET
        // past the ceiling resolves nothing, so the relation is not compared
        // and the maintainer reads one line about the one number to change,
        // rather than a second line quoting the number that was just refused.
        const withDefaults = spec({
            remindAfter: duration({ default: "14d" }),
            reapAfter: duration({ default: "21d", above: ["remindAfter", 24] }),
        });
        expect(problemsOf(readFrom(withDefaults, view({ remindAfter: "36501d" })))).toEqual([
            "remindAfter: must be at most 36500d",
        ]);
    });
});

describe("the written form", () => {
    it("reads every legal spelling and refuses every other", () => {
        expect(parseDuration("0h")).toBe(0);
        expect(parseDuration("0d")).toBe(0);
        expect(parseDuration("1h")).toBe(1);
        expect(parseDuration("14d")).toBe(336);
        expect(parseDuration("36500d")).toBe(MAX_CLOCK_HOURS);
        for (const written of ["", "14", "14.5d", "2w", "90m", "1d4h", "014d", "-1h", "d", "h14"]) {
            expect(parseDuration(written)).toBeNull();
        }
    });

    /** The pattern the editor schema states and this reader are one set. */
    it("agrees with the pattern the editor schema publishes", () => {
        for (const written of ["0h", "0d", "1h", "14d", "36500d", "14", "2w", "90m", "1d4h"]) {
            expect(DURATION_PATTERN.test(written)).toBe(parseDuration(written) !== null);
        }
    });

    it("writes hours back as the spelling a maintainer would have typed", () => {
        expect(writeDuration(0)).toBe("0h");
        expect(writeDuration(1)).toBe("1h");
        expect(writeDuration(23)).toBe("23h");
        expect(writeDuration(24)).toBe("1d");
        expect(writeDuration(25)).toBe("25h");
        expect(writeDuration(336)).toBe("14d");
        expect(writeDuration(MAX_CLOCK_HOURS)).toBe("36500d");
    });
});

describe("count", () => {
    const fields = spec({ maxOpen: count({ default: 2 }) });

    it("reads a whole number, zero included — what zero MEANS is the capability's", () => {
        expect(readFrom(fields, view({ maxOpen: 0 }))).toEqual({
            ok: true,
            value: { maxOpen: 0 },
        });
        expect(readFrom(fields, view({}))).toEqual({ ok: true, value: { maxOpen: 2 } });
    });

    it.each([
        ["a fraction", 1.5],
        ["a negative cap", -2],
        ["a string", "2"],
    ])("reports %s", (_why, value) => {
        expect(problemsOf(readFrom(fields, view({ maxOpen: value })))).toEqual([
            "maxOpen: must be a whole number, zero or more",
        ]);
    });

    /**
     * A count is never added to an instant, so `days`'s ceiling is not its:
     * `maxOpen: 2147483647` is an absurd cap and an honest one, and the
     * capability's own prose is what says whether it means anything.
     */
    it("has no ceiling of its own", () => {
        expect(readFrom(fields, view({ maxOpen: Number.MAX_SAFE_INTEGER }))).toEqual({
            ok: true,
            value: { maxOpen: Number.MAX_SAFE_INTEGER },
        });
    });

    /**
     * What `0` means is said in the sentence or nowhere: the description
     * carries the `doc` its constructor was given and invents no reading of
     * zero, so a generated page or schema cannot promise one either.
     */
    it("says what zero means only when the capability's sentence says it", () => {
        expect(count({ default: 0 }).describe().doc).toBe(null);
        expect(count({ default: 0, doc: "How many at once; 0 is uncapped" }).describe().doc).toBe(
            "How many at once; 0 is uncapped",
        );
    });
});

describe("text", () => {
    it("reads a string, and renders without it when it is optional", () => {
        const fields = spec({ guide: text({ optional: true }) });
        expect(readFrom(fields, view({ guide: "https://example.test/signing" }))).toEqual({
            ok: true,
            value: { guide: "https://example.test/signing" },
        });
        expect(readFrom(fields, view({}))).toEqual({ ok: true, value: { guide: null } });
    });

    it("reports an absent required string, and a non-string either way", () => {
        expect(problemsOf(readFrom(spec({ guide: text({ optional: false }) }), view({})))).toEqual([
            "guide: must be set",
        ]);
        expect(
            problemsOf(readFrom(spec({ guide: text({ optional: true }) }), view({ guide: 7 }))),
        ).toEqual(["guide: must be text"]);
    });
});

describe("meanings", () => {
    const fields = spec({ claimableOnlyWhen: meanings() });

    it("reads the mapped meanings a guard names, and an absent list as none", () => {
        expect(
            readFrom(
                fields,
                view({ claimableOnlyWhen: ["ready"] }, { meanings: ["ready", "blocked"] }),
            ),
        ).toEqual({ ok: true, value: { claimableOnlyWhen: ["ready"] } });
        expect(readFrom(fields, view({}))).toEqual({
            ok: true,
            value: { claimableOnlyWhen: [] },
        });
        expect(readFrom(fields, view({ claimableOnlyWhen: [] }))).toEqual({
            ok: true,
            value: { claimableOnlyWhen: [] },
        });
    });

    /** A guard naming a meaning demands its mapping, and says which entry. */
    it("reports every unmapped entry at its own dotted path", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({ claimableOnlyWhen: ["ready", "blocked"] }, { meanings: ["ready"] }),
                ),
            ),
        ).toEqual(['claimableOnlyWhen.1: "blocked" is not a meaning this repository has mapped']);
    });

    it("reports a list that is not a list", () => {
        expect(problemsOf(readFrom(fields, view({ claimableOnlyWhen: "ready" })))).toEqual([
            "claimableOnlyWhen: must be a list of meanings",
        ]);
    });
});

/**
 * The other two families, on `meanings()`'s pattern. Each reads its OWN family
 * and no other, which is the claim worth making: a reader that reached for
 * `mapped.labels` would pass every test above and let a capability gate on a
 * command the repository never mapped.
 */
describe("commands and skills", () => {
    const fields = spec({ answersTo: commands(), gates: skills() });
    const repository = {
        meanings: ["ready"],
        commands: ["assign", "working"],
        skills: ["beginner"],
    };

    it("reads each family's own mapped names, and an absent list as none", () => {
        expect(readFrom(fields, view({ answersTo: ["working"] }, repository))).toEqual({
            ok: true,
            value: { answersTo: ["working"], gates: [] },
        });
        expect(readFrom(fields, view({ gates: ["beginner"] }, repository))).toEqual({
            ok: true,
            value: { answersTo: [], gates: ["beginner"] },
        });
    });

    it("does not let one family satisfy another, and says so in that family's words", () => {
        expect(
            problemsOf(
                readFrom(fields, view({ answersTo: ["beginner"], gates: ["ready"] }, repository)),
            ),
        ).toEqual([
            'answersTo.0: "beginner" is not a command this repository has mapped',
            'gates.0: "ready" is not a skill tier this repository has mapped',
        ]);
    });

    it("reports a list that is not a list, in each family's plural", () => {
        expect(
            problemsOf(readFrom(fields, view({ answersTo: "/assign", gates: "beginner" }))),
        ).toEqual([
            "answersTo: must be a list of commands",
            "gates: must be a list of skill tiers",
        ]);
    });
});

describe("principal", () => {
    const fields = spec({ notify: principal({ optional: false }) });

    it("reads the NAME of a principal the document declares", () => {
        expect(
            readFrom(
                fields,
                view({ notify: "maintainerTeam" }, { principals: ["maintainerTeam"] }),
            ),
        ).toEqual({ ok: true, value: { notify: "maintainerTeam" } });
    });

    it("renders without the ping when it is optional and absent", () => {
        expect(readFrom(spec({ notify: principal({ optional: true }) }), view({}))).toEqual({
            ok: true,
            value: { notify: null },
        });
    });

    it("reports a name the document never declared, and an absent required one", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({ notify: "triageTeam" }, { principals: ["maintainerTeam"] }),
                ),
            ),
        ).toEqual(['notify: "triageTeam" is not a principal this repository declares']);
        expect(problemsOf(readFrom(fields, view({})))).toEqual(["notify: must name a principal"]);
        expect(problemsOf(readFrom(fields, view({ notify: 7 })))).toEqual([
            "notify: must name a principal",
        ]);
    });
});

describe("section", () => {
    const fields = spec({
        onOpen: section({ label: flag({ default: false }), welcome: flag({ default: true }) }),
    });

    it("reads every inner field, with no consent of its own to ask for", () => {
        expect(readFrom(fields, view({ onOpen: { label: true, welcome: false } }))).toEqual({
            ok: true,
            value: { onOpen: { label: true, welcome: false } },
        });
    });

    /** The difference from `block`, stated as a claim: absent is defaults, not parked. */
    it("reads an absent section as every field at its default", () => {
        expect(readFrom(fields, view({}))).toEqual({
            ok: true,
            value: { onOpen: { label: false, welcome: true } },
        });
        expect(readFrom(fields, view({ onOpen: {} }))).toEqual({
            ok: true,
            value: { onOpen: { label: false, welcome: true } },
        });
    });

    it("reports its own problems at their nested paths, and a section that is not a mapping", () => {
        expect(problemsOf(readFrom(fields, view({ onOpen: { label: "yes" } })))).toEqual([
            "onOpen.label: must be true or false",
        ]);
        expect(problemsOf(readFrom(fields, view({ onOpen: "on" })))).toEqual([
            "onOpen: must be a mapping",
        ]);
    });

    it("nests, so a station's advisory group is a group of its own", () => {
        const nested = spec({
            approval: section({
                confirm: flag({ default: false }),
                checklist: section({ skillTier: flag({ default: false }) }),
            }),
        });

        expect(readFrom(nested, view({ approval: { confirm: true } }))).toEqual({
            ok: true,
            value: { approval: { confirm: true, checklist: { skillTier: false } } },
        });
    });

    /** A section is a level, so §3.1 walks through it exactly as it walks a block. */
    it("passes the cascade and the above relation through, level for level", () => {
        const laddered = spec({
            remindAfter: duration({ default: "14d" }),
            reapAfter: duration({ default: "21d" }),
            tiers: section({
                reapAfter: duration({ inherits: "reapAfter" }),
                strict: section({
                    reapAfter: duration({
                        inherits: "reapAfter",
                        above: ["remindAfter", MIN_GRACE_HOURS],
                    }),
                }),
            }),
        });

        expect(readFrom(laddered, view({ tiers: { reapAfter: "60d" } }))).toEqual({
            ok: true,
            value: {
                remindAfter: 14 * 24,
                reapAfter: 21 * 24,
                tiers: { reapAfter: 60 * 24, strict: { reapAfter: 60 * 24 } },
            },
        });
        expect(
            problemsOf(readFrom(laddered, view({ tiers: { strict: { reapAfter: "14d" } } }))),
        ).toEqual(["tiers.strict.reapAfter: must be at least 1h above remindAfter (14d)"]);
    });

    /**
     * A DOTTED `inherits`, which is what a level whose clock sits inside a
     * group of its own needs (§3.1). Three claims in one spec: an enclosing
     * level that states the whole path answers, one that states the group but
     * not the leaf is walked PAST rather than read as nothing, and the root's
     * declared default is found through the group it sits in.
     */
    it("walks a dotted inherits, past any level that states only half of it", () => {
        const nested = spec({
            reap: section({ after: duration({ default: "21d" }) }),
            tiers: section({
                reap: block({ after: duration({ inherits: "reap.after" }) }),
                strict: section({
                    reap: block({ after: duration({ inherits: "reap.after" }) }),
                }),
            }),
        });

        // The enclosing level states the whole path: both levels take 60d.
        expect(
            readFrom(nested, view({ tiers: { reap: { enabled: true, after: "60d" } } })),
        ).toEqual({
            ok: true,
            value: {
                reap: { after: 21 * 24 },
                tiers: {
                    reap: { enabled: true, after: 60 * 24 },
                    strict: { reap: { enabled: false } },
                },
            },
        });

        // A `reap:` with no `after` in it resolves nothing, so the walk keeps
        // going and the root's own default is what answers.
        expect(readFrom(nested, view({ tiers: { reap: { enabled: true }, strict: {} } }))).toEqual({
            ok: true,
            value: {
                reap: { after: 21 * 24 },
                tiers: {
                    reap: { enabled: true, after: 21 * 24 },
                    strict: { reap: { enabled: false } },
                },
            },
        });
    });
});

/**
 * D4 — the defect the sweep was generalised for: D84's unknown-key sweep
 * reaches the TOP of a settings block and stops, so a group reader that walked
 * its spec's keys and never looked at the file's left `mergedPRz:` counting
 * nothing and saying nothing. Every group constructor sweeps now, so the DEPTH
 * a mistake sits at no longer decides whether a maintainer hears about it.
 */
describe("the unknown-key sweep every group makes (D4)", () => {
    it("a section reports a key its spec does not name, at that key's own path", () => {
        const fields = spec({ onOpen: section({ label: flag({ default: false }) }) });

        expect(problemsOf(readFrom(fields, view({ onOpen: { label: true, labl: true } })))).toEqual(
            ['onOpen.labl: "labl" is not one of label'],
        );
    });

    it("reaches the bottom of a nest, not only the group the mistake's parent is in", () => {
        const fields = spec({
            approval: section({ checklist: section({ skillTier: flag({ default: false }) }) }),
        });

        expect(
            problemsOf(readFrom(fields, view({ approval: { checklist: { skillTierz: true } } }))),
        ).toEqual(['approval.checklist.skillTierz: "skillTierz" is not one of skillTier']);
    });

    it("a block counts its consent among its own keys, and nothing else", () => {
        const fields = spec({ pullRequests: block({ reapAfter: count({ default: 0 }) }) });

        expect(
            problemsOf(
                readFrom(fields, view({ pullRequests: { enabled: true, reapAfter: 5, nope: 1 } })),
            ),
        ).toEqual(['pullRequests.nope: "nope" is not one of enabled, reapAfter']);
    });

    it("a parked block sweeps nothing: its fields were never read", () => {
        const fields = spec({ pullRequests: block({ reapAfter: count({ default: 0 }) }) });

        expect(readFrom(fields, view({ pullRequests: { enabled: false, nope: 1 } }))).toEqual({
            ok: true,
            value: { pullRequests: { enabled: false } },
        });
    });

    it("each entry of a mapping of groups sweeps as the group it is", () => {
        const asSections = spec({ pillars: sections({ atLeast: count({ default: 0 }) }) });
        const asBlocks = spec({ roles: blocks({ atLeast: count({ default: 0 }) }) });

        expect(
            problemsOf(readFrom(asSections, view({ pillars: { mergedPRs: { atLeest: 1 } } }))),
        ).toEqual(['pillars.mergedPRs.atLeest: "atLeest" is not one of atLeast']);
        expect(
            problemsOf(readFrom(asBlocks, view({ roles: { committer: { enabled: true, x: 1 } } }))),
        ).toEqual(['roles.committer.x: "x" is not one of enabled, atLeast']);
    });

    it("names what a group with no fields of its own takes, which is nothing", () => {
        const fields = spec({ marker: section({}) });

        expect(problemsOf(readFrom(fields, view({ marker: { anything: 1 } })))).toEqual([
            'marker.anything: "anything" is not a setting this group takes',
        ]);
    });

    it("reports a stranger and a bad field together, so one push fixes both", () => {
        const fields = spec({ onOpen: section({ label: flag({ default: false }) }) });
        const consented = spec({ pullRequests: block({ label: flag({ default: false }) }) });

        expect(problemsOf(readFrom(fields, view({ onOpen: { label: "yes", nope: 1 } })))).toEqual([
            'onOpen.nope: "nope" is not one of label',
            "onOpen.label: must be true or false",
        ]);
        expect(
            problemsOf(
                readFrom(
                    consented,
                    view({ pullRequests: { enabled: true, label: "yes", nope: 1 } }),
                ),
            ),
        ).toEqual([
            'pullRequests.nope: "nope" is not one of enabled, label',
            "pullRequests.label: must be true or false",
        ]);
    });
});

describe("sections", () => {
    const fields = spec({ subscriptions: sections({ notify: principal({ optional: false }) }) });
    const teams = { principals: ["maintainerTeam", "triageTeam"] };

    it("reads a mapping whose keys are the repository's own", () => {
        expect(
            readFrom(
                fields,
                view(
                    {
                        subscriptions: {
                            critical: { notify: "maintainerTeam" },
                            high: { notify: "triageTeam" },
                        },
                    },
                    teams,
                ),
            ),
        ).toEqual({
            ok: true,
            value: {
                subscriptions: {
                    critical: { notify: "maintainerTeam" },
                    high: { notify: "triageTeam" },
                },
            },
        });
    });

    it("reads an absent mapping as no entries", () => {
        expect(readFrom(fields, view({}, teams))).toEqual({
            ok: true,
            value: { subscriptions: {} },
        });
    });

    it("reports one entry's problem without losing the others", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view(
                        { subscriptions: { critical: { notify: "nobody" }, high: "triageTeam" } },
                        teams,
                    ),
                ),
            ),
        ).toEqual([
            'subscriptions.critical.notify: "nobody" is not a principal this repository declares',
            "subscriptions.high: must be a mapping",
        ]);
    });

    it("reports a mapping that is not one, at the mapping's own path", () => {
        expect(problemsOf(readFrom(fields, view({ subscriptions: ["critical"] }, teams)))).toEqual([
            "subscriptions: must be a mapping",
        ]);
    });
});

/**
 * The `keys` option on its own: a mapping whose keys must name entries of the
 * one open family, rather than being free-form as the suite above's are.
 */
describe("sections keyed by a mapping family", () => {
    const fields = spec({
        advice: sections({ ask: flag({ default: false }) }, { keys: "alerts" }),
    });

    it("reads an entry keyed by an alert the repository mapped", () => {
        expect(
            readFrom(fields, view({ advice: { p0: { ask: true } } }, { alerts: ["p0"] })),
        ).toEqual({ ok: true, value: { advice: { p0: { ask: true } } } });
    });

    it("reports a key naming an alert nobody mapped, in that family's own words", () => {
        expect(
            problemsOf(readFrom(fields, view({ advice: { epic: {} } }, { alerts: ["p0"] }))),
        ).toEqual(['advice.epic: "epic" is not an alert this repository has mapped']);
    });
});

describe("block", () => {
    const fields = spec({
        checklist: block({ skillTier: flag({ default: false }), guide: text({ optional: true }) }),
    });

    it("reads its fields only on an explicit enabled: true", () => {
        expect(readFrom(fields, view({ checklist: { enabled: true, skillTier: true } }))).toEqual({
            ok: true,
            value: { checklist: { enabled: true, skillTier: true, guide: null } },
        });
    });

    it.each([
        ["absent", undefined],
        ["off", { enabled: false, skillTier: "nonsense" }],
        ["kept without consent at all", { skillTier: 7 }],
    ])("reads a block %s as parked, and never reads its fields", (_why, checklist) => {
        // The malformed inner field is the proof: a parked block is not read,
        // so a check nobody enabled cannot make a file unusable.
        expect(readFrom(fields, view(checklist === undefined ? {} : { checklist }))).toEqual({
            ok: true,
            value: { checklist: { enabled: false } },
        });
    });

    it("rejects malformed consent instead of silently parking it", () => {
        expect(
            problemsOf(readFrom(fields, view({ checklist: { enabled: "yes", skillTier: 7 } }))),
        ).toEqual(["checklist.enabled: must be true or false"]);
    });

    /** The parser hands on records built without a prototype (`__proto__` as data). */
    it("reads a block that carries no prototype", () => {
        const bare = Object.assign(Object.create(null) as Record<string, unknown>, {
            enabled: true,
            skillTier: true,
        });

        expect(readFrom(fields, view({ checklist: bare }))).toEqual({
            ok: true,
            value: { checklist: { enabled: true, skillTier: true, guide: null } },
        });
    });

    it("reports a block that is not a mapping", () => {
        expect(problemsOf(readFrom(fields, view({ checklist: "on" })))).toEqual([
            "checklist: must be a mapping",
        ]);
    });

    it("reports an enabled block's own problems, at their nested paths", () => {
        expect(
            problemsOf(readFrom(fields, view({ checklist: { enabled: true, skillTier: 7 } }))),
        ).toEqual(["checklist.skillTier: must be true or false"]);
    });
});

describe("blocks", () => {
    const fields = spec({ checks: blocks({ guide: text({ optional: true }) }) });

    it("reads a mapping whose keys are the repository's own", () => {
        expect(
            readFrom(
                fields,
                view({
                    checks: {
                        dcoSignoff: { enabled: true, guide: "https://example.test/dco" },
                        gpgSignature: { enabled: false },
                    },
                }),
            ),
        ).toEqual({
            ok: true,
            value: {
                checks: {
                    dcoSignoff: { enabled: true, guide: "https://example.test/dco" },
                    gpgSignature: { enabled: false },
                },
            },
        });
    });

    it("reads an absent mapping as no entries", () => {
        expect(readFrom(fields, view({}))).toEqual({ ok: true, value: { checks: {} } });
    });

    it("reports one entry's problem without losing the others", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({ checks: { dcoSignoff: { enabled: true, guide: 7 }, gpg: "on" } }),
                ),
            ),
        ).toEqual(["checks.dcoSignoff.guide: must be text", "checks.gpg: must be a mapping"]);
    });

    it("reports a mapping that is not one", () => {
        expect(problemsOf(readFrom(fields, view({ checks: ["dcoSignoff"] })))).toEqual([
            "checks: must be a mapping",
        ]);
    });
});

describe("oneOf", () => {
    const fields = spec({ noticeOn: oneOf(["latestActivity", "trackingIssue"]) });

    it("reads a listed choice", () => {
        expect(readFrom(fields, view({ noticeOn: "trackingIssue" }))).toEqual({
            ok: true,
            value: { noticeOn: "trackingIssue" },
        });
    });

    it("reports an unlisted one, and an absent one, by listing the choices", () => {
        expect(problemsOf(readFrom(fields, view({ noticeOn: "somewhere" })))).toEqual([
            "noticeOn: must be one of latestActivity, trackingIssue",
        ]);
        expect(problemsOf(readFrom(fields, view({})))).toEqual([
            "noticeOn: must be one of latestActivity, trackingIssue",
        ]);
    });
});

describe("closed", () => {
    const fields = spec({
        pillars: closed({
            reviews: section({ atLeast: count({ default: 0 }) }),
            mergedPRs: closed({ atLeast: count({ default: 0 }), minTier: skills() }),
        }),
    });

    it("answers null for a member the file did not state", () => {
        expect(readFrom(fields, view({ pillars: { reviews: { atLeast: 9 } } }))).toEqual({
            ok: true,
            value: { pillars: { reviews: { atLeast: 9 }, mergedPRs: null } },
        });
    });

    it("answers null for every member when the group itself is absent", () => {
        expect(readFrom(fields, view({}))).toEqual({
            ok: true,
            value: { pillars: { reviews: null, mergedPRs: null } },
        });
    });

    it("reports a key outside the vocabulary rather than dropping it", () => {
        expect(
            problemsOf(readFrom(fields, view({ pillars: { mergedPRz: { atLeast: 1 } } }))),
        ).toEqual(['pillars.mergedPRz: "mergedPRz" is not one of reviews, mergedPRs']);
    });

    it("reports a stranger and a bad member together", () => {
        expect(
            problemsOf(readFrom(fields, view({ pillars: { nope: {}, reviews: { atLeast: -1 } } }))),
        ).toEqual([
            'pillars.nope: "nope" is not one of reviews, mergedPRs',
            "pillars.reviews.atLeast: must be a whole number, zero or more",
        ]);
    });

    it("reports a group that is not a mapping", () => {
        expect(problemsOf(readFrom(fields, view({ pillars: 3 })))).toEqual([
            "pillars: must be a mapping",
        ]);
    });

    it("nests, so a parameter on the wrong pillar is caught the same way", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({ pillars: { mergedPRs: { atLeast: 1, window: 12 } } }, { skills: [] }),
                ),
            ),
        ).toEqual(['pillars.mergedPRs.window: "window" is not one of atLeast, minTier']);
    });
});

describe("texts", () => {
    const fields = spec({ uncounted: texts() });

    it("reads a list of free display text", () => {
        expect(readFrom(fields, view({ uncounted: ["review substance", "mentorship"] }))).toEqual({
            ok: true,
            value: { uncounted: ["review substance", "mentorship"] },
        });
    });

    it("absent is no entries", () => {
        expect(readFrom(fields, view({}))).toEqual({ ok: true, value: { uncounted: [] } });
    });

    it("reports a value that is not a list, and every entry that is not text", () => {
        expect(problemsOf(readFrom(fields, view({ uncounted: "mentorship" })))).toEqual([
            "uncounted: must be a list of text",
        ]);
        expect(problemsOf(readFrom(fields, view({ uncounted: ["ok", 3, false] })))).toEqual([
            "uncounted.1: must be text",
            "uncounted.2: must be text",
        ]);
    });
});

// ─── The cascade, the relation, and the report ───────────────────────

describe("the cascade (§3.1)", () => {
    const fields = spec({
        remindAfter: duration({ default: "14d" }),
        reapAfter: duration({ default: "21d" }),
        pullRequests: block({
            reapAfter: duration({ inherits: "reapAfter" }),
            reapWhen: blocks({ reapAfter: duration({ inherits: "reapAfter" }) }),
        }),
    });

    const resolve = (settings: Readonly<Record<string, unknown>>) => {
        const read = readFrom(fields, view(settings));
        if (!read.ok) throw new Error(problemsOf(read).join(", "));
        return read.value;
    };

    it("resolves most-specific-first: reason, then ladder, then capability default", () => {
        const value = resolve({
            reapAfter: "21d",
            pullRequests: {
                enabled: true,
                reapAfter: "60d",
                reapWhen: {
                    draft: { enabled: true },
                    needsRevision: { enabled: true, reapAfter: "5d" },
                },
            },
        });
        expect(value.pullRequests).toEqual({
            enabled: true,
            reapAfter: 60 * 24,
            reapWhen: {
                draft: { enabled: true, reapAfter: 60 * 24 },
                needsRevision: { enabled: true, reapAfter: 5 * 24 },
            },
        });
    });

    it("reaches the capability's own field when the ladder states none", () => {
        const value = resolve({
            reapAfter: "21d",
            pullRequests: { enabled: true, reapWhen: { draft: { enabled: true } } },
        });
        expect(value.pullRequests).toEqual({
            enabled: true,
            reapAfter: 21 * 24,
            reapWhen: { draft: { enabled: true, reapAfter: 21 * 24 } },
        });
    });

    /**
     * The level that STATES the unreadable value is the one that reports it,
     * once. An inner field inheriting from it falls through to its own default
     * rather than reporting the same mistake at a second path.
     */
    it("stops at a level whose value it cannot read, and reports it there", () => {
        const inheriting = spec({
            reapAfter: duration({ default: "21d" }),
            pullRequests: block({
                reapAfter: duration({ inherits: "reapAfter", default: "30d" }),
            }),
        });

        expect(
            problemsOf(
                readFrom(inheriting, view({ reapAfter: "soon", pullRequests: { enabled: true } })),
            ),
        ).toEqual([
            'reapAfter: must be a duration: a whole number of hours or days, written "4h" or "14d"',
        ]);
    });

    it("reaches the default when no level states anything", () => {
        expect(resolve({ pullRequests: { enabled: true } })).toEqual({
            remindAfter: 14 * 24,
            reapAfter: 21 * 24,
            pullRequests: { enabled: true, reapAfter: 21 * 24, reapWhen: {} },
        });
    });
});

describe("the above relation (§3.1)", () => {
    const fields = spec({
        remindAfter: duration({ default: "14d" }),
        reapAfter: duration({ default: "21d", above: ["remindAfter", MIN_GRACE_HOURS] }),
        pullRequests: block({
            remindAfter: duration({ inherits: "remindAfter" }),
            reapAfter: duration({
                inherits: "reapAfter",
                above: ["remindAfter", MIN_GRACE_HOURS],
            }),
        }),
    });

    it("passes when every level clears the floor", () => {
        expect(
            readFrom(
                fields,
                view({
                    remindAfter: "14d",
                    reapAfter: "21d",
                    pullRequests: { enabled: true, remindAfter: "2d", reapAfter: "5d" },
                }),
            ).ok,
        ).toBe(true);
    });

    /** The floor is one HOUR, so the gap a level clears may be an hour wide. */
    it("passes on a gap of one hour", () => {
        expect(
            readFrom(
                fields,
                view({ pullRequests: { enabled: true, remindAfter: "2h", reapAfter: "3h" } }),
            ).ok,
        ).toBe(true);
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({ pullRequests: { enabled: true, remindAfter: "2h", reapAfter: "2h" } }),
                ),
            ),
        ).toEqual(["pullRequests.reapAfter: must be at least 1h above remindAfter (2h)"]);
    });

    it("reports the level where the reap does not clear the remind", () => {
        expect(
            problemsOf(
                readFrom(
                    fields,
                    view({
                        remindAfter: "14d",
                        reapAfter: "21d",
                        pullRequests: { enabled: true, remindAfter: "30d" },
                    }),
                ),
            ),
        ).toEqual(["pullRequests.reapAfter: must be at least 1h above remindAfter (30d)"]);
    });

    it("holds the platform's floor under a gap a spec states more weakly", () => {
        const weaker = spec({
            remindAfter: duration({ default: "14d" }),
            reapAfter: duration({ default: "14d", above: ["remindAfter", 0] }),
        });
        expect(problemsOf(readFrom(weaker, view({})))).toEqual([
            "reapAfter: must be at least 1h above remindAfter (14d)",
        ]);
    });

    it("does not compare at a level where the target resolves to nothing", () => {
        const orphan = spec({ reapAfter: duration({ default: "1d", above: ["remindAfter", 5] }) });
        expect(readFrom(orphan, view({})).ok).toBe(true);
    });
});

describe("problems as the parser reports them (§3.2)", () => {
    const inactivity = declarationFor(
        "inactivity",
        spec({ gracePeriod: duration({ default: "7d" }) }),
    );
    const assignment = declarationFor(
        "assignment",
        spec({ a: flag({ default: false }), b: section({ c: flag({ default: false }) }) }),
    );

    const rejected = (declaration: TypedDeclaration, settings: Readonly<Record<string, unknown>>) =>
        parseConfig(
            {
                schemaVersion: 2,
                capabilities: { [declaration.name]: { enabled: true, ...settings } },
            },
            { revision: "rev-problems", knownCapabilities: [declaration] },
        );

    /**
     * Where a relative path becomes one a maintainer can find: the walk
     * answers `gracePeriod`, and the block it was read for is what turns
     * that into the line in the file.
     */
    it("prefixes every problem with the block it came from, and says what is wrong", () => {
        const result = rejected(inactivity, { gracePeriod: 1.5 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors).toEqual([
            {
                code: "settingInvalid",
                path: "capabilities.inactivity.gracePeriod",
                message:
                    'capabilities.inactivity.gracePeriod: must be a duration: a whole number of hours or days, written "4h" or "14d"',
            },
        ]);
    });

    /** Nothing is dropped: a maintainer with two mistakes hears about two. */
    it("reports every problem of one block, at whatever depth it sits", () => {
        expect(refusalsOf(rejected(assignment, { a: 1, b: { c: 2 } }))).toEqual([
            "settingInvalid @ capabilities.assignment.a",
            "settingInvalid @ capabilities.assignment.b.c",
        ]);
    });

    /**
     * The two codes, and the line between them: a key the spec does not name
     * is `unknownKey` at any depth (D84), and everything else the spec cannot
     * read is `settingInvalid`. The sweep at the block's TOP is the parser's;
     * the one inside `b` is the group constructor's (D4).
     */
    it("calls a stranger an unknown key and a bad value a bad setting", () => {
        expect(refusalsOf(rejected(assignment, { stray: true, b: { stray: true } }))).toEqual([
            "unknownKey @ capabilities.assignment.stray",
            "unknownKey @ capabilities.assignment.b.stray",
        ]);
    });
});

describe("readSettings", () => {
    it("reads a spec with no fields at all — the shape does not vary", () => {
        expect(readFrom(spec({}), view({}))).toEqual({ ok: true, value: {} });
    });

    it("returns every problem at once, not the first", () => {
        const fields = spec({
            announce: flag({ default: false }),
            after: duration({ default: "1d" }),
        });
        expect(problemsOf(readFrom(fields, view({ announce: "yes", after: -1 })))).toEqual([
            "announce: must be true or false",
            'after: must be a duration: a whole number of hours or days, written "4h" or "14d"',
        ]);
    });
});

// ─── What a spec says about itself ───────────────────────────────────

/**
 * Every `describe()`, against the rule the constructor beside it applies.
 *
 * `absent` is the load-bearing half: it is DERIVED from what the reader does
 * with a missing key, so the arms below are the same arms the suites above
 * read. The optional keys are asserted present AND absent, because an absent
 * one is what tells a generator the field has no default rather than a default
 * of `undefined`.
 */
describe("describe", () => {
    it("flag: a default, always, and the sentence when one was written", () => {
        expect(flag({ default: false, doc: "Say so in a comment" }).describe()).toStrictEqual({
            kind: "flag",
            doc: "Say so in a comment",
            absent: "default",
            default: false,
        });
        expect(flag({ default: true }).describe()).toStrictEqual({
            kind: "flag",
            doc: null,
            absent: "default",
            default: true,
        });
    });

    it("duration: the cascade decides what an absent key reads as", () => {
        // The default is reported as WRITTEN, because a generated tree shows a
        // maintainer the string they would type rather than a number of hours.
        expect(
            duration({ default: "14d", doc: "Silence before a reminder" }).describe(),
        ).toStrictEqual({
            kind: "duration",
            doc: "Silence before a reminder",
            absent: "default",
            default: "14d",
        });
        expect(duration({ inherits: "remindAfter" }).describe()).toStrictEqual({
            kind: "duration",
            doc: null,
            absent: "inherited",
            inherits: "remindAfter",
        });
        expect(duration().describe()).toStrictEqual({
            kind: "duration",
            doc: null,
            absent: "problem",
        });
    });

    it("duration: the cascade outranks a default, and both bounds travel with it", () => {
        const described = duration({
            default: "21d",
            inherits: "reapAfter",
            above: ["remindAfter", MIN_GRACE_HOURS],
            atLeast: MIN_REAP_HOURS,
        }).describe();
        expect(described).toStrictEqual({
            kind: "duration",
            doc: null,
            absent: "inherited",
            default: "21d",
            inherits: "reapAfter",
            above: ["remindAfter", MIN_GRACE_HOURS],
            atLeast: MIN_REAP_HOURS,
        });
        // A key that is absent, not a key whose value is undefined.
        expect(Object.keys(duration().describe())).toEqual(["kind", "doc", "absent"]);
    });

    it("count: a whole number, and its default", () => {
        expect(count({ default: 2, doc: "How many at once" }).describe()).toStrictEqual({
            kind: "count",
            doc: "How many at once",
            absent: "default",
            default: 2,
        });
    });

    it("text: optional reads null, required is a problem", () => {
        expect(text({ optional: true, doc: "A guide link" }).describe()).toStrictEqual({
            kind: "text",
            doc: "A guide link",
            absent: "null",
            optional: true,
        });
        expect(text({ optional: false }).describe()).toStrictEqual({
            kind: "text",
            doc: null,
            absent: "problem",
            optional: false,
        });
    });

    it("principal: the same two arms as text, under its own kind", () => {
        expect(principal({ optional: true, doc: "Who to cc" }).describe()).toStrictEqual({
            kind: "principal",
            doc: "Who to cc",
            absent: "null",
            optional: true,
        });
        expect(principal({ optional: false }).describe()).toStrictEqual({
            kind: "principal",
            doc: null,
            absent: "problem",
            optional: false,
        });
    });

    it("the three mapped lists keep their own kinds, and all read absent as empty", () => {
        expect(meanings({ doc: "Meanings that claim" }).describe()).toStrictEqual({
            kind: "meanings",
            doc: "Meanings that claim",
            absent: "empty",
        });
        expect(commands({ doc: "Words it answers to" }).describe()).toStrictEqual({
            kind: "commands",
            doc: "Words it answers to",
            absent: "empty",
        });
        expect(skills().describe()).toStrictEqual({ kind: "skills", doc: null, absent: "empty" });
    });

    it("texts: free display text, absent as no entries", () => {
        expect(texts({ doc: "What is not counted" }).describe()).toStrictEqual({
            kind: "texts",
            doc: "What is not counted",
            absent: "empty",
        });
        expect(texts().describe()).toStrictEqual({ kind: "texts", doc: null, absent: "empty" });
    });

    it("oneOf: the choices, in the order it lists them, and no default to fall to", () => {
        expect(
            oneOf(["latestActivity", "trackingIssue"], { doc: "Where to say it" }).describe(),
        ).toStrictEqual({
            kind: "oneOf",
            doc: "Where to say it",
            absent: "problem",
            values: ["latestActivity", "trackingIssue"],
        });
    });

    it("section: absent is every field at its default, and the children come with it", () => {
        expect(
            section(
                { label: flag({ default: true, doc: "Apply it" }) },
                { doc: "On open" },
            ).describe(),
        ).toStrictEqual({
            kind: "section",
            doc: "On open",
            absent: "default",
            fields: { label: { kind: "flag", doc: "Apply it", absent: "default", default: true } },
        });
    });

    it("sections: the open family it keys by, when it names one", () => {
        const fields = { atLeast: count({ default: 0, doc: "How many" }) };
        expect(
            sections(fields, { keys: "alerts", doc: "Who hears what" }).describe(),
        ).toStrictEqual({
            kind: "sections",
            doc: "Who hears what",
            absent: "empty",
            keys: "alerts",
            fields: { atLeast: { kind: "count", doc: "How many", absent: "default", default: 0 } },
        });
        expect(Object.keys(sections(fields).describe())).toEqual([
            "kind",
            "doc",
            "absent",
            "fields",
        ]);
    });

    it("block: absent is parked, not defaulted", () => {
        expect(
            block(
                { after: duration({ default: "7d", doc: "How long" }) },
                { doc: "The ladder" },
            ).describe(),
        ).toStrictEqual({
            kind: "block",
            doc: "The ladder",
            absent: "parked",
            fields: {
                after: { kind: "duration", doc: "How long", absent: "default", default: "7d" },
            },
        });
    });

    it("blocks: a mapping of them is absent as no entries", () => {
        expect(
            blocks(
                { guide: text({ optional: true, doc: "A link" }) },
                { doc: "Each check" },
            ).describe(),
        ).toStrictEqual({
            kind: "blocks",
            doc: "Each check",
            absent: "empty",
            fields: { guide: { kind: "text", doc: "A link", absent: "null", optional: true } },
        });
    });

    it("closed: an unstated member is null, which is the group's own absent", () => {
        expect(
            closed(
                { mergedPRs: count({ default: 0, doc: "How many" }) },
                { doc: "Pillars" },
            ).describe(),
        ).toStrictEqual({
            kind: "closed",
            doc: "Pillars",
            absent: "null",
            fields: {
                mergedPRs: { kind: "count", doc: "How many", absent: "default", default: 0 },
            },
        });
    });

    /** The absence a check reads: `null` is what the shipped-spec sweep fails on. */
    it.each([
        ["count", count({ default: 0 })],
        ["oneOf", oneOf(["latestActivity"])],
        ["section", section({})],
        ["sections", sections({})],
        ["block", block({})],
        ["blocks", blocks({})],
        ["closed", closed({})],
    ] as const)("%s written without a sentence says it has none", (_kind, field) => {
        expect(field.describe().doc).toBeNull();
    });
});

describe("describeSpec", () => {
    it("describes every key of a spec, and an empty spec as no keys", () => {
        expect(describeSpec(spec({ announce: flag({ default: false, doc: "Say so" }) }))).toEqual({
            announce: { kind: "flag", doc: "Say so", absent: "default", default: false },
        });
        expect(describeSpec(spec({}))).toEqual({});
    });

    it("reaches the bottom of a nest, because each group carries its children", () => {
        const fields = spec({
            pullRequests: block(
                {
                    reapWhen: section(
                        {
                            draft: block(
                                { after: duration({ inherits: "after" }) },
                                { doc: "Drafts" },
                            ),
                        },
                        { doc: "The states" },
                    ),
                },
                { doc: "The ladder" },
            ),
        });
        const described = describeSpec(fields);
        expect(
            described.pullRequests?.fields?.reapWhen?.fields?.draft?.fields?.after,
        ).toStrictEqual({ kind: "duration", doc: null, absent: "inherited", inherits: "after" });
    });
});

// ─── The six designs' config sections, as fixtures ───────────────────

describe("intake — packages/capabilities/src/intake/design.md", () => {
    /**
     * The two stations, as sections. Neither carries an `enabled` of its own —
     * "stations are opt-in per key", so each flag is its own consent and an
     * unwritten station reads as every flag off. `checklist` is a section
     * inside a section for the same reason.
     *
     * `skillTier` and `issueType` read as the flags they are. The doc's
     * Verified-by row — a checklist demanding a `skills` mapping the file never
     * made — is the unshipped family reader's, not this spec's (§3.3).
     */
    const INTAKE_DESIGN = spec({
        onOpen: section({
            label: flag({ default: false }),
            welcome: flag({ default: false }),
            lock: flag({ default: false }),
        }),
        approval: section({
            when: meanings(),
            unlock: flag({ default: false }),
            confirm: flag({ default: false }),
            checklist: section({
                skillTier: flag({ default: false }),
                issueType: flag({ default: false }),
            }),
        }),
    });

    const intake = declarationFor("intake", INTAKE_DESIGN, { labels: ["awaitingTriage"] });

    it("reads the quarantine example: label, welcome, lock, then release on ready", () => {
        const { refused, stripped, config } = travel("intake.1", intake);

        expect([refused, stripped]).toEqual([[], []]);
        expect(Object.keys(config.capabilities.intake?.settings ?? {})).toEqual([
            "onOpen",
            "approval",
        ]);
        expect(viewOf(intake, config).settings).toEqual({
            onOpen: { label: true, welcome: true, lock: true },
            approval: {
                when: ["ready"],
                unlock: true,
                confirm: true,
                checklist: { skillTier: false, issueType: false },
            },
        });
    });

    /**
     * The `types` family does not ship: it had no reader anywhere in the tree,
     * so it was deleted rather than documented. Intake's design page still
     * names it, under phase 3 and in this block, so the document is set aside
     * — as the family the platform does not have, which is the refusal a
     * maintainer holding this file gets today.
     */
    it("reads the C++ shape's advisory checklist, once the types family is set aside", () => {
        const { refused, stripped, config } = travel("intake.2", intake);

        expect([refused, stripped]).toEqual([["unknownKey @ mappings.types"], ["types"]]);
        expect(viewOf(intake, config).settings).toEqual({
            onOpen: { label: true, welcome: false, lock: false },
            approval: {
                when: ["ready"],
                unlock: false,
                confirm: true,
                checklist: { skillTier: true, issueType: true },
            },
        });
    });

    /** The third policy is no policy, and it parses as one: consent withheld. */
    it("reads the repository that never triages as a capability turned off", () => {
        const { refused, config } = travel("intake.3", intake);

        expect(refused).toEqual([]);
        expect(config.capabilities.intake?.enabled).toBe(false);
        // Both stations absent is both stations off — the section's own rule,
        // and the reason a repository states only the flags it wants. The
        // block is resolved either way: a disabled capability's settings are
        // read with the file, so a typo in one is caught today (D84's reason).
        expect(viewOf(intake, config).settings).toEqual({
            onOpen: { label: false, welcome: false, lock: false },
            approval: {
                when: [],
                unlock: false,
                confirm: false,
                checklist: { skillTier: false, issueType: false },
            },
        });
    });
});

describe("prDashboard — packages/capabilities/src/prDashboard/design.md", () => {
    /** The whole section, in three constructors. `assignedIssues` nests, which is its dependency. */
    const PR_DASHBOARD_DESIGN = spec({
        checks: blocks({
            guide: text({ optional: true }),
            assignedIssues: block({ guide: text({ optional: true }) }),
        }),
        applyLabels: flag({ default: false }),
    });

    const prDashboard = declarationFor("prDashboard", PR_DASHBOARD_DESIGN);

    const read = (name: string) => {
        const { refused, stripped, config } = travel(name, prDashboard);
        expect([refused, stripped]).toEqual([[], []]);
        return viewOf(prDashboard, config).settings;
    };

    it("runs the four consented checks, and the sub-check inside the one that carries it", () => {
        expect(read("prDashboard.1")).toEqual({
            checks: {
                dcoSignoff: {
                    enabled: true,
                    guide: "https://github.com/<org>/<repo>/wiki/Signing-Guide",
                    assignedIssues: { enabled: false },
                },
                gpgSignature: {
                    enabled: true,
                    guide: "https://github.com/<org>/<repo>/wiki/Signing-Guide",
                    assignedIssues: { enabled: false },
                },
                mergeConflicts: {
                    enabled: true,
                    guide: null,
                    assignedIssues: { enabled: false },
                },
                linkedIssues: {
                    enabled: true,
                    guide: "https://github.com/<org>/<repo>/wiki/Linked-Issues",
                    assignedIssues: {
                        enabled: true,
                        guide: "https://github.com/<org>/<repo>/wiki/Assignment",
                    },
                },
            },
            applyLabels: true,
        });
    });

    it("reads the trimmed setup as two checks and no label mode", () => {
        expect(read("prDashboard.2")).toEqual({
            checks: {
                dcoSignoff: { enabled: true, guide: null, assignedIssues: { enabled: false } },
                mergeConflicts: { enabled: true, guide: null, assignedIssues: { enabled: false } },
            },
            applyLabels: false,
        });
    });

    /** The doc's own Verified-by row: the nesting IS the dependency (D84). */
    it("reports assignedIssues outside linkedIssues as an unknown key, at parse time", () => {
        const result = parseConfigDocument(
            [
                "schemaVersion: 2",
                "capabilities:",
                "  prDashboard:",
                "    enabled: true",
                "    assignedIssues:",
                "      enabled: true",
            ].join("\n"),
            { revision: "rev-nesting", knownCapabilities: [prDashboard] },
        );

        expect(refusalsOf(result)).toEqual([
            "unknownKey @ capabilities.prDashboard.assignedIssues",
        ]);
    });
});

describe("inactivity — packages/capabilities/src/inactivity/design.md", () => {
    /**
     * The design's two ladders. Every `duration` inside one inherits by name,
     * so the spec states the chain by naming the field and the reader does the
     * walking; `above` carries `MIN_GRACE_HOURS` and `atLeast` the
     * `MIN_REAP_HOURS` floor, both ON THE LEVEL THAT CONSENTS and nowhere else.
     *
     * The reap is an enabled-block at every level that acts, so a level with no
     * `reap` reminds and never releases. Its clock is therefore inherited by
     * the DOTTED name `reap.after`: the level above states it inside its own
     * block, and a level that names no `after` there is walked past rather than
     * read as a clock nothing resolves. The two levels that only hand the clock
     * on are sections — the root, whose default every level inherits, and the
     * `pullRequests` ladder, whose reasons are what act — and neither declares
     * a floor, because a clock nobody acts on is judged where it lands.
     */
    const reapingLadder = {
        remindAfter: duration({ inherits: "remindAfter" }),
        reap: block({
            after: duration({
                inherits: "reap.after",
                above: ["remindAfter", MIN_GRACE_HOURS],
                atLeast: MIN_REAP_HOURS,
            }),
        }),
    };

    const INACTIVITY_DESIGN = spec({
        exemptBlocked: flag({ default: false }),
        remindAfter: duration({ default: "14d" }),
        reap: section({ after: duration({ default: "21d" }) }),
        issues: block({ ...reapingLadder }),
        pullRequests: block({
            remindAfter: duration({ inherits: "remindAfter" }),
            reap: section({ after: duration({ inherits: "reap.after" }) }),
            reapWhen: blocks({ ...reapingLadder }),
        }),
    });

    const inactivity = declarationFor("inactivity", INACTIVITY_DESIGN);

    const travelled = () => travel("inactivity.1", inactivity);

    it("parses as written, commands family and all — the clock reset is mappable", () => {
        const { refused, stripped, config } = travelled();
        expect([refused, stripped]).toEqual([[], []]);
        expect(config.mappings.commands).toEqual({ working: "/working" });
    });

    it("resolves every clock most-specific-first: reason, then ladder, then default", () => {
        expect(viewOf(inactivity, travelled().config).settings).toEqual({
            exemptBlocked: true,
            remindAfter: 14 * 24,
            reap: { after: 21 * 24 },
            issues: {
                enabled: true,
                remindAfter: 14 * 24,
                reap: { enabled: true, after: 21 * 24 },
            },
            pullRequests: {
                enabled: true,
                remindAfter: 14 * 24,
                // A section: the clock the reasons below inherit, with no
                // consent of its own, because this ladder closes nothing.
                reap: { after: 60 * 24 },
                reapWhen: {
                    draft: {
                        enabled: true,
                        remindAfter: 14 * 24,
                        reap: { enabled: true, after: 60 * 24 },
                    },
                    changesRequested: {
                        enabled: true,
                        remindAfter: 14 * 24,
                        reap: { enabled: true, after: 60 * 24 },
                    },
                    needsRevision: {
                        enabled: true,
                        remindAfter: 2 * 24,
                        reap: { enabled: true, after: 5 * 24 },
                    },
                },
            },
        });
    });

    /**
     * "On every level that consents, the reap must exceed `remindAfter` by the
     * platform's minimum grace" — including the level that inherited one side.
     */
    it("reports a reason whose reap does not clear its own remind", () => {
        const { config } = travelled();
        // The block as the file writes it, not the resolved settings spread
        // back: a resolved clock is a number of hours, and a document states
        // the written form.
        const impatient = withSettings(config, inactivity, {
            exemptBlocked: true,
            remindAfter: "14d",
            reap: { after: "21d" },
            pullRequests: {
                enabled: true,
                reap: { after: "60d" },
                reapWhen: {
                    needsRevision: {
                        enabled: true,
                        remindAfter: "5d",
                        reap: { enabled: true, after: "5d" },
                    },
                },
            },
        });

        expect(impatient.ok ? [] : impatient.errors.map((e) => e.message)).toEqual([
            "capabilities.inactivity.pullRequests.reapWhen.needsRevision.reap.after: must be at least 1h above remindAfter (5d)",
        ]);
    });

    /**
     * The honest spelling C11 found missing, at the level that has it: a ladder
     * with no `reap` block parses, keeps its reminder clock, and carries no
     * release clock for anything to act on.
     */
    it("leaves a ladder with no reap block reminding and never acting", () => {
        const { config } = travelled();
        const remindOnly = withSettings(config, inactivity, {
            remindAfter: "14d",
            issues: { enabled: true },
        });

        expect(remindOnly.ok ? [] : remindOnly.errors.map((e) => e.message)).toEqual([]);
        expect(
            remindOnly.ok ? remindOnly.config.capabilities.inactivity?.settings.issues : null,
        ).toEqual({ enabled: true, remindAfter: 14 * 24, reap: { enabled: false } });
    });
});

describe("advancement — design/guides/capabilities/advancement.md", () => {
    /**
     * A role IS an enabled-block, so `roles` stays `blocks`: each role states
     * `enabled`, and a role turned off must not have its pillars read. Its
     * `uncounted` is free display text, which is `texts()`.
     *
     * `pillars` is `closed()` and not `sections()`, and D4 is why. Each pillar
     * carries its OWN parameters — `minTier` is `mergedPRs`'s and `outcome` is
     * `issuesAuthored`'s — so one open-keyed shape for all four would have to
     * admit every parameter on every pillar, and before D4 it admitted them by
     * dropping them in silence. A closed group names the four pillars, gives
     * each its own fields, and reports a fifth at its own path.
     *
     * `oneOf` still has no optional form, and inside `closed()` it does not
     * need one: a member the file never stated reads `null` and its reader
     * never runs. That is what makes `minTier` and `outcome` readable here at
     * last. What `oneOf` cannot do is check a tier against `mappings.skills` —
     * a scalar sibling of `skills()` would, and adding one is a change to §3's
     * table rather than a test's business.
     *
     * The doc's one cross-field rule — `noticeIssue` required by
     * `noticeOn: trackingIssue` — is unread on purpose. §3.3 moves the DESIGN's
     * config to a structural form (a group under the choice that needs it)
     * rather than growing the toolkit a dependency; until then both fields are
     * read flat and the pairing is nobody's rule here.
     */
    const ADVANCEMENT_DESIGN = spec({
        noticeOn: oneOf(["latestActivity", "trackingIssue"]),
        noticeIssue: count({ default: 0 }),
        mentionCandidate: flag({ default: true }),
        reference: text({ optional: true }),
        roles: blocks({
            uncounted: texts(),
            pillars: closed({
                activeWeeks: section({
                    atLeast: count({ default: 0 }),
                    window: count({ default: 0 }),
                }),
                mergedPRs: section({
                    atLeast: count({ default: 0 }),
                    minTier: oneOf(SKILL_TIERS),
                }),
                reviews: section({ atLeast: count({ default: 0 }) }),
                issuesAuthored: section({
                    atLeast: count({ default: 0 }),
                    outcome: oneOf(["accepted", "completed"]),
                }),
            }),
        }),
    });

    const advancement = declarationFor("advancement", ADVANCEMENT_DESIGN);

    it("reads the three-role governance ladder, skills family and all", () => {
        const { refused, stripped, config } = travel("advancement.1", advancement);

        expect([refused, stripped]).toEqual([[], []]);
        expect(viewOf(advancement, config).settings).toEqual({
            noticeOn: "latestActivity",
            noticeIssue: 0,
            mentionCandidate: true,
            reference:
                "https://github.com/hiero-ledger/governance/blob/main/roles/advancement-qualifications.md",
            roles: {
                juniorCommitter: {
                    enabled: true,
                    uncounted: [
                        "review substance",
                        "triage judgement",
                        "community support",
                        "responsiveness",
                    ],
                    pillars: {
                        activeWeeks: { atLeast: 8, window: 12 },
                        mergedPRs: { atLeast: 5, minTier: "beginner" },
                        reviews: { atLeast: 9 },
                        issuesAuthored: { atLeast: 3, outcome: "accepted" },
                    },
                },
                committer: {
                    enabled: true,
                    uncounted: [
                        "standing as junior committer",
                        "review depth",
                        "breadth",
                        "judgement",
                        "mentorship",
                    ],
                    pillars: {
                        activeWeeks: { atLeast: 20, window: 40 },
                        mergedPRs: { atLeast: 20, minTier: "intermediate" },
                        reviews: { atLeast: 20 },
                        issuesAuthored: { atLeast: 6, outcome: "completed" },
                    },
                },
                maintainer: {
                    enabled: true,
                    uncounted: [
                        "standing as committer",
                        "technical mastery",
                        "design leadership",
                        "review depth and judgement",
                        "API and compatibility judgement",
                        "debugging depth",
                        "stewardship",
                        "mentorship",
                        "community leadership",
                        "escalation",
                    ],
                    pillars: {
                        activeWeeks: { atLeast: 30, window: 52 },
                        mergedPRs: { atLeast: 10, minTier: "advanced" },
                        reviews: { atLeast: 40 },
                        // The one pillar this role does not weigh, and
                        // `null` is how a closed group says so — not a
                        // threshold of zero anyone could meet by doing
                        // nothing.
                        issuesAuthored: null,
                    },
                },
            },
        });
    });

    it("reads the tracking-issue venue, its issue number, and the silent candidate", () => {
        const { refused, config } = travel("advancement.2", advancement);

        expect(refused).toEqual([]);
        expect(viewOf(advancement, config).settings).toEqual({
            noticeOn: "trackingIssue",
            noticeIssue: 7,
            mentionCandidate: false,
            reference: null,
            roles: {
                trustedReviewer: {
                    enabled: true,
                    uncounted: ["review quality"],
                    pillars: {
                        activeWeeks: { atLeast: 10, window: 16 },
                        mergedPRs: null,
                        reviews: { atLeast: 25 },
                        issuesAuthored: null,
                    },
                },
            },
        });
    });

    /** Consent is the block's, and a role withdrawn takes its pillars with it. */
    it("does not read the pillars of a role turned off", () => {
        const { config } = travel("advancement.2", advancement);
        const paused = withSettings(config, advancement, {
            noticeOn: "trackingIssue",
            roles: { trustedReviewer: { enabled: false, pillars: { reviews: 25 } } },
        });

        expect(refusalsOf(paused)).toEqual([]);
        if (!paused.ok) return;
        expect(viewOf(advancement, paused.config).settings).toEqual(
            expect.objectContaining({ roles: { trustedReviewer: { enabled: false } } }),
        );
    });
});

describe("assignment — design/guides/capabilities/assignment.md", () => {
    /**
     * One tier of the skill ladder. The four tiers share a shape and differ
     * only in what a repository states, so an unstated parameter is that
     * tier's default rather than a second way of writing zero.
     *
     * `maxOpen` here is the doc's "tier override of the cap". It is read flat,
     * not as a cascade: §3.1's cascade is a `days` relation, and a `count` has
     * none — which tier's cap wins is the capability's own arithmetic.
     */
    const TIER = spec({
        maxOpen: count({ default: 0 }),
        maxCompletions: count({ default: 0 }),
        requiresPrevious: count({ default: 0 }),
        supportTeam: principal({ optional: true }),
    });

    /**
     * The three commands blocks, their caps, and the meaning sets that decide
     * claimability. Each is a `block` because each states `enabled`; the four
     * tiers inside `skillGates` are sections, because the ladder's names are
     * the platform's and a tier consents to nothing — the gate above it does.
     */
    const ASSIGNMENT_DESIGN = spec({
        autoAssign: block({
            claimableOnlyWhen: meanings(),
            notClaimableWhen: meanings(),
            capIgnores: meanings(),
            maxOpen: count({ default: 0 }),
            maxPerDay: count({ default: 0 }),
            minAccountAge: duration({ default: "0d" }),
        }),
        unassign: block({}),
        skillGates: block({
            goodFirstIssue: section(TIER),
            beginner: section(TIER),
            intermediate: section(TIER),
            advanced: section(TIER),
        }),
    });

    const assignment = declarationFor("assignment", ASSIGNMENT_DESIGN);

    /** Every tier parameter at its default — what a stated tier is read against. */
    const NO_TIER = { maxOpen: 0, maxCompletions: 0, requiresPrevious: 0, supportTeam: null };

    it("reads the caps-only repository, and parks the gates it turned off", () => {
        const { refused, stripped, config } = travel("assignment.1", assignment);

        expect([refused, stripped]).toEqual([[], []]);
        expect(viewOf(assignment, config).settings).toEqual({
            autoAssign: {
                enabled: true,
                claimableOnlyWhen: [],
                notClaimableWhen: [],
                capIgnores: [],
                maxOpen: 2,
                maxPerDay: 1,
                minAccountAge: 7 * 24,
            },
            unassign: { enabled: true },
            skillGates: { enabled: false },
        });
    });

    it("reads every meaning set of the ready-for-dev repository", () => {
        const { refused, stripped, config } = travel("assignment.2", assignment);

        expect([refused, stripped]).toEqual([[], []]);
        expect(viewOf(assignment, config).settings).toEqual({
            autoAssign: {
                enabled: true,
                claimableOnlyWhen: ["ready"],
                notClaimableWhen: ["blocked", "awaitingTriage", "inProgress"],
                capIgnores: ["needsReview", "blocked"],
                maxOpen: 2,
                maxPerDay: 1,
                minAccountAge: 7 * 24,
            },
            unassign: { enabled: true },
            skillGates: {
                enabled: true,
                goodFirstIssue: {
                    ...NO_TIER,
                    maxCompletions: 2,
                    supportTeam: "gfiSupportTeam",
                },
                beginner: { ...NO_TIER, requiresPrevious: 1 },
                intermediate: { ...NO_TIER, requiresPrevious: 3 },
                advanced: { ...NO_TIER, requiresPrevious: 10 },
            },
        });
    });

    /**
     * The third example states its guards and not the mappings they name — it
     * is an excerpt of a file, not a file. Read on its own it is exactly the
     * case the doc's own rule describes: a guard naming a meaning demands its
     * mapping, and an unmapped one is reported with the entry that named it.
     *
     * Since C1 that refusal is the PARSER's, which is why this excerpt no
     * longer travels: the file a maintainer would push is rejected whole,
     * naming the entry rather than the capability.
     */
    /** The excerpt never maps `blocked`; its default spelling stands in (D203). */
    it("accepts the guard meaning this excerpt never mapped, on its default spelling", () => {
        const result = parseConfigDocument(documentOf("assignment.3"), {
            revision: "rev-assignment.3",
            knownCapabilities: [assignment],
        });

        expect(refusalsOf(result)).toEqual([]);
    });
});

describe("notifications — design/guides/capabilities/notifications.md", () => {
    /**
     * A subscription is a plain group (`{ notify: <principal> }`) keyed by an
     * alert name the repository invented, which is `sections` exactly — and
     * since the alerts wave, keyed by an alert the file actually maps.
     *
     * BOTH halves of the doc's unusable row are read now: an unknown principal
     * is reported at the subscription that named it, and an unmapped alert at
     * the subscription's own key.
     */
    const NOTIFICATIONS_DESIGN = spec({
        subscriptions: sections({ notify: principal({ optional: false }) }, { keys: "alerts" }),
    });

    const notifications = declarationFor("notifications", NOTIFICATIONS_DESIGN);

    /**
     * Both of the design's blocks travel end to end, which is what one family
     * reader bought: they are the same schema twice, differing only in the
     * words two repositories chose. The native project field the design also
     * names is phase 2 and is not a shape the document may carry — the entry's
     * value widens to a union the day that read has an endpoint row.
     */
    it("reads notifications.1's subscriptions, each to a mapped alert and a declared principal", () => {
        const { refused, stripped, config } = travel("notifications.1", notifications);

        expect([refused, stripped]).toEqual([[], []]);
        expect(config.mappings.alerts).toEqual({
            critical: "priority: critical",
            high: "priority: high",
        });
        expect(viewOf(notifications, config).settings).toEqual({
            subscriptions: {
                critical: { notify: "maintainerTeam" },
                high: { notify: "triageTeam" },
            },
        });
    });

    it("refuses the native field form — an alert is spelled by a label", () => {
        const native = parseConfigDocument(
            `schemaVersion: 2\n${fixture("notifications.1").replace(
                `critical: "priority: critical"`,
                "critical: { field: Priority, value: Critical }",
            )}`,
            { revision: "rev-notifications.native", knownCapabilities: [notifications] },
        );

        expect(native.ok).toBe(false);
        if (native.ok) return;
        expect(native.errors.map((e) => `${e.code} @ ${String(e.path)}`)).toEqual([
            "alertInvalid @ mappings.alerts.critical",
        ]);
    });

    it("reads notifications.2's subscriptions, each to a mapped alert and a declared principal", () => {
        const { refused, stripped, config } = travel("notifications.2", notifications);

        expect([refused, stripped]).toEqual([[], []]);
        expect(config.mappings.alerts).toEqual({ p0: "P0-🔥", security: "Security" });
        expect(viewOf(notifications, config).mapped.alerts).toEqual(["p0", "security"]);
        expect(config.principals["securityTeam"]).toMatch(/^hiero-ledger\//);
        expect(viewOf(notifications, config).settings).toEqual({
            subscriptions: {
                p0: { notify: "maintainerTeam" },
                security: { notify: "securityTeam" },
            },
        });
    });

    /** The doc's own Verified-by row, now whole — and now at parse time. */
    it("refuses a subscription naming an unmapped alert", () => {
        const { config } = travel("notifications.2", notifications);
        const unmapped = withSettings(config, notifications, {
            subscriptions: { critical: { notify: "maintainerTeam" } },
        });

        expect(unmapped.ok ? [] : unmapped.errors.map((e) => e.message)).toEqual([
            'capabilities.notifications.subscriptions.critical: "critical" is not an alert this repository has mapped',
        ]);
    });

    it("refuses a subscription pinging a principal the file never declared", () => {
        const { config } = travel("notifications.2", notifications);
        const unknown = withSettings(config, notifications, {
            subscriptions: { p0: { notify: "releaseTeam" } },
        });

        expect(unknown.ok ? [] : unknown.errors.map((e) => e.message)).toEqual([
            'capabilities.notifications.subscriptions.p0.notify: "releaseTeam" is not a principal this repository declares',
        ]);
    });
});
