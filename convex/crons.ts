import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

// Clean up expired invitations every hour
crons.interval(
  "cleanup expired invitations",
  { hours: 1 },
  internal.invitations.cleanupExpired
)

// Clean up expired AI continuation linkage every hour
crons.interval(
  "cleanup expired ai continuation state",
  { hours: 1 },
  internal.aiConversations.cleanupExpiredContinuationState,
  {}
)

// ============================================
// SYNC SYSTEM CRON JOBS
// ============================================

// Cleanup expired file tombstones (daily at 5:00 AM UTC)
crons.cron(
  "cleanup expired tombstones",
  "0 5 * * *",
  internal.fileTombstones.cleanupAllExpiredTombstones
)

// Cleanup stale Git replica session/lock metadata (daily at 5:30 AM UTC)
crons.cron(
  "cleanup replica metadata",
  "30 5 * * *",
  internal.projectReplicaGit.cleanupReplicaMetadata,
  {}
)

// Cleanup stale LFS metadata records with missing backing blobs (daily at 6:00 AM UTC)
crons.cron(
  "cleanup replica lfs metadata",
  "0 6 * * *",
  internal.projectReplicaLfs.cleanupStaleLfsMetadata,
  {}
)

// Identity invariant scan (daily at 6:15 AM UTC)
crons.cron(
  "identity invariant scan",
  "15 6 * * *",
  internal.identityRepair.runInvariantCheckDaily
)

// Cleanup stale Yjs awareness records (every 15 minutes)
crons.interval(
  "cleanup yjs awareness",
  { minutes: 15 },
  internal.yjsAwareness.cleanupExpiredAwarenessInternal,
  {}
)

// ============================================
// STORAGE TRACKING CRON JOBS
// ============================================

// Recalculate storage usage for all organizations (weekly on Sunday at 6:00 AM UTC)
crons.cron(
  "recalculate storage usage",
  "0 6 * * 0",
  internal.organizations.recalculateStorageUsageAll
)

export default crons
