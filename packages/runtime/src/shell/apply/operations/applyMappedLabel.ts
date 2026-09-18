/**
 * Moving one item's position label, whole: the plan, its three rows, and the presence read that proves each.
 * The label is defined first, with the platform's colour, only where the repository lacks it (D202).
 */

import {
    ISSUE_MEANINGS,
    LABEL_DEFAULTS,
    PR_MEANINGS,
    type Intent,
    type ItemRef,
    type MappableMeaning,
} from "@hiero-hackers/automation-core";
import { held, type OperationHandler } from "./handler.js";
import { at, text } from "./row.js";
import type { Call } from "../../effects.js";

/** The define call for one meaning's mapped name; sent as `already` where the repository has it. */
function defineLabel(label: string, meaning: MappableMeaning): Call {
    const { color, description } = LABEL_DEFAULTS[meaning];
    return { verb: "defineLabel", label, color, description };
}

/** The own-flow positions of one entity kind, in `MAPPABLE_MEANINGS` order. */
function positionsOf(kind: ItemRef["kind"]): readonly MappableMeaning[] {
    return kind === "issue" ? ISSUE_MEANINGS : PR_MEANINGS;
}

/**
 * The position this move displaces, or `undefined` when the item held none.
 * Read from the capability's claim: `deriveWorld` refuses the write unless the authoritative projection observed it, and at most one own-flow position survives.
 */
function displacedBy(intent: Intent<"applyMappedLabel">): MappableMeaning | undefined {
    return positionsOf(intent.item.kind).find(
        (meaning) =>
            meaning !== intent.desired.meaning && intent.claims.meaningsPresent.includes(meaning),
    );
}

export const applyMappedLabel: OperationHandler<"applyMappedLabel"> = {
    verbs: ["defineLabel", "addLabel", "removeLabel"],

    /**
     * Define, add, then remove. The intermediate state carries two position labels, which projects
     * as a conflict, so every other decision safe-holds; removing first would leave a window with NO position, which reads as untriaged.
     */
    plan(effect, config) {
        const { intent } = effect;
        const target = config.mappings.labels[intent.desired.meaning];
        if (target === undefined) {
            return {
                ok: false,
                code: "labelUnmapped",
                detail: `the repository maps no label to ${intent.desired.meaning}`,
            };
        }
        const define = defineLabel(target, intent.desired.meaning);
        const displaced = displacedBy(intent);
        if (displaced === undefined) {
            return { ok: true, calls: [define, { verb: "addLabel", label: target }] };
        }
        const previous = config.mappings.labels[displaced];
        if (previous === undefined) {
            return {
                ok: false,
                code: "labelUnmapped",
                detail: `the repository maps no label to the displaced position ${displaced}`,
            };
        }
        return {
            ok: true,
            calls: [
                define,
                { verb: "addLabel", label: target },
                { verb: "removeLabel", label: previous },
            ],
        };
    },

    serialize: (call) =>
        call.verb === "defineLabel"
            ? {
                  verb: call.verb,
                  label: call.label,
                  color: call.color,
                  description: call.description,
              }
            : { verb: call.verb, label: call.label },

    parse(row) {
        const verb = at(row, "verb");
        const label = text(row, "label");
        if (label === null) return null;
        if (verb === "addLabel" || verb === "removeLabel") return { verb, label };
        if (verb !== "defineLabel") return null;
        const color = text(row, "color");
        const description = text(row, "description");
        return color === null || description === null ? null : { verb, label, color, description };
    },

    /** The define reads before it writes: a label the repository holds is left exactly as it is. */
    async send(call, pass) {
        switch (call.verb) {
            case "defineLabel": {
                const defined = await pass.reader.labelDefined(call.label);
                if (defined === "present") return { outcome: "already" };
                if (defined === "unknown") {
                    return {
                        outcome: "unknown",
                        detail: "the read-back could not establish whether the repository defines this label",
                    };
                }
                const created = await pass.writer.createLabel(
                    call.label,
                    call.color,
                    call.description,
                    pass.allowance,
                );
                if (created.outcome !== "conflict") return created;
                const raced = await pass.reader.labelDefined(call.label);
                if (raced === "present") return { outcome: "already" };
                if (raced === "unknown") {
                    return {
                        outcome: "unknown",
                        detail: "the read-back could not establish whether another writer defined this label",
                    };
                }
                return created;
            }
            case "addLabel":
                return await pass.writer.addLabel(pass.item, call.label, pass.allowance);
            case "removeLabel":
                return await pass.writer.removeLabel(pass.item, call.label, pass.allowance);
        }
    },

    async confirm(call, pass) {
        switch (call.verb) {
            case "defineLabel":
                return held(await pass.reader.labelDefined(call.label), "present");
            case "addLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "present");
            case "removeLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "absent");
        }
    },
};
