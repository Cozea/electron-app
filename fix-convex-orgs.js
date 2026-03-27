const fs = require('fs');
let file = fs.readFileSync('convex/organizations.ts', 'utf8');

// Remove aiUsage and aiUsageAggregates from deleteOrganization
const deleteLogic = `    // 4. Delete all AI usage records
    const aiUsage = await ctx.db
      .query("aiUsage")
      .withIndex("by_organization", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const usage of aiUsage) {
      await ctx.db.delete(usage._id)
    }

    // 5. Delete all AI usage aggregates
    const aggregates = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) => q.eq("organizationId", args.orgId))
      .collect()
    for (const aggregate of aggregates) {
      await ctx.db.delete(aggregate._id)
    }

`;
file = file.replace(deleteLogic, "");

// Modify getUsageSummary
const usageSummaryOld = `    const aggregate = await ctx.db
      .query("aiUsageAggregates")
      .withIndex("by_organization_and_period", (q) =>
        q
          .eq("organizationId", args.orgId)
          .eq("period", args.period)
          .eq("periodStart", periodStart)
      )
      .first()

    const org = await ctx.db.get(args.orgId)
    const billingSnapshot = org
      ? await resolveOrganizationBillingSnapshot(ctx, {
          organization: org,
        })
      : null
    const aggregateWithTrackedUnits = aggregate
      ? {
          ...aggregate,
          totalTrackedUnits: aggregate.totalTrackedUnits,
        }
      : null

    return {
      aggregate: aggregateWithTrackedUnits,
      trackedUsage: {
        totalTrackedUnits: aggregate?.totalTrackedUnits ?? 0,
      },
      billingSnapshot,`;

const usageSummaryNew = `    const org = await ctx.db.get(args.orgId)
    const billingSnapshot = org
      ? await resolveOrganizationBillingSnapshot(ctx, {
          organization: org,
        })
      : null

    return {
      aggregate: null,
      trackedUsage: {
        totalTrackedUnits: 0,
      },
      billingSnapshot,`;

file = file.replace(usageSummaryOld, usageSummaryNew);

fs.writeFileSync('convex/organizations.ts', file);
