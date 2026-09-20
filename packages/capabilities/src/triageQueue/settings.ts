import { flag, section, skills, spec } from "@hiero-hackers/automation-core/author";

export const TRIAGE_QUEUE_SETTINGS = spec({
    welcome: flag({
        default: false,
        doc: "Post a welcome comment on a new issue, saying it is waiting for triage",
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
            skills: skills({
                doc: "Require exactly one of these mapped skill labels before triage is complete",
            }),
        },
        { doc: "Optional labels that the issue should carry before triage is complete" },
    ),
});
