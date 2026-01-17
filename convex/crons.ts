import { cronJobs } from "convex/server"
import { internal } from "./_generated/api"

const crons = cronJobs()

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

export default crons
