# D1 compatible backport (0.20.0 / SDK0.2.0-rc.2)

This branch is based on upstream tagv0.20.0, commit362043a22a186733329f2d9167bd309174de78f9. It is not an upgrade to current upstream0.21.6, which targets a different SDK line. No npm publication, host plugin activation, profile edit or server restart is part of this change.

## Fix and boundaries

- Allocate replay authority before asynchronous reads/schema enumeration; older results cannot replace newer restrictions.
- Version disabled-map reads and committed cache updates so late I/O cannot roll back the execution guard's cached policy.
- Settings writes and disposal invalidate pending carrier/replay publication; disposed APIs cannot restart it.
- Equivalent policies reuse the cached value (server/tool order and duplicate entries do not matter). A genuinely newer standalone sidecar snapshot reconciles the interrupted apply instead of stranding an old visibility layer.
- Preserve the previously backported per-agent layer/key CPU fix. The originalv0.20.0 tag did not contain it; this source backport carries it deliberately. No schema-isolation/deep-copy semantics were changed.

Reconciliation assumes eventually completing dependencies and finitely changing policies. Ordinary reads outside an active apply are still reads, not a new watcher. Arbitrary synchronous reentrant host teardown is not newly guaranteed.

## Verification and safety

`npm run build` automatically executes `scripts/sync-profile.mjs`, which can mirror builds into **all installed profiles**. Never run it here against a working HOME/DSH_HOME. CI and local verification use private empty roots; CI has contents-read permission only and installation hooks are disabled.

Regression tests import the actual compiled module: both completion orders, read/schema/settings races, cache-reader liveness, wildcard reconciliation, disposal, equivalent-policy traffic and unchanged-layer convergence. A separate test uses actual Cordis/ToolRuntime/scopes and several real debounce windows, without connecting to a running server or reading its profile.

The execution predicate is tested; this is not a claim about every host permission/approval boundary or live-server CPU/RAM. Persistent RAM leakage remains unproven. Installed module identity is checked separately; passing source tests does not mean a running server loaded this backport.

O2, D2, known-tools/state-catalog lifecycle findings and unrelated upstream changes are not included. Any activation of this patched version requires a separate coordinated owner decision and a verified exact-version rollback plan.
