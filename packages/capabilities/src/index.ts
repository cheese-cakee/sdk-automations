/**
 * The registry: every capability this package ships, in production order.
 *
 * Adding a capability is one folder and one line here. The shell composes
 * `CAPABILITIES` and never names a member, and `test/engine-matrix.test.ts`
 * derives its subsets from it, so a new capability joins the P3 matrix with
 * no test edit.
 *
 * The named exports below are the package's public surface, listed rather
 * than re-exported wholesale: a capability's settings are its own business,
 * not the package's.
 */

import { toEngine, type EngineCapability } from "@hiero-hackers/automation-core";
import { intake } from "./intake/capability.js";
import { prQuality } from "./prQuality/capability.js";
import { inactivity } from "./inactivity/capability.js";

export { intake, intakeDeclaration, type IntakeDeclaration } from "./intake/capability.js";
export {
    prQuality,
    prQualityDeclaration,
    type PrQualityDeclaration,
} from "./prQuality/capability.js";
export {
    inactivity,
    inactivityDeclaration,
    type InactivityDeclaration,
} from "./inactivity/capability.js";

/**
 * The declaration type is erased here rather than at each call site, through
 * the one blessed erasure — the soundness argument lives once, in
 * `packages/core/src/engine/invoke.ts`.
 *
 * `Capability<TypedDeclaration>` cannot serve: a capability declaring no need
 * reads a group typed `Unread` and one declaring every need reads it read, and
 * neither shape widens into the other. That is the guarantee working — the
 * declaration IS what a capability may read — so the list holds the erased
 * shape the engine already works against.
 *
 * Order is the production composition. The shell evaluates capabilities in
 * this order for every delivery, so a reordering is a behaviour change.
 */
export const CAPABILITIES: readonly EngineCapability[] = [
    toEngine(intake),
    toEngine(prQuality),
    toEngine(inactivity),
];
