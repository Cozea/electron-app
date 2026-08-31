# T3 substrate pin

Date: 2026-08-31

| Field | Value |
| --- | --- |
| Upstream | [Cozea/t3code](https://github.com/Cozea/t3code), based on [pingdotgg/t3code](https://github.com/pingdotgg/t3code) |
| Required pin SHA | `6d45ad94cb3982b61bf1c69c4b461169ddb75df3` (`6d45ad94`) |
| Recorded by | Parent repository `vendor/t3code` gitlink |
| Vendor strategy | Non-recursive Git submodule; `bun run prepare:t3-runtime` validates the gitlink and builds the pinned server |

Update this file whenever the shadow-server pin moves. Keep the Electron runtime
constant and parent gitlink synchronized. Generated contract banners record the
revision they were generated from and change only when contracts are regenerated.
