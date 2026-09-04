# T3 substrate pin

Date: 2026-09-05

| Field | Value |
| --- | --- |
| Upstream | [Cozea/t3code](https://github.com/Cozea/t3code), based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) |
| Required pin SHA | `e6fd2165c7c1e8a1a0563c993d5205d53480130b` (`e6fd2165`) |
| Recorded by | Parent repository `vendor/t3code` gitlink |
| Vendor strategy | Non-recursive Git submodule; `bun run prepare:t3-runtime` validates the gitlink and builds the pinned server |

Update this file whenever the shadow-server pin moves. Keep the Electron runtime
constant and parent gitlink synchronized. Generated contract banners record the
revision they were generated from and change only when contracts are regenerated.

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

The patch is intentionally maintained in the parent repository so a clean clone,
CI build, or packaged app does not depend on local settings or an unpublished
submodule commit. `bun run prepare:t3-runtime:check` validates every bundle anchor
and fails loudly after a T3 repin until the policy patch is reviewed and refreshed.

## Codex history compatibility

This pin accepts completed sub-agent activity, newer collaboration tools/statuses,
account plans, and rate-limit errors in saved Codex history. Generator overrides
and generated schemas come from upstream fixes #8346, #8447, and #8897. Decode
failures preserve the native thread binding and surface an actionable compatibility
message. The broader upstream provider integration is tracked in
`docs/upstream-provider-integration-plan.md`.
