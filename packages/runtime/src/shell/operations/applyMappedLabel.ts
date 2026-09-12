/**
 * Moving one item's position label, whole: what the move plans, how its two
 * rows are spelled and read, and the presence read that proves each one.
 *
 * The only operation whose plan is more than one call, and the order of the
 * two is the decision — see `plan`.
 */

import {
    ISSUE_MEANINGS,
    PR_MEANINGS,
    type Intent,
    type ItemRef,
    type MappableMeaning,
} from "@hiero-hackers/automation-core";
import { held, type OperationHandler } from "./handler.js";
import { at, text } from "./row.js";

/** The own-flow positions of one entity kind, in `MAPPABLE_MEANINGS` order. */
function positionsOf(kind: ItemRef["kind"]): readonly MappableMeaning[] {
    return kind === "issue" ? ISSUE_MEANINGS : PR_MEANINGS;
}

/**
 * The position this move displaces, or `undefined` when the item held none.
 *
 * Read from the capability's own claim rather than from a live read, and that
 * is what makes it honest: `deriveWorld` refuses the write unless every
 * claimed meaning is one the authoritative projection actually observed, so a
 * claim that survives the gate is a fact. At most one own-flow position can
 * survive it — two project as a conflict, which `screenIntent` refuses — so
 * the first match is the only match.
 */
function displacedBy(intent: Intent<"applyMappedLabel">): MappableMeaning | undefined {
    return positionsOf(intent.item.kind).find(
        (meaning) =>
            meaning !== intent.desired.meaning && intent.claims.meaningsPresent.includes(meaning),
    );
}

/** The `applyMappedLabel` operation, as the registry holds it. */
export const applyMappedLabel: OperationHandler<"applyMappedLabel"> = {
    verbs: ["addLabel", "removeLabel"],

    /**
     * Add, then remove, and the order is the decision. The intermediate state
     * carries two position labels, which projects as a conflict — so every
     * other capability's decision about the item safe-holds until the removal
     * lands, and a human sees an item that is obviously mid-move. Removing
     * first would leave a window with NO position, which reads as untriaged
     * and invites exactly the automation that should be waiting.
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
        const displaced = displacedBy(intent);
        if (displaced === undefined) {
            return { ok: true, calls: [{ verb: "addLabel", label: target }] };
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
                { verb: "addLabel", label: target },
                { verb: "removeLabel", label: previous },
            ],
        };
    },

    serialize: (call) => ({ verb: call.verb, label: call.label }),

    parse(row) {
        const verb = at(row, "verb");
        if (verb !== "addLabel" && verb !== "removeLabel") return null;
        const label = text(row, "label");
        return label === null ? null : { verb, label };
    },

    async send(call, pass) {
        switch (call.verb) {
            case "addLabel":
                return await pass.writer.addLabel(pass.item, call.label);
            case "removeLabel":
                return await pass.writer.removeLabel(pass.item, call.label);
        }
    },

    async confirm(call, pass) {
        switch (call.verb) {
            case "addLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "present");
            case "removeLabel":
                return held(await pass.reader.labelPresence(pass.item, call.label), "absent");
        }
    },
};
