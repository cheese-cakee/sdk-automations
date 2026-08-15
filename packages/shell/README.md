# Shell

Shell verifies the exact webhook bytes, durably accepts the delivery, acknowledges it, claims it,
loads strict configuration, and calls the linked-issue logic directly. It then atomically stores one
canonical report and completes the delivery through Store.

The configured repository comes from `REPO_OWNER` and `REPO_NAME`. Payload owner/name comparisons
are case-insensitive and fail closed on mismatch. Numeric repository and installation binding is
deferred to the real GitHub adapter.

The temporary linked-issue reader always returns `unknown`; it never turns unavailable data into an
absent link. `active` remains unsupported and there are no GitHub writes.
