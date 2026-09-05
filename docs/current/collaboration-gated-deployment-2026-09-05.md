# Gated production deployment, 2026-09-05

Production Convex functions/schema deployed from source `f2bea013` to
`knowing-finch-546` using `bunx convex deploy --typecheck enable`. The production
dry run passed and reported no deleted indexes. `COLLABORATION_G3_CREATE_ENABLED`
was explicitly set to `0` before deployment. No development deployment was used.

The deployment preflight caught `PublicationArgs` failing Convex's argument
constraint. Its concrete object type now satisfies that constraint, and both the
branch-validation and release workflows run the dedicated Convex typecheck.
Generated API bindings were refreshed by the actual production deploy.

The Worker compatibility deploy from `f2bea013` produced version
`da53da1c-9411-4599-8e2e-a29c8b9b41c3`. Adding the webhook secret produced version
`6fd3c21c-8122-4bb4-bea9-1a7f93f34e3f`. The webhook response correction from
`b1a64268` produced version `c8892554-97d3-49ee-8eb2-ba64305d2a3d`.
Checkpoint and closed-room metadata retention from `947a371e` then deployed as
version `93b92bad-b9db-4124-8d6f-2ca2b47f9f3a`, after 36 focused behavioral tests,
Worker/test typechecks, lint and a successful dry run.

Wrangler 4.123.0 used the pinned existing account and
`deploy --containers-rollout=none --keep-vars`, after successful dry runs.
Container images, instances, other namespaces and R2 buckets were not changed.
The existing protocol-2 capabilities endpoint remains compatible; session routes
enforce generation 3 separately. The desktop release gate remains off.

## Read-only verification and webhook state

- GitHub App `3150202`, `cozea-source-control`, belongs to Cozea. Installation
  `118021065` is active, unsuspended and selects all repositories. The existing
  user-supplied private key authenticated the App metadata requests.
- App permissions include contents/admin/workflows write and members/metadata read.
  Its event list was empty. These metadata reads do not establish user OAuth.
- A new webhook secret was generated in process memory and installed through
  Wrangler stdin. No private key, bearer token, OAuth secret or webhook secret
  was printed or committed.
- Both GitHub `GET /app/hook/config` and `PATCH /app/hook/config` returned 404.
  GitHub webhook activation/configuration remains pending; the user was asked to
  enable it in the existing App settings so API configuration can be retried.
- The deployed endpoint accepted a synthetic correctly signed ping with 204.
  After the response correction, an invalid signature returns 401. Health and
  legacy capabilities endpoints return 200. These probes made no repository or
  collaboration-data mutations and are not proof of actual GitHub delivery.
- Four behavioral webhook tests pass, covering signature validation, malformed
  bodies, installation revocation event routing and retryable backend failure.

The earlier [alpha inventory](collaboration-alpha-inventory-2026-09-05.md) found no
collaboration reset targets. No rows, room storage, local caches, ordinary
workspaces or Git history were deleted. Reinventory before enabling any rollout.

The original end-to-end release gate remains incomplete: desktop implementation,
actual OAuth and GitHub delivery, and independently authenticated packaged GUI
acceptance are still required. Rollback keeps creation disabled and preserves
local encrypted recovery. Computer tools remain unavailable in this running task
despite the user's enabled settings and explicit plugin tag.
