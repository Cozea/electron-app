const fs = require('fs');
let file = fs.readFileSync('convex/organizations.ts', 'utf8');

file = file.replace(
  `    const now = Date.now()
    const periodStart =
      args.period === "daily"
        ? getUtcDayStartTimestamp(now)
        : getUtcMonthStartTimestamp(now)

    const org = await ctx.db.get(args.orgId)`,
  `    const org = await ctx.db.get(args.orgId)`
);

fs.writeFileSync('convex/organizations.ts', file);
