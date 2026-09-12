# runtime — everything that runs

The one package that touches the outside world, in three directories with the layer rules the
dependency cruiser holds as directory rules:

- [`src/store/`](src/store/README.md) — the owned operational store: deliveries, the effect journal,
  schedules. Sits on core only.
- [`src/adapter/`](src/adapter/README.md) — the only code that talks to GitHub. Sits on core only,
  and is imported by the composition root alone.
- [`src/shell/`](src/shell/README.md) — the transport: receiver, processor, applier, the fact sweep
  that turns a due schedule row into one decision per open item, and `main.ts`, the composition root
  where the seams meet.

The barrel re-exports the three; a consumer sees one package. Tests mirror the three under `test/`,
with one exception that proves the rule: `test/sweep.test.ts` is about the seam BETWEEN the adapter
and the shell, which neither directory may import the other across, so it sits above both and
reaches each through its barrel — the way the composition root does. Run it from the repository
root: `node --import tsx packages/runtime/src/shell/main.ts`.

**The package mutation break threshold is 90**, the gate the adapter and shell carried before the
merge. CI also enforces the store's existing 96 threshold from the same mutation report, so merging
the packages does not lower its ratchet.
