# automation-runtime — everything that runs

The one package that touches the outside world, as three directories: `src/store/` is the owned
operational store, `src/adapter/` the only code that talks to GitHub, and `src/shell/` the transport
that composes them. It may import core and the capabilities the shell composes, and nothing else.
Inside it, the store and the adapter reach core alone, and only the shell's composition root may name
the adapter — so no credential exists anywhere else.

The tree, and the three layering locks that hold those directions in place, are
[`design/architecture.md`](../../design/architecture.md) §1. Running the endpoint — the environment,
what arms writes and what arms the sweep, the switches, the commands — is
[`docs/running.md`](../../docs/running.md).

The barrel re-exports the three, so a consumer names one package, and `test/` mirrors `src/`.

```bash
pnpm --filter @hiero-hackers/automation-runtime test
pnpm start
```
