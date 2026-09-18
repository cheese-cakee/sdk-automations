/** The mapped-label operation's transport: the three label verbs. */

import { repoPath } from "../../client/contract.js";
import type { WriteVerbs } from "@hiero-hackers/automation-core";
import { issuePath, type OperationTransport, type VerbContext } from "./transport.js";

export const APPLY_MAPPED_LABEL = {
    verbs: (
        context: VerbContext,
    ): Pick<WriteVerbs, "createLabel" | "addLabel" | "removeLabel"> => ({
        createLabel: (label, color, description, allowance) =>
            context.apply(
                {
                    url: `${repoPath(context.repository)}/labels`,
                    method: "POST",
                    body: JSON.stringify({ name: label, color, description }),
                    idempotency: "nonIdempotent",
                },
                "invisible",
                allowance,
            ),
        addLabel: (item, label, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels`,
                    method: "POST",
                    body: JSON.stringify({ labels: [label] }),
                    idempotency: "idempotent",
                },
                "invisible",
                allowance,
            ),
        removeLabel: (item, label, allowance) =>
            context.apply(
                {
                    url: `${issuePath(context.repository, item)}/labels/${encodeURIComponent(label)}`,
                    method: "DELETE",
                    idempotency: "idempotent",
                },
                "labelMayBeAbsent",
                allowance,
            ),
    }),
} satisfies OperationTransport;
