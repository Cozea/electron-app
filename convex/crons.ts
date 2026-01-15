import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Clean up expired invitations every hour
crons.interval(
  "cleanup expired invitations",
  { hours: 1 },
  internal.invitations.cleanupExpired
)

export default crons
