# Org DevApps

Org DevApps publish a **built static artifact** to a Cozea-owned organization. Every org member can open every published DevApp in that org. Consumers never receive the source project, a local path, or a localhost recipe.

`VITE_FF_PROJECT_DEVAPPS` defaults to `true` and hides publish / Store / launcher / settings DevApp UI when set to `false`.

## Product rules

- Identity is a **Cozea organization** (create + email invite, same pattern as project team). This is not WorkOS.
- Left-nav **Publish** / **Update** only builds, packs, and uploads. It does not start a preview, navigate into Dev Server, or call `startDevServerRun`.
- Open path is an isolated in-Cozea tile (`addTile` + `orgDevApp`), never the Dev Server singleton and never `http://localhost:*`.
- Consumer payloads contain publication metadata + artifact identity only. They must not include `projectId`, `localPath`, git URL, `workspaceId`, `devCommand`, or `devPort`.
- Store cards are labeled with the **organization name**. Do not describe this catalog as This Mac / Local DevApps.

## Organizations

Convex tables:

- `organizations` — name, creator, timestamps
- `organizationMembers` — `admin` | `member`
- `organizationInvites` — email invite, pending/accepted/expired
- `projects.organizationId` — required before a project can publish

Settings → **Organizations** lists every org you belong to, its members and pending invites, and every DevApp published there. Org admins invite or remove members and can archive a DevApp. Accepting an invite uses the same email match as project team.

Every authenticated Convex function that lists or mutates an org checks membership with `requireOrgMember` / `requireOrgAdmin`. Do not trust a client-supplied “list this org” without that check.

## Publish lifecycle

1. The project overflow menu shows **Publish** when the project has no active artifact release.
2. If the project is not attached to an org, Cozea prompts to create one or attach an existing org you belong to.
3. First publish always asks for a PNG, JPEG, or WebP logo. Later **Update** reuses the publication logo unless it is missing.
4. Electron main detects a **build** script (not `dev`), runs it, and requires static `index.html` in `dist/`, `build/`, `out/`, or similar. Projects without a static UI fail with a clear error — this product does not ship `npm run dev` to the org.
5. Main packs the output as a zip, hashes it (SHA-256), uploads it to Convex `_storage`, and inserts an immutable `devAppReleases` row. The publication points at that release.
6. Name and logo live on the publication. Editing them in Project Settings or the identity dialog does not append a release.

If the project has no linked local folder, no `build` script, or no static `index.html` after build, publish stops without writing a release.

## Open lifecycle

1. Store **Your org** and the workbench launcher load `devApps.listMine` / `listForOrganization`.
2. Choosing an org DevApp resolves to `addTile` + `tileType: "orgDevApp"` (`publishedDevApp` launch kind).
3. The tile asks Convex for a short-lived artifact URL (`getArtifactUrl`), caches the zip under app data keyed by content hash, and navigates to `cozea-devapp://release/<hash>/index.html`.
4. `WorkbenchBrowserService` uses a per-publication session partition (`persist:cozea-devapp-<publicationId>`) and `navigationPolicy: "orgDevApp"`. Localhost, `file:`, and `http:` are rejected. `https:` is allowed for the app’s own hosted API.
5. Several org apps, Browser, and Dev Server can be open at once. They do not share a run key.

If a mini app needs a backend, that backend is hosted. The tile is only the built UI.

## Settings

The Organizations settings surface is the control plane for “which orgs we are part of”:

- list of orgs you belong to, with role
- members and pending invites
- DevApps published in the selected org (name, version, Open, Archive for admins)

Every org member sees the same DevApp list. Opening from Settings uses the same isolated tile path as the launcher.

## Data model

- `devAppPublications`: org-scoped, `visibility: "organization"`, editable name/logo, active release pointer, `projectId` is publisher-only
- `devAppReleases`: append-only version, `artifactStorageId`, `entryPath`, `contentHash`, framework. Legacy recipe fields (`devCommand` / `devPort`) remain optional on empty historical docs and are unused by the client

The machine-local `localProjectDevAppStore` is not a consumer catalog. Store, launcher, settings, and the left-nav publish control must not read it.

## Convex deploy

Promote schema and functions with `bunx convex deploy`. **Never** use `convex dev` for this repository.
