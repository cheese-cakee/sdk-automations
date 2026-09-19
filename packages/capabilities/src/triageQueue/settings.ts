/** The settings triageQueue reads beside its `enabled`: three flags, one per thing a contributor sees. */

import { flag, spec } from "@hiero-hackers/automation-core/author";

export const TRIAGE_QUEUE_SETTINGS = spec({
    welcome: flag({
        default: false,
        doc: "Post a welcome comment on a new issue, saying it is waiting for triage",
    }),
    lockUntilTriaged: flag({
        default: false,
        doc: 'Lock a new issue\'s conversation until someone with triage access adds the ready label — mappings.labels.ready, default "status: ready", never created by the App; the welcome is posted either way',
    }),
    confirmUnlock: flag({
        default: false,
        doc: "Post a comment when the ready label unlocks the issue; does nothing unless lockUntilTriaged is on",
    }),
});
