# Troubleshooting

The canonical SQLite record names the result directly:

- `satisfied`: GitHub reported a same-repository closing issue reference.
- `observedAbsent`: observe mode saw no reference and proposed nothing.
- `advisoryDesired`: dry-run saw no reference and recorded the one advisory it would want.
- `unknown`: the read was unavailable; no absence was invented and no advisory was proposed.
- `disabled`: configuration prevented evaluation.
- `ignored`: the webhook event or action is unsupported.
- `refused`: the payload is malformed, inconsistent, closed, or belongs to another repository.

`configRejected` means the YAML failed strict parsing. `modeUnsupported` means active mode was
requested even though the runnable process has no GitHub effect path.
