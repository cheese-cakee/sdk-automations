/**
 * The settings toolkit — `design/guides/capability-kits.md` §3.
 *
 * Two halves, in the order a reader meets them. The constructors first, each
 * against the rule its row of §3's table states; then the six capability
 * designs, whose `automations.yml` examples are the fixtures under
 * `fixtures/settings/`. The second half is the acceptance claim: the toolkit
 * is proved against all six designs before the second capability's code exists.
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
 * - `mappings` holds five families: three CLOSED (`labels`, `commands`,
 *   `skills`) and two OPEN (`alerts`, `types`). An open family's entry is a
 *   mapping naming a `label`, so a design that wrote its entries as bare
 *   strings — intake's `types:` block — is still refused, and so is the native
 *   `{ field, value }` alert form notifications' own phase table lists as work
 *   to come. `travel` records which family refused a document before reading
 *   the settings without it.
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
    days,
    declareCapability,
    flag,
    meanings,
    MIN_GRACE_DAYS,
    oneOf,
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
    unusable,
    type CapabilityView,
    type PlatformHandle,
    type RepositoryConfig,
    type RequiredMappings,
    type SettingsProblem,
    type StructuredExplanation,
    type TypedDeclaration,
} from "../../src/index.js";

// ─── Reading a spec against a repository ─────────────────────────────

/** Everything a design fixture needs from a declaration, and nothing it does not. */
const declarationFor = (
    name: string,
    configKeys: readonly string[],
    requiredMappings: RequiredMappings = {},
) =>
    declareCapability({
        name,
        triggers: [{ kind: "event", event: "issues" }],
        configKeys,
        requiredMappings,
        facts: ["issue"],
        needs: [],
        resolvers: [],
        intents: ["postManagedComment"],
        operationalNeeds: {
            schedule: false,
            durableState: "none",
            crossItemCoordination: false,
            externalDelivery: false,
        },
    });

const fixture = (name: string): string =>
    readFileSync(
        fileURLToPath(new URL(`fixtures/settings/${name}.yml`, import.meta.url)),
        "utf8",
    ).replaceAll("\r\n", "\n");

/**
 * The open families, whose entry shape two designs pre-date: the one a
 * document may have to shed before today's parser will read the rest of it.
 */
const OPEN_FAMILIES = ["alerts", "types"];

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

/**
 * Take one design's block through the real boundary: text → document →
 * `RepositoryConfig`. A block is an excerpt, so `schemaVersion` is supplied
 * when it states none; everything else is the file as its design doc wrote it.
 */
function travel(name: string, declaration: TypedDeclaration): Travelled {
    const verbatim = fixture(name);
    const document = verbatim.startsWith("schemaVersion")
        ? verbatim
        : `schemaVersion: 1\n${verbatim}`;
    const options = {
        revision: `rev-${name}`,
        knownCapabilities: [
            {
                name: declaration.name,
                configKeys: declaration.configKeys,
                requiredMappings: declaration.requiredMappings,
            },
        ],
    };

    // Stripped only when the document as written is refused: a family the
    // parser now reads is one nothing has to come out for.
    const asWritten = parseConfigDocument(document, options);
    const stripped = asWritten.ok
        ? []
        : OPEN_FAMILIES.filter((family) => withoutFamily(document, family) !== document);
    const shippable = withoutEmptySections(stripped.reduce(withoutFamily, document));
    const result = parseConfigDocument(shippable, options);
    if (!result.ok) {
        throw new Error(`${name}: ${result.errors.map((e) => `${e.code} @ ${e.path}`).join(", ")}`);
    }
    return {
        refused: asWritten.ok ? [] : asWritten.errors.map((e) => `${e.code} @ ${String(e.path)}`),
        stripped,
        config: result.config,
    };
}

/** The view a fixture's capability receives, ready for `readSettings`. */
const viewOf = <D extends TypedDeclaration>(declaration: D, config: RepositoryConfig) =>
    projectCapabilityView(declaration, config);

/** A view built by hand, for the constructor tests that want no document. */
function view(
    settings: Readonly<Record<string, unknown>>,
    of: {
        meanings?: string[];
        commands?: string[];
        skills?: string[];
        alerts?: string[];
        types?: string[];
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
            types: of.types ?? [],
        },
        principals: of.principals ?? [],
    };
}

/** What one read said went wrong, as `path: message`. */
const problemsOf = (result: { ok: boolean; problems?: readonly SettingsProblem[] }): string[] =>
    (result.problems ?? []).map((problem) => `${problem.path}: ${problem.message}`);

// ─── The fifteen constructors ────────────────────────────────────────

describe("flag", () => {
    const fields = spec({ announce: flag({ default: false }) });

    it("reads the boolean the repository wrote", () => {
        expect(readSettings(fields, view({ announce: true }))).toEqual({
            ok: true,
            value: { announce: true },
        });
        expect(readSettings(fields, view({ announce: false }))).toEqual({
            ok: true,
            value: { announce: false },
        });
    });

    it("falls back to the default when the key is absent", () => {
        expect(readSettings(fields, view({}))).toEqual({ ok: true, value: { announce: false } });
        expect(readSettings(spec({ announce: flag({ default: true }) }), view({}))).toEqual({
            ok: true,
            value: { announce: true },
        });
    });

    /** "Truthy is not consent" is the platform's own rule one level down. */
    it("reports a non-boolean rather than reading it as one", () => {
        expect(problemsOf(readSettings(fields, view({ announce: "yes" })))).toEqual([
            "announce: must be true or false",
        ]);
    });
});

describe("days", () => {
    const fields = spec({ gracePeriodDays: days({ default: 7 }) });

    it("reads a whole number of days, and defaults when absent", () => {
        expect(readSettings(fields, view({ gracePeriodDays: 21 }))).toEqual({
            ok: true,
            value: { gracePeriodDays: 21 },
        });
        expect(readSettings(fields, view({}))).toEqual({
            ok: true,
            value: { gracePeriodDays: 7 },
        });
        expect(readSettings(fields, view({ gracePeriodDays: 0 }))).toEqual({
            ok: true,
            value: { gracePeriodDays: 0 },
        });
    });

    it.each([
        ["a fraction", 7.5],
        ["a negative period", -1],
        ["a string", "7"],
    ])("reports %s rather than rounding or ignoring it", (_why, value) => {
        expect(problemsOf(readSettings(fields, view({ gracePeriodDays: value })))).toEqual([
            "gracePeriodDays: must be a whole number of days, zero or more",
        ]);
    });

    it("reports a field with no value and no default", () => {
        expect(problemsOf(readSettings(spec({ after: days() }), view({})))).toEqual([
            "after: must be set to a number of days",
        ]);
    });
});

describe("count", () => {
    const fields = spec({ maxOpen: count({ default: 2 }) });

    it("reads a whole number, zero included — what zero MEANS is the capability's", () => {
        expect(readSettings(fields, view({ maxOpen: 0 }))).toEqual({
            ok: true,
            value: { maxOpen: 0 },
        });
        expect(readSettings(fields, view({}))).toEqual({ ok: true, value: { maxOpen: 2 } });
    });

    it.each([
        ["a fraction", 1.5],
        ["a negative cap", -2],
        ["a string", "2"],
    ])("reports %s", (_why, value) => {
        expect(problemsOf(readSettings(fields, view({ maxOpen: value })))).toEqual([
            "maxOpen: must be a whole number, zero or more",
        ]);
    });
});

describe("text", () => {
    it("reads a string, and renders without it when it is optional", () => {
        const fields = spec({ guide: text({ optional: true }) });
        expect(readSettings(fields, view({ guide: "https://example.test/signing" }))).toEqual({
            ok: true,
            value: { guide: "https://example.test/signing" },
        });
        expect(readSettings(fields, view({}))).toEqual({ ok: true, value: { guide: null } });
    });

    it("reports an absent required string, and a non-string either way", () => {
        expect(
            problemsOf(readSettings(spec({ guide: text({ optional: false }) }), view({}))),
        ).toEqual(["guide: must be set"]);
        expect(
            problemsOf(readSettings(spec({ guide: text({ optional: true }) }), view({ guide: 7 }))),
        ).toEqual(["guide: must be text"]);
    });
});

describe("meanings", () => {
    const fields = spec({ claimableOnlyWhen: meanings() });

    it("reads the mapped meanings a guard names, and an absent list as none", () => {
        expect(
            readSettings(
                fields,
                view({ claimableOnlyWhen: ["ready"] }, { meanings: ["ready", "blocked"] }),
            ),
        ).toEqual({ ok: true, value: { claimableOnlyWhen: ["ready"] } });
        expect(readSettings(fields, view({}))).toEqual({
            ok: true,
            value: { claimableOnlyWhen: [] },
        });
        expect(readSettings(fields, view({ claimableOnlyWhen: [] }))).toEqual({
            ok: true,
            value: { claimableOnlyWhen: [] },
        });
    });

    /** A guard naming a meaning demands its mapping, and says which entry. */
    it("reports every unmapped entry at its own dotted path", () => {
        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({ claimableOnlyWhen: ["ready", "blocked"] }, { meanings: ["ready"] }),
                ),
            ),
        ).toEqual(['claimableOnlyWhen.1: "blocked" is not a meaning this repository has mapped']);
    });

    it("reports a list that is not a list", () => {
        expect(problemsOf(readSettings(fields, view({ claimableOnlyWhen: "ready" })))).toEqual([
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
        expect(readSettings(fields, view({ answersTo: ["working"] }, repository))).toEqual({
            ok: true,
            value: { answersTo: ["working"], gates: [] },
        });
        expect(readSettings(fields, view({ gates: ["beginner"] }, repository))).toEqual({
            ok: true,
            value: { answersTo: [], gates: ["beginner"] },
        });
    });

    it("does not let one family satisfy another, and says so in that family's words", () => {
        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({ answersTo: ["beginner"], gates: ["ready"] }, repository),
                ),
            ),
        ).toEqual([
            'answersTo.0: "beginner" is not a command this repository has mapped',
            'gates.0: "ready" is not a skill tier this repository has mapped',
        ]);
    });

    it("reports a list that is not a list, in each family's plural", () => {
        expect(
            problemsOf(readSettings(fields, view({ answersTo: "/assign", gates: "beginner" }))),
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
            readSettings(
                fields,
                view({ notify: "maintainerTeam" }, { principals: ["maintainerTeam"] }),
            ),
        ).toEqual({ ok: true, value: { notify: "maintainerTeam" } });
    });

    it("renders without the ping when it is optional and absent", () => {
        expect(readSettings(spec({ notify: principal({ optional: true }) }), view({}))).toEqual({
            ok: true,
            value: { notify: null },
        });
    });

    it("reports a name the document never declared, and an absent required one", () => {
        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({ notify: "triageTeam" }, { principals: ["maintainerTeam"] }),
                ),
            ),
        ).toEqual(['notify: "triageTeam" is not a principal this repository declares']);
        expect(problemsOf(readSettings(fields, view({})))).toEqual([
            "notify: must name a principal",
        ]);
        expect(problemsOf(readSettings(fields, view({ notify: 7 })))).toEqual([
            "notify: must name a principal",
        ]);
    });
});

describe("section", () => {
    const fields = spec({
        onOpen: section({ label: flag({ default: false }), welcome: flag({ default: true }) }),
    });

    it("reads every inner field, with no consent of its own to ask for", () => {
        expect(readSettings(fields, view({ onOpen: { label: true, welcome: false } }))).toEqual({
            ok: true,
            value: { onOpen: { label: true, welcome: false } },
        });
    });

    /** The difference from `block`, stated as a claim: absent is defaults, not parked. */
    it("reads an absent section as every field at its default", () => {
        expect(readSettings(fields, view({}))).toEqual({
            ok: true,
            value: { onOpen: { label: false, welcome: true } },
        });
        expect(readSettings(fields, view({ onOpen: {} }))).toEqual({
            ok: true,
            value: { onOpen: { label: false, welcome: true } },
        });
    });

    it("reports its own problems at their nested paths, and a section that is not a mapping", () => {
        expect(problemsOf(readSettings(fields, view({ onOpen: { label: "yes" } })))).toEqual([
            "onOpen.label: must be true or false",
        ]);
        expect(problemsOf(readSettings(fields, view({ onOpen: "on" })))).toEqual([
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

        expect(readSettings(nested, view({ approval: { confirm: true } }))).toEqual({
            ok: true,
            value: { approval: { confirm: true, checklist: { skillTier: false } } },
        });
    });

    /** A section is a level, so §3.1 walks through it exactly as it walks a block. */
    it("passes the cascade and the above relation through, level for level", () => {
        const laddered = spec({
            remindAfterDays: days({ default: 14 }),
            reapAfterDays: days({ default: 21 }),
            tiers: section({
                reapAfterDays: days({ inherits: "reapAfterDays" }),
                strict: section({
                    reapAfterDays: days({
                        inherits: "reapAfterDays",
                        above: ["remindAfterDays", MIN_GRACE_DAYS],
                    }),
                }),
            }),
        });

        expect(readSettings(laddered, view({ tiers: { reapAfterDays: 60 } }))).toEqual({
            ok: true,
            value: {
                remindAfterDays: 14,
                reapAfterDays: 21,
                tiers: { reapAfterDays: 60, strict: { reapAfterDays: 60 } },
            },
        });
        expect(
            problemsOf(readSettings(laddered, view({ tiers: { strict: { reapAfterDays: 14 } } }))),
        ).toEqual([
            `tiers.strict.reapAfterDays: must be at least ${String(MIN_GRACE_DAYS)} day(s) above remindAfterDays (14)`,
        ]);
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

        expect(
            problemsOf(readSettings(fields, view({ onOpen: { label: true, labl: true } }))),
        ).toEqual(['onOpen.labl: "labl" is not one of label']);
    });

    it("reaches the bottom of a nest, not only the group the mistake's parent is in", () => {
        const fields = spec({
            approval: section({ checklist: section({ skillTier: flag({ default: false }) }) }),
        });

        expect(
            problemsOf(
                readSettings(fields, view({ approval: { checklist: { skillTierz: true } } })),
            ),
        ).toEqual(['approval.checklist.skillTierz: "skillTierz" is not one of skillTier']);
    });

    it("a block counts its consent among its own keys, and nothing else", () => {
        const fields = spec({ pullRequests: block({ reapAfterDays: count({ default: 0 }) }) });

        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({ pullRequests: { enabled: true, reapAfterDays: 5, nope: 1 } }),
                ),
            ),
        ).toEqual(['pullRequests.nope: "nope" is not one of enabled, reapAfterDays']);
    });

    it("a parked block sweeps nothing: its fields were never read", () => {
        const fields = spec({ pullRequests: block({ reapAfterDays: count({ default: 0 }) }) });

        expect(readSettings(fields, view({ pullRequests: { enabled: false, nope: 1 } }))).toEqual({
            ok: true,
            value: { pullRequests: { enabled: false } },
        });
    });

    it("each entry of a mapping of groups sweeps as the group it is", () => {
        const asSections = spec({ pillars: sections({ atLeast: count({ default: 0 }) }) });
        const asBlocks = spec({ roles: blocks({ atLeast: count({ default: 0 }) }) });

        expect(
            problemsOf(readSettings(asSections, view({ pillars: { mergedPRs: { atLeest: 1 } } }))),
        ).toEqual(['pillars.mergedPRs.atLeest: "atLeest" is not one of atLeast']);
        expect(
            problemsOf(
                readSettings(asBlocks, view({ roles: { committer: { enabled: true, x: 1 } } })),
            ),
        ).toEqual(['roles.committer.x: "x" is not one of enabled, atLeast']);
    });

    it("names what a group with no fields of its own takes, which is nothing", () => {
        const fields = spec({ marker: section({}) });

        expect(problemsOf(readSettings(fields, view({ marker: { anything: 1 } })))).toEqual([
            'marker.anything: "anything" is not a setting this group takes',
        ]);
    });

    it("reports a stranger and a bad field together, so one push fixes both", () => {
        const fields = spec({ onOpen: section({ label: flag({ default: false }) }) });
        const consented = spec({ pullRequests: block({ label: flag({ default: false }) }) });

        expect(
            problemsOf(readSettings(fields, view({ onOpen: { label: "yes", nope: 1 } }))),
        ).toEqual([
            'onOpen.nope: "nope" is not one of label',
            "onOpen.label: must be true or false",
        ]);
        expect(
            problemsOf(
                readSettings(
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
            readSettings(
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
        expect(readSettings(fields, view({}, teams))).toEqual({
            ok: true,
            value: { subscriptions: {} },
        });
    });

    it("reports one entry's problem without losing the others", () => {
        expect(
            problemsOf(
                readSettings(
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
        expect(
            problemsOf(readSettings(fields, view({ subscriptions: ["critical"] }, teams))),
        ).toEqual(["subscriptions: must be a mapping"]);
    });
});

/**
 * The second instance of the open-family mechanism. `types` reads exactly as
 * `alerts` does and says so in its own words, which is the whole of what
 * "one mechanism, two instances" has to mean at a call site.
 */
describe("sections keyed by the types family", () => {
    const fields = spec({ advice: sections({ ask: flag({ default: false }) }, { keys: "types" }) });

    it("reads an entry keyed by a type the repository mapped", () => {
        expect(
            readSettings(fields, view({ advice: { bug: { ask: true } } }, { types: ["bug"] })),
        ).toEqual({ ok: true, value: { advice: { bug: { ask: true } } } });
    });

    it("reports a key naming a type nobody mapped, in that family's own words", () => {
        expect(
            problemsOf(readSettings(fields, view({ advice: { epic: {} } }, { types: ["bug"] }))),
        ).toEqual(['advice.epic: "epic" is not a type this repository has mapped']);
    });
});

describe("block", () => {
    const fields = spec({
        checklist: block({ skillTier: flag({ default: false }), guide: text({ optional: true }) }),
    });

    it("reads its fields only on an explicit enabled: true", () => {
        expect(
            readSettings(fields, view({ checklist: { enabled: true, skillTier: true } })),
        ).toEqual({
            ok: true,
            value: { checklist: { enabled: true, skillTier: true, guide: null } },
        });
    });

    it.each([
        ["absent", undefined],
        ["off", { enabled: false, skillTier: "nonsense" }],
        ["consented to with something that is not true", { enabled: "yes", skillTier: 7 }],
        ["kept without consent at all", { skillTier: 7 }],
    ])("reads a block %s as parked, and never reads its fields", (_why, checklist) => {
        // The malformed inner field is the proof: a parked block is not read,
        // so a check nobody enabled cannot make a file unusable.
        expect(readSettings(fields, view(checklist === undefined ? {} : { checklist }))).toEqual({
            ok: true,
            value: { checklist: { enabled: false } },
        });
    });

    /** The parser hands on records built without a prototype (`__proto__` as data). */
    it("reads a block that carries no prototype", () => {
        const bare = Object.assign(Object.create(null) as Record<string, unknown>, {
            enabled: true,
            skillTier: true,
        });

        expect(readSettings(fields, view({ checklist: bare }))).toEqual({
            ok: true,
            value: { checklist: { enabled: true, skillTier: true, guide: null } },
        });
    });

    it("reports a block that is not a mapping", () => {
        expect(problemsOf(readSettings(fields, view({ checklist: "on" })))).toEqual([
            "checklist: must be a mapping",
        ]);
    });

    it("reports an enabled block's own problems, at their nested paths", () => {
        expect(
            problemsOf(readSettings(fields, view({ checklist: { enabled: true, skillTier: 7 } }))),
        ).toEqual(["checklist.skillTier: must be true or false"]);
    });
});

describe("blocks", () => {
    const fields = spec({ checks: blocks({ guide: text({ optional: true }) }) });

    it("reads a mapping whose keys are the repository's own", () => {
        expect(
            readSettings(
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
        expect(readSettings(fields, view({}))).toEqual({ ok: true, value: { checks: {} } });
    });

    it("reports one entry's problem without losing the others", () => {
        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({ checks: { dcoSignoff: { enabled: true, guide: 7 }, gpg: "on" } }),
                ),
            ),
        ).toEqual(["checks.dcoSignoff.guide: must be text", "checks.gpg: must be a mapping"]);
    });

    it("reports a mapping that is not one", () => {
        expect(problemsOf(readSettings(fields, view({ checks: ["dcoSignoff"] })))).toEqual([
            "checks: must be a mapping",
        ]);
    });
});

describe("oneOf", () => {
    const fields = spec({ noticeOn: oneOf(["latestActivity", "trackingIssue"]) });

    it("reads a listed choice", () => {
        expect(readSettings(fields, view({ noticeOn: "trackingIssue" }))).toEqual({
            ok: true,
            value: { noticeOn: "trackingIssue" },
        });
    });

    it("reports an unlisted one, and an absent one, by listing the choices", () => {
        expect(problemsOf(readSettings(fields, view({ noticeOn: "somewhere" })))).toEqual([
            "noticeOn: must be one of latestActivity, trackingIssue",
        ]);
        expect(problemsOf(readSettings(fields, view({})))).toEqual([
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
        expect(readSettings(fields, view({ pillars: { reviews: { atLeast: 9 } } }))).toEqual({
            ok: true,
            value: { pillars: { reviews: { atLeast: 9 }, mergedPRs: null } },
        });
    });

    it("answers null for every member when the group itself is absent", () => {
        expect(readSettings(fields, view({}))).toEqual({
            ok: true,
            value: { pillars: { reviews: null, mergedPRs: null } },
        });
    });

    it("reports a key outside the vocabulary rather than dropping it", () => {
        expect(
            problemsOf(readSettings(fields, view({ pillars: { mergedPRz: { atLeast: 1 } } }))),
        ).toEqual(['pillars.mergedPRz: "mergedPRz" is not one of reviews, mergedPRs']);
    });

    it("reports a stranger and a bad member together", () => {
        expect(
            problemsOf(
                readSettings(fields, view({ pillars: { nope: {}, reviews: { atLeast: -1 } } })),
            ),
        ).toEqual([
            'pillars.nope: "nope" is not one of reviews, mergedPRs',
            "pillars.reviews.atLeast: must be a whole number, zero or more",
        ]);
    });

    it("reports a group that is not a mapping", () => {
        expect(problemsOf(readSettings(fields, view({ pillars: 3 })))).toEqual([
            "pillars: must be a mapping",
        ]);
    });

    it("nests, so a parameter on the wrong pillar is caught the same way", () => {
        expect(
            problemsOf(
                readSettings(
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
        expect(
            readSettings(fields, view({ uncounted: ["review substance", "mentorship"] })),
        ).toEqual({ ok: true, value: { uncounted: ["review substance", "mentorship"] } });
    });

    it("absent is no entries", () => {
        expect(readSettings(fields, view({}))).toEqual({ ok: true, value: { uncounted: [] } });
    });

    it("reports a value that is not a list, and every entry that is not text", () => {
        expect(problemsOf(readSettings(fields, view({ uncounted: "mentorship" })))).toEqual([
            "uncounted: must be a list of text",
        ]);
        expect(problemsOf(readSettings(fields, view({ uncounted: ["ok", 3, false] })))).toEqual([
            "uncounted.1: must be text",
            "uncounted.2: must be text",
        ]);
    });
});

// ─── The cascade, the relation, and the report ───────────────────────

describe("the cascade (§3.1)", () => {
    const fields = spec({
        remindAfterDays: days({ default: 14 }),
        reapAfterDays: days({ default: 21 }),
        pullRequests: block({
            reapAfterDays: days({ inherits: "reapAfterDays" }),
            reapWhen: blocks({ reapAfterDays: days({ inherits: "reapAfterDays" }) }),
        }),
    });

    const resolve = (settings: Readonly<Record<string, unknown>>) => {
        const read = readSettings(fields, view(settings));
        if (!read.ok) throw new Error(problemsOf(read).join(", "));
        return read.value;
    };

    it("resolves most-specific-first: reason, then ladder, then capability default", () => {
        const value = resolve({
            reapAfterDays: 21,
            pullRequests: {
                enabled: true,
                reapAfterDays: 60,
                reapWhen: {
                    draft: { enabled: true },
                    needsRevision: { enabled: true, reapAfterDays: 5 },
                },
            },
        });
        expect(value.pullRequests).toEqual({
            enabled: true,
            reapAfterDays: 60,
            reapWhen: {
                draft: { enabled: true, reapAfterDays: 60 },
                needsRevision: { enabled: true, reapAfterDays: 5 },
            },
        });
    });

    it("reaches the capability's own field when the ladder states none", () => {
        const value = resolve({
            reapAfterDays: 21,
            pullRequests: { enabled: true, reapWhen: { draft: { enabled: true } } },
        });
        expect(value.pullRequests).toEqual({
            enabled: true,
            reapAfterDays: 21,
            reapWhen: { draft: { enabled: true, reapAfterDays: 21 } },
        });
    });

    /**
     * The level that STATES the unreadable value is the one that reports it,
     * once. An inner field inheriting from it falls through to its own default
     * rather than reporting the same mistake at a second path.
     */
    it("stops at a level whose value it cannot read, and reports it there", () => {
        const inheriting = spec({
            reapAfterDays: days({ default: 21 }),
            pullRequests: block({
                reapAfterDays: days({ inherits: "reapAfterDays", default: 30 }),
            }),
        });

        expect(
            problemsOf(
                readSettings(
                    inheriting,
                    view({ reapAfterDays: "soon", pullRequests: { enabled: true } }),
                ),
            ),
        ).toEqual(["reapAfterDays: must be a whole number of days, zero or more"]);
    });

    it("reaches the default when no level states anything", () => {
        expect(resolve({ pullRequests: { enabled: true } })).toEqual({
            remindAfterDays: 14,
            reapAfterDays: 21,
            pullRequests: { enabled: true, reapAfterDays: 21, reapWhen: {} },
        });
    });
});

describe("the above relation (§3.1)", () => {
    const fields = spec({
        remindAfterDays: days({ default: 14 }),
        reapAfterDays: days({ default: 21, above: ["remindAfterDays", MIN_GRACE_DAYS] }),
        pullRequests: block({
            remindAfterDays: days({ inherits: "remindAfterDays" }),
            reapAfterDays: days({
                inherits: "reapAfterDays",
                above: ["remindAfterDays", MIN_GRACE_DAYS],
            }),
        }),
    });

    it("passes when every level clears the floor", () => {
        expect(
            readSettings(
                fields,
                view({
                    remindAfterDays: 14,
                    reapAfterDays: 21,
                    pullRequests: { enabled: true, remindAfterDays: 2, reapAfterDays: 5 },
                }),
            ).ok,
        ).toBe(true);
    });

    it("reports the level where the reap does not clear the remind", () => {
        expect(
            problemsOf(
                readSettings(
                    fields,
                    view({
                        remindAfterDays: 14,
                        reapAfterDays: 21,
                        pullRequests: { enabled: true, remindAfterDays: 30 },
                    }),
                ),
            ),
        ).toEqual([
            `pullRequests.reapAfterDays: must be at least ${String(MIN_GRACE_DAYS)} day(s) above remindAfterDays (30)`,
        ]);
    });

    it("holds the platform's floor under a gap a spec states more weakly", () => {
        const weaker = spec({
            remindAfterDays: days({ default: 14 }),
            reapAfterDays: days({ default: 14, above: ["remindAfterDays", 0] }),
        });
        expect(problemsOf(readSettings(weaker, view({})))).toEqual([
            `reapAfterDays: must be at least ${String(MIN_GRACE_DAYS)} day(s) above remindAfterDays (14)`,
        ]);
    });

    it("does not compare at a level where the target resolves to nothing", () => {
        const orphan = spec({ reapAfterDays: days({ default: 1, above: ["remindAfterDays", 5] }) });
        expect(readSettings(orphan, view({})).ok).toBe(true);
    });
});

describe("unusable (§3.2)", () => {
    function watch(): {
        readonly platform: PlatformHandle<TypedDeclaration>;
        readonly explained: StructuredExplanation[];
    } {
        const explained: StructuredExplanation[] = [];
        return {
            platform: {
                resolve: async () => {
                    throw new Error("no resolver here");
                },
                explain: (explanation) => {
                    explained.push(explanation);
                },
            },
            explained,
        };
    }

    it("reports one problem as the whole sentence, under its dotted path", () => {
        const { platform, explained } = watch();

        expect(
            unusable(
                [
                    {
                        path: "gracePeriodDays",
                        message: "must be a whole number of days, zero or more",
                    },
                ],
                platform,
                "inactivity",
            ),
        ).toEqual([]);
        expect(explained).toEqual([
            {
                capability: "inactivity",
                summary:
                    "Skipped: settings unusable — capabilities.inactivity.settings.gracePeriodDays: must be a whole number of days, zero or more",
                detail: [],
            },
        ]);
    });

    it("keeps every further problem as detail, so nothing is silently dropped", () => {
        const { platform, explained } = watch();

        unusable(
            [
                { path: "a", message: "first" },
                { path: "b.c", message: "second" },
            ],
            platform,
            "assignment",
        );

        expect(explained[0]).toEqual({
            capability: "assignment",
            summary: "Skipped: settings unusable — capabilities.assignment.settings.a: first",
            detail: ["capabilities.assignment.settings.b.c: second"],
        });
    });

    it("explains once even for a problem list nobody built", () => {
        const { platform, explained } = watch();
        unusable([], platform, "intake");
        expect(explained).toEqual([
            { capability: "intake", summary: "Skipped: settings unusable.", detail: [] },
        ]);
    });
});

describe("readSettings", () => {
    it("reads a spec with no fields at all — the shape does not vary", () => {
        expect(readSettings(spec({}), view({}))).toEqual({ ok: true, value: {} });
    });

    it("returns every problem at once, not the first", () => {
        const fields = spec({ announce: flag({ default: false }), after: days({ default: 1 }) });
        expect(problemsOf(readSettings(fields, view({ announce: "yes", after: -1 })))).toEqual([
            "announce: must be true or false",
            "after: must be a whole number of days, zero or more",
        ]);
    });
});

// ─── The six designs' config sections, as fixtures ───────────────────

describe("intake — packages/capabilities/src/intake/design.md", () => {
    const intake = declarationFor("intake", ["onOpen", "approval"], {
        labels: ["awaitingTriage"],
    });

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

    it("reads the quarantine example: label, welcome, lock, then release on ready", () => {
        const { refused, stripped, config } = travel("intake.1", intake);

        expect([refused, stripped]).toEqual([[], []]);
        expect(Object.keys(config.capabilities.intake?.settings ?? {})).toEqual([
            "onOpen",
            "approval",
        ]);
        expect(readSettings(INTAKE_DESIGN, viewOf(intake, config))).toEqual({
            ok: true,
            value: {
                onOpen: { label: true, welcome: true, lock: true },
                approval: {
                    when: ["ready"],
                    unlock: true,
                    confirm: true,
                    checklist: { skillTier: false, issueType: false },
                },
            },
        });
    });

    /**
     * The `types` family ships now, and intake's design page pre-dates its
     * shape: an open family's entry is a mapping naming a `label`, and this
     * document writes bare strings. So it is still set aside — but the refusal
     * now names the entry that is wrong instead of the family that did not
     * exist, which is the whole of what shipping the family bought a
     * maintainer holding this file.
     */
    it("reads the C++ shape's advisory checklist, once the types family is set aside", () => {
        const { refused, stripped, config } = travel("intake.2", intake);

        expect([refused, stripped]).toEqual([
            [
                "typeInvalid @ mappings.types.bug",
                "typeInvalid @ mappings.types.enhancement",
                "typeInvalid @ mappings.types.docs",
            ],
            ["types"],
        ]);
        expect(readSettings(INTAKE_DESIGN, viewOf(intake, config))).toEqual({
            ok: true,
            value: {
                onOpen: { label: true, welcome: false, lock: false },
                approval: {
                    when: ["ready"],
                    unlock: false,
                    confirm: true,
                    checklist: { skillTier: true, issueType: true },
                },
            },
        });
    });

    /** The third policy is no policy, and it parses as one: consent withheld. */
    it("reads the repository that never triages as a capability turned off", () => {
        const { refused, config } = travel("intake.3", intake);

        expect(refused).toEqual([]);
        expect(config.capabilities.intake).toEqual({ enabled: false, settings: {} });
        // Both stations absent is both stations off — the section's own rule,
        // and the reason a repository states only the flags it wants.
        expect(readSettings(INTAKE_DESIGN, viewOf(intake, config))).toEqual({
            ok: true,
            value: {
                onOpen: { label: false, welcome: false, lock: false },
                approval: {
                    when: [],
                    unlock: false,
                    confirm: false,
                    checklist: { skillTier: false, issueType: false },
                },
            },
        });
    });
});

describe("prQuality — packages/capabilities/src/prQuality/design.md", () => {
    const prQuality = declarationFor("prQuality", ["checks", "applyLabels"]);

    /** The whole section, in three constructors. `assignedIssues` nests, which is its dependency. */
    const PR_QUALITY_DESIGN = spec({
        checks: blocks({
            guide: text({ optional: true }),
            assignedIssues: block({ guide: text({ optional: true }) }),
        }),
        applyLabels: flag({ default: false }),
    });

    const read = (name: string) => {
        const { refused, stripped, config } = travel(name, prQuality);
        expect([refused, stripped]).toEqual([[], []]);
        const settings = readSettings(PR_QUALITY_DESIGN, viewOf(prQuality, config));
        if (!settings.ok) throw new Error(problemsOf(settings).join(", "));
        return settings.value;
    };

    it("runs the four consented checks, and the sub-check inside the one that carries it", () => {
        expect(read("prQuality.1")).toEqual({
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
        expect(read("prQuality.2")).toEqual({
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
                "schemaVersion: 1",
                "capabilities:",
                "  prQuality:",
                "    enabled: true",
                "    settings:",
                "      assignedIssues:",
                "        enabled: true",
            ].join("\n"),
            {
                revision: "rev-nesting",
                knownCapabilities: [
                    {
                        name: "prQuality",
                        configKeys: prQuality.configKeys,
                        requiredMappings: {},
                    },
                ],
            },
        );

        expect(result.ok ? [] : result.errors.map((e) => `${e.code} @ ${String(e.path)}`)).toEqual([
            "unknownKey @ capabilities.prQuality.settings.assignedIssues",
        ]);
    });
});

describe("inactivity — packages/capabilities/src/inactivity/design.md", () => {
    const inactivity = declarationFor("inactivity", [
        "exemptBlocked",
        "remindAfterDays",
        "reapAfterDays",
        "issues",
        "pullRequests",
    ]);

    /**
     * The design's two ladders. Every `days` inside one inherits by name, so
     * the spec states the chain by naming the field and the reader does the
     * walking; `above` carries `MIN_GRACE_DAYS` at each level it appears.
     */
    const INACTIVITY_DESIGN = spec({
        exemptBlocked: flag({ default: false }),
        remindAfterDays: days({ default: 14 }),
        reapAfterDays: days({ default: 21, above: ["remindAfterDays", MIN_GRACE_DAYS] }),
        issues: block({
            remindAfterDays: days({ inherits: "remindAfterDays" }),
            reapAfterDays: days({
                inherits: "reapAfterDays",
                above: ["remindAfterDays", MIN_GRACE_DAYS],
            }),
        }),
        pullRequests: block({
            remindAfterDays: days({ inherits: "remindAfterDays" }),
            reapAfterDays: days({
                inherits: "reapAfterDays",
                above: ["remindAfterDays", MIN_GRACE_DAYS],
            }),
            reapWhen: blocks({
                remindAfterDays: days({ inherits: "remindAfterDays" }),
                reapAfterDays: days({
                    inherits: "reapAfterDays",
                    above: ["remindAfterDays", MIN_GRACE_DAYS],
                }),
            }),
        }),
    });

    const travelled = () => travel("inactivity.1", inactivity);

    it("parses as written, commands family and all — the clock reset is mappable", () => {
        const { refused, stripped, config } = travelled();
        expect([refused, stripped]).toEqual([[], []]);
        expect(config.mappings.commands).toEqual({ working: "/working" });
    });

    it("resolves every clock most-specific-first: reason, then ladder, then default", () => {
        const settings = readSettings(INACTIVITY_DESIGN, viewOf(inactivity, travelled().config));

        expect(settings).toEqual({
            ok: true,
            value: {
                exemptBlocked: true,
                remindAfterDays: 14,
                reapAfterDays: 21,
                issues: { enabled: true, remindAfterDays: 14, reapAfterDays: 21 },
                pullRequests: {
                    enabled: true,
                    remindAfterDays: 14,
                    reapAfterDays: 60,
                    reapWhen: {
                        draft: { enabled: true, remindAfterDays: 14, reapAfterDays: 60 },
                        changesRequested: {
                            enabled: true,
                            remindAfterDays: 14,
                            reapAfterDays: 60,
                        },
                        needsRevision: {
                            enabled: true,
                            remindAfterDays: 2,
                            reapAfterDays: 5,
                        },
                    },
                },
            },
        });
    });

    /**
     * "At every level, `reapAfterDays` must exceed `remindAfterDays` by the
     * platform's minimum grace" — including the level that inherited one side.
     */
    it("reports a reason whose reap does not clear its own remind", () => {
        const { config } = travelled();
        const block = config.capabilities.inactivity;
        const impatient = {
            ...config,
            capabilities: {
                inactivity: {
                    enabled: true,
                    settings: {
                        ...block?.settings,
                        pullRequests: {
                            enabled: true,
                            reapAfterDays: 60,
                            reapWhen: {
                                needsRevision: {
                                    enabled: true,
                                    remindAfterDays: 5,
                                    reapAfterDays: 5,
                                },
                            },
                        },
                    },
                },
            },
        };

        expect(problemsOf(readSettings(INACTIVITY_DESIGN, viewOf(inactivity, impatient)))).toEqual([
            `pullRequests.reapWhen.needsRevision.reapAfterDays: must be at least ${String(MIN_GRACE_DAYS)} day(s) above remindAfterDays (5)`,
        ]);
    });
});

describe("advancement — design/guides/capabilities/advancement.md", () => {
    const advancement = declarationFor("advancement", [
        "noticeOn",
        "noticeIssue",
        "mentionCandidate",
        "reference",
        "roles",
    ]);

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

    it("reads the three-role governance ladder, skills family and all", () => {
        const { refused, stripped, config } = travel("advancement.1", advancement);

        expect([refused, stripped]).toEqual([[], []]);
        expect(readSettings(ADVANCEMENT_DESIGN, viewOf(advancement, config))).toEqual({
            ok: true,
            value: {
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
            },
        });
    });

    it("reads the tracking-issue venue, its issue number, and the silent candidate", () => {
        const { refused, config } = travel("advancement.2", advancement);

        expect(refused).toEqual([]);
        expect(readSettings(ADVANCEMENT_DESIGN, viewOf(advancement, config))).toEqual({
            ok: true,
            value: {
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
            },
        });
    });

    /** Consent is the block's, and a role withdrawn takes its pillars with it. */
    it("does not read the pillars of a role turned off", () => {
        const { config } = travel("advancement.2", advancement);
        const settings = config.capabilities.advancement?.settings;
        const paused = {
            ...config,
            capabilities: {
                advancement: {
                    enabled: true,
                    settings: {
                        ...settings,
                        roles: { trustedReviewer: { enabled: false, pillars: { reviews: 25 } } },
                    },
                },
            },
        };

        expect(readSettings(ADVANCEMENT_DESIGN, viewOf(advancement, paused))).toEqual({
            ok: true,
            value: expect.objectContaining({ roles: { trustedReviewer: { enabled: false } } }),
        });
    });
});

describe("assignment — design/guides/capabilities/assignment.md", () => {
    const assignment = declarationFor("assignment", ["autoAssign", "unassign", "skillGates"]);

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
            minAccountAgeDays: days({ default: 0 }),
        }),
        unassign: block({}),
        skillGates: block({
            goodFirstIssue: section(TIER),
            beginner: section(TIER),
            intermediate: section(TIER),
            advanced: section(TIER),
        }),
    });

    /** Every tier parameter at its default — what a stated tier is read against. */
    const NO_TIER = { maxOpen: 0, maxCompletions: 0, requiresPrevious: 0, supportTeam: null };

    it("reads the caps-only repository, and parks the gates it turned off", () => {
        const { refused, stripped, config } = travel("assignment.1", assignment);

        expect([refused, stripped]).toEqual([[], []]);
        expect(readSettings(ASSIGNMENT_DESIGN, viewOf(assignment, config))).toEqual({
            ok: true,
            value: {
                autoAssign: {
                    enabled: true,
                    claimableOnlyWhen: [],
                    notClaimableWhen: [],
                    capIgnores: [],
                    maxOpen: 2,
                    maxPerDay: 1,
                    minAccountAgeDays: 7,
                },
                unassign: { enabled: true },
                skillGates: { enabled: false },
            },
        });
    });

    it("reads every meaning set of the ready-for-dev repository", () => {
        const { refused, stripped, config } = travel("assignment.2", assignment);

        expect([refused, stripped]).toEqual([[], []]);
        expect(readSettings(ASSIGNMENT_DESIGN, viewOf(assignment, config))).toEqual({
            ok: true,
            value: {
                autoAssign: {
                    enabled: true,
                    claimableOnlyWhen: ["ready"],
                    notClaimableWhen: ["blocked", "awaitingTriage", "inProgress"],
                    capIgnores: ["needsReview", "blocked"],
                    maxOpen: 2,
                    maxPerDay: 1,
                    minAccountAgeDays: 7,
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
            },
        });
    });

    /**
     * The third example states its guards and not the mappings they name — it
     * is an excerpt of a file, not a file. Read on its own it is exactly the
     * case the doc's own rule describes: a guard naming a meaning demands its
     * mapping, and an unmapped one is reported with the entry that named it.
     */
    it("reports the guard meaning this excerpt never mapped, by its dotted path", () => {
        const { refused, config } = travel("assignment.3", assignment);

        expect(refused).toEqual([]);
        expect(problemsOf(readSettings(ASSIGNMENT_DESIGN, viewOf(assignment, config)))).toEqual([
            'autoAssign.notClaimableWhen.0: "blocked" is not a meaning this repository has mapped',
        ]);
    });
});

describe("notifications — design/guides/capabilities/notifications.md", () => {
    const notifications = declarationFor("notifications", ["subscriptions"]);

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

    /**
     * `notifications.1` is the design's NATIVE form and is refused whole, by
     * name: `{ field: Priority, value: Critical }` is that design's phase 2 and
     * needs a project-field read no endpoint row confirms. `notifications.2` is
     * the label form, and travels end to end.
     */
    it("refuses notifications.1 — the native field form is phase 2", () => {
        const { refused } = travel("notifications.2", notifications);
        expect(refused).toEqual([]);

        const verbatim = parseConfigDocument(`schemaVersion: 1\n${fixture("notifications.1")}`, {
            revision: "rev-notifications.1",
            knownCapabilities: [notifications],
        });
        expect(verbatim.ok).toBe(false);
        if (verbatim.ok) return;
        expect(verbatim.errors.map((e) => `${e.code} @ ${String(e.path)}`)).toEqual([
            "alertInvalid @ mappings.alerts.critical",
            "alertInvalid @ mappings.alerts.high",
        ]);
    });

    it("reads notifications.2's subscriptions, each to a mapped alert and a declared principal", () => {
        const { refused, stripped, config } = travel("notifications.2", notifications);

        expect([refused, stripped]).toEqual([[], []]);
        expect(config.mappings.alerts).toEqual({
            p0: { label: "P0-🔥" },
            security: { label: "Security" },
        });
        expect(viewOf(notifications, config).mapped.alerts).toEqual(["p0", "security"]);
        expect(config.principals["securityTeam"]).toMatch(/^hiero-ledger\//);
        expect(readSettings(NOTIFICATIONS_DESIGN, viewOf(notifications, config))).toEqual({
            ok: true,
            value: {
                subscriptions: {
                    p0: { notify: "maintainerTeam" },
                    security: { notify: "securityTeam" },
                },
            },
        });
    });

    /** The doc's own Verified-by row, now whole. */
    it("reports a subscription naming an unmapped alert", () => {
        const { config } = travel("notifications.2", notifications);
        const unmapped = {
            ...config,
            capabilities: {
                notifications: {
                    enabled: true,
                    settings: { subscriptions: { critical: { notify: "maintainerTeam" } } },
                },
            },
        };

        expect(
            problemsOf(readSettings(NOTIFICATIONS_DESIGN, viewOf(notifications, unmapped))),
        ).toEqual([
            'subscriptions.critical: "critical" is not an alert this repository has mapped',
        ]);
    });

    it("reports a subscription pinging a principal the file never declared", () => {
        const { config } = travel("notifications.2", notifications);
        const unknown = {
            ...config,
            capabilities: {
                notifications: {
                    enabled: true,
                    settings: { subscriptions: { p0: { notify: "releaseTeam" } } },
                },
            },
        };

        expect(
            problemsOf(readSettings(NOTIFICATIONS_DESIGN, viewOf(notifications, unknown))),
        ).toEqual([
            'subscriptions.p0.notify: "releaseTeam" is not a principal this repository declares',
        ]);
    });
});
