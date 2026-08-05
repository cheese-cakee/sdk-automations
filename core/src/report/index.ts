/**
 * What the platform decided, and why.
 *
 * `finding.ts` is the record; `convert.ts` turns what each part of core
 * already returns into one. Rendering — a managed comment, a check run, an
 * operator page — is the shell's business.
 */
export * from "./finding.js";
export * from "./convert.js";
