/**
 * What the platform decided, and why. Every decision core makes lands here,
 * and four surfaces are views of this one list: the dry-run report, the
 * configuration report, the operator page, and the managed comment.
 *
 * `finding.ts` is the record; `convert.ts` turns what each part of core
 * already returns into one. Rendering — a managed comment, a check run, an
 * operator page — is the shell's business. The list is FLAT on purpose: those
 * four consumers group differently, by item, capability, config path and
 * severity, and a shape favouring one makes the others awkward.
 *
 * SEVERITY IS ABOUT WHAT A MAINTAINER MUST DO, not how bad something sounds:
 * `info` happened and was normal, `notice` means nothing happened and that was
 * intended, `problem` means a human has to act or this keeps failing. So a
 * refusal is usually NOT a problem — most refusals are the system working —
 * and `convert.ts` holds that judgement as one table mapping every refusal
 * code to a severity, so the four consumers cannot drift into disagreeing
 * about what counts as bad. A capability supplies its own explanation and no
 * severity: the platform classifies, the capability explains. `code` and
 * `Subject` stay machine-readable because every consumer groups by them;
 * `summary` is prose and is never asserted on, only its presence (D75).
 */
export * from "./finding.js";
export * from "./convert.js";
