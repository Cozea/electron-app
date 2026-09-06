# Device-principal identity cutover progress

This branch is intentionally breaking. Cozea has no compatibility requirement for the old account-era identity model.

## Target invariant

- one physical Cozea installation/device is one principal
- `czd_...` is the immutable public device identity
- mutable presentation is device display name + avatar only
- authentication, authorization, collaboration encryption, and recovery never depend on presentation
- no human account abstraction, login account, email identity, first/last name, or multi-device user aggregation

## Implemented on this branch

- canonical `devicePrincipals` schema/API replaces the account-era `users` model
- WorkOS/email/first-name/last-name account identity fields and indexes are removed from the principal schema
- device-auth refresh no longer overwrites user-selected presentation
- explicit presentation-only mutation for device name
- avatars use Convex Storage with image/size validation and replacement cleanup
- first-run device naming/avatar onboarding
- sidebar and Device Identity settings consume canonical device presentation
- email-keyed project and organization invite modules/routes are removed
- explicit project and organization device enrollment flows use `czd_...` identity keys
- join links authorize the authenticated device principal directly
- join-link acceptance no longer creates a second trusted-device identity record
- project presence derives principal/name/avatar from server-side authentication
- file locks and tombstones derive actor identity from authenticated device authority
- the duplicate `projectTrustedDevices` authorization path/table is removed
- collaboration gateway authority and encryption metadata resolve from the canonical device principal
- the duplicate `collabDevices` registry is removed from the active Yjs path
- task assignment is being normalized to device identity instead of email identity
- activity, organization membership, DevApp publisher attribution, and collaboration presentation use device-principal metadata
- regression tests cover presentation isolation, onboarding, project principal authority, and collaboration authority

## Validation remaining

- finish compiler-driven cleanup of any stale account-shaped renderer/task contracts
- run desktop, Cloudflare, and test typechecks
- run identity tests, lint, full tests, and production build
- update PR status to ready only after the branch is green
