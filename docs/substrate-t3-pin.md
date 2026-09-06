# T3 substrate pin

Date: 2026-09-06

| Field | Value |
| --- | --- |
| Upstream | [Cozea/t3code](https://github.com/Cozea/t3code), based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) |
| Required pin SHA | `7500499980b6d5e6cad483d8fea6b0586fc406eb` (`75004999`) |
| Recorded by | Parent repository `vendor/t3code` gitlink |
| Vendor strategy | Non-recursive Git submodule; `bun run prepare:t3-runtime` validates the gitlink and builds the pinned server |

Update this file whenever the shadow-server pin moves. Keep the Electron runtime
constant and parent gitlink synchronized. Generated contract banners record the
revision they were generated from and change only when contracts are regenerated.

This reviewed fork revision retains the provider-QA baseline and Cozea's managed
Computer Use MCP toolkit. The toolkit exposes the upstream open-computer-use
v0.3.3 nine-tool contract through the existing provider-scoped T3 MCP endpoint,
but forwards execution to the signed Electron main process over a private
loopback broker. It never installs a global MCP entry in provider home
configuration.

Accepted canonical terminal `thread.session-set` events are now forwarded to the
Electron broker for every thread, rather than only threads that already invoked a
Computer Use tool. Electron owns the authoritative per-thread policy/runtime
state and ignores unrelated terminal notifications. This lets scheduled threads
that were explicitly denied Computer Use release their deny policy only from T3's
accepted provider lifecycle, while ordinary interactive Computer Use still gets
upstream `notifications/turn-ended` cleanup. Stale terminal provider events do
not produce this notification because they never become an accepted
`thread.session-set` event.

## Cozea runtime policy patches

`scripts/prepare-t3-runtime.mjs` applies Cozea-owned policy patches to the built
server bundle after every fresh build and before development or distribution use.
The current patches:

- enable Cursor and OpenCode for fresh or sparse settings while leaving Grok
  opt-in and preserving an explicit persisted `enabled: false`;
- make provider CLI updates target the npm prefix that owns the selected
  executable, including a `~/.local/bin` launcher backed by
  `~/.local/lib/node_modules`, instead of whichever npm prefix happens to be
  active in the server process; and
- keep upstream product branding out of provider-update result copy.

Those parent-owned bundle policies remain separate from the Computer Use toolkit,
which is normal reviewed source in the pinned Cozea/t3code commit. A clean clone,
CI build, or packaged app therefore gets the same managed MCP surface from the
submodule pin rather than depending on an unpublished checkout.
`bun run prepare:t3-runtime:check` still validates every bundle-policy anchor and
fails loudly after a T3 repin until those policies are reviewed and refreshed.

## Codex history compatibility

This pin accepts completed sub-agent activity, newer collaboration tools/statuses,
account plans, and rate-limit errors in saved Codex history. Generator overrides
and generated schemas come from upstream fixes #8346, #8447, and #8897. Decode
failures preserve the native thread binding and surface an actionable compatibility
message. The broader upstream provider integration is tracked in
`docs/upstream-provider-integration-plan.md`.
