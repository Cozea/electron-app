import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()
const internalAny = internal as unknown as Record<string, Record<string, unknown>>

// Clean up expired invitations every hour
crons.interval(
  "cleanup expired invitations",
  { hours: 1 },
  internal.invitations.cleanupExpired
)

// ============================================
// BILLING CRON JOBS
// ============================================

// Check overage thresholds and create invoices (daily at 2:00 AM UTC)
crons.cron(
  "check overage thresholds",
  "0 2 * * *",
  internal.billing.checkOverageThresholds
)

// Expire credit lots that have passed their expiration date (daily at 3:00 AM UTC)
crons.cron(
  "expire credit lots",
  "0 3 * * *",
  internal.billing.expireCreditLots
)

// Check and reset billing periods (daily at 4:00 AM UTC)
crons.cron(
  "check billing period resets",
  "0 4 * * *",
  internal.billing.checkBillingPeriodResets
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
  internalAny.projectReplicaGit
    .cleanupReplicaMetadata as Parameters<typeof crons.cron>[2]
)

// Cleanup stale LFS metadata records with missing backing blobs (daily at 6:00 AM UTC)
crons.cron(
  "cleanup replica lfs metadata",
  "0 6 * * *",
  internalAny.projectReplicaLfs
    .cleanupStaleLfsMetadata as Parameters<typeof crons.cron>[2]
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
