# T3 substrate pin

Date: 2026-09-02

| Field | Value |
| --- | --- |
| Upstream | [Cozea/t3code](https://github.com/Cozea/t3code), based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) |
| Required pin SHA | `46c3f1217730a819fc79e95b7684784312269602` (`46c3f121`) |
| Recorded by | Parent repository `vendor/t3code` gitlink |
| Vendor strategy | Non-recursive Git submodule; `bun run prepare:t3-runtime` validates the gitlink and builds the pinned server |

Update this file whenever the shadow-server pin moves. Keep the Electron runtime
constant and parent gitlink synchronized. Generated contract banners record the
revision they were generated from and change only when contracts are regenerated.

## Cozea runtime policy patches

`scripts/prepare-t3-runtime.mjs` applies Cozea-owned policy patches to the built
server bundle after every fresh build and before development or distribution use.
The current patch enables Cursor and OpenCode for fresh or sparse settings while
leaving Grok opt-in and preserving an explicit persisted `enabled: false`.

The patch is intentionally maintained in the parent repository so a clean clone,
CI build, or packaged app does not depend on local settings or an unpublished
submodule commit. `bun run prepare:t3-runtime:check` validates every bundle anchor
and fails loudly after a T3 repin until the policy patch is reviewed and refreshed.
