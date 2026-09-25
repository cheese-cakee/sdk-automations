import { flag, section, spec } from "@hiero-hackers/automation-core/author";

export const TRIAGE_QUEUE_SETTINGS = spec({
    welcome: flag({
        default: false,
        doc: "Post a welcome comment on a new issue, saying it is waiting for triage; a requirement below posts it too",
    }),
    lockUntilTriaged: flag({
        default: false,
        doc: 'Lock a new issue\'s conversation until someone with triage access adds the ready label — mappings.labels.ready, default "status: ready", which no capability creates yet; the welcome is posted either way',
    }),
    confirmUnlock: flag({
        default: false,
        doc: "Post a comment when the ready label unlocks the issue; does nothing unless lockUntilTriaged is on",
    }),
    requirements: section(
        {
            skill: flag({
                default: false,
                needs: "skills",
                doc: "Exactly one mapped skill label, from mappings.skills; the repository creates those labels",
            }),
        },
        {
            doc: "What a triaged issue carries, one opt-in item each, shown as a checklist in the welcome; nothing moves the issue yet",
        },
    ),
});
