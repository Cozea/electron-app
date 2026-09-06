# T3 substrate pin

Date: 2026-09-06

| Field | Value |
| --- | --- |
| Upstream | [Cozea/t3code](https://github.com/Cozea/t3code), based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) |
| Required pin SHA | `c594c87fabcbbdab1e2ca99a7afa7a3495e76b40` (`c594c87f`) |
| Recorded by | Parent repository `vendor/t3code` gitlink |
| Vendor strategy | Non-recursive Git submodule; `bun run prepare:t3-runtime` validates the gitlink and builds the pinned server |

Update this file whenever the shadow-server pin moves. Keep the Electron runtime
constant and parent gitlink synchronized. Generated contract banners record the
revision they were generated from and change only when contracts are regenerated.

This reviewed fork revision retains the provider-QA baseline and adds Cozea's
managed Computer Use MCP toolkit. The toolkit exposes the upstream
open-computer-use v0.3.3 nine-tool contract through the existing provider-scoped
T3 MCP endpoint, but forwards execution to the signed Electron main process over
a private loopback broker. It never installs a global MCP entry in provider home
configuration.

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
