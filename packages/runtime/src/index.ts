/**
 * The running platform's public surface, composed from the three barrels
 * beside it: `store/` (which durable state transition may commit now),
 * `adapter/` (the only place that talks to GitHub) and `shell/` (the order
 * everything happens in).
 *
 * Each directory keeps its own `index.ts` and its own README, because each is
 * still a boundary: inside this package a module reaches a sibling directory
 * THROUGH that barrel and never past it (`.dependency-cruiser.cjs`). This file
 * only re-exports them, so the surface it publishes is exactly the union of
 * the three — no name is added or renamed here.
 *
 * `WriteResult` is the union's one collision, and it is not two things
 * colliding: the shell declares the seam and the adapter declares the shape it
 * implements it with, six words for six words. They are one type to a reader,
 * so the seam's declaration is the one this barrel publishes; the adapter's
 * stays reachable through `adapter/index.ts` for the transport's own callers.
 *
 * `shell/main.ts` is the runnable entry point and is deliberately not exported.
 */
export * from "./store/index.js";
export * from "./adapter/index.js";
export * from "./shell/index.js";
export type { WriteResult } from "./shell/index.js";
