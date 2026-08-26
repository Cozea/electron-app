# Project DevApps

Project DevApps promote a Cozea project into a reusable DevApp entry on the current Mac. They appear in the DevApps Store and every project's workbench launcher, and open inside the existing Dev Server tile.

## Current local scope

The shipping implementation is machine-local while WorkOS and authenticated Convex access are pending:

- publications and immutable release snapshots are persisted in the Electron renderer's local storage;
- the catalog never calls the undeployed `convex/devApps.ts` functions;
- Store cards are labeled **This Mac** so local availability is explicit;
- records are available only to this Cozea app profile on this device and are removed with its local app data;
- this is convenience scoping, not organization authorization or a cloud security boundary.

`VITE_FF_PROJECT_DEVAPPS` defaults to `true` and can disable all local Project DevApp UI when set to `false`.

## Launch lifecycle

1. The project menu shows **Launch as DevApp** when no local publication exists.
2. Cozea asks the user to choose a PNG, JPEG, or WebP logo. The renderer validates and center-crops it into a bounded square WebP before it is saved.
3. Cozea resolves the project's local workspace and inspects its runnable web configuration, including a single runnable nested package when applicable.
4. It verifies or prepares the command runtime, inventories project files, records the current Git revision when available, and fingerprints modified source.
5. The local catalog creates a stable project publication and immutable release `v1` without a network write.
6. Cozea navigates to the source project's workbench, opens the Dev Server singleton with the release's command/framework/port, prepares missing dependencies through the existing dev-server bootstrap, and auto-starts the preview.
7. The release and its logo appear under **Local DevApps** in the Store, the conditional **Local** launcher shelf, and open tile chrome.

If the project has no linked local folder, no runnable command, or an ambiguous command selection, publication stops with an actionable error instead of creating an unusable release.

## Update lifecycle

After publication, the menu action becomes **Update DevApp**. Updating repeats inspection and appends the next immutable local release while retaining the publication's chosen display name and logo. A legacy local entry that predates logo support asks for one on its next update. The stable publication points to that new active release. If its workbench tile is already mounted, Cozea replaces the stored launch metadata and restarts the local server so command, framework, port, and source changes take effect.

Each Local DevApp card shows its active version beside the DevApp name. The card does not expose a separate launch button or command/framework footer; DevApps are opened from Cozea's DevApp launcher. Clicking the DevApp artwork in the Store opens its local identity settings, where the user can change both its display name and artwork. The same editor is available under **Local DevApp** in the source project's settings.

Display-name and artwork changes appear immediately in the Store, launcher, and Project Settings. Artwork also refreshes in sidebar and mounted-workbench glyphs through the shared publication ID. These are local metadata edits: they do not rename the source project, inspect its files, append a release, restart the Dev Server, or affect built-in DevApps.

Opening the built-in Dev Server later clears Project DevApp metadata and restores the normal built-in tile identity.

## Local data model

The persisted local catalog keeps one record per source project:

- a stable publication identity and active release pointer;
- one editable display name and optimized raster logo data URL for the publication, stored only in the local catalog;
- source project name, slug, status, and update time for Store navigation;
- append-only releases with monotonically increasing version, detected framework, command, port, optional Git revision, source fingerprint, publisher, and creation time.

A Project DevApp is a launch recipe, not a hosted build artifact. It continues to use the source project's linked local checkout and local Dev Server runtime.

Local publications are a machine-wide launcher shelf: once at least one exists, every project shows a **Local** category alongside All, Development, and Assistant. Opening a DevApp from another project keeps the tile and layout in the destination workbench, while framework detection, terminal ownership, Dev Server state, and preview execution stay bound to the source project's opaque workspace and lane. Cozea creates an auxiliary source session with `ensureSession` only; it does not activate that session or background the destination project. If the source folder is missing or broken, launch stops and asks the user to relink it rather than falling back to the destination project's files.

## Runtime safety

Published commands are restricted to one recognized preview `package.json` script (`dev`, `start`, `develop`, `web`, or `serve`). On open, Cozea parses the command again, verifies that the referenced script exists in the local root or nested package, and uses that package directory for dependency preparation. Other script names, mixed-case aliases, shell operators, substitutions, redirections, extra arguments, and paths outside the project are rejected.

## Future WorkOS and Convex phase

The `devAppPublications` / `devAppReleases` schema and `convex/devApps.ts` remain a backend scaffold only. Its functions are internal so a normal Convex deployment cannot expose caller-supplied user IDs as a privacy boundary.

Before switching the renderer to the remote catalog:

1. configure verified WorkOS identity for the Convex client and functions;
2. derive the user and organization server-side instead of accepting identity from the client;
3. add organization/project authorization tests;
4. change the internal functions to authenticated public functions;
5. migrate or explicitly discard machine-local releases;
6. run the production Convex dry-run and obtain approval before `bunx convex deploy`.

Never use `convex dev` for this repository.
