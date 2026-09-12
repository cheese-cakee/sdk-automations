/**
 * What we observed about GitHub — the one directory whose contents can go
 * wrong while nobody edits them, because they describe a live system free to
 * change underneath us. Everything else in `core/` encodes a decision the
 * project made and stays true until someone decides differently; green tests
 * HERE mean only that the code still agrees with what we measured on the date
 * each file stamps.
 *
 * That is also the inclusion test: if GitHub could change and make a file
 * wrong with no commit in between, it belongs here; if it encodes a rule we
 * chose, it belongs elsewhere however much it mentions GitHub.
 *
 * D40 makes re-probing a standing obligation — quarterly for the files that
 * carry a probe date, plus ad-hoc whenever the first symptom a file names
 * shows up in operator reports. The re-probe is to compare each `observed`
 * sample against what GitHub says now; every dated fact carries its own date,
 * experiment, staleness condition and first symptom in the file that holds it,
 * so the obligation lives beside the code it governs rather than in a table
 * that can disagree with it.
 */
export * from "./actors.js";
export * from "./ids.js";
export * from "./signatures.js";
export * from "./permissions.js";
export * from "./rate-limits.js";
export * from "./failures.js";
