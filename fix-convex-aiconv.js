const fs = require('fs');

// 1. Fix convex/organizations.ts
let orgsFile = fs.readFileSync('convex/organizations.ts', 'utf8');
const clearAiConv = `          // Clear aiConversations
          const convos = await ctx.db
            .query("aiConversations")
            .withIndex("by_project", (q) => q.eq("projectId", project._id))
            .collect()
          for (const c of convos) {
            await ctx.db.delete(c._id)
          }`;
orgsFile = orgsFile.replace(clearAiConv, "");
fs.writeFileSync('convex/organizations.ts', orgsFile);

// 2. Fix convex/lib/workspaceLimits.ts
let workspaceFile = fs.readFileSync('convex/lib/workspaceLimits.ts', 'utf8');
workspaceFile = workspaceFile.replace(
  "  aiHistory: number // aiConversations message payloads\n",
  "  aiHistory: number // DEPRECATED\n"
);

const convosQuery = `      // 3. AI History
      let aiHistoryBytes = 0
      const convos = await ctx.db
        .query("aiConversations")
        .withIndex("by_project", (q) => q.eq("projectId", project._id))
        .collect()
      for (const conv of convos) {
        aiHistoryBytes += calculateDocSize(conv)
      }
      breakdown.aiHistory += aiHistoryBytes`;

workspaceFile = workspaceFile.replace(convosQuery, "");
fs.writeFileSync('convex/lib/workspaceLimits.ts', workspaceFile);

// 3. Fix convex/debug.ts
let debugFile = fs.readFileSync('convex/debug.ts', 'utf8');
const debugConv = `    const convos = await ctx.db
      .query("aiConversations")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
    for (const c of convos) {
      await ctx.db.delete(c._id)
      deletedCount++
    }`;
debugFile = debugFile.replace(debugConv, "");
fs.writeFileSync('convex/debug.ts', debugFile);
