/**
 * The registry: every capability this package ships, in production order.
 * Registering one is an import below plus one entry in `CAPABILITIES`.
 */

import { toEngine, type EngineCapability } from "@hiero-hackers/automation-core";
import { intake } from "./intake/capability.js";
import { prDashboard } from "./prDashboard/capability.js";
import { inactivity } from "./inactivity/capability.js";
import { configReport } from "./configReport/capability.js";

export { intake, intakeDeclaration, type IntakeDeclaration } from "./intake/capability.js";
export {
    prDashboard,
    prDashboardDeclaration,
    type PrDashboardDeclaration,
} from "./prDashboard/capability.js";
export {
    inactivity,
    inactivityDeclaration,
    type InactivityDeclaration,
} from "./inactivity/capability.js";
export {
    configReport,
    configReportDeclaration,
    type ConfigReportDeclaration,
} from "./configReport/capability.js";

/** Order is the production composition: a reordering is a behaviour change. */
export const CAPABILITIES: readonly EngineCapability[] = [
    toEngine(intake),
    toEngine(prDashboard),
    toEngine(inactivity),
    toEngine(configReport),
];
