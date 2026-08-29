import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Evict presence rows whose heartbeat has gone stale (client crashed or closed
// without a clean leave). cleanupStale is idempotent and args-less.
crons.interval(
  "cleanup stale project presence",
  { minutes: 5 },
  internal.projectPresence.cleanupStale,
  {},
)

crons.daily(
  "cleanup expired identity security state",
  { hourUTC: 3, minuteUTC: 15 },
  internal.fileTombstones.cleanupAllExpiredTombstones,
  {},
)

export default crons
