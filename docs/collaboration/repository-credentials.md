# Background repository credentials

The `sessionRepositoryCredentials:forPullRequest` action issues GitHub.com installation tokens for the authenticated device's active collaboration session. It requires active non-viewer session membership, project edit access, and an exact match between the session remote and the canonical project repository. The device cannot choose an installation or repository ID.

An operator must configure these Convex environment values through the existing secret-management process:

- `COZEA_GITHUB_APP_ID`: the GitHub App ID or client ID used as the JWT issuer.
- `COZEA_GITHUB_APP_PRIVATE_KEY`: the App's RSA private key. Keep it server-side.
- `COZEA_GITHUB_REPOSITORY_GRANTS`: a JSON array of `{projectId, repositoryUrl, installationId, repositoryId, allowGitWrite?}` bindings. Repository URLs must exactly match the validated canonical project and session URL. Duplicate matches are refused. Git-write issuance requires `allowGitWrite: true`; omission authorizes only PR credentials.

Provision grants only after independently verifying that the project operator controls the intended installation and repository. Project source-control metadata alone does not establish that authority. Never put private keys or installation tokens in this document, remote URLs, renderer state, command arguments or logs.

Each token request explicitly selects one repository ID and requests `contents: read` and `pull_requests: write`. These credentials support PR operations, not AutoGit pushes. The action checks authorization again after issuance and sanitizes provider failures. Token expiration is returned for callers to respect; credentials are not stored in Convex documents.

The separate `sessionRepositoryCredentials:forGitWrite` action requires the explicit Git-write grant and requests only `contents: write` for the selected repository. It uses the same device/session/project checks and post-issuance recheck. Background-session AutoGit, active-session merge and target-monitor network commands acquire credentials per operation through the temporary socket broker. Fetch and push URLs are resolved independently and must identify the same repository before a push, so checkpoint reconciliation reads the repository that received it. Multiple URLs and conflicting second-stage URL rewrites are refused. Cozea-owned GitHub SSH commands use HTTPS without changing repository config. Repository and branch protections continue to govern GitHub writes. Git LFS transport, frozen-session recovery previews and live GitHub qualification remain unfinished.

The daemon installs this provider for sessions with saved background access. Each PR request loads the existing device identity, authenticates with the cloud, and calls the issuer. It checks the returned project, exact GitHub repository and expiration, then rechecks local identity and active session intent before using the token. Tokens are not persisted or sent through the renderer. Leaving the session retains recovery data but removes authorization to acquire repository credentials.

Implementation status: issuer, daemon acquisition and command/UI wiring exist locally. Deployment, environment provisioning, live GitHub acceptance and independent grant-capability discovery remain outstanding. The PR action can currently report an authorization error when an operator has not provisioned the issuer. Use the project's production deployment workflow; never use `convex dev`.

References: [installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app), [App JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app).
