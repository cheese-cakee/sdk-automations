/**
 * The settings toolkit — `design/guides/capability-kits.md` §3.
 *
 * A capability's settings file is a spec: a plain object whose values are field
 * readers built from a closed vocabulary of fifteen constructors. `readSettings`
 * walks the spec against the capability's view and answers the typed settings
 * or every problem it found, and `unusable` turns those problems into the one
 * explanation §3.2 requires — an unusable block is reported on every delivery
 * that meets it, never silently ignored.
 *
 * A spec is data plus pure readers. There are no conditional fields, no
 * cross-field computation beyond the cascade and the `above` relation, and no
 * custom reader functions (§3.3): a design that needs one has found a config
 * shape the six designs do not have, and the vocabulary grows by one
 * constructor HERE with its rule stated, never by a hook in a capability.
 *
 * `guards.ts` is the shape's other half. Problem paths are relative to the
 * settings block; `unusable` is what renders them under
 * `capabilities.<name>.settings`, because the view does not carry the name.
 */

import type { Command, MappableMeaning, OpenMappingFamily, Skill } from "../config/index.js";
import { MIN_GRACE_DAYS } from "../safety/index.js";
import type { CapabilityView, PlatformHandle } from "./boundary.js";
import type { TypedDeclaration } from "./declaration.js";
import { skipped } from "./guards.js";

// ─── What a reader answers ───────────────────────────────────────────

/** One thing wrong with a settings block: where it is, and what is wrong. */
export interface SettingsProblem {
    /** Dotted, relative to the block — `pullRequests.reapWhen.draft.reapAfterDays`. */
    readonly path: string;
    readonly message: string;
}

/** What `readSettings` answers: the typed settings, or every problem at once. */
export type SettingsResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly problems: readonly SettingsProblem[] };

/**
 * One field's own answer, in the same errors-as-values shape as the whole.
 *
 * Every reader is total: it returns problems rather than throwing, and it
 * returns ALL of them, so a maintainer with three mistakes is told about three.
 */
type Read<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly problems: readonly SettingsProblem[] };

/**
 * One level of the block, and the way out of it.
 *
 * `outer` is what makes the cascade a walk rather than a lookup, and `fields`
 * is what lets a relation resolve a field the raw document never stated: the
 * `above` target may only exist as a default (§3.1).
 */
interface Scope {
    readonly raw: Readonly<Record<string, unknown>>;
    /** Dotted path of this level, `""` at the block's root. */
    readonly path: string;
    readonly fields: Spec;
    readonly outer: Scope | null;
    readonly view: SettingsView;
}

/** The lists a spec checks values against — names, never spellings. */
interface SettingsView {
    readonly mapped: CapabilityView<TypedDeclaration>["mapped"];
    readonly principals: readonly string[];
}

/**
 * One field of a spec: the reader for one key, holding whatever its own
 * constructor closed over. It fetches its own raw value rather than being
 * handed one, because `days` resolves through enclosing levels (§3.1).
 */
export interface Field<T> {
    read(key: string, scope: Scope): Read<T>;
    /** Present on `days` fields only — what the cascade and `above` resolve with. */
    readonly cascades?: DaysOptions;
}

/** A settings spec: field name → the reader for it. */
export type Spec = Readonly<Record<string, Field<unknown>>>;

/** The settings a spec produces — the type a capability reads. */
export type SettingsOf<S extends Spec> = {
    readonly [K in keyof S]: S[K] extends Field<infer T> ? T : never;
};

/** What an enabled-block reads as: parked, or running with its fields. */
export type BlockOf<F extends Spec> =
    { readonly enabled: false } | ({ readonly enabled: true } & SettingsOf<F>);

// ─── Reading one value ───────────────────────────────────────────────

function dot(path: string, key: string): string {
    return path === "" ? key : `${path}.${key}`;
}

function problem(path: string, message: string): Read<never> {
    return { ok: false, problems: [{ path, message }] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function isWholeDays(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A child level, one key down from its parent. */
function inner(raw: Record<string, unknown>, path: string, fields: Spec, outer: Scope): Scope {
    return { raw, path, fields, outer, view: outer.view };
}

/**
 * Every key of a group the spec does not name, reported at its own dotted path
 * — D4, and the reason the sweep is here rather than in one constructor.
 *
 * D84's sweep reaches the TOP of a settings block and stops, so a group reader
 * that walks its spec's keys and never looks at the file's leaves a misspelt
 * `mergedPRz:` counting nothing and saying nothing: the silent zero a closed
 * vocabulary exists to refuse. Every group constructor — `section`, `block`,
 * and the two mappings of them — sweeps, so the depth a mistake sits at no
 * longer decides whether a maintainer hears about it.
 *
 * `known` is the spec's keys plus whatever the constructor owns itself:
 * `block` owns `enabled`, which is consent rather than a field, and a section
 * that saw it would run a group the repository turned off.
 */
function strangers(
    stated: Readonly<Record<string, unknown>>,
    known: readonly string[],
    path: string,
): readonly SettingsProblem[] {
    return Object.keys(stated)
        .filter((name) => !known.includes(name))
        .map((name) => ({
            path: dot(path, name),
            message:
                known.length === 0
                    ? `${JSON.stringify(name)} is not a setting this group takes`
                    : `${JSON.stringify(name)} is not one of ${known.join(", ")}`,
        }));
}

// ─── The fifteen constructors ────────────────────────────────────────

/** The spec, pinned. Identity at runtime; the point is the `const` parameter. */
export function spec<const S extends Spec>(fields: S): S {
    return fields;
}

/** A boolean. Absent reads as the default; anything else is a problem. */
export function flag(options: { readonly default: boolean }): Field<boolean> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: options.default };
            const value = scope.raw[key];
            if (typeof value !== "boolean") return problem(path, "must be true or false");
            return { ok: true, value };
        },
    };
}

/** What a `days` field resolves with — the cascade and the one relation. */
export interface DaysOptions {
    readonly default?: number;
    /** The field name this one inherits from in the enclosing levels (§3.1). */
    readonly inherits?: string;
    /** `[target, by]` — this field must exceed `target` by at least `by` days. */
    readonly above?: readonly [string, number];
}

/**
 * The value a named `days` field has at this level: the raw value if any level
 * from here outward states one, else the nearest declaring level's default.
 *
 * `null` means nothing resolves, which the caller reads two ways — a missing
 * value is a problem, a missing relation target is simply not compared (§3.1).
 */
function daysNamed(name: string, from: Scope | null): number | null {
    for (let level = from; level !== null; level = level.outer) {
        if (Object.hasOwn(level.raw, name)) {
            const value = level.raw[name];
            return isWholeDays(value) ? value : null;
        }
    }
    for (let level = from; level !== null; level = level.outer) {
        const stated = level.fields[name]?.cascades?.default;
        if (stated !== undefined) return stated;
    }
    return null;
}

/**
 * A whole number of days, resolved most-specific-first: this field's own
 * value, then the enclosing levels' `inherits` field, then the default.
 *
 * The `above` relation is checked after the cascade, at every level where both
 * sides resolve. `MIN_GRACE_DAYS` is the floor under the gap a spec states, so
 * a spec cannot declare a grace weaker than the one `safety/destructive.ts`
 * enforces — the constant is imported, never restated.
 */
export function days(options: DaysOptions = {}): Field<number> {
    return {
        cascades: options,
        read(key, scope) {
            const path = dot(scope.path, key);
            const own = Object.hasOwn(scope.raw, key);
            const inherited =
                !own && options.inherits !== undefined
                    ? daysNamed(options.inherits, scope.outer)
                    : null;
            const resolved = own ? scope.raw[key] : (inherited ?? options.default);

            if (resolved === undefined) return problem(path, "must be set to a number of days");
            if (!isWholeDays(resolved)) {
                return problem(path, "must be a whole number of days, zero or more");
            }
            if (options.above === undefined) return { ok: true, value: resolved };

            const [target, by] = options.above;
            const floor = daysNamed(target, scope);
            if (floor === null) return { ok: true, value: resolved };
            const gap = Math.max(by, MIN_GRACE_DAYS);
            if (resolved < floor + gap) {
                return problem(
                    path,
                    `must be at least ${String(gap)} day(s) above ${target} (${String(floor)})`,
                );
            }
            return { ok: true, value: resolved };
        },
    };
}

/**
 * A whole number, zero or more. Whether `0` means "uncapped" is the
 * capability's own prose; the reader does not know and does not ask.
 */
export function count(options: { readonly default: number }): Field<number> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: options.default };
            const value = scope.raw[key];
            if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
                return problem(path, "must be a whole number, zero or more");
            }
            return { ok: true, value };
        },
    };
}

/** A string, for guide links and references. Never parsed, never followed. */
export function text(options: { readonly optional: boolean }): Field<string | null> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) {
                return options.optional ? { ok: true, value: null } : problem(path, "must be set");
            }
            const value = scope.raw[key];
            if (typeof value !== "string") return problem(path, "must be text");
            return { ok: true, value };
        },
    };
}

/**
 * A list drawn from one mapping family. A guard naming a meaning demands its
 * mapping, so an entry outside `view.mapped[family]` is a problem rather than
 * a silent miss — the capability would otherwise wait forever for a meaning
 * nobody maps.
 *
 * The three readers below differ only in the family and the two nouns, which
 * is why they share this body rather than the vocabulary growing by two rules.
 */
function mappedList<T extends string>(
    family: keyof SettingsView["mapped"],
    nouns: { readonly one: string; readonly many: string },
): Field<readonly T[]> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: [] };
            const value = scope.raw[key];
            if (!Array.isArray(value)) return problem(path, `must be a list of ${nouns.many}`);

            // Widened to `readonly string[]`, which is always safe; the found
            // entry IS a member of the family, so narrowing it back is not.
            const names: readonly string[] = scope.view.mapped[family];
            const problems: SettingsProblem[] = [];
            const listed: T[] = [];
            for (const [index, entry] of value.entries()) {
                const at = `${path}.${String(index)}`;
                const mapped = names.find((name) => name === entry);
                if (mapped === undefined) {
                    problems.push({
                        path: at,
                        message: `${JSON.stringify(entry)} is not ${nouns.one} this repository has mapped`,
                    });
                    continue;
                }
                listed.push(mapped as T);
            }
            return problems.length > 0 ? { ok: false, problems } : { ok: true, value: listed };
        },
    };
}

/** A list of mapped label meanings — `claimableOnlyWhen: [ready]`. */
export function meanings(): Field<readonly MappableMeaning[]> {
    return mappedList("labels", { one: "a meaning", many: "meanings" });
}

/** A list of mapped commands — the words a capability answers to. */
export function commands(): Field<readonly Command[]> {
    return mappedList("commands", { one: "a command", many: "commands" });
}

/** A list of mapped skill tiers, in the repository's own order of listing. */
export function skills(): Field<readonly Skill[]> {
    return mappedList("skills", { one: "a skill tier", many: "skill tiers" });
}

/**
 * A principal the document declares, by NAME. Absent when optional renders
 * without the ping; a name the document never declared is a problem, because
 * the alternative is a comment that cc's nobody and says nothing about it.
 *
 * Overloaded on `optional` so a required principal reads as `string` rather
 * than `string | null`: a capability that has already said the field is
 * required should not have to re-prove it to the compiler at the use site.
 */
export function principal(options: { readonly optional: false }): Field<string>;
export function principal(options: { readonly optional: true }): Field<string | null>;
export function principal(options: { readonly optional: boolean }): Field<string | null>;
export function principal(options: { readonly optional: boolean }): Field<string | null> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) {
                return options.optional
                    ? { ok: true, value: null }
                    : problem(path, "must name a principal");
            }
            const value = scope.raw[key];
            if (typeof value !== "string") return problem(path, "must name a principal");
            if (!scope.view.principals.includes(value)) {
                return problem(
                    path,
                    `${JSON.stringify(value)} is not a principal this repository declares`,
                );
            }
            return { ok: true, value };
        },
    };
}

/**
 * A plain group of fields with no consent of its own.
 *
 * A section is not a block and the difference is the whole point: it has no
 * `enabled` key, so every inner field is read whether the group was written
 * out or not, and an absent section reads as every field at its default. The
 * station a section configures is switched by its own flags — `onOpen.label`,
 * `approval.confirm`, a skill tier's threshold, a pillar's `atLeast`.
 *
 * A group that DOES carry an `enabled` key is a `block`, not a section read
 * loosely: a section would read `enabled` as an unknown key and run the group
 * a repository had turned off.
 *
 * The cascade and the `above` relation resolve through a section exactly as
 * they do through a block, because both are levels with an `outer` (§3.1).
 */
export function section<const F extends Spec>(fields: F): Field<SettingsOf<F>> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            const stated = Object.hasOwn(scope.raw, key) ? scope.raw[key] : {};
            if (!isRecord(stated)) return problem(path, "must be a mapping");

            const unknown = strangers(stated, Object.keys(fields), path);
            const read = readScope(fields, inner(stated, path, fields, scope));
            if (unknown.length === 0) return read;
            return { ok: false, problems: [...unknown, ...(read.ok ? [] : read.problems)] };
        },
    };
}

/**
 * What a `sections` mapping checks its KEYS against, when they are not
 * free-form.
 */
export interface SectionsOptions {
    /**
     * The open-keyed mapping family every key must name.
     *
     * `subscriptions` are keyed by alert, and an alert the repository never
     * mapped is a subscription to a label that can never arrive — reported
     * here for the same reason `meanings()` reports an unmapped meaning, and
     * with the same consequence: the capability's whole block is unusable
     * rather than quietly one entry short. Absent leaves keys free-form, which
     * is what `pillars` and `roles` want.
     *
     * Only OPEN families belong here. A closed family's members are a platform
     * union and a settings KEY is untyped text, so a spec that wanted one would
     * be asking the toolkit to narrow a string it cannot narrow — those are
     * read as values, through `meanings()` and its siblings.
     */
    readonly keys?: OpenMappingFamily;
}

/**
 * A mapping of same-shaped sections, keyed by names that are the repository's
 * own — `subscriptions`, `pillars`. Each entry reads exactly as `section`
 * does, so an entry that states nothing still reads at its defaults.
 *
 * An absent mapping is no entries; a value that is not a mapping is a problem
 * at the mapping's own path, because the alternative is a capability quietly
 * subscribing nobody.
 */
export function sections<const F extends Spec>(
    fields: F,
    options: SectionsOptions = {},
): Field<Readonly<Record<string, SettingsOf<F>>>> {
    const entry = section(fields);
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: {} };
            const raw = scope.raw[key];
            if (!isRecord(raw)) return problem(path, "must be a mapping");

            const family = options.keys;
            const problems: SettingsProblem[] = [];
            const read: [string, SettingsOf<F>][] = [];
            const level = inner(raw, path, {}, scope);
            for (const name of Object.keys(raw)) {
                if (family !== undefined && !scope.view.mapped[family].includes(name)) {
                    problems.push({
                        path: dot(path, name),
                        message: `${JSON.stringify(name)} is not ${family === "alerts" ? "an alert" : "a type"} this repository has mapped`,
                    });
                    continue;
                }
                const one = entry.read(name, level);
                if (one.ok) read.push([name, one.value]);
                else problems.push(...one.problems);
            }
            return problems.length > 0
                ? { ok: false, problems }
                : { ok: true, value: Object.fromEntries(read) };
        },
    };
}

/**
 * An enabled-block: consent is `enabled: true` and nothing else.
 *
 * A block that is absent, or that says anything but `true`, reads as
 * `{ enabled: false }` and its other fields are NOT read — parked, not
 * running. That is what makes a kept block with `enabled: false` safe to
 * leave in a file, and it is why a nested block is unreadable when its parent
 * is off (§3.1).
 */
export function block<const F extends Spec>(fields: F): Field<BlockOf<F>> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            const parked: Read<BlockOf<F>> = { ok: true, value: { enabled: false } };
            if (!Object.hasOwn(scope.raw, key)) return parked;
            const raw = scope.raw[key];
            if (!isRecord(raw)) return problem(path, "must be a mapping");
            if (raw.enabled !== true) return parked;

            // `enabled` is consent, not a field, so it joins the spec's keys
            // for the sweep and nowhere else.
            const unknown = strangers(raw, ["enabled", ...Object.keys(fields)], path);
            const read = readScope(fields, inner(raw, path, fields, scope));
            if (unknown.length > 0) {
                return { ok: false, problems: [...unknown, ...(read.ok ? [] : read.problems)] };
            }
            if (!read.ok) return read;
            return { ok: true, value: { enabled: true, ...read.value } };
        },
    };
}

/**
 * A mapping of same-shaped enabled-blocks, keyed by names that are the
 * repository's own — `checks`, `reapWhen`, `roles`. Each entry reads exactly
 * as `block` does, so an entry without consent is parked with its siblings
 * still running.
 */
export function blocks<const F extends Spec>(
    fields: F,
): Field<Readonly<Record<string, BlockOf<F>>>> {
    const entry = block(fields);
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: {} };
            const raw = scope.raw[key];
            if (!isRecord(raw)) return problem(path, "must be a mapping");

            const problems: SettingsProblem[] = [];
            const read: [string, BlockOf<F>][] = [];
            const level = inner(raw, path, {}, scope);
            for (const name of Object.keys(raw)) {
                const one = entry.read(name, level);
                if (one.ok) read.push([name, one.value]);
                else problems.push(...one.problems);
            }
            return problems.length > 0
                ? { ok: false, problems }
                : { ok: true, value: Object.fromEntries(read) };
        },
    };
}

/**
 * A group of OPTIONAL members drawn from a CLOSED vocabulary — `pillars`.
 *
 * One rule `section` does not have, and the design that needed it is
 * advancement's role/pillar block: a member the file did not state reads
 * `null` rather than at its defaults, because "no `mergedPRs` pillar" and "a
 * `mergedPRs` pillar of zero" are different requirements and a section cannot
 * tell them apart.
 *
 * The other half of the design — a key outside the spec is a PROBLEM at its
 * own path rather than a silent drop — is no longer this constructor's alone:
 * `strangers` gave it to every group reader (D4), which is where it belonged.
 *
 * Not `blocks`, which would be the same shape read through consent: a pillar
 * carries no `enabled` key, and demanding one would put platform bookkeeping
 * into a threshold a maintainer writes on one line.
 */
export function closed<const F extends Spec>(
    fields: F,
): Field<{ readonly [K in keyof F]: (F[K] extends Field<infer T> ? T : never) | null }> {
    type Members = { readonly [K in keyof F]: (F[K] extends Field<infer T> ? T : never) | null };
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            const stated = Object.hasOwn(scope.raw, key) ? scope.raw[key] : {};
            if (!isRecord(stated)) return problem(path, "must be a mapping");

            const problems: SettingsProblem[] = [...strangers(stated, Object.keys(fields), path)];
            const level = inner(stated, path, fields, scope);
            const read: [string, unknown][] = [];
            for (const [name, field] of Object.entries(fields)) {
                if (!Object.hasOwn(stated, name)) {
                    read.push([name, null]);
                    continue;
                }
                const one = field.read(name, level);
                if (one.ok) read.push([name, one.value]);
                else problems.push(...one.problems);
            }
            return problems.length > 0
                ? { ok: false, problems }
                : { ok: true, value: Object.fromEntries(read) as Members };
        },
    };
}

/**
 * A list of free text — `uncounted: [review substance, triage judgement]`.
 *
 * The three list readers above all check their entries against a mapping
 * family, because a guard naming a meaning demands its mapping. This one
 * checks nothing but the shape, because its entries are DISPLAY TEXT: they are
 * rendered into a sentence and never compared with a label, a command or a
 * meaning. Absent is no entries.
 */
export function texts(): Field<readonly string[]> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: [] };
            const value = scope.raw[key];
            if (!Array.isArray(value)) return problem(path, "must be a list of text");
            const problems: SettingsProblem[] = [];
            const listed: string[] = [];
            for (const [index, entry] of value.entries()) {
                if (typeof entry === "string") listed.push(entry);
                else problems.push({ path: `${path}.${String(index)}`, message: "must be text" });
            }
            return problems.length > 0 ? { ok: false, problems } : { ok: true, value: listed };
        },
    };
}

/** A closed choice — `noticeOn: latestActivity | trackingIssue`. */
export function oneOf<const V extends readonly string[]>(values: V): Field<V[number]> {
    return {
        read(key, scope) {
            const path = dot(scope.path, key);
            const listed = `must be one of ${values.join(", ")}`;
            if (!Object.hasOwn(scope.raw, key)) return problem(path, listed);
            const value = scope.raw[key];
            const chosen = values.find((allowed) => allowed === value);
            if (chosen === undefined) return problem(path, listed);
            return { ok: true, value: chosen };
        },
    };
}

// ─── Reading a spec, and reporting one that cannot be read ───────────

/** Every field of one level, each read whether or not an earlier one failed. */
function readScope<S extends Spec>(fields: S, scope: Scope): Read<SettingsOf<S>> {
    const problems: SettingsProblem[] = [];
    const read: [string, unknown][] = [];
    for (const [key, field] of Object.entries(fields)) {
        const one = field.read(key, scope);
        if (one.ok) read.push([key, one.value]);
        else problems.push(...one.problems);
    }
    if (problems.length > 0) return { ok: false, problems };
    return { ok: true, value: Object.fromEntries(read) as SettingsOf<S> };
}

/**
 * Read a capability's settings block against its spec.
 *
 * The seam is a VIEW, not a document: the same spec is what a pull-request
 * configuration check would run at parse time when that build lands, and
 * nothing here presumes it (§3.2).
 */
export function readSettings<const S extends Spec, D extends TypedDeclaration>(
    fields: S,
    view: CapabilityView<D>,
): SettingsResult<SettingsOf<S>> {
    const raw: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(view.settings)) raw[key] = value;
    return readScope(fields, {
        raw,
        path: "",
        fields,
        outer: null,
        view: { mapped: view.mapped, principals: view.principals },
    });
}

/**
 * The honest floor for an unusable block: one explanation on the operator
 * surface, and no intent — the settings caption's own stop, spoken through
 * `guards.ts`'s one helper.
 *
 * The first problem is the summary's sentence and the rest are its detail, so
 * the shape holds whether a maintainer made one mistake or four. This is where
 * the capability's name arrives, and so where a relative path becomes the
 * dotted one a maintainer can find in their file.
 */
export function unusable<D extends TypedDeclaration>(
    problems: readonly SettingsProblem[],
    platform: PlatformHandle<D>,
    capability: string,
): readonly never[] {
    const at = ({ path, message }: SettingsProblem): string =>
        `capabilities.${capability}.settings.${path}: ${message}`;
    const [first, ...rest] = problems;
    return skipped(
        platform,
        capability,
        first === undefined
            ? "Skipped: settings unusable."
            : `Skipped: settings unusable — ${at(first)}`,
        ...rest.map(at),
    );
}
