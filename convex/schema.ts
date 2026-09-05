import { defineSchema } from "convex/server"

import baseSchema from "./schema/base"
import { collaborationTables } from "./schema/collaboration"
import { collaborationRepositoryTables } from "./schema/collaborationRepositories"

// Keep the inherited schema in `schema/base.ts` while new domains move into
// owned modules. Collaboration v2 adds only low-volume control-plane records;
// customer source files and credentials never belong in Convex tables.
export default defineSchema({
  ...baseSchema.tables,
  ...collaborationTables,
  ...collaborationRepositoryTables,
})
