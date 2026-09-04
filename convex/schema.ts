import { defineSchema } from "convex/server"

import baseSchema from "./schema/base"
import { collaborationTables } from "./schema/collaboration"

// Keep the existing schema byte-for-byte in `schema/base.ts` while new domains
// move into owned modules. This avoids another monolithic schema edit and gives
// collaboration v2 a clear boundary that can be reviewed and migrated alone.
export default defineSchema({
  ...baseSchema.tables,
  ...collaborationTables,
})
