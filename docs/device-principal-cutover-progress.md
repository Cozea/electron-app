# Device-principal identity cutover progress

This branch is intentionally breaking. Cozea has no compatibility requirement for the old account-era identity model.

## Target invariant

- one physical Cozea installation/device is one principal
- `czd_...` is the immutable public device identity
- mutable presentation is device display name + avatar only
- authentication, authorization, collaboration encryption, and recovery never depend on presentation
- no human account abstraction, login account, email identity, first/last name, or multi-device user aggregation

## Implemented on this branch

- device-auth refresh no longer overwrites user-selected presentation
- explicit presentation-only mutation for device name/avatar
- first-run device naming/avatar onboarding
- sidebar and Device Identity settings consume canonical device presentation
- join links authorize the authenticated device principal directly
- join-link acceptance no longer creates a second trusted-device identity record
- project presence derives principal/name/avatar from server-side authentication
- file locks and tombstones derive actor identity from authenticated device authority
- collaboration gateway registration uses canonical principal metadata rather than caller-supplied labels/keys
- regression tests cover presentation isolation, onboarding, project principal authority, and collaboration authority

## Remaining destructive cleanup

- remove account-era schema fields/indexes and email notification remnants
- remove email-keyed project/organization invite paths and recent-contact caches
- remove `projectTrustedDevices` as an authorization source/table
- collapse duplicate collaboration device registry where room-key code permits
- remove account-shaped shared/session types and synthetic local email semantics
- normalize remaining activity/tasks/organization/DevApp attribution to device presentation
- move avatar persistence from transitional optimized data URL to durable storage
- update tests/docs and run full typecheck/lint/test/build gates
