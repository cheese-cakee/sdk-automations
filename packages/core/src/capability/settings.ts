/**
 * The settings vocabulary — `design/guides/capability-kits.md` §3: the closed
 * set of field constructors a capability's own `settings.ts` builds a spec
 * from. Every constructor but `spec` takes an optional `doc` for `describe()`.
 */

import type { Command, MappableMeaning, OpenMappingFamily, Skill } from "../config/index.js";
import { MIN_GRACE_HOURS } from "../safety/index.js";
import {
    describeSpec,
    dot,
    problem,
    readScope,
    type BlockOf,
    type DurationOptions,
    type Field,
    type FieldDescription,
    type Scope,
    type SettingsOf,
    type SettingsProblem,
    type SettingsResult,
    type SettingsView,
    type Spec,
} from "../config/spec.js";

// ─── Bounds ──────────────────────────────────────────────────────────

const HOURS_PER_DAY = 24;

/** The longest clock a `duration` field may state — a century (D153). */
export const MAX_CLOCK_HOURS = 36_500 * HOURS_PER_DAY;

// ─── The written form ────────────────────────────────────────────────

/** How a maintainer spells a duration: a whole number and a unit, `4h` or `14d`. */
export const DURATION_PATTERN = /^[1-9][0-9]*[hd]$|^0[hd]$/;

/** The written form as a whole number of HOURS, or `null` when it is not one. */
export function parseDuration(written: string): number | null {
    if (!DURATION_PATTERN.test(written)) return null;
    const value = Number(written.slice(0, -1));
    return written.endsWith("d") ? value * HOURS_PER_DAY : value;
}

/** Hours back in the maintainer's own spelling — days where whole, else hours. */
export function writeDuration(hours: number): string {
    if (hours !== 0 && hours % HOURS_PER_DAY === 0) {
        return `${String(hours / HOURS_PER_DAY)}d`;
    }
    return `${String(hours)}h`;
}

// ─── Shapes every constructor judges ─────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

/** A value a `duration` field can hold: written, and inside the ceiling. */
function clockHours(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const hours = parseDuration(value);
    return hours !== null && hours <= MAX_CLOCK_HOURS ? hours : null;
}

function inner(raw: Record<string, unknown>, path: string, fields: Spec, outer: Scope): Scope {
    return { raw, path, fields, outer, view: outer.view };
}

/**
 * Every key of a group the spec does not name, reported at its own dotted path
 * (D4, D84). `known` is the spec's keys plus whatever the constructor owns.
 */
function strangers(
    stated: Readonly<Record<string, unknown>>,
    known: readonly string[],
    path: string,
): readonly SettingsProblem[] {
    return Object.keys(stated)
        .filter((name) => !known.includes(name))
        .map((name) => ({
            code: "unknownKey" as const,
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
export function flag(options: {
    readonly default: boolean;
    readonly doc?: string;
}): Field<boolean> {
    return {
        describe: () => ({
            kind: "flag",
            doc: options.doc ?? null,
            absent: "default",
            default: options.default,
        }),
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: options.default };
            const value = scope.raw[key];
            if (typeof value !== "boolean") return problem(path, "must be true or false");
            return { ok: true, value };
        },
    };
}

/** What a level states nowhere along a path — distinct from a stated `null`. */
const UNSTATED = Symbol("unstated");

/**
 * What one level's raw document holds at a dotted path, or `UNSTATED`. A path
 * is stated only when every segment of it is, and every segment is a record.
 */
function statedAt(raw: Readonly<Record<string, unknown>>, path: readonly string[]): unknown {
    let here: unknown = raw;
    for (const segment of path) {
        if (!isRecord(here) || !Object.hasOwn(here, segment)) return UNSTATED;
        here = here[segment];
    }
    return here;
}

/** The default one level's SPEC declares at a dotted path, in hours, if any. */
function declaredAt(fields: Spec, path: readonly string[]): number | undefined {
    const [head, ...rest] = path;
    const field = head === undefined ? undefined : fields[head];
    if (field === undefined) return undefined;
    if (rest.length === 0) return field.cascades?.default;
    return field.within === undefined ? undefined : declaredAt(field.within, rest);
}

/**
 * The value a named `duration` field has at this level, in hours: the raw value
 * if any level states one, else the nearest declaring level's default (§3.1).
 */
function durationNamed(name: string, from: Scope | null): number | null {
    const path = name.split(".");
    for (let level = from; level !== null; level = level.outer) {
        const stated = statedAt(level.raw, path);
        if (stated !== UNSTATED) return clockHours(stated);
    }
    for (let level = from; level !== null; level = level.outer) {
        const declared = declaredAt(level.fields, path);
        if (declared !== undefined) return declared;
    }
    return null;
}

/** What an absent `duration` key reads as — the same order `read` resolves in. */
function durationAbsent(options: DurationOptions): FieldDescription["absent"] {
    if (options.inherits !== undefined) return "inherited";
    if (options.default !== undefined) return "default";
    return "problem";
}

/** What a value that is not a duration is told, in the spelling it should have had. */
function malformed(value: unknown): string {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        const spelled = String(value);
        return `must be a duration with a unit — write "${spelled}d" for days or "${spelled}h" for hours`;
    }
    return 'must be a duration: a whole number of hours or days, written "4h" or "14d"';
}

/**
 * A length of time, resolved most-specific-first: own value, enclosing levels'
 * `inherits`, then `default`. WRITTEN with a unit and HELD as hours.
 */
export function duration(options: DurationOptions & { readonly doc?: string } = {}): Field<number> {
    const declared = options.default === undefined ? null : parseDuration(options.default);
    if (options.default !== undefined && declared === null) {
        throw new Error(`duration default ${JSON.stringify(options.default)} is not a duration`);
    }

    const bounded = (hours: number, path: string, scope: Scope): SettingsResult<number> => {
        if (hours > MAX_CLOCK_HOURS) {
            return problem(path, `must be at most ${writeDuration(MAX_CLOCK_HOURS)}`);
        }
        if (options.atLeast !== undefined && hours < options.atLeast) {
            return problem(path, `must be at least ${writeDuration(options.atLeast)}`);
        }
        if (options.above === undefined) return { ok: true, value: hours };
        const [target, by] = options.above;
        const floor = durationNamed(target, scope);
        if (floor === null) return { ok: true, value: hours };
        const gap = Math.max(by, MIN_GRACE_HOURS);
        if (hours < floor + gap) {
            return problem(
                path,
                `must be at least ${writeDuration(gap)} above ${target} (${writeDuration(floor)})`,
            );
        }
        return { ok: true, value: hours };
    };

    return {
        ...(declared === null ? {} : { cascades: { default: declared } }),
        describe: () => ({
            kind: "duration",
            doc: options.doc ?? null,
            absent: durationAbsent(options),
            ...(options.default === undefined ? {} : { default: options.default }),
            ...(options.inherits === undefined ? {} : { inherits: options.inherits }),
            ...(options.above === undefined ? {} : { above: options.above }),
            ...(options.atLeast === undefined ? {} : { atLeast: options.atLeast }),
        }),
        read(key, scope) {
            const path = dot(scope.path, key);
            if (Object.hasOwn(scope.raw, key)) {
                const written = scope.raw[key];
                const hours = typeof written === "string" ? parseDuration(written) : null;
                return hours === null
                    ? problem(path, malformed(written))
                    : bounded(hours, path, scope);
            }
            const inherited =
                options.inherits === undefined
                    ? null
                    : durationNamed(options.inherits, scope.outer);
            const resolved = inherited ?? declared;
            if (resolved === null) return problem(path, "must be set to a duration");
            return bounded(resolved, path, scope);
        },
    };
}

/** A whole number, zero or more. */
export function count(options: { readonly default: number; readonly doc?: string }): Field<number> {
    return {
        describe: () => ({
            kind: "count",
            doc: options.doc ?? null,
            absent: "default",
            default: options.default,
        }),
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
export function text(options: { readonly optional: false; readonly doc?: string }): Field<string>;
export function text(options: {
    readonly optional: true;
    readonly doc?: string;
}): Field<string | null>;
export function text(options: {
    readonly optional: boolean;
    readonly doc?: string;
}): Field<string | null>;
export function text(options: {
    readonly optional: boolean;
    readonly doc?: string;
}): Field<string | null> {
    return {
        describe: () => ({
            kind: "text",
            doc: options.doc ?? null,
            absent: options.optional ? "null" : "problem",
            optional: options.optional,
        }),
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
 * A list drawn from one mapping family: an entry outside `view.mapped[family]`
 * is a problem rather than a silent miss.
 */
function mappedList<T extends string>(
    kind: "meanings" | "commands" | "skills",
    family: keyof SettingsView["mapped"],
    nouns: { readonly one: string; readonly many: string },
    doc: string | undefined,
): Field<readonly T[]> {
    return {
        describe: () => ({ kind, doc: doc ?? null, absent: "empty" }),
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: [] };
            const value = scope.raw[key];
            if (!Array.isArray(value)) return problem(path, `must be a list of ${nouns.many}`);

            const names = scope.view.mapped[family];
            const problems: SettingsProblem[] = [];
            const listed: T[] = [];
            for (const [index, entry] of value.entries()) {
                const at = `${path}.${String(index)}`;
                const mapped = names.find((name) => name === entry);
                if (mapped === undefined) {
                    problems.push({
                        code: "settingInvalid",
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
export function meanings(
    options: {
        readonly doc?: string;
    } = {},
): Field<readonly MappableMeaning[]> {
    return mappedList("meanings", "labels", { one: "a meaning", many: "meanings" }, options.doc);
}

/** A list of mapped commands — the words a capability answers to. */
export function commands(options: { readonly doc?: string } = {}): Field<readonly Command[]> {
    return mappedList("commands", "commands", { one: "a command", many: "commands" }, options.doc);
}

/** A list of mapped skill tiers, in the repository's own order of listing. */
export function skills(options: { readonly doc?: string } = {}): Field<readonly Skill[]> {
    return mappedList(
        "skills",
        "skills",
        { one: "a skill tier", many: "skill tiers" },
        options.doc,
    );
}

/** A principal the document declares, by NAME; a name it never declared is a problem. */
export function principal(options: {
    readonly optional: false;
    readonly doc?: string;
}): Field<string>;
export function principal(options: {
    readonly optional: true;
    readonly doc?: string;
}): Field<string | null>;
export function principal(options: {
    readonly optional: boolean;
    readonly doc?: string;
}): Field<string | null>;
export function principal(options: {
    readonly optional: boolean;
    readonly doc?: string;
}): Field<string | null> {
    return {
        describe: () => ({
            kind: "principal",
            doc: options.doc ?? null,
            absent: options.optional ? "null" : "problem",
            optional: options.optional,
        }),
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
 * A plain group of fields with no consent of its own: no `enabled` key, and an
 * absent section reads as every field at its default.
 */
export function section<const F extends Spec>(
    fields: F,
    options: { readonly doc?: string } = {},
): Field<SettingsOf<F>> {
    return {
        within: fields,
        describe: () => ({
            kind: "section",
            doc: options.doc ?? null,
            absent: "default",
            fields: describeSpec(fields),
        }),
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

/** What a `sections` mapping takes beyond its fields. */
export interface SectionsOptions {
    readonly doc?: string;
    /** The open-keyed mapping family every key must name; absent leaves keys free-form. */
    readonly keys?: OpenMappingFamily;
}

/**
 * A mapping of same-shaped sections, keyed by names that are the repository's
 * own — `subscriptions`, `pillars`. Entries keep the file's own key order.
 */
export function sections<const F extends Spec>(
    fields: F,
    options: SectionsOptions = {},
): Field<Readonly<Record<string, SettingsOf<F>>>> {
    const entry = section(fields);
    return {
        describe: () => ({
            kind: "sections",
            doc: options.doc ?? null,
            absent: "empty",
            ...(options.keys === undefined ? {} : { keys: options.keys }),
            fields: describeSpec(fields),
        }),
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
                        code: "settingInvalid",
                        path: dot(path, name),
                        message: `${JSON.stringify(name)} is not an alert this repository has mapped`,
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
 * An enabled-block: consent is `enabled: true` and nothing else. Absent, or
 * anything but `true`, is parked — `{ enabled: false }`, no other field read.
 */
export function block<const F extends Spec>(
    fields: F,
    options: { readonly doc?: string } = {},
): Field<BlockOf<F>> {
    return {
        within: fields,
        describe: () => ({
            kind: "block",
            doc: options.doc ?? null,
            absent: "parked",
            fields: describeSpec(fields),
        }),
        read(key, scope) {
            const path = dot(scope.path, key);
            const parked: SettingsResult<BlockOf<F>> = { ok: true, value: { enabled: false } };
            if (!Object.hasOwn(scope.raw, key)) return parked;
            const raw = scope.raw[key];
            if (!isRecord(raw)) return problem(path, "must be a mapping");
            if (Object.hasOwn(raw, "enabled") && typeof raw.enabled !== "boolean") {
                return problem(dot(path, "enabled"), "must be true or false");
            }
            if (raw.enabled !== true) return parked;

            // `enabled` is consent, not a field, so it joins the sweep's keys only.
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
 * repository's own — `roles`. Each entry reads exactly as `block` does.
 */
export function blocks<const F extends Spec>(
    fields: F,
    options: { readonly doc?: string } = {},
): Field<Readonly<Record<string, BlockOf<F>>>> {
    const entry = block(fields);
    return {
        describe: () => ({
            kind: "blocks",
            doc: options.doc ?? null,
            absent: "empty",
            fields: describeSpec(fields),
        }),
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
 * A group of OPTIONAL members drawn from a CLOSED vocabulary — `pillars`. A
 * member the file did not state reads `null` rather than at its defaults.
 */
export function closed<const F extends Spec>(
    fields: F,
    options: { readonly doc?: string } = {},
): Field<{ readonly [K in keyof F]: (F[K] extends Field<infer T> ? T : never) | null }> {
    type Members = { readonly [K in keyof F]: (F[K] extends Field<infer T> ? T : never) | null };
    return {
        describe: () => ({
            kind: "closed",
            doc: options.doc ?? null,
            absent: "null",
            fields: describeSpec(fields),
        }),
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
 * A list of free text — `uncounted: [review substance, triage judgement]`. The
 * entries are DISPLAY TEXT: shape is checked and nothing else.
 */
export function texts(options: { readonly doc?: string } = {}): Field<readonly string[]> {
    return {
        describe: () => ({ kind: "texts", doc: options.doc ?? null, absent: "empty" }),
        read(key, scope) {
            const path = dot(scope.path, key);
            if (!Object.hasOwn(scope.raw, key)) return { ok: true, value: [] };
            const value = scope.raw[key];
            if (!Array.isArray(value)) return problem(path, "must be a list of text");
            const problems: SettingsProblem[] = [];
            const listed: string[] = [];
            for (const [index, entry] of value.entries()) {
                if (typeof entry === "string") listed.push(entry);
                else {
                    problems.push({
                        code: "settingInvalid",
                        path: `${path}.${String(index)}`,
                        message: "must be text",
                    });
                }
            }
            return problems.length > 0 ? { ok: false, problems } : { ok: true, value: listed };
        },
    };
}

/** A closed choice — `noticeOn: latestActivity | trackingIssue`. */
export function oneOf<const V extends readonly string[]>(
    values: V,
    options: { readonly doc?: string } = {},
): Field<V[number]> {
    return {
        describe: () => ({
            kind: "oneOf",
            doc: options.doc ?? null,
            absent: "problem",
            values,
        }),
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
