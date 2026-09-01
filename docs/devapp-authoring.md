# Native DevApp authoring

Native DevApps are normal Cozea projects with a `cozea-devapp.json` manifest at the package root. They may contain a view, a trusted local development worker, a service, or any combination of those parts.

## Start a project

Use **Create native DevApp** beside the normal project creation actions, or from the DevApps browsing page. Cozea creates a managed Git project and lets you choose **View**, **Worker**, or **View + worker**. The scaffold contains:

- `cozea-devapp.json`, validated against the current host contract;
- `.cozea/cozea-devapp.schema.json` and editor schema association;
- a dependency-free view starter and built output;
- a versioned worker starter when selected;
- a typed view client example using `@cozea/devapp-api`;
- build scripts that use Bun.

The workbench opens the development preview immediately. **Open existing DevApp** imports an existing folder through the ordinary project attachment flow and requires a valid manifest. Ordinary folder import also detects a root DevApp manifest: valid packages open their preview; invalid manifests are reported instead of being ignored.

## Test inside another project

Development DevApps are device-local and never appear in the published Store. Open the target project, choose **Add Tile**, and select the local DevApp under **Development**. The tile keeps an opaque development reference and source workspace ID; it never persists the source path or copies source into the target project. This supports integration testing against a separate project while the DevApp remains owned and edited in its own repository.

## Manifest

The public schema is generated from `shared/devAppPackage.ts`:

```sh
bun run devapp:generate
bun run devapp:check
```

The generated file is `packages/devapp-api/schema/cozea-devapp.schema.json`. The manifest version and worker protocol version are independent. Unknown capabilities fail closed. A manifest requests capabilities; only an explicit development approval grants them.

Workers declare agent-facing operations explicitly rather than setting an exposure flag:

```json
{
  "worker": {
    "entry": "worker/index.js",
    "protocolVersion": 1,
    "capabilities": ["project.read"],
    "tools": [
      {
        "name": "search_project",
        "description": "Search the current project for matching source text.",
        "inputSchema": {
          "type": "object",
          "properties": { "query": { "type": "string" } },
          "required": ["query"],
          "additionalProperties": false
        }
      }
    ]
  }
}
```

Tool names are package-local lowercase identifiers. Input schemas are bounded object JSON Schemas
without `$ref`; a worker with no operations writes `"tools": []`. The authenticated agent MCP
session exposes `devapp_tool_catalog`, which returns these declarations for an existing development
preview. The catalog reports `toolInvocationAvailable: false` until Phase 8 supplies the contained
runtime required for autonomous execution.

## Typed view/worker client

`@cozea/devapp-api` exports the manifest types and `createDevAppClient`. Define the private methods shared by the package view and worker:

```ts
import { createDevAppClient, type DevAppMethodDefinition } from "@cozea/devapp-api";

interface Methods {
  search: DevAppMethodDefinition<{ query: string }, { paths: string[] }>;
}

const worker = createDevAppClient<Methods>();
const result = await worker.request("search", { query: "manifest" });
```

The client uses the MessagePort transferred only to that package's view. It supplies request correlation, bounded timeouts, structured errors, and typed results. The view does not receive host capabilities; the worker holds the approved grant and the main process enforces it.

The package is built as a self-contained browser ESM distribution with declarations; it does not reach back into Cozea's private source tree. `bun run --cwd packages/devapp-api build` produces the publishable `dist`, and `bun pm pack --dry-run` verifies the public package boundary without publishing it.

## Programmatic publishing

`publishNativeDevAppProgrammatically` in `apps/desktop/src/features/devapps/devAppAuthoringPublish.ts` publishes without opening a dialog. It validates the root manifest and derives the publication name and description from it. The caller supplies an authenticated Convex client, project/workspace IDs, and a logo data URL for the first publication. Upload reservations, artifact verification, organization authorization, and immutable release registration are identical to the UI path.

## Security boundary

Development workers are trusted local developer code and run in Cozea's managed utility-process host with an approved capability grant. They are not consumer apps and are not represented as an OS sandbox. Published or externally sourced worker execution remains disabled until the Phase 8 container/VM runtime ships. Static and service publication behavior is unchanged.

## In-product agent documentation

Cozea's authenticated MCP server exposes the read-only `devapp_authoring_docs` and
`devapp_tool_catalog` tools. They summarize the authoring contract and inspect declared operations
without granting a capability or invoking worker code.
