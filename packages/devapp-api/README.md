# `@cozea/devapp-api`

Typed view-to-worker transport and manifest types for native Cozea DevApps.

```ts
import { createDevAppClient, type DevAppMethodDefinition } from "@cozea/devapp-api";

interface Methods {
  ping: DevAppMethodDefinition<{ message: string }, { ok: boolean }>;
}

const worker = createDevAppClient<Methods>();
const response = await worker.request("ping", { message: "hello" });
```

The package's `./schema` export is the generated `cozea-devapp.json` JSON Schema. The full
authoring guide is distributed with Cozea as `devapp-authoring.md`.

Development workers are trusted local code and require explicit session approval. Published
worker execution remains disabled until Cozea's isolated runtime is available.
