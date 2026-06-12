import { cronJobs } from "convex/server"
import { api } from "./_generated/api"

const crons = cronJobs()

// Evict presence rows whose heartbeat has gone stale (client crashed or closed
// without a clean leave). cleanupStale is idempotent and args-less.
crons.interval(
  "cleanup stale project presence",
  { minutes: 5 },
  api.projectPresence.cleanupStale,
  {},
)

export default crons
