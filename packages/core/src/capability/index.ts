/**
 * The capability layer: what a capability may declare, and how it is called.
 *
 * `catalogue.ts` holds the closed vocabularies and `operations/` the platform's
 * per-operation facts and change wording; `producers.ts` holds the other side
 * of the fact contract — which producer reads which group — and is what a
 * declared need is judged against. `facts.ts` holds the judgements every
 * capability makes over a record it is handed, which is where a shared reading
 * lives now that P3 forbids one capability importing a sibling for it.
 * `managed.ts` owns the identity of the App's own comments. `declaration.ts` owns direct boot admission. `intent.ts`
 * is what a capability asks for plus the screens that request passes,
 * `factory.ts` how one is built, and `boundary.ts` how the platform invokes a
 * capability and what it lets it see. `guards.ts` and `settings.ts` are the two
 * kits every `evaluate` is written with — the three stops, and the settings spec.
 *
 * One rule holds the directory together: a capability is ordinary code the
 * platform must not trust, and everything here makes that lack of trust
 * structural. The vocabularies are CLOSED (D61), so a capability chooses from
 * them and cannot extend them — which is where P3 isolation comes from, since
 * capabilities sharing no vocabulary have nothing to call each other through.
 * Comment identity is platform-owned (D125): a capability supplies a `kind` and
 * body content and can write no marker. The view IS the config isolation — a
 * capability cannot read a neighbour's block because the view never contains
 * it — and the engine derives action class and permission from
 * `INTENT_OPERATIONS`, which capabilities never supply. Read in import order:
 * `catalogue.ts` imports nothing from here and everything reaches it, so a new
 * import INTO the catalogue is the signal something is in the wrong file.
 *
 * Deliberately NOT here: label strings (a capability speaks meanings —
 * `../config/`), the write rules (`../safety/`), the transition tables the
 * screen consults (`../workflow/`), and any capability itself — those live in
 * `packages/capabilities/`, one folder each.
 */
export * from "./catalogue.js";
export * from "./producers.js";
export * from "./facts.js";
export { INTENT_OPERATIONS } from "./operations/index.js";
export * from "./managed.js";
export * from "./declaration.js";
export * from "./intent.js";
export * from "./factory.js";
export * from "./boundary.js";
export { skipped } from "./guards.js";
export {
    block,
    blocks,
    closed,
    commands,
    count,
    days,
    flag,
    meanings,
    oneOf,
    principal,
    readSettings,
    section,
    sections,
    skills,
    spec,
    text,
    texts,
    unusable,
    type BlockOf,
    type DaysOptions,
    type Field,
    type SectionsOptions,
    type SettingsOf,
    type SettingsProblem,
    type SettingsResult,
    type Spec,
} from "./settings.js";
